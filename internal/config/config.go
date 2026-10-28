package config

import (
	"errors"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	PublicOrigin string
	DatabasePath string
	ListenAddr   string
	MaxNotes     int64
	MaxBytes     int64
}

func Load() (Config, error) {
	c := Config{
		PublicOrigin: env("PUBLIC_ORIGIN", "http://localhost:8080"),
		DatabasePath: env("DATABASE_PATH", "/data/notes.db"),
		ListenAddr:   env("LISTEN_ADDR", ":8080"),
	}
	u, err := url.Parse(c.PublicOrigin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.ContainsAny(c.PublicOrigin, "?#") {
		return Config{}, errors.New("invalid PUBLIC_ORIGIN")
	}
	c.MaxNotes, err = positive("MAX_ACTIVE_NOTES", "10000")
	if err != nil {
		return Config{}, err
	}
	c.MaxBytes, err = positive("MAX_ACTIVE_BYTES", "1000000000")
	if err != nil {
		return Config{}, err
	}
	return c, nil
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func positive(name, fallback string) (int64, error) {
	n, err := strconv.ParseInt(env(name, fallback), 10, 64)
	if err != nil || n <= 0 {
		return 0, errors.New("invalid " + name)
	}
	return n, nil
}
