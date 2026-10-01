package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/faucet"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mutationfreeze"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	var err error
	if len(os.Args) > 1 && os.Args[1] == "recover-request" {
		err = runRecoverRequest(os.Args[2:])
	} else {
		err = runFaucet()
	}
	if err != nil {
		log.Fatal(err)
	}
}

// recover-request is deliberately a local offline CLI, not an HTTP handler.
// It cannot share the admission DB lock with the running daemon.
func runRecoverRequest(args []string) error {
	flags := flag.NewFlagSet("recover-request", flag.ContinueOnError)
	id := flags.String("request-id", "", "original admitted request ID")
	address := flags.String("address", "", "original receiving address")
	amount := flags.Int64("amount", 0, "original admitted amount")
	chainID := flags.Int64("chain-id", 0, "explicit testnet chain ID (6423)")
	rpcURL := flags.String("rpc", "", "original Core RPC URL")
	dbPath := flags.String("admission-db", "", "existing offline admission database path")
	tokenPath := flags.String("core-auth-token-file", "", "existing private Core token file; required only with --execute")
	execute := flags.Bool("execute", false, "reserve and attempt one original-ID recovery POST")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if len(flags.Args()) != 0 || *id == "" || *address == "" || *amount <= 0 || *chainID != 6423 || *rpcURL == "" || *dbPath == "" {
		return errors.New("recover-request requires --request-id, --address, --amount, --chain-id=6423, --rpc, and --admission-db")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	result, err := faucet.InspectOrRecoverRequest(ctx, faucet.Config{ChainID: *chainID, RPCURL: *rpcURL, AdmissionPath: *dbPath, CoreAuthTokenPath: *tokenPath}, *id, *address, *amount, *execute)
	if encodeErr := json.NewEncoder(os.Stdout).Encode(result); encodeErr != nil {
		return errors.Join(err, encodeErr)
	}
	return err
}

func runFaucet() (result error) {
	httpAddr := flag.String("http", envOrDefault("YNX_FAUCET_HTTP_ADDR", "127.0.0.1:6428"), "faucet HTTP listen address")
	rpcURL := flag.String("rpc", envOrDefault("YNX_FAUCET_RPC_URL", "http://127.0.0.1:6420"), "YNX Chain RPC URL")
	upstreamMode := flag.String("upstream-mode", envOrDefault("YNX_FAUCET_UPSTREAM_MODE", faucet.UpstreamAuthoritative), "faucet upstream mode: authoritative or bft")
	requestLog := flag.String("request-log", envOrDefault("YNX_FAUCET_REQUEST_LOG", "tmp/faucet/requests.jsonl"), "JSONL request log path")
	admissionPath := flag.String("admission-db", os.Getenv("YNX_FAUCET_ADMISSION_DB"), "durable admission database (default: request-log + .admissions.db)")
	maxAdmissions := flag.Int("max-admissions", envIntOrDefault("YNX_FAUCET_MAX_ADMISSIONS", 100000), "retained admission capacity; existing IDs remain retryable at capacity")
	defaultAmount := flag.Int64("default-amount", envInt64OrDefault("YNX_FAUCET_DEFAULT_AMOUNT", 100), "default faucet amount")
	maxAmount := flag.Int64("max-amount", envInt64OrDefault("YNX_FAUCET_MAX_AMOUNT", 100), "max faucet amount")
	window := flag.Duration("rate-window", envDurationOrDefault("YNX_FAUCET_RATE_LIMIT_WINDOW", time.Hour), "rate limit window")
	maxRequests := flag.Int("rate-max", envIntOrDefault("YNX_FAUCET_RATE_LIMIT_MAX", 1), "max requests per receiving address in window")
	healthTimeout := flag.Duration("health-timeout", envDurationOrDefault("YNX_FAUCET_HEALTH_TIMEOUT", 2*time.Second), "total read-only health probe deadline (at most 5s)")
	flag.Parse()

	coreTokenPath := strings.TrimSpace(os.Getenv("YNX_FAUCET_CORE_AUTH_TOKEN_FILE"))
	if strings.EqualFold(strings.TrimSpace(*upstreamMode), faucet.UpstreamAuthoritative) && coreTokenPath == "" {
		return errors.New("YNX_FAUCET_CORE_AUTH_TOKEN_FILE is required for the authoritative Faucet")
	}
	service, err := faucet.New(faucet.Config{
		CoreAuthTokenPath: coreTokenPath,
		RPCURL:            *rpcURL,
		HTTPAddr:          *httpAddr,
		UpstreamMode:      *upstreamMode,
		FaucetKey:         os.Getenv("FAUCET_PRIVATE_KEY"),
		FaucetKeyPath:     os.Getenv("YNX_FAUCET_PRIVATE_KEY_FILE"),
		FaucetAddress:     os.Getenv("YNX_FAUCET_ADDRESS"),
		ChainID:           envInt64OrDefault("YNX_FAUCET_CHAIN_ID", 6423),
		DefaultAmount:     *defaultAmount,
		MaxAmount:         *maxAmount,
		Window:            *window,
		MaxRequests:       *maxRequests,
		IPMaxRequests:     envIntOrDefault("YNX_FAUCET_IP_RATE_LIMIT_MAX", 100),
		IPWindow:          envDurationOrDefault("YNX_FAUCET_IP_RATE_LIMIT_WINDOW", time.Minute),
		RequestLog:        *requestLog,
		AdmissionPath:     *admissionPath,
		MaxAdmissions:     *maxAdmissions,
		HealthTimeout:     *healthTimeout,
	})
	if err != nil {
		return err
	}

	defer func() { result = errors.Join(result, service.Close()) }()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go service.MonitorHealth(ctx, 15*time.Second)
	srv := &http.Server{
		Addr:              *httpAddr,
		Handler:           mutationfreeze.FromEnv(faucet.NewServerWithBuild(service, currentBuildInfo()).Handler()),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       75 * time.Second,
		MaxHeaderBytes:    16 * 1024,
	}
	log.Printf("YNX Faucet listening on http://%s and funding via %s mode=%s", *httpAddr, *rpcURL, *upstreamMode)
	return serveHTTPUntilShutdown(ctx, srv, 5*time.Second)
}

func currentBuildInfo() buildinfo.Info {
	return buildinfo.Normalize(buildinfo.Info{
		Commit:    strings.TrimSpace(buildCommit),
		Release:   strings.TrimSpace(buildRelease),
		BuildTime: strings.TrimSpace(buildTime),
	})
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt64OrDefault(key string, fallback int64) int64 {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func envIntOrDefault(key string, fallback int) int {
	value := os.Getenv(key)
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
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}
