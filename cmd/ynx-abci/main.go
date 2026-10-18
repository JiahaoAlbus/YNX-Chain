package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
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
	consensusGenesis := flag.String("consensus-genesis", "", "operator-pinned raw Comet genesis file (registry registration only)")
	consensusGenesisHash := flag.String("consensus-genesis-sha256", "", "independent operator SHA256 pin for exact raw Comet genesis bytes")
	nativeGenesisHash := flag.String("original-genesis-hash", "", "independent operator pin for original native genesis hash")
	migrationHash := flag.String("bound-migration-state-hash", "", "independent operator pin for validated key-bound migration StateHash")
	flag.Parse()
	if *migrationPath == "" {
		log.Fatal("-migration-state is required")
	}
	if *statePath == "" {
		*statePath = *migrationPath + ".abci-state.json"
	}
	pins := consensus.ConsensusBootstrapPins{CometGenesisSHA256: *consensusGenesisHash, OriginalGenesisHash: *nativeGenesisHash, MigrationStateHash: *migrationHash}
	if err := runWithBootstrap(*listen, *transport, *migrationPath, *statePath, *consensusGenesis, pins); err != nil {
		log.Fatal(err)
	}
}

func run(listen, transport, migrationPath, statePath string) error {
	return runWithBootstrap(listen, transport, migrationPath, statePath, "", consensus.ConsensusBootstrapPins{})
}

func runWithBootstrap(listen, transport, migrationPath, statePath, genesisPath string, pins consensus.ConsensusBootstrapPins) error {
	payload, err := os.ReadFile(migrationPath)
	if err != nil {
		return fmt.Errorf("read migration state: %w", err)
	}
	var state chain.ConsensusMigrationState
	if err := json.Unmarshal(payload, &state); err != nil {
		return fmt.Errorf("decode migration state: %w", err)
	}
	var app *consensus.Application
	if genesisPath == "" {
		if pins != (consensus.ConsensusBootstrapPins{}) {
			return fmt.Errorf("consensus bootstrap pins require -consensus-genesis")
		}
		app, err = consensus.NewPersistentApplication(state, statePath)
	} else {
		rawGenesis, readErr := os.ReadFile(genesisPath)
		if readErr != nil {
			return fmt.Errorf("read pinned Comet genesis: %w", readErr)
		}
		bootstrap, bootstrapErr := consensus.NewConsensusBootstrap(rawGenesis, pins, state)
		if bootstrapErr != nil {
			return fmt.Errorf("validate operator-pinned consensus bootstrap: %w", bootstrapErr)
		}
		app, err = consensus.NewPersistentApplicationWithBootstrap(state, statePath, bootstrap)
	}
	if err != nil {
		return err
	}
	server, err := abciserver.NewServer(listen, transport, app)
	if err != nil {
		return fmt.Errorf("create ABCI server: %w", err)
	}
	if err := server.Start(); err != nil {
		return fmt.Errorf("start ABCI server: %w", err)
	}
	defer server.Stop()
	log.Printf("YNX ABCI application listening on %s over %s at migrated height %d with durable state %s", listen, transport, state.Height, statePath)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
	return nil
}
