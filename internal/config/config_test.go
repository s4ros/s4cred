package config

import "testing"

func TestDefaultsAndOverrides(t *testing.T) {
	for _, key := range []string{"PUBLIC_ORIGIN", "DATABASE_PATH", "LISTEN_ADDR", "MAX_ACTIVE_NOTES", "MAX_ACTIVE_BYTES"} {
		t.Setenv(key, "")
	}
	c, err := Load()
	if err != nil || c.PublicOrigin != "http://localhost:8080" || c.DatabasePath != "/data/notes.db" || c.ListenAddr != ":8080" || c.MaxNotes != 10000 || c.MaxBytes != 1000000000 {
		t.Fatalf("defaults: %+v, %v", c, err)
	}
	t.Setenv("PUBLIC_ORIGIN", "https://notes.example")
	t.Setenv("DATABASE_PATH", "/tmp/db")
	t.Setenv("LISTEN_ADDR", "127.0.0.1:1234")
	t.Setenv("MAX_ACTIVE_NOTES", "4")
	t.Setenv("MAX_ACTIVE_BYTES", "17")
	c, err = Load()
	if err != nil || c.PublicOrigin != "https://notes.example" || c.DatabasePath != "/tmp/db" || c.ListenAddr != "127.0.0.1:1234" || c.MaxNotes != 4 || c.MaxBytes != 17 {
		t.Fatalf("overrides: %+v, %v", c, err)
	}
}

func TestInvalidConfiguration(t *testing.T) {
	for _, value := range []string{"ftp://example.com", "https://example.com/", "https://example.com/path", "https://user@example.com", "https://example.com?", "https://example.com#", "null", "https://example.com:abc"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("PUBLIC_ORIGIN", value)
			if _, err := Load(); err == nil {
				t.Fatal("invalid origin accepted")
			}
		})
	}
	for _, key := range []string{"MAX_ACTIVE_NOTES", "MAX_ACTIVE_BYTES"} {
		for _, value := range []string{"0", "-1", "invalid", "9223372036854775808"} {
			t.Run(key+value, func(t *testing.T) {
				t.Setenv(key, value)
				if _, err := Load(); err == nil {
					t.Fatal("invalid limit accepted")
				}
			})
		}
	}
}
