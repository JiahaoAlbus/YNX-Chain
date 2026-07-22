package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricapi"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricconfig"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricnats"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricpostgres"
	_ "github.com/lib/pq"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	listen := flag.String("listen", env("YNX_DATA_FABRIC_LISTEN", "127.0.0.1:8094"), "listen address")
	storeMode := flag.String("store", env("YNX_DATA_FABRIC_STORE", "postgres"), "authoritative store: postgres (production) or file (local development only)")
	statePath := flag.String("state", os.Getenv("YNX_DATA_FABRIC_STATE_PATH"), "absolute persistent state path")
	postgresDSNFile := flag.String("postgres-dsn-file", os.Getenv("YNX_DATA_FABRIC_POSTGRES_DSN_FILE"), "absolute private PostgreSQL DSN path")
	introspectionURL := flag.String("introspection-url", os.Getenv("YNX_DATA_FABRIC_INTROSPECTION_URL"), "canonical Wallet/App Gateway introspection URL")
	keyRegistryPath := flag.String("event-keys", os.Getenv("YNX_DATA_FABRIC_EVENT_KEYS_FILE"), "absolute event verification key registry path")
	privacyKeyPath := flag.String("privacy-key", os.Getenv("YNX_DATA_FABRIC_PRIVACY_KEY_FILE"), "absolute privacy pseudonymization key path")
	eventLogPath := flag.String("event-log", os.Getenv("YNX_DATA_FABRIC_EVENT_LOG_PATH"), "absolute durable event log path")
	brokerMode := flag.String("broker", env("YNX_DATA_FABRIC_BROKER", "nats"), "event broker: nats (production) or file (local development only)")
	natsURL := flag.String("nats-url", env("YNX_DATA_FABRIC_NATS_URL", "tls://127.0.0.1:4222"), "NATS server URL")
	natsStream := flag.String("nats-stream", env("YNX_DATA_FABRIC_NATS_STREAM", datafabricnats.DefaultStream), "JetStream stream name")
	natsCredentials := flag.String("nats-credentials", os.Getenv("YNX_DATA_FABRIC_NATS_CREDENTIALS_FILE"), "absolute NATS credentials path")
	natsCA := flag.String("nats-ca", os.Getenv("YNX_DATA_FABRIC_NATS_CA_FILE"), "absolute NATS TLS CA path")
	natsCert := flag.String("nats-cert", os.Getenv("YNX_DATA_FABRIC_NATS_CERT_FILE"), "absolute NATS TLS client certificate path")
	natsKey := flag.String("nats-key", os.Getenv("YNX_DATA_FABRIC_NATS_KEY_FILE"), "absolute NATS TLS client key path")
	natsReplicas := flag.Int("nats-replicas", 3, "JetStream replica count")
	sourceCommit := flag.String("source-commit", os.Getenv("YNX_DATA_FABRIC_SOURCE_COMMIT"), "source commit")
	sourceRelease := flag.String("source-release", os.Getenv("YNX_DATA_FABRIC_SOURCE_RELEASE"), "source release")
	rateLimitPerMinute := flag.Uint("rate-limit-per-minute", envUint("YNX_DATA_FABRIC_RATE_LIMIT_PER_MINUTE", 120), "per canonical session/device/product request limit per minute")
	flag.Parse()

	if _, _, err := net.SplitHostPort(*listen); err != nil {
		fail("listen address must contain a valid host and port")
	}
	if *rateLimitPerMinute == 0 || *rateLimitPerMinute > 10000 {
		fail("rate limit must be between 1 and 10000 requests per minute")
	}
	if !filepath.IsAbs(*keyRegistryPath) || !filepath.IsAbs(*privacyKeyPath) {
		fail("privacy key and event key registry paths must be absolute")
	}
	keys, keyProducts, err := datafabricconfig.LoadEventKeys(*keyRegistryPath)
	if err != nil {
		fail(err.Error())
	}
	privacyKey, err := datafabricconfig.LoadSecretFile(*privacyKeyPath, "privacy pseudonymization")
	if err != nil {
		fail(err.Error())
	}
	shutdownContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	apiConfig := datafabricapi.Config{Authorizer: datafabricapi.HTTPAuthorizer{Endpoint: *introspectionURL}, EventKeys: keys, EventKeyProducts: keyProducts, PrivacyKey: privacyKey, SourceCommit: *sourceCommit, SourceRelease: *sourceRelease, RateLimitPerMinute: uint32(*rateLimitPerMinute)}
	closeBackend := func() {}
	switch *storeMode {
	case "postgres":
		if err := datafabricconfig.ValidatePrivateFile(*postgresDSNFile, "PostgreSQL DSN"); err != nil {
			fail(err.Error())
		}
		dsn, err := datafabricconfig.LoadSecretFile(*postgresDSNFile, "PostgreSQL DSN")
		if err != nil {
			fail(err.Error())
		}
		db, err := sql.Open("postgres", string(dsn))
		if err != nil {
			fail(err.Error())
		}
		db.SetMaxOpenConns(32)
		db.SetMaxIdleConns(8)
		db.SetConnMaxLifetime(30 * time.Minute)
		startupCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		if err := db.PingContext(startupCtx); err != nil {
			cancel()
			_ = db.Close()
			fail("PostgreSQL connection failed: " + err.Error())
		}
		if err := datafabricpostgres.VerifySchema(startupCtx, db); err != nil {
			cancel()
			_ = db.Close()
			fail("PostgreSQL schema verification failed: " + err.Error())
		}
		repository, err := datafabricpostgres.NewStore(db)
		if err != nil {
			cancel()
			_ = db.Close()
			fail(err.Error())
		}
		if err := repository.AuditIntegrity(startupCtx, keys); err != nil {
			cancel()
			_ = db.Close()
			fail("persistent integrity audit failed: " + err.Error())
		}
		cancel()
		apiConfig.Repository = repository
		closeBackend = func() { _ = db.Close() }
		slog.Info("PostgreSQL authoritative repository selected; Outbox dispatch requires ynx-data-fabric-worker")
	case "file":
		if !filepath.IsAbs(*statePath) {
			fail("local file store requires an absolute state path")
		}
		store, err := datafabric.OpenStore(*statePath)
		if err != nil {
			fail(err.Error())
		}
		if err := store.AuditIntegrity(keys); err != nil {
			fail("persistent integrity audit failed: " + err.Error())
		}
		apiConfig.Store = store
		publisher, closePublisher := localPublisher(*brokerMode, *eventLogPath, *natsURL, *natsStream, *natsCredentials, *natsCA, *natsCert, *natsKey, *natsReplicas)
		closeBackend = closePublisher
		go runDispatcher(shutdownContext, datafabric.Dispatcher{Store: store, Publisher: publisher, BatchSize: 100, MaxAttempts: 8})
		slog.Warn("local file authoritative repository selected; this mode is not production-capable")
	default:
		fail("store must be postgres or file")
	}
	defer closeBackend()
	api, err := datafabricapi.New(apiConfig)
	if err != nil {
		fail(err.Error())
	}
	server := &http.Server{Addr: *listen, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 * 1024}
	go func() {
		<-shutdownContext.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			slog.Error("data fabric shutdown failed", "error", err)
		}
	}()
	slog.Info("YNX Data Fabric listening", "address", *listen, "release", *sourceRelease, "commit", *sourceCommit)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fail(err.Error())
	}
}

func localPublisher(mode, eventLogPath, natsURL, natsStream, natsCredentials, natsCA, natsCert, natsKey string, natsReplicas int) (datafabric.Publisher, func()) {
	switch mode {
	case "nats":
		if !strings.HasPrefix(natsURL, "tls://") {
			fail("production NATS URL must use tls://")
		}
		for _, privateFile := range []struct{ path, purpose string }{{natsCredentials, "NATS credentials"}, {natsKey, "NATS TLS client key"}} {
			if err := datafabricconfig.ValidatePrivateFile(privateFile.path, privateFile.purpose); err != nil {
				fail(err.Error())
			}
		}
		if !filepath.IsAbs(natsCA) || !filepath.IsAbs(natsCert) {
			fail("NATS TLS CA and client certificate paths must be absolute")
		}
		connectCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		broker, err := datafabricnats.Connect(connectCtx, datafabricnats.Config{URL: natsURL, Stream: natsStream, CredentialsFile: natsCredentials, TLSCAFile: natsCA, TLSCertFile: natsCert, TLSKeyFile: natsKey, Replicas: natsReplicas})
		cancel()
		if err != nil {
			fail(err.Error())
		}
		return broker, broker.Close
	case "file":
		if !filepath.IsAbs(eventLogPath) {
			fail("local file broker requires an absolute event log path")
		}
		slog.Warn("file event broker is single-node development mode and is not production-capable")
		return &datafabric.EventLogPublisher{Path: eventLogPath}, func() {}
	default:
		fail("broker must be nats or file")
		return nil, func() {}
	}
}

func runDispatcher(ctx context.Context, dispatcher datafabric.Dispatcher) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			report, err := dispatcher.DispatchOnce(ctx)
			if err != nil && !errors.Is(err, context.Canceled) {
				slog.Error("event dispatch cycle failed", "error", err)
				continue
			}
			if report.Failed > 0 || report.Published > 0 {
				slog.Info("event dispatch cycle", "selected", report.Selected, "published", report.Published, "failed", report.Failed, "deadLetters", report.DeadLetter)
			}
		}
	}
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envUint(name string, fallback uint) uint {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseUint(value, 10, 32)
	if err != nil {
		fail(name + " must be an unsigned integer")
	}
	return uint(parsed)
}

func fail(message string) {
	slog.Error("YNX Data Fabric failed", "error", message)
	os.Exit(1)
}
