package main

import (
	"context"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aigateway/httpdrain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/aiproduct"
	taskv6 "github.com/JiahaoAlbus/YNX-Chain/internal/authaitaskv6"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

//go:embed web/*
var assets embed.FS

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

// Keep process exit outside the service lifetime so original Source owners
// can be retired and closed after HTTP handlers have drained.
func run() (runErr error) {
	httpAddr := flag.String("http", env("YNX_AI_CLIENT_HTTP_ADDR", "127.0.0.1:6438"), "YNX AI client listen address")
	statePath := flag.String("state", env("YNX_AI_CLIENT_STATE_PATH", ""), "absolute encrypted product state path")
	backupCreate := flag.String("backup-create", "", "create an immutable encrypted backup at this absolute path and exit")
	backupRestore := flag.String("backup-restore", "", "restore an authenticated encrypted backup into the configured state path and exit")
	flag.Parse()
	if *backupCreate != "" && *backupRestore != "" {
		return fmt.Errorf("-backup-create and -backup-restore are mutually exclusive")
	}
	if *statePath == "" {
		return fmt.Errorf("YNX_AI_CLIENT_STATE_PATH is required")
	}
	key, err := decodeKey(os.Getenv("YNX_AI_CLIENT_CONTENT_KEY"))
	if err != nil {
		return err
	}
	store, err := aiproduct.NewStore(*statePath, key)
	if err != nil {
		return err
	}
	if *backupCreate != "" {
		manifest, err := store.CreateBackup(*backupCreate)
		if err != nil {
			return err
		}
		if err := json.NewEncoder(os.Stdout).Encode(manifest); err != nil {
			return err
		}
		return nil
	}
	if *backupRestore != "" {
		manifest, err := store.RestoreBackup(*backupRestore)
		if err != nil {
			return err
		}
		if err := json.NewEncoder(os.Stdout).Encode(manifest); err != nil {
			return err
		}
		return nil
	}
	web, err := fs.Sub(assets, "web")
	if err != nil {
		return err
	}
	fixtureAuth := env("YNX_AI_ALLOW_LOCAL_FIXTURE_AUTH", "0") == "1"
	var taskRuntime *aiproduct.PreparedOriginalTaskRuntime
	var taskErr error
	if !fixtureAuth {
		taskRuntime, taskErr = aiproduct.OpenOriginalTaskRuntime(context.Background(), aiproduct.TaskModelConfig{
			ChainURL:       env("YNX_AI_GATEWAY_CHAIN_URL", "http://127.0.0.1:6420"),
			ProviderURL:    env("YNX_AI_PROVIDER_URL", "https://api.openai.com/v1"),
			ProviderAPIKey: os.Getenv("OPENAI_API_KEY"), Model: os.Getenv("AI_MODEL_NAME"),
			AccessAPIKey: os.Getenv("YNX_AI_GATEWAY_API_KEY"), UpstreamKey: os.Getenv("YNX_AI_GATEWAY_UPSTREAM_KEY"),
			UpstreamMode: env("YNX_AI_GATEWAY_UPSTREAM_MODE", "authoritative"),
			AuditLog:     env("YNX_AI_GATEWAY_AUDIT_LOG", "tmp/ai-gateway/audit.jsonl"),
			Window:       envDuration("YNX_AI_GATEWAY_RATE_LIMIT_WINDOW", time.Minute), MaxRequests: int(envInt64("YNX_AI_GATEWAY_RATE_LIMIT_MAX", 30)),
		})
	}
	if taskErr != nil {
		if taskRuntime != nil {
			taskErr = errors.Join(taskErr, taskRuntime.Close())
		}
		taskRuntime = nil
		log.Printf("YNX AI task runtime unavailable: %v", taskErr)
	} else if taskRuntime != nil {
		defer func() { runErr = errors.Join(runErr, taskRuntime.Close()) }()
		if cause := taskRuntime.NewEffectsUnavailable(); cause != nil {
			log.Printf("YNX AI task runtime holds original recovery only; new effects unavailable: %v", cause)
		}
	}
	server, err := aiproduct.NewServer(aiproduct.Config{TaskRuntime: taskRuntime, BYOKGatewayKey: os.Getenv("YNX_AI_BYOK_ACCESS_KEY"), CanonicalWalletGatewayOrigin: env("YNX_AI_WALLET_GATEWAY_ORIGIN", ""), GatewayURL: env("YNX_AI_CLIENT_GATEWAY_URL", "http://127.0.0.1:6429"), GatewayKey: os.Getenv("YNX_AI_GATEWAY_API_KEY"), ExactWalletCallback: env("YNX_AI_CLIENT_WALLET_CALLBACK", "ynxai://wallet-auth/callback"), TrustURL: env("YNX_AI_CLIENT_TRUST_URL", "https://trust.ynxweb4.com/appeals"), ProviderName: env("YNX_AI_CLIENT_PROVIDER_NAME", "configured OpenAI-compatible provider"), InputUSDPerMillion: envFloat("YNX_AI_CLIENT_INPUT_USD_PER_MILLION"), OutputUSDPerMillion: envFloat("YNX_AI_CLIENT_OUTPUT_USD_PER_MILLION"), ResourceUnitsPerKTokens: envInt64("YNX_AI_CLIENT_RESOURCE_UNITS_PER_KTOKENS", 1), GenerationTimeout: envDuration("YNX_AI_CLIENT_GENERATION_TIMEOUT", 45*time.Second), Build: buildinfo.Info{Commit: buildCommit, Release: buildRelease, BuildTime: buildTime}, AllowLocalFixtureAuth: fixtureAuth, Logger: slog.New(slog.NewJSONHandler(os.Stdout, nil))}, store, web)
	if err != nil {
		return err
	}
	// Retain even a partial original owner: unavailable registration must fail
	// V6 requests closed while the existing service remains accessible.
	v6, v6Err := taskv6.OpenOriginalAITaskActionServerV6(server)
	if v6 == nil {
		return errors.Join(v6Err, errors.New("AI V6 normal factory returned no owner"))
	}
	if v6Err != nil {
		log.Printf("YNX AI V6 runtime unavailable: %v", v6Err)
	}
	shutdownTimeout := envDuration("YNX_AI_CLIENT_SHUTDOWN_TIMEOUT", 60*time.Second)
	defer func() { runErr = errors.Join(runErr, closeOriginalTaskV6(v6, shutdownTimeout)) }()
	srv := &http.Server{Addr: *httpAddr, Handler: v6.Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("YNX AI client listening on http://%s; provider responses remain Gateway-backed only", *httpAddr)
	return httpdrain.ListenAndServe(srv, shutdownTimeout)
}

// HTTP draining returns before the original same-request sources are retired.
// Cleanup has its own bounded lifetime and preserves every original failure.
func closeOriginalTaskV6(owner *taskv6.OriginalAITaskActionServerV6, timeout time.Duration) error {
	if owner == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	retireErr := owner.Retire()
	joinErr := owner.Join(ctx)
	closeErr := owner.Close()
	drainErr := owner.DrainPartial(ctx)
	return errors.Join(retireErr, joinErr, closeErr, drainErr)
}

func decodeKey(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if raw, err := hex.DecodeString(strings.TrimPrefix(value, "0x")); err == nil && len(raw) == 32 {
		return raw, nil
	}
	raw, err := base64.RawStdEncoding.DecodeString(value)
	if err == nil && len(raw) == 32 {
		return raw, nil
	}
	return nil, &keyError{}
}

type keyError struct{}

func (*keyError) Error() string {
	return "YNX_AI_CLIENT_CONTENT_KEY must be 32 bytes encoded as hex or raw base64"
}
func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
func envDuration(key string, fallback time.Duration) time.Duration {
	if v, err := time.ParseDuration(strings.TrimSpace(os.Getenv(key))); err == nil && v > 0 {
		return v
	}
	return fallback
}
func envInt64(key string, fallback int64) int64 {
	var v int64
	if _, err := fmt.Sscan(strings.TrimSpace(os.Getenv(key)), &v); err == nil && v > 0 {
		return v
	}
	return fallback
}
func envFloat(key string) float64 {
	var v float64
	_, _ = fmt.Sscan(strings.TrimSpace(os.Getenv(key)), &v)
	return v
}
