package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricconfig"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricpay"
	sdk "github.com/JiahaoAlbus/YNX-Chain/sdk/datafabric"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	sourceURL := flag.String("pay-source-url", os.Getenv("YNX_PAY_DATA_FABRIC_SOURCE_URL"), "authoritative YNX Chain Pay origin")
	sourceMode := flag.String("pay-source-mode", envString("YNX_PAY_DATA_FABRIC_SOURCE_MODE", datafabricpay.SourceModeAuthoritative), "Pay event source mode: authoritative or bft")
	upstreamKeyFile := flag.String("pay-upstream-key-file", os.Getenv("YNX_PAY_DATA_FABRIC_UPSTREAM_KEY_FILE"), "absolute private Pay upstream key path")
	producerURL := flag.String("data-fabric-url", os.Getenv("YNX_PAY_DATA_FABRIC_URL"), "Data Fabric producer origin")
	keyID := flag.String("event-key-id", os.Getenv("YNX_PAY_DATA_FABRIC_EVENT_KEY_ID"), "registered Pay product event key ID")
	eventKeyFile := flag.String("event-key-file", os.Getenv("YNX_PAY_DATA_FABRIC_EVENT_KEY_FILE"), "absolute private Pay event signing key path")
	sourceCommit := flag.String("source-commit", os.Getenv("YNX_PAY_SOURCE_COMMIT"), "exact Pay source commit")
	sourceRelease := flag.String("source-release", os.Getenv("YNX_PAY_SOURCE_RELEASE"), "exact Pay source release")
	chainID := flag.Int64("chain-id", envInt64("YNX_PAY_DATA_FABRIC_CHAIN_ID", 6423), "authoritative YNX Chain ID")
	interval := flag.Duration("interval", 2*time.Second, "authoritative Pay event polling interval")
	once := flag.Bool("once", false, "run one integration cycle and exit")
	flag.Parse()

	if *interval <= 0 || strings.TrimSpace(*sourceCommit) == "" || strings.TrimSpace(*sourceRelease) == "" {
		fail("positive interval, exact Pay source commit, and exact Pay source release are required")
	}
	var upstreamKey []byte
	var err error
	if *sourceMode == datafabricpay.SourceModeAuthoritative {
		upstreamKey, err = datafabricconfig.LoadSecretFile(*upstreamKeyFile, "Pay authority upstream")
		if err != nil {
			fail(err.Error())
		}
	} else if strings.TrimSpace(*upstreamKeyFile) != "" {
		fail("BFT Pay event source must not configure a legacy upstream key file")
	}
	eventKey, err := datafabricconfig.LoadSecretFile(*eventKeyFile, "Pay Data Fabric event signing")
	if err != nil {
		fail(err.Error())
	}
	producer, err := sdk.NewProducerClient(*producerURL, *keyID, eventKey)
	if err != nil {
		fail(err.Error())
	}
	bridge, err := datafabricpay.New(datafabricpay.Config{
		SourceURL: *sourceURL, SourceMode: *sourceMode, UpstreamKey: string(upstreamKey), KeyID: *keyID, SigningKey: eventKey,
		SourceCommit: *sourceCommit, SourceRelease: *sourceRelease, ChainID: *chainID, Producer: producer,
	})
	if err != nil {
		fail(err.Error())
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, bridge, *interval, *once); err != nil && !errors.Is(err, context.Canceled) {
		fail(err.Error())
	}
}

func run(ctx context.Context, bridge *datafabricpay.Bridge, interval time.Duration, once bool) error {
	for {
		report, err := bridge.SyncOnce(ctx)
		if err != nil {
			if once {
				return err
			}
			slog.Error("Pay Data Fabric integration cycle failed", "error", err)
		} else if report.CanonicalEvents > 0 {
			slog.Info("Pay Data Fabric integration cycle", "sourceEvents", report.SourceEvents, "mappedSourceEvents", report.MappedSourceEvents, "unmappedSourceEvents", report.UnmappedSourceEvents, "canonicalEvents", report.CanonicalEvents, "committed", report.Committed, "alreadyCommitted", report.AlreadyCommitted)
		}
		if once {
			return nil
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func fail(message string) {
	slog.Error("YNX Pay Data Fabric bridge failed", "error", message)
	os.Exit(1)
}

func envInt64(name string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func envString(name, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	return value
}
