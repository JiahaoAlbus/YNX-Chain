package main

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
)

func main() {
	key, err := decodeKey(required("YNX_PAY_PRODUCT_INTEGRITY_KEY"))
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
	service, err := payproduct.New(payproduct.Config{StorePath: env("YNX_PAY_PRODUCT_STORE", "tmp/pay-product/state.json"), IntegrityKey: key, BootstrapKey: required("YNX_PAY_PRODUCT_BOOTSTRAP_KEY"), PublicBaseURL: required("YNX_PAY_PRODUCT_PUBLIC_URL"), CentralMerchantID: required("YNX_PAY_PRODUCT_CENTRAL_MERCHANT_ID"), PayAPI: pay, AI: ai})
	if err != nil {
		log.Fatal(err)
	}
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			service.RetryDue(context.Background())
		}
	}()
	addr := env("YNX_PAY_PRODUCT_ADDR", "127.0.0.1:6431")
	server := &http.Server{Addr: addr, Handler: payproduct.NewServer(service).Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 75 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("ynx-pay-product listening on %s", addr)
	log.Fatal(server.ListenAndServe())
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
