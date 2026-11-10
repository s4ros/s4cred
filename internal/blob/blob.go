package blob

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"time"
)

type Dir struct {
	root *os.Root
}

func Open(path string) (*Dir, error) {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(path, 0o700); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		return nil, err
	}
	if err := root.MkdirAll("tmp", 0o700); err != nil {
		root.Close()
		return nil, err
	}
	return &Dir{root: root}, nil
}

func (d *Dir) Close() error { return d.root.Close() }

func hexName(id []byte) string { return hex.EncodeToString(id) }

func finalName(id []byte) (string, error) {
	if len(id) != 16 {
		return "", os.ErrNotExist
	}
	return hexName(id), nil
}

func (d *Dir) Write(r io.Reader, size int64) ([]byte, error) {
	if size <= 0 {
		return nil, errors.New("invalid size")
	}
	var tmpID [16]byte
	if _, err := rand.Read(tmpID[:]); err != nil {
		return nil, err
	}
	tmpName := "tmp/" + hexName(tmpID[:])
	f, err := d.root.OpenFile(tmpName, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	n, copyErr := io.Copy(f, io.LimitReader(r, size))
	syncErr := f.Sync()
	closeErr := f.Close()
	if copyErr != nil || syncErr != nil || closeErr != nil || n != size {
		_ = d.root.Remove(tmpName)
		if copyErr != nil {
			return nil, copyErr
		}
		if n != size {
			return nil, io.ErrUnexpectedEOF
		}
		if syncErr != nil {
			return nil, syncErr
		}
		return nil, closeErr
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		_ = d.root.Remove(tmpName)
		return nil, err
	}
	name := hexName(id[:])
	if _, err := d.root.Lstat(name); err == nil {
		_ = d.root.Remove(tmpName)
		return nil, os.ErrExist
	}
	if err := d.root.Rename(tmpName, name); err != nil {
		_ = d.root.Remove(tmpName)
		return nil, err
	}
	dir, err := d.root.Open(".")
	if err != nil {
		_ = d.root.Remove(name)
		return nil, err
	}
	syncErr = dir.Sync()
	closeErr = dir.Close()
	if syncErr != nil || closeErr != nil {
		_ = d.root.Remove(name)
		if syncErr != nil {
			return nil, syncErr
		}
		return nil, closeErr
	}
	return append([]byte(nil), id[:]...), nil
}

func (d *Dir) Open(id []byte) (*os.File, error) {
	name, err := finalName(id)
	if err != nil {
		return nil, err
	}
	return d.root.Open(name)
}

func (d *Dir) Remove(id []byte) error {
	name, err := finalName(id)
	if err != nil {
		return err
	}
	err = d.root.Remove(name)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (d *Dir) Sweep(live [][]byte, now time.Time, grace time.Duration) error {
	keep := make(map[string]struct{}, len(live))
	for _, id := range live {
		name, err := finalName(id)
		if err != nil {
			continue
		}
		keep[name] = struct{}{}
	}
	cutoff := now.Add(-grace)
	dir, err := d.root.Open(".")
	if err != nil {
		return err
	}
	entries, readErr := dir.ReadDir(-1)
	closeErr := dir.Close()
	if readErr != nil {
		return readErr
	}
	if closeErr != nil {
		return closeErr
	}
	for _, entry := range entries {
		name := entry.Name()
		if name == "tmp" {
			if err := d.sweepTemp(cutoff); err != nil {
				return err
			}
			continue
		}
		if _, ok := keep[name]; ok || len(name) != 32 {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.ModTime().After(cutoff) {
			continue
		}
		if err := d.root.Remove(name); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

func (d *Dir) sweepTemp(cutoff time.Time) error {
	dir, err := d.root.Open("tmp")
	if err != nil {
		return err
	}
	entries, readErr := dir.ReadDir(-1)
	closeErr := dir.Close()
	if readErr != nil {
		return readErr
	}
	if closeErr != nil {
		return closeErr
	}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.ModTime().After(cutoff) {
			continue
		}
		if err := d.root.Remove("tmp/" + entry.Name()); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}
