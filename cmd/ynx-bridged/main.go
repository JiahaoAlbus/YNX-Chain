package main

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bridgegateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mutationfreeze"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_BRIDGE_HTTP_ADDR", "127.0.0.1:6433"), "Bridge coordinator HTTP listen address")
	statePath := flag.String("state", envOrDefault("YNX_BRIDGE_STATE_PATH", "tmp/bridge/state.json"), "Bridge persistent state path")
	threshold := flag.Int("threshold", envIntOrDefault("YNX_BRIDGE_RELAYER_THRESHOLD", 2), "required relayer attestations")
	rateWindow := flag.Duration("rate-window", envDurationOrDefault("YNX_BRIDGE_RATE_LIMIT_WINDOW", time.Minute), "rate limit window")
	rateMax := flag.Int("rate-max", envIntOrDefault("YNX_BRIDGE_RATE_LIMIT_MAX", 5000), "maximum requests per API key/IP in window")
	retention := flag.Duration("retention", envDurationOrDefault("YNX_BRIDGE_RETENTION_PERIOD", 7*365*24*time.Hour), "identity retention after last transfer update")
	checkConfig := flag.Bool("check-config", false, "validate configuration without starting the service")
	flag.Parse()

	relayers, err := parseRelayers(os.Getenv("YNX_BRIDGE_RELAYERS_JSON"))
	if err != nil {
		log.Fatal(err)
	}
	policies, err := parsePolicies(os.Getenv("YNX_BRIDGE_ROUTE_POLICIES_JSON"))
	if err != nil {
		log.Fatal(err)
	}
	cfg := bridgegateway.Config{StatePath: *statePath, APIKey: os.Getenv("YNX_BRIDGE_API_KEY"), Relayers: relayers, Threshold: *threshold, Policies: policies, RateLimitWindow: *rateWindow, RateLimitMax: *rateMax, RetentionPeriod: *retention}
	if *checkConfig {
		if err := bridgegateway.ValidateConfig(cfg); err != nil {
			log.Fatal(err)
		}
		fmt.Println("ynx-bridged config check passed; external submission remains disabled")
		return
	}
	service, err := bridgegateway.New(cfg)
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	server := &http.Server{Addr: *httpAddr, Handler: mutationfreeze.FromEnv(bridgegateway.NewServerWithBuild(service, currentBuildInfo()).Handler()), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	log.Printf("YNX Bridge coordinator listening on http://%s; external submission disabled", *httpAddr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func parseRelayers(raw string) (map[string]ed25519.PublicKey, error) {
	encoded := map[string]string{}
	if err := decodeStrict(raw, &encoded); err != nil {
		return nil, fmt.Errorf("YNX_BRIDGE_RELAYERS_JSON: %w", err)
	}
	relayers := make(map[string]ed25519.PublicKey, len(encoded))
	for name, value := range encoded {
		key, err := base64.StdEncoding.Strict().DecodeString(strings.TrimSpace(value))
		if err != nil || len(key) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("YNX_BRIDGE_RELAYERS_JSON relayer %q must contain one base64 Ed25519 public key", name)
		}
		relayers[name] = ed25519.PublicKey(key)
	}
	return relayers, nil
}

func parsePolicies(raw string) ([]bridgegateway.RoutePolicy, error) {
	var policies []bridgegateway.RoutePolicy
	if err := decodeStrict(raw, &policies); err != nil {
		return nil, fmt.Errorf("YNX_BRIDGE_ROUTE_POLICIES_JSON: %w", err)
	}
	return policies, nil
}

func decodeStrict(raw string, target any) error {
	if strings.TrimSpace(raw) == "" {
		return errors.New("value is required")
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("value must contain one JSON document")
	}
	return nil
}

func currentBuildInfo() buildinfo.Info {
	return buildinfo.Normalize(buildinfo.Info{Commit: strings.TrimSpace(buildCommit), Release: strings.TrimSpace(buildRelease), BuildTime: strings.TrimSpace(buildTime)})
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envIntOrDefault(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envDurationOrDefault(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}
