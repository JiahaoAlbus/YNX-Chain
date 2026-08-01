package main

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
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
	var sponsorship payproduct.SponsorshipProvider
	var sponsorPolicy payproduct.SponsorPolicy
	if base := strings.TrimSpace(os.Getenv("YNX_PAY_PRODUCT_PAYMASTER_URL")); base != "" {
		sponsorship, err = payproduct.NewHTTPSponsorshipProvider(base, required("YNX_PAY_PRODUCT_PAYMASTER_KEY"))
		if err != nil {
			log.Fatal(err)
		}
		sponsorPolicy = payproduct.SponsorPolicy{Sponsor: required("YNX_PAY_PRODUCT_SPONSOR_ID"), DailyBudget: positiveInt("YNX_PAY_PRODUCT_SPONSOR_DAILY_BUDGET"), PerUserDailyBudget: positiveInt("YNX_PAY_PRODUCT_SPONSOR_USER_DAILY_BUDGET"), PerMerchantDailyBudget: positiveInt("YNX_PAY_PRODUCT_SPONSOR_MERCHANT_DAILY_BUDGET"), MaximumQuoteLifetime: 5 * time.Minute}
	}
	var bridge payproduct.BridgeProvider
	if base := strings.TrimSpace(os.Getenv("YNX_PAY_PRODUCT_BRIDGE_URL")); base != "" {
		bridge, err = payproduct.NewHTTPBridgeProvider(base, required("YNX_PAY_PRODUCT_BRIDGE_KEY"))
		if err != nil {
			log.Fatal(err)
		}
	}
	quantEvidenceKeys, err := decodeVerifierMap(strings.TrimSpace(os.Getenv("YNX_PAY_PRODUCT_QUANT_VERIFIERS")))
	if err != nil {
		log.Fatal(err)
	}
	quantEvidenceMaxAge, err := optionalMinutes("YNX_PAY_PRODUCT_QUANT_MAX_AGE_MINUTES", 24*60)
	if err != nil {
		log.Fatal(err)
	}
	service, err := payproduct.New(payproduct.Config{StorePath: env("YNX_PAY_PRODUCT_STORE", "tmp/pay-product/state.json"), IntegrityKey: key, GatewayKey: gatewayKey, BootstrapKey: required("YNX_PAY_PRODUCT_BOOTSTRAP_KEY"), PublicBaseURL: required("YNX_PAY_PRODUCT_PUBLIC_URL"), CentralMerchantID: required("YNX_PAY_PRODUCT_CENTRAL_MERCHANT_ID"), PayAPI: pay, AI: ai, Sponsorship: sponsorship, SponsorPolicy: sponsorPolicy, Bridge: bridge, QuantEvidenceKeys: quantEvidenceKeys, QuantEvidenceMaxAge: quantEvidenceMaxAge})
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
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	build := buildinfo.Normalize(buildinfo.Info{Commit: buildCommit, Release: buildRelease, BuildTime: buildTime})
	productServer := payproduct.NewServerWithLogger(service, build, logger)
	server := &http.Server{Addr: addr, Handler: productServer.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 75 * time.Second, IdleTimeout: 60 * time.Second, ErrorLog: slog.NewLogLogger(logger.Handler(), slog.LevelError)}
	logger.Info("service_start", "service", "ynx-pay-product", "address", addr, "commit", build.Commit, "release", build.Release, "build_time", build.BuildTime)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("service_exit", "service", "ynx-pay-product", "error", "listen_failed")
		os.Exit(1)
	}
}
func positiveInt(name string) int64 {
	v, err := strconv.ParseInt(required(name), 10, 64)
	if err != nil || v <= 0 {
		log.Fatalf("%s must be a positive integer", name)
	}
	return v
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
func optionalMinutes(name string, fallback int64) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return time.Duration(fallback) * time.Minute, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer number of minutes", name)
	}
	return time.Duration(value) * time.Minute, nil
}
func decodeVerifierMap(raw string) (map[string]ed25519.PublicKey, error) {
	out := map[string]ed25519.PublicKey{}
	if raw == "" {
		return out, nil
	}
	var encoded map[string]string
	if err := json.Unmarshal([]byte(raw), &encoded); err != nil {
		return nil, fmt.Errorf("decode Quant verifier map: %w", err)
	}
	for keyID, value := range encoded {
		decoded, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(value), "0x"))
		if err != nil || len(decoded) != ed25519.PublicKeySize {
			decoded, err = base64.RawStdEncoding.DecodeString(strings.TrimSpace(value))
		}
		if err != nil || len(decoded) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("Quant verifier %q must be a 32-byte Ed25519 public key", keyID)
		}
		out[keyID] = ed25519.PublicKey(append([]byte(nil), decoded...))
	}
	return out, nil
}
func decodeKey(v string) ([]byte, error) {
	hexValue := strings.TrimPrefix(v, "0x")
	if isHexEncoding(hexValue) {
		raw, err := hex.DecodeString(hexValue)
		if err != nil || len(raw) < 32 {
			return nil, fmt.Errorf("key hex value must contain at least 32 bytes")
		}
		return raw, nil
	}
	raw, err := base64.RawStdEncoding.DecodeString(v)
	if err != nil || len(raw) < 32 {
		return nil, fmt.Errorf("key must contain at least 32 bytes encoded as hex or unpadded base64")
	}
	return raw, nil
}

func isHexEncoding(value string) bool {
	if value == "" || len(value)%2 != 0 {
		return false
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}
