package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func newStore(t *testing.T, count, size int64) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "notes.db"), count, size)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func create(t *testing.T, s *Store, token []byte, size int, ttl int64) string {
	t.Helper()
	hash := sha256.Sum256(token)
	id, err := s.Create(context.Background(), bytes.Repeat([]byte{0x71}, size), bytes.Repeat([]byte{0x34}, 12), hash[:], ttl)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func idBytes(t *testing.T, id string) []byte {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(id)
	if err != nil || len(b) != 32 || len(id) != 43 {
		t.Fatalf("bad id %q: %v", id, err)
	}
	return b
}

func TestConsumeAndStoredFields(t *testing.T) {
	s := newStore(t, 10, 1000)
	token := bytes.Repeat([]byte{0x55}, 32)
	id := create(t, s, token, 17, 3600)
	idRaw := idBytes(t, id)
	var storedID, storedToken, ciphertext, nonce []byte
	if err := s.db.QueryRow(`SELECT id_hash, read_token_hash, ciphertext, nonce FROM notes`).Scan(&storedID, &storedToken, &ciphertext, &nonce); err != nil {
		t.Fatal(err)
	}
	idHash, tokenHash := sha256.Sum256(idRaw), sha256.Sum256(token)
	if !bytes.Equal(storedID, idHash[:]) || !bytes.Equal(storedToken, tokenHash[:]) || bytes.Equal(storedToken, token) || len(ciphertext) != 17 || len(nonce) != 12 {
		t.Fatal("stored fields did not match the expected hashes and ciphertext")
	}
	var secureDelete int
	if err := s.db.QueryRow(`PRAGMA secure_delete`).Scan(&secureDelete); err != nil || secureDelete != 1 {
		t.Fatalf("secure_delete = %d, error %v", secureDelete, err)
	}
	for _, wrong := range [][]byte{nil, bytes.Repeat([]byte{0x56}, 32), token[:31]} {
		if _, _, err := s.Consume(context.Background(), idRaw, wrong); !errors.Is(err, ErrNotFound) {
			t.Fatalf("wrong token: %v", err)
		}
	}
	got, gotNonce, err := s.Consume(context.Background(), idRaw, token)
	if err != nil || !bytes.Equal(got, ciphertext) || !bytes.Equal(gotNonce, nonce) {
		t.Fatalf("consume: %v", err)
	}
	if _, _, err = s.Consume(context.Background(), idRaw, token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second consume: %v", err)
	}
}

func TestExpirationCleanupAndCapacity(t *testing.T) {
	s := newStore(t, 1, 17)
	now := time.Unix(1_700_000_000, 0)
	s.now = func() time.Time { return now }
	token := bytes.Repeat([]byte{1}, 32)
	id := create(t, s, token, 17, 3600)
	hash := sha256.Sum256(token)
	if _, err := s.Create(context.Background(), make([]byte, 17), make([]byte, 12), hash[:], 3600); !errors.Is(err, ErrCapacity) {
		t.Fatalf("expected capacity: %v", err)
	}
	now = now.Add(time.Hour)
	if _, _, err := s.Consume(context.Background(), idBytes(t, id), token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired read: %v", err)
	}
	create(t, s, token, 17, 86400)
	if err := s.Cleanup(context.Background()); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT count(*) FROM notes`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("remaining count %d: %v", count, err)
	}
}

func TestByteCapacityAndValidation(t *testing.T) {
	s := newStore(t, 10, 34)
	token := make([]byte, 32)
	h := sha256.Sum256(token)
	create(t, s, token, 17, 3600)
	create(t, s, token, 17, 604800)
	if _, err := s.Create(context.Background(), make([]byte, 17), make([]byte, 12), h[:], 86400); !errors.Is(err, ErrCapacity) {
		t.Fatalf("byte quota: %v", err)
	}
	for _, tc := range []struct {
		ciphertext, nonce, hash []byte
		ttl                     int64
	}{
		{make([]byte, 16), make([]byte, 12), h[:], 3600},
		{make([]byte, MaxCiphertext+1), make([]byte, 12), h[:], 3600},
		{make([]byte, 17), make([]byte, 11), h[:], 3600},
		{make([]byte, 17), make([]byte, 12), h[:31], 3600},
		{make([]byte, 17), make([]byte, 12), h[:], 1},
	} {
		if _, err := s.Create(context.Background(), tc.ciphertext, tc.nonce, tc.hash, tc.ttl); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid note: %v", err)
		}
	}
}

func TestConcurrentConsume(t *testing.T) {
	s := newStore(t, 100, 1_000_000)
	token := bytes.Repeat([]byte{7}, 32)
	id := idBytes(t, create(t, s, token, 17, 3600))
	var success, missing, failures atomic.Int64
	var wg sync.WaitGroup
	for range 100 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := s.Consume(context.Background(), id, token)
			switch {
			case err == nil:
				success.Add(1)
			case errors.Is(err, ErrNotFound):
				missing.Add(1)
			default:
				failures.Add(1)
			}
		}()
	}
	wg.Wait()
	if success.Load() != 1 || missing.Load() != 99 || failures.Load() != 0 {
		t.Fatalf("success %d missing %d failures %d", success.Load(), missing.Load(), failures.Load())
	}
}

func TestConcurrentCapacity(t *testing.T) {
	for _, tc := range []struct{ count, size int64 }{{5, 1000}, {100, 5 * 17}} {
		s := newStore(t, tc.count, tc.size)
		var success, rejected, failures atomic.Int64
		var wg sync.WaitGroup
		for range 50 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, err := s.Create(context.Background(), make([]byte, 17), make([]byte, 12), make([]byte, 32), 3600)
				switch {
				case err == nil:
					success.Add(1)
				case errors.Is(err, ErrCapacity):
					rejected.Add(1)
				default:
					failures.Add(1)
				}
			}()
		}
		wg.Wait()
		if success.Load() != 5 || rejected.Load() != 45 || failures.Load() != 0 {
			t.Fatalf("success %d rejected %d failures %d", success.Load(), rejected.Load(), failures.Load())
		}
	}
}

func TestPersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.db")
	s, err := Open(path, 10, 1000)
	if err != nil {
		t.Fatal(err)
	}
	token := make([]byte, 32)
	id := idBytes(t, create(t, s, token, 17, 86400))
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path, 10, 1000)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, _, err := s.Consume(context.Background(), id, token); err != nil {
		t.Fatal(err)
	}
}

func lockedStore(t *testing.T, maxNotes, maxBytes int64) (*Store, *sql.Conn) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "notes.db")
	s, err := Open(path, maxNotes, maxBytes)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	other, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = other.Close() })
	conn, err := other.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = conn.ExecContext(context.Background(), "ROLLBACK")
		_ = conn.Close()
	})
	return s, conn
}

func lockWriter(t *testing.T, conn *sql.Conn) {
	t.Helper()
	if _, err := conn.ExecContext(context.Background(), "BEGIN IMMEDIATE"); err != nil {
		t.Fatal(err)
	}
}

func unlockWriter(t *testing.T, conn *sql.Conn) {
	t.Helper()
	if _, err := conn.ExecContext(context.Background(), "ROLLBACK"); err != nil {
		t.Fatal(err)
	}
}

// The deadline must expire before any clock read while an external writer holds the lock.
func TestWriteLockTimeoutPrecedesClock(t *testing.T) {
	s, other := lockedStore(t, 1, 17)
	token := bytes.Repeat([]byte{9}, 32)
	id := idBytes(t, create(t, s, token, 17, 3600))
	var busyTimeout int
	if err := s.db.QueryRow(`PRAGMA busy_timeout`).Scan(&busyTimeout); err != nil || busyTimeout != 0 {
		t.Fatalf("configured busy timeout = %d ms, error %v", busyTimeout, err)
	}
	s.timeout = 100 * time.Millisecond
	var clockCalls atomic.Int64
	s.now = func() time.Time {
		clockCalls.Add(1)
		return time.Now()
	}
	lockWriter(t, other)
	defer unlockWriter(t, other)
	hash := sha256.Sum256(token)
	for _, op := range []struct {
		name string
		run  func() error
	}{
		{"consume", func() error { _, _, err := s.Consume(context.Background(), id, token); return err }},
		{"create", func() error {
			_, err := s.Create(context.Background(), make([]byte, 17), make([]byte, 12), hash[:], 3600)
			return err
		}},
		{"cleanup", func() error { return s.Cleanup(context.Background()) }},
	} {
		t.Run(op.name, func(t *testing.T) {
			clockCalls.Store(0)
			err := op.run()
			if !errors.Is(err, context.DeadlineExceeded) {
				t.Errorf("expected bounded lock wait to expire, got %v", err)
			}
			if n := clockCalls.Load(); n != 0 {
				t.Errorf("clock was read %d times before the write lock was acquired", n)
			}
		})
	}
}

func waitForStoreConnection(t *testing.T, db *sql.DB, done <-chan error) {
	t.Helper()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	timeout := time.NewTimer(2 * time.Second)
	defer timeout.Stop()
	for db.Stats().InUse == 0 {
		select {
		case err := <-done:
			t.Fatalf("operation completed before releasing the external lock: %v", err)
		case <-ticker.C:
		case <-timeout.C:
			t.Fatal("operation did not acquire the store connection")
		}
	}
}

func TestConsumeExpiresWhileWaitingForWriteLock(t *testing.T) {
	s, other := lockedStore(t, 10, 1000)
	start := time.Unix(1_700_000_000, 0)
	var clock atomic.Int64
	clock.Store(start.UnixNano())
	s.now = func() time.Time { return time.Unix(0, clock.Load()) }
	token := bytes.Repeat([]byte{4}, 32)
	id := idBytes(t, create(t, s, token, 17, 3600))
	lockWriter(t, other)
	done := make(chan error, 1)
	go func() {
		_, _, err := s.Consume(context.Background(), id, token)
		done <- err
	}()
	waitForStoreConnection(t, s.db, done)
	clock.Store(start.Add(time.Hour).UnixNano())
	unlockWriter(t, other)
	if err := <-done; !errors.Is(err, ErrNotFound) {
		t.Fatalf("consume after expiration while waiting: %v", err)
	}
}

func TestQuotaTimeAfterWaitingForWriteLock(t *testing.T) {
	for _, tc := range []struct {
		name               string
		maxNotes, maxBytes int64
	}{{"count", 1, 1000}, {"bytes", 10, 17}} {
		t.Run(tc.name, func(t *testing.T) {
			s, other := lockedStore(t, tc.maxNotes, tc.maxBytes)
			start := time.Unix(1_700_000_000, 0)
			var clock atomic.Int64
			clock.Store(start.UnixNano())
			s.now = func() time.Time { return time.Unix(0, clock.Load()) }
			token := bytes.Repeat([]byte{5}, 32)
			create(t, s, token, 17, 3600)
			hash := sha256.Sum256(token)
			lockWriter(t, other)
			done := make(chan error, 1)
			go func() {
				_, err := s.Create(context.Background(), make([]byte, 17), make([]byte, 12), hash[:], 3600)
				done <- err
			}()
			waitForStoreConnection(t, s.db, done)
			clock.Store(start.Add(time.Hour).UnixNano())
			unlockWriter(t, other)
			if err := <-done; err != nil {
				t.Fatalf("create after old note expired while waiting: %v", err)
			}
			var expires int64
			if err := s.db.QueryRow(`SELECT max(expires_at) FROM notes`).Scan(&expires); err != nil || expires != start.Add(2*time.Hour).UnixNano() {
				t.Fatalf("new note expiration %d, error %v", expires, err)
			}
		})
	}
}

func TestCleanupTimeAfterWaitingForWriteLock(t *testing.T) {
	s, other := lockedStore(t, 10, 1000)
	start := time.Unix(1_700_000_000, 0)
	var clock atomic.Int64
	clock.Store(start.UnixNano())
	s.now = func() time.Time { return time.Unix(0, clock.Load()) }
	create(t, s, make([]byte, 32), 17, 3600)
	lockWriter(t, other)
	done := make(chan error, 1)
	go func() { done <- s.Cleanup(context.Background()) }()
	waitForStoreConnection(t, s.db, done)
	clock.Store(start.Add(time.Hour).UnixNano())
	unlockWriter(t, other)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT count(*) FROM notes`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("expired records remaining: %d, error %v", count, err)
	}
}

func TestOperationDeadlineWhileWaitingForPool(t *testing.T) {
	s := newStore(t, 20, 10000)
	if s.timeout != 10*time.Second {
		t.Fatalf("default operation timeout: %v", s.timeout)
	}
	token := bytes.Repeat([]byte{0x42}, 32)
	id := idBytes(t, create(t, s, token, 17, 3600))
	hash := sha256.Sum256(token)
	s.timeout = 250 * time.Millisecond
	hold, err := s.db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer hold.Close()
	const consumers, creators = 7, 3
	results := make(chan error, consumers+creators)
	start := make(chan struct{})
	for range consumers {
		go func() {
			<-start
			_, _, err := s.Consume(context.Background(), id, token)
			results <- err
		}()
	}
	for range creators {
		go func() {
			<-start
			_, err := s.Create(context.Background(), make([]byte, 17), make([]byte, 12), hash[:], 3600)
			results <- err
		}()
	}
	started := time.Now()
	close(start)
	for range consumers + creators {
		select {
		case err := <-results:
			if !errors.Is(err, context.DeadlineExceeded) {
				t.Errorf("queued operation returned %v, want deadline exceeded", err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("queued operation did not stop within the deadline buffer")
		}
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("queued operations took %v", elapsed)
	}
	if err := hold.Close(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT count(*) FROM notes`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("timed-out creates changed database: count %d, error %v", count, err)
	}
	if _, _, err := s.Consume(context.Background(), id, token); err != nil {
		t.Fatalf("timed-out reads consumed the note: %v", err)
	}
}

func TestOperationDeadlineWithExternalWriter(t *testing.T) {
	s, other := lockedStore(t, 20, 10000)
	token := bytes.Repeat([]byte{0x57}, 32)
	id := idBytes(t, create(t, s, token, 17, 3600))
	s.timeout = 250 * time.Millisecond
	lockWriter(t, other)
	const n = 7
	results := make(chan error, n)
	started := time.Now()
	for range n {
		go func() {
			_, _, err := s.Consume(context.Background(), id, token)
			results <- err
		}()
	}
	for range n {
		select {
		case err := <-results:
			if !errors.Is(err, context.DeadlineExceeded) {
				t.Errorf("consume returned %v, want deadline exceeded", err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("consume did not stop while external lock was held")
		}
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("operations took %v", elapsed)
	}
	unlockWriter(t, other)
	if _, _, err := s.Consume(context.Background(), id, token); err != nil {
		t.Fatalf("timed-out reads consumed the note: %v", err)
	}
}

func TestCommitDeadlineRollsBackMutation(t *testing.T) {
	s, other := lockedStore(t, 10, 1000)
	token := bytes.Repeat([]byte{0x68}, 32)
	id := idBytes(t, create(t, s, token, 17, 3600))
	if _, err := other.ExecContext(context.Background(), "BEGIN"); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := other.QueryRowContext(context.Background(), `SELECT count(*) FROM notes`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("reader lock setup: count %d, error %v", count, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	tx, err := s.begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM notes`)
	if err != nil {
		tx.close()
		t.Fatal(err)
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		tx.close()
		t.Fatalf("delete: %d, %v", n, err)
	}
	started := time.Now()
	err = tx.commit(ctx)
	tx.close()
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(started) > 2*time.Second {
		t.Fatalf("blocked commit: %v after %v", err, time.Since(started))
	}
	unlockWriter(t, other)
	if _, _, err := s.Consume(context.Background(), id, token); err != nil {
		t.Fatalf("timed-out commit deleted note: %v", err)
	}
}

func TestOperationsRollBackWhenCommitTimesOut(t *testing.T) {
	s, other := lockedStore(t, 10, 1000)
	token := bytes.Repeat([]byte{0x79}, 32)
	id := idBytes(t, create(t, s, token, 17, 3600))
	hash := sha256.Sum256(token)
	s.timeout = 150 * time.Millisecond
	if _, err := other.ExecContext(context.Background(), "BEGIN"); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := other.QueryRowContext(context.Background(), `SELECT count(*) FROM notes`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("reader lock setup: count %d, error %v", count, err)
	}
	if _, _, err := s.Consume(context.Background(), id, token); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("consume with blocked commit: %v", err)
	}
	if _, err := s.Create(context.Background(), make([]byte, 17), make([]byte, 12), hash[:], 3600); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("create with blocked commit: %v", err)
	}
	unlockWriter(t, other)
	if err := s.db.QueryRow(`SELECT count(*) FROM notes`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("timed-out create persisted: count %d, error %v", count, err)
	}
	if _, _, err := s.Consume(context.Background(), id, token); err != nil {
		t.Fatalf("timed-out consume persisted: %v", err)
	}
}

func TestCancellationAfterWriteLockDoesNotMutate(t *testing.T) {
	for _, operation := range []string{"create", "consume"} {
		t.Run(operation, func(t *testing.T) {
			s := newStore(t, 10, 1000)
			token := bytes.Repeat([]byte{0x81}, 32)
			id := idBytes(t, create(t, s, token, 17, 3600))
			hash := sha256.Sum256(token)
			clockEntered := make(chan struct{})
			releaseClock := make(chan struct{})
			s.now = func() time.Time {
				close(clockEntered)
				<-releaseClock
				return time.Now()
			}
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan error, 1)
			go func() {
				if operation == "consume" {
					_, _, err := s.Consume(ctx, id, token)
					done <- err
					return
				}
				_, err := s.Create(ctx, make([]byte, 17), make([]byte, 12), hash[:], 3600)
				done <- err
			}()
			<-clockEntered
			cancel()
			close(releaseClock)
			if err := <-done; !errors.Is(err, context.Canceled) {
				t.Fatalf("canceled operation: %v", err)
			}
			s.now = time.Now
			var count int
			if err := s.db.QueryRow(`SELECT count(*) FROM notes`).Scan(&count); err != nil || count != 1 {
				t.Fatalf("canceled operation changed database: count %d, error %v", count, err)
			}
			if _, _, err := s.Consume(context.Background(), id, token); err != nil {
				t.Fatalf("canceled operation consumed note: %v", err)
			}
		})
	}
}
