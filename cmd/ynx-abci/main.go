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
	flag.Parse()
	if *migrationPath == "" {
		log.Fatal("-migration-state is required")
	}
	if err := run(*listen, *transport, *migrationPath); err != nil {
		log.Fatal(err)
	}
}

func run(listen, transport, migrationPath string) error {
	payload, err := os.ReadFile(migrationPath)
	if err != nil {
		return fmt.Errorf("read migration state: %w", err)
	}
	var state chain.ConsensusMigrationState
	if err := json.Unmarshal(payload, &state); err != nil {
		return fmt.Errorf("decode migration state: %w", err)
	}
	app, err := consensus.NewApplication(state)
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
	log.Printf("YNX ABCI application listening on %s over %s at migrated height %d", listen, transport, state.Height)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
	return nil
}
