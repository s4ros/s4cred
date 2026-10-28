package main

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

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
	if err := db.Cleanup(context.Background()); err != nil {
		return errors.New("database cleanup failed")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	server := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           httpapi.New(db, cfg.PublicOrigin, web.Files),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		// Allow the 30-second request read, a bounded database operation, and response time.
		WriteTimeout:   60 * time.Second,
		IdleTimeout:    60 * time.Second,
		MaxHeaderBytes: 16 * 1024,
		ErrorLog:       log.New(io.Discard, "", 0),
	}
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := db.Cleanup(ctx); err != nil && ctx.Err() == nil {
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
