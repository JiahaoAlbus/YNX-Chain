package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestBlockProductionPaused(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "pause.json")
	if blockProductionPaused("") || blockProductionPaused(marker) {
		t.Fatal("missing pause marker should not pause production")
	}
	if err := os.WriteFile(marker, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !blockProductionPaused(marker) {
		t.Fatal("existing pause marker did not pause production")
	}
	directory := filepath.Join(t.TempDir(), "directory-marker")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	if !blockProductionPaused(directory) {
		t.Fatal("unexpected marker type must fail closed")
	}
}

func TestPauseFileConfigMustBeCleanAbsolutePath(t *testing.T) {
	cfg := nodeRuntimeConfig{BlockProductionPauseFile: "relative/pause.json", ReplicationInterval: time.Second}
	if err := validateReplicationStartupConfig(chainConfigForPauseTest(), nil, cfg); err == nil {
		t.Fatal("relative pause path passed validation")
	}
}

func chainConfigForPauseTest() chain.NetworkConfig {
	return chain.DefaultNetworkConfig("devnet")
}
