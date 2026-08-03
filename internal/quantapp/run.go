package quantapp

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/quantlab"
)

type Config struct {
	Name        string
	Role        string
	DefaultAddr string
}

func Run(cfg Config) error {
	addr := env("YNX_QUANT_HTTP_ADDR", cfg.DefaultAddr)
	statePath := env("YNX_QUANT_STATE_PATH", ".ynx/quant-lab/state.json")
	var marketData quantlab.MarketData
	if endpoint := strings.TrimSpace(os.Getenv("YNX_QUANT_EXCHANGE_URL")); endpoint != "" {
		marketData = quantlab.HTTPExchangeMarketData{BaseURL: endpoint, Client: &http.Client{Timeout: 5 * time.Second}}
	}
	service, err := quantlab.New(quantlab.Config{StatePath: statePath, MarketData: marketData})
	if err != nil {
		return err
	}
	handler := requestHeaders(quantlab.NewRoleServer(service, cfg.Role))
	server := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	slog.Info("quant service listening", "service", cfg.Name, "role", cfg.Role, "address", addr, "version", quantlab.Version, "commit", quantlab.BuildCommit)
	err = server.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func requestHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}
