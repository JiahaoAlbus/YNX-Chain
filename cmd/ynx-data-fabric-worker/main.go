package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricconfig"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricnats"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricpayledger"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricpostgres"
	_ "github.com/lib/pq"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	payLedgerDefault, err := envBool("YNX_DATA_FABRIC_PAY_LEDGER_ENABLED")
	if err != nil {
		fail(err.Error())
	}
	dsnFile := flag.String("postgres-dsn-file", os.Getenv("YNX_DATA_FABRIC_POSTGRES_DSN_FILE"), "absolute private PostgreSQL DSN path")
	dispatcherID := flag.String("dispatcher-id", os.Getenv("YNX_DATA_FABRIC_DISPATCHER_ID"), "stable unique dispatcher instance ID")
	natsURL := flag.String("nats-url", env("YNX_DATA_FABRIC_NATS_URL", "tls://127.0.0.1:4222"), "NATS server URL")
	natsStream := flag.String("nats-stream", env("YNX_DATA_FABRIC_NATS_STREAM", datafabricnats.DefaultStream), "JetStream stream name")
	natsCredentials := flag.String("nats-credentials", os.Getenv("YNX_DATA_FABRIC_NATS_CREDENTIALS_FILE"), "absolute NATS credentials path")
	natsCA := flag.String("nats-ca", os.Getenv("YNX_DATA_FABRIC_NATS_CA_FILE"), "absolute NATS TLS CA path")
	natsCert := flag.String("nats-cert", os.Getenv("YNX_DATA_FABRIC_NATS_CERT_FILE"), "absolute NATS TLS client certificate path")
	natsKey := flag.String("nats-key", os.Getenv("YNX_DATA_FABRIC_NATS_KEY_FILE"), "absolute NATS TLS client key path")
	natsReplicas := flag.Int("nats-replicas", 3, "JetStream replica count")
	batchSize := flag.Int("batch-size", 100, "Outbox records per dispatch cycle")
	sagaTimeoutBatch := flag.Int("saga-timeout-batch", 100, "expired Sagas transitioned per worker cycle")
	payLedgerEnabled := flag.Bool("pay-ledger-consumer", payLedgerDefault, "consume authoritative Pay receipt/refund events into Ledger and reconciliation")
	payChainURL := flag.String("pay-chain-url", os.Getenv("YNX_DATA_FABRIC_PAY_CHAIN_URL"), "independent authoritative chain origin for Pay refund reconciliation")
	payChainCommit := flag.String("pay-chain-commit", os.Getenv("YNX_DATA_FABRIC_PAY_CHAIN_COMMIT"), "exact independent chain observer commit")
	payChainRelease := flag.String("pay-chain-release", os.Getenv("YNX_DATA_FABRIC_PAY_CHAIN_RELEASE"), "exact independent chain observer release")
	interval := flag.Duration("interval", 250*time.Millisecond, "dispatch interval")
	lease := flag.Duration("lease", 30*time.Second, "Outbox lease duration")
	flag.Parse()

	if strings.TrimSpace(*dispatcherID) == "" || len(*dispatcherID) > 128 {
		fail("dispatcher-id is required and must not exceed 128 bytes")
	}
	if *batchSize <= 0 || *batchSize > 1000 || *sagaTimeoutBatch <= 0 || *sagaTimeoutBatch > 1000 || *interval <= 0 || *lease <= 0 {
		fail("batch-size and saga-timeout-batch must be 1..1000 and interval/lease must be positive")
	}
	if !strings.HasPrefix(*natsURL, "tls://") {
		fail("production NATS URL must use tls://")
	}
	for _, privateFile := range []struct{ path, purpose string }{{*dsnFile, "PostgreSQL DSN"}, {*natsCredentials, "NATS credentials"}, {*natsKey, "NATS TLS client key"}} {
		if err := datafabricconfig.ValidatePrivateFile(privateFile.path, privateFile.purpose); err != nil {
			fail(err.Error())
		}
	}
	if !filepath.IsAbs(*natsCA) || !filepath.IsAbs(*natsCert) {
		fail("NATS TLS CA and client certificate paths must be absolute")
	}
	dsn, err := datafabricconfig.LoadSecretFile(*dsnFile, "PostgreSQL DSN")
	if err != nil {
		fail(err.Error())
	}
	db, err := sql.Open("postgres", string(dsn))
	if err != nil {
		fail(err.Error())
	}
	defer db.Close()
	db.SetMaxOpenConns(16)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)
	startupCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	if err := db.PingContext(startupCtx); err != nil {
		cancel()
		fail("PostgreSQL connection failed: " + err.Error())
	}
	if err := datafabricpostgres.VerifySchema(startupCtx, db); err != nil {
		cancel()
		fail("PostgreSQL schema verification failed: " + err.Error())
	}
	broker, err := datafabricnats.Connect(startupCtx, datafabricnats.Config{
		URL: *natsURL, Stream: *natsStream, CredentialsFile: *natsCredentials, TLSCAFile: *natsCA,
		TLSCertFile: *natsCert, TLSKeyFile: *natsKey, Replicas: *natsReplicas,
	})
	cancel()
	if err != nil {
		fail(err.Error())
	}
	defer broker.Close()
	store, err := datafabricpostgres.NewStore(db)
	if err != nil {
		fail(err.Error())
	}
	var payLedger *datafabricpayledger.Processor
	if *payLedgerEnabled {
		observer, err := datafabricpayledger.NewHTTPChainObserver(datafabricpayledger.HTTPChainObserverConfig{
			Origin: *payChainURL, SourceCommit: *payChainCommit, SourceRelease: *payChainRelease,
			ChainID: 6423,
		})
		if err != nil {
			fail(err.Error())
		}
		payLedger = &datafabricpayledger.Processor{Store: store, Observer: observer}
	}
	dispatcher := datafabricpostgres.Dispatcher{Store: store, Publisher: broker, Owner: *dispatcherID, BatchSize: *batchSize, Lease: *lease, MaxAttempts: 8}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	slog.Info("YNX Data Fabric PostgreSQL Outbox worker started", "dispatcherId", *dispatcherID, "batchSize", *batchSize)
	if err := run(ctx, dispatcher, store, broker, payLedger, *interval, *sagaTimeoutBatch); err != nil && !errors.Is(err, context.Canceled) {
		fail(err.Error())
	}
	slog.Info("YNX Data Fabric PostgreSQL Outbox worker stopped", "dispatcherId", *dispatcherID)
}

func run(ctx context.Context, dispatcher datafabricpostgres.Dispatcher, store *datafabricpostgres.Store, broker *datafabricnats.Broker, payLedger *datafabricpayledger.Processor, interval time.Duration, sagaTimeoutBatch int) error {
	if payLedger != nil {
		go runPayLedgerConsumer(ctx, broker, payLedger, interval)
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			expired, err := store.ExpireSagas(ctx, time.Now().UTC(), sagaTimeoutBatch)
			if err != nil {
				slog.Error("Saga timeout cycle failed", "error", err)
			} else if len(expired) > 0 {
				slog.Info("Saga timeout cycle", "expired", len(expired))
			}
			report, err := dispatcher.DispatchOnce(ctx)
			if err != nil {
				slog.Error("Outbox dispatch cycle failed", "error", err)
				continue
			}
			if report.Selected > 0 {
				slog.Info("Outbox dispatch cycle", "selected", report.Selected, "published", report.Published, "failed", report.Failed, "deadLetters", report.DeadLetter)
			}
		}
	}
}

func runPayLedgerConsumer(ctx context.Context, broker *datafabricnats.Broker, processor *datafabricpayledger.Processor, retryDelay time.Duration) {
	for ctx.Err() == nil {
		applied, err := broker.ConsumeEventOnce(ctx, datafabricpayledger.ConsumerName, "ynx.events.pay.>", processor.Process)
		if err == nil {
			if applied {
				slog.Info("Pay Ledger reconciliation event committed")
			}
			continue
		}
		if errors.Is(err, context.Canceled) || ctx.Err() != nil {
			return
		}
		slog.Error("Pay Ledger reconciliation consumer failed", "error", err)
		timer := time.NewTimer(retryDelay)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-timer.C:
		}
	}
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envBool(name string) (bool, error) {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	switch value {
	case "", "0", "false", "no":
		return false, nil
	case "1", "true", "yes":
		return true, nil
	default:
		return false, fmt.Errorf("%s must be true/false, yes/no, or 1/0", name)
	}
}

func fail(message string) {
	slog.Error("YNX Data Fabric worker failed", "error", message)
	os.Exit(1)
}
