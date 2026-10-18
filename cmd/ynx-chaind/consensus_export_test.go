package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestExportConsensusStateWritesValidatedPrivateFile(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet("ynx_export_owner", 500); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	destination := filepath.Join(t.TempDir(), "nested", "consensus-state.json")
	var output bytes.Buffer
	if err := exportConsensusState(devnet, destination, &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "consensus migration state exported") {
		t.Fatalf("missing export evidence: %s", output.String())
	}
	info, err := os.Stat(destination)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("consensus export permissions = %o, want 600", info.Mode().Perm())
	}
	payload, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	var state chain.ConsensusMigrationState
	if err := json.Unmarshal(payload, &state); err != nil {
		t.Fatal(err)
	}
	if err := state.Validate(); err != nil {
		t.Fatalf("exported state failed validation: %v", err)
	}
}

func TestRunNodeConsensusExportBypassesMutatingStartup(t *testing.T) {
	dir, expected := persistedConsensusExportFixture(t)
	before := captureConsensusExportFiles(t, dir)
	// These startup settings must neither rewrite source authority nor prevent
	// an offline read. In particular, the persisted validator is not this one.
	t.Setenv("YNX_VALIDATOR_SET", "ynx_unrelated_validator|unrelated")
	t.Setenv("YNX_BOOTSTRAP_PEERS", "invalid bootstrap setting")
	t.Setenv("YNX_FAUCET_CORE_AUTH_TOKEN_FILE", filepath.Join(t.TempDir(), "missing-token"))
	cfg := nodeRuntimeConfig{
		DataDir: dir, Network: "mainnet", PQAdmissionHeight: "999", EthereumNativeTransfers: true,
		BlockProduction: true, PeerSyncRaw: "invalid startup peer", ExportConsensusState: "-",
	}
	var output bytes.Buffer
	if err := runNode(cfg, &output); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(output.Bytes(), expected) {
		t.Fatal("startup overrides changed the original canonical export")
	}
	assertConsensusExportFilesUnchanged(t, dir, before)
	cfg.ExportConsensusState = filepath.Join(t.TempDir(), "new", "consensus.json")
	output.Reset()
	if err := runNode(cfg, &output); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(cfg.ExportConsensusState)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(actual, expected) {
		t.Fatal("file and stdout export differ")
	}
	assertConsensusExportFilesUnchanged(t, dir, before)
}

func TestRunNodeConsensusExportMissingSourceDoesNotCreateChain(t *testing.T) {
	base := t.TempDir()
	cfg := nodeRuntimeConfig{DataDir: filepath.Join(base, "missing", "source"), Network: "testnet", ExportConsensusState: filepath.Join(base, "output", "state.json")}
	if err := runNode(cfg, io.Discard); err == nil {
		t.Fatal("missing source exported replacement genesis")
	}
	entries, err := os.ReadDir(base)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatal("missing source export created input or output directories")
	}
}

func TestRunNodeConsensusExportRejectsPendingWithoutWriting(t *testing.T) {
	dir := t.TempDir()
	d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	if _, err := d.Faucet("ynx_pending_export", 12); err != nil {
		t.Fatal(err)
	}
	before := captureConsensusExportFiles(t, dir)
	destination := filepath.Join(t.TempDir(), "state.json")
	err = runNode(nodeRuntimeConfig{DataDir: dir, Network: "testnet", ExportConsensusState: destination}, io.Discard)
	if err == nil || !strings.Contains(err.Error(), "pending") {
		t.Fatalf("pending source result: %v", err)
	}
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatalf("pending export wrote output: %v", err)
	}
	assertConsensusExportFilesUnchanged(t, dir, before)
}

func TestRunNodeConsensusExportCannotOverwriteSourceOrExistingTarget(t *testing.T) {
	dir, _ := persistedConsensusExportFixture(t)
	before := captureConsensusExportFiles(t, dir)
	for _, name := range []string{"devnet-state.json", "devnet-state.integrity-version", "devnet-state.json.tmp", "devnet-state.integrity-version.tmp"} {
		t.Run(name, func(t *testing.T) {
			cfg := nodeRuntimeConfig{DataDir: dir, ExportConsensusState: filepath.Join(dir, name)}
			if err := runNode(cfg, io.Discard); err == nil {
				t.Fatal("source path accepted as export target")
			}
			assertConsensusExportFilesUnchanged(t, dir, before)
		})
	}
	for _, kind := range []string{"existing-result", "symlink", "hardlink", "old-temp", "source-directory-alias"} {
		t.Run(kind, func(t *testing.T) {
			outputDir := t.TempDir()
			target := filepath.Join(outputDir, "state.json")
			switch kind {
			case "existing-result":
				if err := os.WriteFile(target, []byte("UNKNOWN original output"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if err := os.Symlink(filepath.Join(dir, "devnet-state.json"), target); err != nil {
					t.Fatal(err)
				}
			case "hardlink":
				if err := os.Link(filepath.Join(dir, "devnet-state.json"), target); err != nil {
					t.Fatal(err)
				}
			case "old-temp":
				if err := os.WriteFile(target+".tmp", []byte("UNKNOWN old exporter"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "source-directory-alias":
				if err := os.Symlink(dir, filepath.Join(outputDir, "alias")); err != nil {
					t.Fatal(err)
				}
				target = filepath.Join(outputDir, "alias", "devnet-state.json.tmp")
			}
			originalOutput := captureConsensusExportFiles(t, outputDir)
			if err := runNode(nodeRuntimeConfig{DataDir: dir, ExportConsensusState: target}, io.Discard); err == nil {
				t.Fatal("existing or conflicting export target was overwritten")
			}
			assertConsensusExportFilesUnchanged(t, outputDir, originalOutput)
			assertConsensusExportFilesUnchanged(t, dir, before)
		})
	}
}

func TestConsensusExportUnknownRetainsOriginalTargetAndRejectsRetry(t *testing.T) {
	dir, expected := persistedConsensusExportFixture(t)
	state, err := chain.ExportConsensusMigrationCheckpoint(dir)
	if err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(t.TempDir(), "state.json")
	injected := errors.New("injected directory fsync failure")
	err = writeConsensusStateExport(state, destination, io.Discard, func(string) error { return injected })
	if !errors.Is(err, errConsensusExportUncertain) || !errors.Is(err, injected) {
		t.Fatalf("missing UNKNOWN/first cause: %v", err)
	}
	payload, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(payload, expected) {
		t.Fatal("UNKNOWN target lost original canonical bytes")
	}
	before := captureConsensusExportFiles(t, filepath.Dir(destination))
	if err := writeConsensusStateExport(state, destination, io.Discard, syncConsensusExportDirectory); !errors.Is(err, os.ErrExist) {
		t.Fatalf("retry did not preserve exclusive target: %v", err)
	}
	assertConsensusExportFilesUnchanged(t, filepath.Dir(destination), before)
}

func TestConsensusExportSyncsCreatedDirectoryAncestors(t *testing.T) {
	dir, _ := persistedConsensusExportFixture(t)
	state, err := chain.ExportConsensusMigrationCheckpoint(dir)
	if err != nil {
		t.Fatal(err)
	}
	base := t.TempDir()
	destination := filepath.Join(base, "first", "second", "state.json")
	var synced []string
	err = writeConsensusStateExport(state, destination, io.Discard, func(path string) error {
		synced = append(synced, path)
		return syncConsensusExportDirectory(path)
	})
	if err != nil {
		t.Fatal(err)
	}
	expected := []string{filepath.Join(base, "first", "second"), filepath.Join(base, "first"), base}
	if strings.Join(synced, "\n") != strings.Join(expected, "\n") {
		t.Fatalf("directory durability boundary = %v, want %v", synced, expected)
	}
	if err := writeConsensusStateExport(state, "-", shortConsensusExportWriter{}, syncConsensusExportDirectory); !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("stdout short write was reported successful: %v", err)
	}
}

type shortConsensusExportWriter struct{}

func (shortConsensusExportWriter) Write(p []byte) (int, error) { return len(p) - 1, nil }

func persistedConsensusExportFixture(t *testing.T) (string, []byte) {
	t.Helper()
	dir := t.TempDir()
	validators := []chain.Validator{{Address: "ynx_original_export_validator", Moniker: "original-authority", VotingPower: 7, Active: true}}
	d, err := chain.NewPersistentDevnetWithValidatorsAndPeers(chain.DefaultNetworkConfig("testnet"), dir, validators, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.Faucet("ynx_original_export_owner", 500); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Transfer("ynx_original_export_owner", "ynx_original_export_recipient", 11); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	state, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	payload, err := state.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	return dir, append(payload, '\n')
}

type consensusExportFileCapture struct {
	info os.FileInfo
	data []byte
}

func captureConsensusExportFiles(t *testing.T, dir string) map[string]consensusExportFileCapture {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	files := make(map[string]consensusExportFileCapture, len(entries))
	for _, entry := range entries {
		path := filepath.Join(dir, entry.Name())
		info, err := os.Lstat(path)
		if err != nil {
			t.Fatal(err)
		}
		var payload []byte
		if info.Mode()&os.ModeSymlink != 0 {
			target, err := os.Readlink(path)
			if err != nil {
				t.Fatal(err)
			}
			payload = []byte(target)
		} else {
			payload, err = os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
		}
		files[entry.Name()] = consensusExportFileCapture{info: info, data: payload}
	}
	return files
}

func assertConsensusExportFilesUnchanged(t *testing.T, dir string, before map[string]consensusExportFileCapture) {
	t.Helper()
	after := captureConsensusExportFiles(t, dir)
	if len(before) != len(after) {
		t.Fatal("export changed original file inventory")
	}
	for name, original := range before {
		current, ok := after[name]
		if !ok || !os.SameFile(original.info, current.info) || !original.info.ModTime().Equal(current.info.ModTime()) || original.info.Mode() != current.info.Mode() || original.info.Size() != current.info.Size() || !bytes.Equal(original.data, current.data) {
			t.Fatalf("export changed original bytes/inode/mtime/mode: %s", name)
		}
	}
}
