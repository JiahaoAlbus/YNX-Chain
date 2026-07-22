package main

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
)

func main() {
	key, err := decodeKey(required("YNX_PAY_PRODUCT_INTEGRITY_KEY"))
	if err != nil {
		log.Fatal(err)
	}
	gatewayKey, err := decodeKey(required("YNX_PAY_PRODUCT_GATEWAY_ASSERTION_KEY"))
	if err != nil {
		log.Fatal(err)
	}
	pay, err := payproduct.NewHTTPPayAPI(required("YNX_PAY_PRODUCT_CENTRAL_URL"), required("YNX_PAY_PRODUCT_CENTRAL_KEY"))
	if err != nil {
		log.Fatal(err)
	}
	var ai payproduct.AIProvider
	if base := strings.TrimSpace(os.Getenv("YNX_PAY_PRODUCT_AI_URL")); base != "" {
		ai = &payproduct.HTTPAIProvider{BaseURL: base, APIKey: required("YNX_PAY_PRODUCT_AI_KEY"), Model: required("YNX_PAY_PRODUCT_AI_MODEL"), Client: &http.Client{Timeout: 60 * time.Second}}
	}
	bootstrapKey := required("YNX_PAY_PRODUCT_BOOTSTRAP_KEY")
	publicURL := required("YNX_PAY_PRODUCT_PUBLIC_URL")
	centralMerchantID := required("YNX_PAY_PRODUCT_CENTRAL_MERCHANT_ID")
	storePath := env("YNX_PAY_PRODUCT_STORE", "tmp/pay-product/state.json")
	storeLock, err := payproduct.AcquireStoreOperationLock(storePath, "service", time.Now().UTC())
	if err != nil {
		log.Fatal(err)
	}
	defer func() {
		if err := storeLock.Release(); err != nil {
			log.Printf("store lock release failed: %v", err)
		}
	}()
	service, err := payproduct.New(payproduct.Config{StorePath: storePath, IntegrityKey: key, GatewayKey: gatewayKey, BootstrapKey: bootstrapKey, PublicBaseURL: publicURL, CentralMerchantID: centralMerchantID, PayAPI: pay, AI: ai})
	if err != nil {
		log.Printf("service initialization failed: %v", err)
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				service.RetryDue(ctx)
			}
		}
	}()
	addr := env("YNX_PAY_PRODUCT_ADDR", "127.0.0.1:6431")
	server := &http.Server{Addr: addr, Handler: payproduct.NewServer(service).Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 75 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("ynx-pay-product listening on %s", addr)
	errCh := make(chan error, 1)
	go func() { errCh <- server.ListenAndServe() }()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("graceful shutdown failed: %v", err)
		}
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("server stopped: %v", err)
		}
	}
}
func required(name string) string {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		log.Fatalf("%s is required", name)
	}
	return v
}
func env(name, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(name)); v != "" {
		return v
	}
	return fallback
}
func decodeKey(v string) ([]byte, error) {
	if raw, err := hex.DecodeString(strings.TrimPrefix(v, "0x")); err == nil && len(raw) >= 32 {
		return raw, nil
	}
	return base64.RawStdEncoding.DecodeString(v)
}
