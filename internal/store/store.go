package store

import (
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

const operationTimeout = 10 * time.Second

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
			link_secret BLOB
		);
		CREATE INDEX IF NOT EXISTS notes_expiration ON notes(expires_at);`)
		if err != nil {
			return err
		}
		var has int
		if err = db.QueryRowContext(ctx, `SELECT count(*) FROM pragma_table_info('notes') WHERE name = 'link_secret'`).Scan(&has); err != nil {
			return err
		}
		if has == 0 {
			_, err = db.ExecContext(ctx, `ALTER TABLE notes ADD COLUMN link_secret BLOB`)
		}
		return err
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
	if err := s.insert(ctx, idHash[:], tokenHash, ciphertext, nonce, nil, ttl); err != nil {
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
	return s.insert(ctx, idHash, tokenHash, ciphertext, nonce, linkSecret, ttl)
}

func (s *Store) insert(ctx context.Context, idHash, tokenHash, ciphertext, nonce, linkSecret []byte, ttl int64) error {
	tx, err := s.begin(ctx)
	if err != nil {
		return err
	}
	defer tx.close()
	now := s.now()
	var count, bytes int64
	if err := tx.QueryRowContext(ctx, `SELECT count(*), coalesce(sum(length(ciphertext)), 0) FROM notes WHERE expires_at > ?`, now.UnixNano()).Scan(&count, &bytes); err != nil {
		return err
	}
	if count >= s.maxNotes || int64(len(ciphertext)) > s.maxBytes || bytes > s.maxBytes-int64(len(ciphertext)) {
		return ErrCapacity
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO notes (id_hash, read_token_hash, ciphertext, nonce, expires_at, link_secret) VALUES (?, ?, ?, ?, ?, ?)`, idHash, tokenHash, ciphertext, nonce, now.Add(time.Duration(ttl)*time.Second).UnixNano(), linkSecret)
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
func (s *Store) Material(ctx context.Context, code []byte) ([]byte, error) {
	if len(code) != 16 {
		return nil, ErrNotFound
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	idHash := sha256.Sum256(code)
	tx, err := s.begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.close()
	var secret []byte
	err = tx.QueryRowContext(ctx, `SELECT link_secret FROM notes WHERE id_hash = ? AND expires_at > ? AND link_secret IS NOT NULL`, idHash[:], s.now().UnixNano()).Scan(&secret)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return append([]byte(nil), secret...), nil
}

// Consume verifies and deletes a note in one transaction before returning it.
func (s *Store) Consume(ctx context.Context, id, token []byte) ([]byte, []byte, error) {
	if (len(id) != 32 && len(id) != 16) || len(token) != 32 {
		return nil, nil, ErrNotFound
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	idHash, tokenHash := sha256.Sum256(id), sha256.Sum256(token)
	tx, err := s.begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.close()
	var storedHash, ciphertext, nonce []byte
	err = tx.QueryRowContext(ctx, `SELECT read_token_hash, ciphertext, nonce FROM notes WHERE id_hash = ? AND expires_at > ?`, idHash[:], s.now().UnixNano()).Scan(&storedHash, &ciphertext, &nonce)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	if subtle.ConstantTimeCompare(storedHash, tokenHash[:]) != 1 {
		return nil, nil, ErrNotFound
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM notes WHERE id_hash = ?`, idHash[:])
	if err != nil {
		return nil, nil, err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		return nil, nil, fmt.Errorf("delete note failed")
	}
	if err := tx.commit(ctx); err != nil {
		return nil, nil, err
	}
	return ciphertext, nonce, nil
}

func (s *Store) Cleanup(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	tx, err := s.begin(ctx)
	if err != nil {
		return err
	}
	defer tx.close()
	if _, err := tx.ExecContext(ctx, `DELETE FROM notes WHERE expires_at <= ?`, s.now().UnixNano()); err != nil {
		return err
	}
	return tx.commit(ctx)
}
