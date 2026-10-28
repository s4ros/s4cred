package store

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func exclusiveDatabase(t *testing.T) (string, *sql.Conn) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "locked.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = conn.ExecContext(context.Background(), "ROLLBACK")
		_ = conn.Close()
	})
	if _, err := conn.ExecContext(context.Background(), "BEGIN EXCLUSIVE"); err != nil {
		t.Fatal(err)
	}
	return path, conn
}

func TestOpenRetriesExclusiveLock(t *testing.T) {
	path, conn := exclusiveDatabase(t)
	type result struct {
		store *Store
		err   error
	}
	started := make(chan struct{})
	done := make(chan result, 1)
	go func() {
		close(started)
		s, err := open(path, 10, 1000, 2*time.Second)
		done <- result{s, err}
	}()
	<-started
	select {
	case r := <-done:
		if r.store != nil {
			_ = r.store.Close()
		}
		t.Fatalf("Open returned before exclusive lock release: %v", r.err)
	case <-time.After(100 * time.Millisecond):
	}
	if _, err := conn.ExecContext(context.Background(), "ROLLBACK"); err != nil {
		t.Fatal(err)
	}
	var r result
	select {
	case r = <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Open did not complete after releasing the lock")
	}
	if r.err != nil {
		t.Fatal(r.err)
	}
	s := r.store
	defer s.Close()
	if s.timeout != operationTimeout {
		t.Fatalf("operation timeout changed to %v", s.timeout)
	}
	var index int
	if err := s.db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name = 'notes_expiration'`).Scan(&index); err != nil || index != 1 {
		t.Fatalf("expiration index: count %d, error %v", index, err)
	}
	token := make([]byte, 32)
	id := idBytes(t, create(t, s, token, 17, 3600))
	if _, _, err := s.Consume(context.Background(), id, token); err != nil {
		t.Fatalf("opened store does not work: %v", err)
	}
}

func TestOpenExclusiveLockDeadline(t *testing.T) {
	path, conn := exclusiveDatabase(t)
	start := time.Now()
	s, err := open(path, 10, 1000, 100*time.Millisecond)
	if s != nil {
		_ = s.Close()
		t.Fatal("Open returned a store while the exclusive lock was held")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Open returned %v, want deadline exceeded", err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("Open took %v despite the short deadline", elapsed)
	}
	if _, err := conn.ExecContext(context.Background(), "ROLLBACK"); err != nil {
		t.Fatal(err)
	}
	s, err = Open(path, 10, 1000)
	if err != nil {
		t.Fatalf("reopen after timeout: %v", err)
	}
	defer s.Close()
	token := make([]byte, 32)
	id := idBytes(t, create(t, s, token, 17, 3600))
	if _, _, err := s.Consume(context.Background(), id, token); err != nil {
		t.Fatalf("reopened store does not work: %v", err)
	}
}
