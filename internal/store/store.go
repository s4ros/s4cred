package store

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"database/sql/driver"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"time"

	"modernc.org/sqlite"
)

var (
	ErrNotFound = errors.New("note not found")
	ErrCapacity = errors.New("capacity exceeded")
	ErrInvalid  = errors.New("invalid note")
)

const MaxCiphertext = 1_000_016

const FileRetentionGrace = 180 * time.Second

const operationTimeout = 10 * time.Second

type Material struct {
	LinkSecret []byte
	Meta       []byte // nil for a text note
	Nonce      []byte // nil for a text note
}

type Secret struct {
	Ciphertext []byte
	Nonce      []byte
	FileID     []byte // nil for a text note
	FileNonce  []byte
	FileSize   int64
}

type Store struct {
	db       *sql.DB
	maxNotes int64
	maxBytes int64
	now      func() time.Time
	timeout  time.Duration
}

// Open serializes this process's transactions and acquires SQLite's write lock
// before evaluating expiration or capacity, including against external writers.
func Open(path string, maxNotes, maxBytes int64) (*Store, error) {
	return open(path, maxNotes, maxBytes, operationTimeout)
}

func open(path string, maxNotes, maxBytes int64, timeout time.Duration) (*Store, error) {
	if path == "" || maxNotes <= 0 || maxBytes <= 0 || timeout <= 0 {
		return nil, ErrInvalid
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	u := url.URL{Scheme: "file", Path: path}
	q := u.Query()
	q.Add("_pragma", "secure_delete(1)")
	// Retry lock contention in Go instead of an uninterruptible SQLite busy wait.
	q.Add("_pragma", "busy_timeout(0)")
	q.Set("_txlock", "immediate")
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	err = retryBusy(ctx, func() error {
		_, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS notes (
			id_hash BLOB PRIMARY KEY NOT NULL,
			read_token_hash BLOB NOT NULL,
			ciphertext BLOB NOT NULL,
			nonce BLOB NOT NULL,
			expires_at INTEGER NOT NULL,
			link_secret BLOB,
			file_id BLOB,
			file_nonce BLOB,
			file_size INTEGER
		);
		CREATE INDEX IF NOT EXISTS notes_expiration ON notes(expires_at);
		CREATE TABLE IF NOT EXISTS deliveries (
			file_id BLOB PRIMARY KEY NOT NULL,
			delete_after INTEGER NOT NULL
		);`)
		if err != nil {
			return err
		}
		var has int
		if err = db.QueryRowContext(ctx, `SELECT count(*) FROM pragma_table_info('notes') WHERE name = 'link_secret'`).Scan(&has); err != nil {
			return err
		}
		if has == 0 {
			if _, err = db.ExecContext(ctx, `ALTER TABLE notes ADD COLUMN link_secret BLOB`); err != nil {
				return err
			}
		}
		for _, column := range []struct{ name, def string }{
			{"file_id", "BLOB"},
			{"file_nonce", "BLOB"},
			{"file_size", "INTEGER"},
		} {
			var has int
			if err = db.QueryRowContext(ctx, `SELECT count(*) FROM pragma_table_info('notes') WHERE name = ?`, column.name).Scan(&has); err != nil {
				return err
			}
			if has == 0 {
				if _, err = db.ExecContext(ctx, `ALTER TABLE notes ADD COLUMN `+column.name+` `+column.def); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		db.Close()
		return nil, err
	}
	// Runtime operations keep the production deadline even when startup uses a shorter test deadline.
	return &Store{db: db, maxNotes: maxNotes, maxBytes: maxBytes, now: time.Now, timeout: operationTimeout}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func ValidTTL(ttl int64) bool { return ttl == 3600 || ttl == 86400 || ttl == 604800 }

// retryBusy keeps both SQLite lock acquisition and commit inside the deadline.
func retryBusy(ctx context.Context, operation func() error) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := operation()
		var sqliteErr *sqlite.Error
		if !errors.As(err, &sqliteErr) || sqliteErr.Code()&0xff != 5 { // SQLITE_BUSY
			return err
		}
		timer := time.NewTimer(10 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

type transaction struct {
	*sql.Conn
	committed bool
}

func (s *Store) begin(ctx context.Context) (*transaction, error) {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	err = retryBusy(ctx, func() error {
		_, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE")
		return err
	})
	if err != nil {
		// A canceled BEGIN may have acquired a transaction before returning.
		_ = conn.Raw(func(any) error { return driver.ErrBadConn })
		_ = conn.Close()
		return nil, err
	}
	return &transaction{Conn: conn}, nil
}

func (tx *transaction) commit(ctx context.Context) error {
	err := retryBusy(ctx, func() error {
		_, err := tx.ExecContext(ctx, "COMMIT")
		return err
	})
	if err == nil {
		tx.committed = true
	}
	return err
}

func (tx *transaction) close() {
	if !tx.committed {
		if _, err := tx.ExecContext(context.Background(), "ROLLBACK"); err != nil {
			// Never return a connection with an uncertain transaction to the pool.
			_ = tx.Raw(func(any) error { return driver.ErrBadConn })
		}
	}
	_ = tx.Conn.Close()
}

// Create stores ciphertext and the token verifier, returning a random public identifier.
func (s *Store) Create(ctx context.Context, ciphertext, nonce, tokenHash []byte, ttl int64) (string, error) {
	if len(ciphertext) < 17 || len(ciphertext) > MaxCiphertext || len(nonce) != 12 || len(tokenHash) != 32 || !ValidTTL(ttl) {
		return "", ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	var id [32]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	idHash := sha256.Sum256(id[:])
	if err := s.insert(ctx, idHash[:], tokenHash, ciphertext, nonce, nil, nil, nil, 0, ttl); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(id[:]), nil
}

func validLinkSecret(secret []byte) bool {
	if len(secret) == 110 && secret[0] == 0x02 && secret[1] == 0x00 {
		return true
	}
	return len(secret) == 154 && secret[0] == 0x02 && secret[1] == 0x01
}

// CreateSealed stores a note under a caller-supplied identifier hash.
// linkSecret is an opaque sealed package; the raw short code is not stored.
func (s *Store) CreateSealed(ctx context.Context, idHash, linkSecret, ciphertext, nonce, tokenHash []byte, ttl int64) error {
	if len(idHash) != 32 || !validLinkSecret(linkSecret) || len(ciphertext) < 17 || len(ciphertext) > MaxCiphertext || len(nonce) != 12 || len(tokenHash) != 32 || !ValidTTL(ttl) {
		return ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	return s.insert(ctx, idHash, tokenHash, ciphertext, nonce, linkSecret, nil, nil, 0, ttl)
}

func (s *Store) CreateFile(ctx context.Context, idHash, linkSecret, metaCiphertext, metaNonce, tokenHash, fileID, fileNonce []byte, fileSize, ttl int64) error {
	if len(idHash) != 32 || !validLinkSecret(linkSecret) || len(metaCiphertext) < 17 || len(metaCiphertext) > 4112 || len(metaNonce) != 12 || len(tokenHash) != 32 || len(fileID) != 16 || len(fileNonce) != 12 || bytes.Equal(metaNonce, fileNonce) || fileSize < 17 || fileSize > 33_554_448 || !ValidTTL(ttl) {
		return ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	return s.insert(ctx, idHash, tokenHash, metaCiphertext, metaNonce, linkSecret, fileID, fileNonce, fileSize, ttl)
}

func (s *Store) insert(ctx context.Context, idHash, tokenHash, ciphertext, nonce, linkSecret, fileID, fileNonce []byte, fileSize, ttl int64) error {
	tx, err := s.begin(ctx)
	if err != nil {
		return err
	}
	defer tx.close()
	now := s.now()
	var count, bytes int64
	if err := tx.QueryRowContext(ctx, `SELECT count(*), coalesce(sum(length(ciphertext) + coalesce(file_size, 0)), 0) FROM notes WHERE expires_at > ?`, now.UnixNano()).Scan(&count, &bytes); err != nil {
		return err
	}
	incoming := int64(len(ciphertext))
	if fileID != nil {
		incoming += fileSize
	}
	if count >= s.maxNotes || incoming > s.maxBytes || bytes > s.maxBytes-incoming {
		return ErrCapacity
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	var storedSize any
	if fileID != nil {
		storedSize = fileSize
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO notes (id_hash, read_token_hash, ciphertext, nonce, expires_at, link_secret, file_id, file_nonce, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, idHash, tokenHash, ciphertext, nonce, now.Add(time.Duration(ttl)*time.Second).UnixNano(), linkSecret, fileID, fileNonce, storedSize)
	if err != nil {
		var sqliteErr *sqlite.Error
		if errors.As(err, &sqliteErr) && sqliteErr.Code()&0xff == 19 { // SQLITE_CONSTRAINT
			return ErrInvalid
		}
		return err
	}
	return tx.commit(ctx)
}

// Material returns the sealed package for a short code without deleting the note.
func (s *Store) Material(ctx context.Context, code []byte) (Material, error) {
	if len(code) != 16 {
		return Material{}, ErrNotFound
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	idHash := sha256.Sum256(code)
	tx, err := s.begin(ctx)
	if err != nil {
		return Material{}, err
	}
	defer tx.close()
	var secret, meta, nonce, fileID []byte
	err = tx.QueryRowContext(ctx, `SELECT link_secret, ciphertext, nonce, file_id FROM notes WHERE id_hash = ? AND expires_at > ? AND link_secret IS NOT NULL`, idHash[:], s.now().UnixNano()).Scan(&secret, &meta, &nonce, &fileID)
	if errors.Is(err, sql.ErrNoRows) {
		return Material{}, ErrNotFound
	}
	if err != nil {
		return Material{}, err
	}
	out := Material{LinkSecret: append([]byte(nil), secret...)}
	if fileID != nil {
		out.Meta = append([]byte(nil), meta...)
		out.Nonce = append([]byte(nil), nonce...)
	}
	return out, nil
}

// Consume verifies and deletes a note in one transaction before returning it.
func (s *Store) Consume(ctx context.Context, id, token []byte, acceptFile bool) (Secret, error) {
	if (len(id) != 32 && len(id) != 16) || len(token) != 32 {
		return Secret{}, ErrNotFound
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	idHash, tokenHash := sha256.Sum256(id), sha256.Sum256(token)
	tx, err := s.begin(ctx)
	if err != nil {
		return Secret{}, err
	}
	defer tx.close()
	now := s.now()
	var storedHash, ciphertext, nonce, fileID, fileNonce []byte
	var fileSize sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT read_token_hash, ciphertext, nonce, file_id, file_nonce, file_size FROM notes WHERE id_hash = ? AND expires_at > ?`, idHash[:], now.UnixNano()).Scan(&storedHash, &ciphertext, &nonce, &fileID, &fileNonce, &fileSize)
	if errors.Is(err, sql.ErrNoRows) {
		return Secret{}, ErrNotFound
	}
	if err != nil {
		return Secret{}, err
	}
	if subtle.ConstantTimeCompare(storedHash, tokenHash[:]) != 1 {
		return Secret{}, ErrNotFound
	}
	if fileID != nil && !acceptFile {
		return Secret{}, ErrNotFound
	}
	if fileID != nil && (len(fileID) != 16 || len(fileNonce) != 12 || !fileSize.Valid || fileSize.Int64 < 17) {
		return Secret{}, fmt.Errorf("invalid file row")
	}
	if err := ctx.Err(); err != nil {
		return Secret{}, err
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM notes WHERE id_hash = ?`, idHash[:])
	if err != nil {
		return Secret{}, err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		return Secret{}, fmt.Errorf("delete note failed")
	}
	out := Secret{Ciphertext: append([]byte(nil), ciphertext...), Nonce: append([]byte(nil), nonce...)}
	if fileID != nil {
		if _, err := tx.ExecContext(ctx, `INSERT INTO deliveries (file_id, delete_after) VALUES (?, ?)`, fileID, now.Add(FileRetentionGrace).UnixNano()); err != nil {
			return Secret{}, err
		}
		out.FileID = append([]byte(nil), fileID...)
		out.FileNonce = append([]byte(nil), fileNonce...)
		out.FileSize = fileSize.Int64
	}
	if err := tx.commit(ctx); err != nil {
		return Secret{}, err
	}
	return out, nil
}

func (s *Store) Cleanup(ctx context.Context) ([][]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	tx, err := s.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.close()
	now := s.now().UnixNano()
	ids, err := fileIDs(ctx, tx, `SELECT file_id FROM notes WHERE expires_at <= ? AND file_id IS NOT NULL`, now)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM notes WHERE expires_at <= ?`, now); err != nil {
		return nil, err
	}
	due, err := fileIDs(ctx, tx, `SELECT file_id FROM deliveries WHERE delete_after <= ?`, now)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM deliveries WHERE delete_after <= ?`, now); err != nil {
		return nil, err
	}
	if err := tx.commit(ctx); err != nil {
		return nil, err
	}
	return append(ids, due...), nil
}

func fileIDs(ctx context.Context, tx *transaction, query string, args ...any) ([][]byte, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids [][]byte
	for rows.Next() {
		var id []byte
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, append([]byte(nil), id...))
	}
	return ids, rows.Err()
}

func (s *Store) LiveFileIDs(ctx context.Context) ([][]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	tx, err := s.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.close()
	return fileIDs(ctx, tx, `SELECT file_id FROM notes WHERE file_id IS NOT NULL UNION SELECT file_id FROM deliveries`)
}

func (s *Store) ForgetDelivery(ctx context.Context, fileID []byte) error {
	if len(fileID) != 16 {
		return ErrInvalid
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	tx, err := s.begin(ctx)
	if err != nil {
		return err
	}
	defer tx.close()
	if _, err := tx.ExecContext(ctx, `DELETE FROM deliveries WHERE file_id = ?`, fileID); err != nil {
		return err
	}
	return tx.commit(ctx)
}
