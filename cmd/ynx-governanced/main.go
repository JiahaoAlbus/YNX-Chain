package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/governance"
)

func main() {
	configPath := flag.String("config", "", "absolute path to ynx-governanced JSON configuration")
	check := flag.Bool("check-config", false, "validate configuration and protected key material without starting")
	flag.Parse()
	if *configPath == "" {
		log.Fatal("--config is required")
	}
	cfg, err := governance.LoadRuntimeConfig(*configPath)
	if err != nil {
		log.Fatal(err)
	}
	if *check {
		if _, _, err = governance.ValidateRuntimeConfig(cfg); err != nil {
			log.Fatal(err)
		}
		fmt.Println("ynx-governanced config check passed; loopback-only, pinned genesis roles, mode-0600 gateway assertion key; deployment not implied")
		return
	}
	service, auth, err := governance.OpenRuntime(cfg, time.Now().UTC())
	if err != nil {
		log.Fatal(err)
	}
	serverHandler, err := governance.NewServer(service, auth, cfg.StatePath, time.Now)
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	server := &http.Server{Addr: cfg.HTTPAddress, Handler: accessLog(logger, serverHandler.Handler()), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("YNX Governance listening on http://%s; canonical Gateway assertions required for mutations", cfg.HTTPAddress)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) { w.status = code; w.ResponseWriter.WriteHeader(code) }
func accessLog(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		wrapped := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		logger.Info("governance_http_request", "method", r.Method, "route", routeClass(r.URL.EscapedPath()), "status", wrapped.status, "duration_ms", time.Since(started).Milliseconds(), "request_id", wrapped.Header().Get("X-Request-ID"))
	})
}
func routeClass(path string) string {
	switch {
	case path == "/health":
		return "/health"
	case path == "/metrics":
		return "/metrics"
	case strings.HasPrefix(path, "/governance/proposals"):
		return "/governance/proposals/:operation"
	case strings.HasPrefix(path, "/governance/emergencies"):
		return "/governance/emergencies/:operation"
	case strings.HasPrefix(path, "/governance/appeals"):
		return "/governance/appeals/:operation"
	case path == "/governance/roles":
		return "/governance/roles"
	default:
		return "unmatched"
	}
}
