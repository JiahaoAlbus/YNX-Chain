package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abciserver "github.com/cometbft/cometbft/abci/server"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func main() {
	listen := flag.String("listen", "tcp://127.0.0.1:26658", "ABCI listen address")
	transport := flag.String("transport", "socket", "ABCI transport: socket or grpc")
	migrationPath := flag.String("migration-state", "", "validated YNX consensus migration JSON path")
	statePath := flag.String("state", "", "durable ABCI committed state path (default: <migration-state>.abci-state.json)")
	layout := flag.String("state-layout", "atomic-json", "persistent layout: atomic-json, snapshot-journal or block-journal (explicit incompatible formats)")
	phaseTiming := flag.Bool("phase-timing", false, "emit bounded cumulative ABCI handler and Commit storage timings to stderr (diagnostics only)")
	flag.Parse()
	if *migrationPath == "" {
		log.Fatal("-migration-state is required")
	}
	if *statePath == "" {
		*statePath = *migrationPath + ".abci-state.json"
	}
	if err := runWithDiagnostics(*listen, *transport, *migrationPath, *statePath, *layout, *phaseTiming); err != nil {
		log.Fatal(err)
	}
}

func run(listen, transport, migrationPath, statePath string) error {
	return runWithLayout(listen, transport, migrationPath, statePath, "atomic-json")
}

func runWithLayout(listen, transport, migrationPath, statePath, layout string) error {
	return runWithDiagnostics(listen, transport, migrationPath, statePath, layout, false)
}

func runWithDiagnostics(listen, transport, migrationPath, statePath, layout string, phaseTiming bool) (runErr error) {
	if layout != "atomic-json" && layout != "snapshot-journal" && layout != "block-journal" {
		return fmt.Errorf("unsupported state layout %q", layout)
	}
	payload, err := os.ReadFile(migrationPath)
	if err != nil {
		return fmt.Errorf("read migration state: %w", err)
	}
	var state chain.ConsensusMigrationState
	if err := json.Unmarshal(payload, &state); err != nil {
		return fmt.Errorf("decode migration state: %w", err)
	}
	var app *consensus.Application
	if layout == "block-journal" {
		app, err = consensus.NewBlockJournaledApplication(state, statePath)
	} else if layout == "snapshot-journal" {
		app, err = consensus.NewJournaledApplication(state, statePath)
	} else {
		app, err = consensus.NewPersistentApplication(state, statePath)
	}
	if err != nil {
		return err
	}
	var application abcitypes.Application = app
	var timed *phaseTimedApplication
	if phaseTiming {
		timed = withPhaseTiming(app, os.Stderr)
		application = timed
	}
	server, err := abciserver.NewServer(listen, transport, application)
	if err != nil {
		return fmt.Errorf("create ABCI server: %w", err)
	}
	if err := server.Start(); err != nil {
		return fmt.Errorf("start ABCI server: %w", err)
	}
	if timed != nil {
		defer func() {
			drainCtx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			runErr = errors.Join(runErr, stopPhaseDiagnostics(drainCtx, server.Stop, timed.recorder))
		}()
	} else {
		defer server.Stop()
	}
	log.Printf("YNX ABCI application listening on %s over %s at migrated height %d with durable state %s", listen, transport, state.Height, statePath)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
	return nil
}
