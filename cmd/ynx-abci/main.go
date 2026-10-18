package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abciserver "github.com/cometbft/cometbft/abci/server"
)

func main() {
	listen := flag.String("listen", "tcp://127.0.0.1:26658", "ABCI listen address")
	transport := flag.String("transport", "socket", "ABCI transport: socket or grpc")
	migrationPath := flag.String("migration-state", "", "validated YNX consensus migration JSON path")
	statePath := flag.String("state", "", "durable ABCI committed state path (default: <migration-state>.abci-state.json)")
	layout := flag.String("state-layout", "atomic-json", "persistent layout: atomic-json, snapshot-journal or block-journal (explicit incompatible formats)")
	consensusGenesis := flag.String("consensus-genesis", "", "operator-pinned raw Comet genesis file (registry registration only)")
	consensusGenesisHash := flag.String("consensus-genesis-sha256", "", "independent operator SHA256 pin for exact raw Comet genesis bytes")
	nativeGenesisHash := flag.String("original-genesis-hash", "", "independent operator pin for original native genesis hash")
	migrationHash := flag.String("bound-migration-state-hash", "", "independent operator pin for validated key-bound migration StateHash")
	engineSchedule := flag.String("pq-engine-schedule", "", "canonical operator-authorized PQ engine schedule JSON")
	engineScheduleHash := flag.String("pq-engine-schedule-hash", "", "independent operator hash pin for the exact PQ engine schedule")
	runtimePlan := flag.String("runtime-upgrade-plan", "", "runtime upgrades require the in-process ynx-comet checkpoint channel")
	runtimePin := flag.String("runtime-upgrade-plan-hash", "", "independent runtime upgrade pin (not supported by external ABCI transport)")
	flag.Parse()
	if err := rejectExternalRuntimeUpgrade(*runtimePlan, *runtimePin); err != nil {
		log.Fatal(err)
	}
	if *migrationPath == "" {
		log.Fatal("-migration-state is required")
	}
	if *statePath == "" {
		*statePath = *migrationPath + ".abci-state.json"
	}
	pins := consensus.ConsensusBootstrapPins{CometGenesisSHA256: *consensusGenesisHash, OriginalGenesisHash: *nativeGenesisHash, MigrationStateHash: *migrationHash}
	if err := runWithLayoutAndEngineAuthorization(*listen, *transport, *migrationPath, *statePath, *layout, *consensusGenesis, pins, *engineSchedule, *engineScheduleHash); err != nil {
		log.Fatal(err)
	}
}

func run(listen, transport, migrationPath, statePath string) error {
	return runWithBootstrap(listen, transport, migrationPath, statePath, "", consensus.ConsensusBootstrapPins{})
}

func runWithLayout(listen, transport, migrationPath, statePath, layout string) error {
	return runWithLayoutAndEngineAuthorization(listen, transport, migrationPath, statePath, layout, "", consensus.ConsensusBootstrapPins{}, "", "")
}

func runWithBootstrap(listen, transport, migrationPath, statePath, genesisPath string, pins consensus.ConsensusBootstrapPins) error {
	return runWithEngineAuthorization(listen, transport, migrationPath, statePath, genesisPath, pins, "", "")
}

func runWithEngineAuthorization(listen, transport, migrationPath, statePath, genesisPath string, pins consensus.ConsensusBootstrapPins, schedulePath, scheduleHash string) error {
	return runWithLayoutAndEngineAuthorization(listen, transport, migrationPath, statePath, "atomic-json", genesisPath, pins, schedulePath, scheduleHash)
}

func readEngineAuthorization(path, pin, genesisPath string) (*consensus.PQEngineAuthorization, error) {
	if path == "" && pin == "" {
		return nil, nil
	}
	if path == "" || pin == "" || genesisPath == "" {
		return nil, fmt.Errorf("PQ engine schedule requires both -pq-engine-schedule and -pq-engine-schedule-hash with -consensus-genesis")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("read independent PQ engine schedule: %w", err)
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 32*1024+1))
	if err != nil || len(raw) > 32*1024 {
		return nil, fmt.Errorf("PQ engine schedule must be readable and at most 32 KiB")
	}
	return consensus.NewPQEngineAuthorization(raw, pin)
}

// Every layout requires the same complete independent authority configuration.
// Partial pins fail before opening a state file or creating a writer lock.
func validateStartupLayout(layout, genesisPath string, pins consensus.ConsensusBootstrapPins, schedulePath, scheduleHash string) error {
	if layout != "atomic-json" && layout != "snapshot-journal" && layout != "block-journal" {
		return fmt.Errorf("unsupported state layout %q", layout)
	}
	if genesisPath == "" && pins != (consensus.ConsensusBootstrapPins{}) {
		return fmt.Errorf("consensus bootstrap pins require -consensus-genesis")
	}
	if genesisPath != "" {
		for _, pin := range []string{pins.CometGenesisSHA256, pins.OriginalGenesisHash, pins.MigrationStateHash} {
			if !startupCanonicalHash(pin) {
				return fmt.Errorf("consensus bootstrap requires all three independent canonical nonzero SHA256 pins")
			}
		}
	}
	if schedulePath != "" || scheduleHash != "" {
		if genesisPath == "" || schedulePath == "" || !startupCanonicalHash(scheduleHash) {
			return fmt.Errorf("PQ engine schedule requires its file, independent canonical hash and pinned consensus genesis")
		}
	}
	return nil
}

func startupCanonicalHash(value string) bool {
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != 32 || hex.EncodeToString(decoded) != value {
		return false
	}
	for _, b := range decoded {
		if b != 0 {
			return true
		}
	}
	return false
}

// prepareApplication is the normal startup path, separated from server.Start so
// layout/lease/pin recovery tests need not launch a socket or node. On success
// the caller owns the lease for the entire application/server lifetime.
func prepareApplication(migrationPath, statePath, layout, genesisPath string, pins consensus.ConsensusBootstrapPins, schedulePath, scheduleHash string) (app *consensus.Application, lease *consensus.ApplicationStateWriterLease, height uint64, result error) {
	if err := validateStartupLayout(layout, genesisPath, pins, schedulePath, scheduleHash); err != nil {
		return nil, nil, 0, err
	}
	authorization, err := readEngineAuthorization(schedulePath, scheduleHash, genesisPath)
	if err != nil {
		return nil, nil, 0, err
	}
	payload, err := os.ReadFile(migrationPath)
	if err != nil {
		return nil, lease, 0, fmt.Errorf("read migration state: %w", err)
	}
	var state chain.ConsensusMigrationState
	if err = json.Unmarshal(payload, &state); err != nil {
		return nil, lease, 0, fmt.Errorf("decode migration state: %w", err)
	}
	var bootstrap *consensus.ConsensusBootstrap
	if genesisPath != "" {
		rawGenesis, readErr := os.ReadFile(genesisPath)
		if readErr != nil {
			return nil, lease, 0, fmt.Errorf("read pinned Comet genesis: %w", readErr)
		}
		bootstrap, err = consensus.NewConsensusBootstrap(rawGenesis, pins, state)
		if err != nil {
			return nil, lease, 0, fmt.Errorf("validate operator-pinned consensus bootstrap: %w", err)
		}
	}
	lease, err = consensus.AcquireApplicationStateWriterLease(statePath)
	if err != nil {
		return nil, nil, 0, err
	}
	defer func() {
		if result != nil {
			result = errors.Join(result, lease.Close())
			lease = nil
			app = nil
		}
	}()
	switch layout {
	case "block-journal":
		if bootstrap == nil {
			app, err = consensus.NewBlockJournaledApplication(state, statePath)
		} else if authorization == nil {
			app, err = consensus.NewBlockJournaledApplicationWithBootstrap(state, statePath, bootstrap)
		} else {
			app, err = consensus.NewBlockJournaledApplicationWithEngineAuthorization(state, statePath, bootstrap, authorization)
		}
	case "snapshot-journal":
		if bootstrap == nil {
			app, err = consensus.NewJournaledApplication(state, statePath)
		} else if authorization == nil {
			app, err = consensus.NewJournaledApplicationWithBootstrap(state, statePath, bootstrap)
		} else {
			app, err = consensus.NewJournaledApplicationWithEngineAuthorization(state, statePath, bootstrap, authorization)
		}
	default:
		if bootstrap == nil {
			app, err = consensus.NewPersistentApplication(state, statePath)
		} else if authorization == nil {
			app, err = consensus.NewPersistentApplicationWithBootstrap(state, statePath, bootstrap)
		} else {
			app, err = consensus.NewPersistentApplicationWithEngineAuthorization(state, statePath, bootstrap, authorization)
		}
	}
	if err != nil {
		return nil, lease, 0, err
	}
	if err := app.ValidateNormalRuntime(); err != nil {
		return nil, lease, 0, err
	}
	return app, lease, state.Height, nil
}

func runWithLayoutAndEngineAuthorization(listen, transport, migrationPath, statePath, layout, genesisPath string, pins consensus.ConsensusBootstrapPins, schedulePath, scheduleHash string) (result error) {
	app, lease, height, err := prepareApplication(migrationPath, statePath, layout, genesisPath, pins, schedulePath, scheduleHash)
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, lease.Close()) }()
	server, err := abciserver.NewServer(listen, transport, app)
	if err != nil {
		return fmt.Errorf("create ABCI server: %w", err)
	}
	if err = server.Start(); err != nil {
		return fmt.Errorf("start ABCI server: %w", err)
	}
	defer server.Stop()
	log.Printf("YNX ABCI application listening on %s over %s at migrated height %d with durable %s state %s", listen, transport, height, layout, statePath)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
	return nil
}
