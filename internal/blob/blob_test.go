package blob

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func openDir(t *testing.T) *Dir {
	t.Helper()
	d, err := Open(filepath.Join(t.TempDir(), "files"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d
}

func TestWriteOpenRemove(t *testing.T) {
	d := openDir(t)
	body := bytes.Repeat([]byte{0xab}, 100)
	id, err := d.Write(bytes.NewReader(body), int64(len(body)))
	if err != nil || len(id) != 16 {
		t.Fatalf("write: %v len %d", err, len(id))
	}
	f, err := d.Open(id)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(f)
	f.Close()
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("open: %v", err)
	}
	info, err := d.root.Stat(hexName(id))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v %v", info, err)
	}
	if err := d.Remove(id); err != nil {
		t.Fatal(err)
	}
	if err := d.Remove(id); err != nil {
		t.Fatalf("second remove: %v", err)
	}
	if _, err := d.Open(id); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("open after remove: %v", err)
	}
}

func TestWriteShortAndEscape(t *testing.T) {
	d := openDir(t)
	if _, err := d.Write(bytes.NewReader([]byte{1, 2}), 4); err == nil {
		t.Fatal("short write succeeded")
	}
	entries, err := os.ReadDir(filepath.Join(d.root.Name(), "tmp"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("temp left behind: %v %d", err, len(entries))
	}
	if _, err := d.Open([]byte{1, 2, 3}); err == nil {
		t.Fatal("short id opened")
	}
	if _, err := d.root.Open("../outside"); err == nil {
		t.Fatal("root allowed escape")
	}
}

func TestSweepKeepsLiveAndYoungOrphans(t *testing.T) {
	d := openDir(t)
	now := time.Unix(1_700_000_000, 0)
	liveBody := []byte("live-bytes")
	live, err := d.Write(bytes.NewReader(liveBody), int64(len(liveBody)))
	if err != nil {
		t.Fatal(err)
	}
	oldBody := []byte("old-orphan")
	old, err := d.Write(bytes.NewReader(oldBody), int64(len(oldBody)))
	if err != nil {
		t.Fatal(err)
	}
	youngBody := []byte("young")
	young, err := d.Write(bytes.NewReader(youngBody), int64(len(youngBody)))
	if err != nil {
		t.Fatal(err)
	}
	aged := now.Add(-time.Hour)
	if err := d.root.Chtimes(hexName(old), aged, aged); err != nil {
		t.Fatal(err)
	}
	if err := d.root.Chtimes(hexName(live), aged, aged); err != nil {
		t.Fatal(err)
	}
	tmp := "tmp/00112233445566778899aabbccddeeff"
	if err := d.root.WriteFile(tmp, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := d.root.Chtimes(tmp, aged, aged); err != nil {
		t.Fatal(err)
	}
	if err := d.Sweep([][]byte{live}, now, time.Hour); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Open(live); err != nil {
		t.Fatalf("live file swept: %v", err)
	}
	if _, err := d.Open(old); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("old orphan remains: %v", err)
	}
	if _, err := d.Open(young); err != nil {
		t.Fatalf("young orphan swept: %v", err)
	}
	if _, err := d.root.Stat(tmp); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("old temp remains: %v", err)
	}
}
