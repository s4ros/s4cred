package main

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/s4ros/s4cred/internal/blob"
	"github.com/s4ros/s4cred/internal/config"
	"github.com/s4ros/s4cred/internal/httpapi"
	"github.com/s4ros/s4cred/internal/store"
	"github.com/s4ros/s4cred/web"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := store.Open(cfg.DatabasePath, cfg.MaxNotes, cfg.MaxBytes)
	if err != nil {
		return errors.New("cannot open database")
	}
	defer db.Close()
	dbPath, err := filepath.Abs(cfg.DatabasePath)
	if err != nil {
		return errors.New("cannot open storage")
	}
	blobs, err := blob.Open(filepath.Join(filepath.Dir(dbPath), "files"))
	if err != nil {
		return errors.New("cannot open storage")
	}
	defer blobs.Close()
	if err := cleanupStorage(context.Background(), db, blobs); err != nil {
		return errors.New("database cleanup failed")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	server := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           httpapi.New(db, blobs, cfg.PublicOrigin, web.Files),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       120 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 * 1024,
		ErrorLog:          log.New(io.Discard, "", 0),
	}
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := cleanupStorage(ctx, db, blobs); err != nil && ctx.Err() == nil {
					log.Print("database cleanup failed")
				}
			}
		}
	}()
	serverErr := make(chan error, 1)
	go func() { serverErr <- server.ListenAndServe() }()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
		}
		<-serverErr
		return nil
	case err := <-serverErr:
		if !errors.Is(err, http.ErrServerClosed) {
			return errors.New("HTTP server failed")
		}
		return nil
	}
}

func cleanupStorage(ctx context.Context, db *store.Store, blobs *blob.Dir) error {
	ids, err := db.Cleanup(ctx)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := blobs.Remove(id); err != nil {
			return err
		}
	}
	live, err := db.LiveFileIDs(ctx)
	if err != nil {
		return err
	}
	return blobs.Sweep(live, time.Now(), store.FileRetentionGrace)
}
