package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"golang.org/x/sys/unix"
)

// This is a public candidate producer, not an operator approval or a live
// ledger rewrite. The original inputs remain immutable and the candidate must
// receive its own independent operator pin before normal package deployment.
func preparePQInitialGenesis(genesisPath, genesisPin, migrationPath, migrationPin, configPath, configPin, output string, stdout io.Writer) error {
	if genesisPath == "" || migrationPath == "" || configPath == "" || output == "" {
		return errors.New("initial-account Genesis preparation requires all original inputs and a new output file")
	}
	rawGenesis, err := readPinnedOperatorPlan(genesisPath, genesisPin, consensus.MaxCometGenesisBytes)
	if err != nil {
		return fmt.Errorf("original Genesis: %w", err)
	}
	// Retains support for the existing full original-chain migration input.
	rawMigration, err := readPinnedOperatorPlan(migrationPath, migrationPin, 1<<30)
	if err != nil {
		return fmt.Errorf("original migration: %w", err)
	}
	migration, err := verifyMigrationStatePayload(rawMigration)
	if err != nil {
		return err
	}
	pins := consensus.ConsensusBootstrapPins{CometGenesisSHA256: genesisPin, OriginalGenesisHash: migration.OriginalGenesisHash, MigrationStateHash: migration.StateHash}
	if _, err := consensus.NewConsensusBootstrap(rawGenesis, pins, migration); err != nil {
		return fmt.Errorf("original independently pinned bootstrap: %w", err)
	}
	rawConfig, err := readPinnedOperatorPlan(configPath, configPin, 8<<20)
	if err != nil {
		return fmt.Errorf("initial-account assignments: %w", err)
	}
	var config consensus.PQInitialAccountConfiguration
	d := json.NewDecoder(bytes.NewReader(rawConfig))
	d.DisallowUnknownFields()
	if d.Decode(&config) != nil || d.Decode(new(any)) != io.EOF {
		return errors.New("invalid initial-account assignment JSON")
	}
	canonical, err := json.Marshal(config)
	if err != nil || !bytes.Equal(canonical, rawConfig) {
		return errors.New("initial-account assignments require exact canonical fields, without duplicates or trailing bytes")
	}
	candidate, err := consensus.EncodePQInitialAccountGenesis(rawGenesis, migration, config)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(candidate)
	candidateHash := hex.EncodeToString(digest[:])
	// A self-computed output hash checks candidate structure only. It is never
	// installed as the independent operational trust pin by this command.
	pins.CometGenesisSHA256 = candidateHash
	if _, err := consensus.NewConsensusBootstrap(candidate, pins, migration); err != nil {
		return fmt.Errorf("candidate bootstrap structure: %w", err)
	}
	absolute, err := filepath.Abs(output)
	if err != nil {
		return err
	}
	parent := filepath.Dir(absolute)
	if resolved, err := filepath.EvalSymlinks(parent); err != nil || resolved != parent {
		return errors.New("candidate output parent must already exist without symlink traversal")
	}
	fd, err := unix.Open(absolute, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0o600)
	if err != nil {
		return fmt.Errorf("create exclusive candidate: %w", err)
	}
	file := os.NewFile(uintptr(fd), "public-initial-account-genesis")
	if n, err := file.Write(candidate); err != nil || n != len(candidate) {
		file.Close()
		return errors.New("candidate write incomplete; preserve original partial output and do not overwrite")
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	_, err = fmt.Fprintf(stdout, "public initial-account Genesis candidate ready: sha256=%s accounts=%d output=%s authorityInstalled=false runtimeStarted=false deployed=false activated=false\n", candidateHash, len(config.Accounts), absolute)
	return err
}
