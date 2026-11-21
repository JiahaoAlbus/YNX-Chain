package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func pqCopyFixture(t *testing.T) (nodeRuntimeConfig, chain.ConsensusMigrationState) {
	t.Helper()
	source, _ := persistedConsensusExportFixture(t)
	source, err := filepath.EvalSymlinks(source)
	if err != nil {
		t.Fatal(err)
	}
	before, err := chain.ExportConsensusMigrationCheckpoint(source)
	if err != nil {
		t.Fatal(err)
	}
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(parent, 0700); err != nil {
		t.Fatal(err)
	}
	return nodeRuntimeConfig{DataDir: source, PQScheduledCopy: filepath.Join(parent, "scheduled"), PQSourceGenesis: before.OriginalGenesisHash, PQSourceState: before.StateHash, PQSourceHeight: strconv.FormatUint(before.Height, 10), PQAdmissionHeight: strconv.FormatUint(before.Height+10, 10)}, before
}

func TestOfflinePQScheduledCopyNormalAndCold(t *testing.T) {
	cfg, before := pqCopyFixture(t)
	original := captureConsensusExportFiles(t, cfg.DataDir)
	var output bytes.Buffer
	if err := runNode(cfg, &output); err != nil {
		t.Fatal(err)
	}
	var receipt chain.OfflinePQCopyResult
	if err := json.Unmarshal(output.Bytes(), &receipt); err != nil {
		t.Fatal(err)
	}
	if receipt.Version != "YNX-OFFLINE-PQ-SCHEDULED-COPY/v1" || receipt.Classification != "DATA" || receipt.SourceStopProven || receipt.ActivationAuthorized || receipt.PinOriginVerified || receipt.CopyDirectory != cfg.PQScheduledCopy || receipt.SourceStateHash != before.StateHash || receipt.OriginalGenesisHash != before.OriginalGenesisHash || receipt.SourceHeight != before.Height {
		t.Fatal("copy receipt misstated source or authority", receipt)
	}
	after, err := chain.ExportConsensusMigrationCheckpoint(cfg.PQScheduledCopy)
	if err != nil || after.StateHash != receipt.ScheduledStateHash {
		t.Fatal("prepared durable copy cannot be read back", err)
	}
	if err := chain.VerifyConsensusPQSchedulePreservation(before, after, receipt.AdmissionHeight); err != nil {
		t.Fatal(err)
	}
	assertConsensusExportFilesUnchanged(t, cfg.DataDir, original)
	var again bytes.Buffer
	if err := runNode(cfg, &again); !errors.Is(err, os.ErrExist) || again.Len() != 0 {
		t.Fatal("existing copy was overwritten or reported success", err)
	}
	assertConsensusExportFilesUnchanged(t, cfg.DataDir, original)
}

func TestOfflinePQScheduledCopyRejectsPinsAndAliasesBeforeTarget(t *testing.T) {
	cfg, _ := pqCopyFixture(t)
	original := captureConsensusExportFiles(t, cfg.DataDir)
	for _, mutate := range []func(*nodeRuntimeConfig){
		func(c *nodeRuntimeConfig) { c.PQSourceGenesis = strings.Repeat("0", 64) },
		func(c *nodeRuntimeConfig) { c.PQSourceState = strings.Repeat("f", 64) },
		func(c *nodeRuntimeConfig) { c.PQSourceHeight = "00" },
		func(c *nodeRuntimeConfig) { c.PQAdmissionHeight = c.PQSourceHeight },
		func(c *nodeRuntimeConfig) { c.PQScheduledCopy = filepath.Join(c.DataDir, "must-not-create") },
		func(c *nodeRuntimeConfig) { c.ExportConsensusState = "-" },
		func(c *nodeRuntimeConfig) { c.CheckConfig = true },
	} {
		bad := cfg
		mutate(&bad)
		if err := runNode(bad, io.Discard); err == nil || errors.Is(err, chain.ErrOfflinePQCopyUnknown) {
			t.Fatal("invalid input was accepted or reserved a target", err)
		}
		if _, err := os.Lstat(bad.PQScheduledCopy); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("invalid input created a target", err)
		}
		assertConsensusExportFilesUnchanged(t, cfg.DataDir, original)
	}
}

func TestOfflinePQScheduledCopyOutputFailureRetainsTarget(t *testing.T) {
	cfg, _ := pqCopyFixture(t)
	original := captureConsensusExportFiles(t, cfg.DataDir)
	if err := runNode(cfg, shortConsensusExportWriter{}); !errors.Is(err, chain.ErrOfflinePQCopyUnknown) || !errors.Is(err, io.ErrShortWrite) {
		t.Fatal("failed delivery did not retain UNKNOWN", err)
	}
	if _, err := chain.ExportConsensusMigrationCheckpoint(cfg.PQScheduledCopy); err != nil {
		t.Fatal("UNKNOWN target was removed", err)
	}
	if err := runNode(cfg, io.Discard); !errors.Is(err, os.ErrExist) {
		t.Fatal("UNKNOWN target was reused", err)
	}
	assertConsensusExportFilesUnchanged(t, cfg.DataDir, original)
}

func TestOfflinePQScheduledCopyRejectsSymlinksAndUnsafeParent(t *testing.T) {
	cfg, _ := pqCopyFixture(t)
	original := captureConsensusExportFiles(t, cfg.DataDir)
	parent := filepath.Dir(cfg.PQScheduledCopy)
	alias := filepath.Join(parent, "source-alias")
	if err := os.Symlink(cfg.DataDir, alias); err != nil {
		t.Fatal(err)
	}
	bad := cfg
	bad.DataDir = alias
	if err := runNode(bad, io.Discard); err == nil {
		t.Fatal("source symlink accepted")
	}
	if err := os.Chmod(parent, 0755); err != nil {
		t.Fatal(err)
	}
	if err := runNode(cfg, io.Discard); err == nil {
		t.Fatal("nonprivate target parent accepted")
	}
	if err := os.Chmod(parent, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(cfg.DataDir, cfg.PQScheduledCopy); err != nil {
		t.Fatal(err)
	}
	if err := runNode(cfg, io.Discard); !errors.Is(err, os.ErrExist) {
		t.Fatal("existing symlink target was followed or overwritten", err)
	}
	if got, err := os.Readlink(cfg.PQScheduledCopy); err != nil || got != cfg.DataDir {
		t.Fatal("existing target symlink changed", err)
	}
	assertConsensusExportFilesUnchanged(t, cfg.DataDir, original)
}

func TestOfflinePQScheduledCopyPreservesExistingSchedule(t *testing.T) {
	cfg, before := pqCopyFixture(t)
	d, err := chain.NewPersistentDevnet(before.Network, cfg.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	admission := before.Height + 10
	if err := d.EnableAccountPQ(admission); err != nil {
		t.Fatal(err)
	}
	before, err = chain.ExportConsensusMigrationCheckpoint(cfg.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	cfg.PQSourceState = before.StateHash
	original := captureConsensusExportFiles(t, cfg.DataDir)
	bad := cfg
	bad.PQAdmissionHeight = strconv.FormatUint(admission+1, 10)
	if err := runNode(bad, io.Discard); err == nil {
		t.Fatal("existing schedule was replaced")
	}
	if _, err := os.Lstat(cfg.PQScheduledCopy); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("different existing schedule reserved a copy", err)
	}
	var output bytes.Buffer
	if err := runNode(cfg, &output); err != nil {
		t.Fatal("unchanged existing schedule refused", err)
	}
	after, err := chain.ExportConsensusMigrationCheckpoint(cfg.PQScheduledCopy)
	if err != nil || after.StateHash != before.StateHash {
		t.Fatal("existing schedule changed in cold copy", err)
	}
	if err := chain.VerifyConsensusPQSchedulePreservation(before, after, admission); err != nil {
		t.Fatal(err)
	}
	assertConsensusExportFilesUnchanged(t, cfg.DataDir, original)
}

func TestOfflinePQScheduledCopyRejectsAlreadyActiveSchedule(t *testing.T) {
	cfg, before := pqCopyFixture(t)
	d, err := chain.NewPersistentDevnet(before.Network, cfg.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	admission := before.Height + 1
	if err := d.EnableAccountPQ(admission); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	active, err := chain.ExportConsensusMigrationCheckpoint(cfg.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	cfg.PQSourceHeight = strconv.FormatUint(active.Height, 10)
	cfg.PQSourceState = active.StateHash
	cfg.PQAdmissionHeight = strconv.FormatUint(admission, 10)
	original := captureConsensusExportFiles(t, cfg.DataDir)
	if err := runNode(cfg, io.Discard); err == nil {
		t.Fatal("already active policy was accepted by a future-schedule comparator")
	}
	if _, err := os.Lstat(cfg.PQScheduledCopy); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("already active policy reserved a target", err)
	}
	assertConsensusExportFilesUnchanged(t, cfg.DataDir, original)
}

func TestOfflinePQScheduledCopyNormalCLI(t *testing.T) {
	cfg, before := pqCopyFixture(t)
	original := captureConsensusExportFiles(t, cfg.DataDir)
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, executable, "-test.run=^TestOfflinePQScheduledCopyCLIHelper$", "--",
		"--data-dir", cfg.DataDir, "--prepare-pq-scheduled-copy", cfg.PQScheduledCopy,
		"--source-genesis-hash", cfg.PQSourceGenesis, "--source-state-hash", cfg.PQSourceState,
		"--source-height", cfg.PQSourceHeight, "--pq-admission-height", cfg.PQAdmissionHeight)
	cmd.Env = append(os.Environ(), "YNX_OFFLINE_PQ_COPY_TEST_HELPER=synthetic")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	raw, err := cmd.Output()
	if err != nil || stderr.Len() != 0 {
		t.Fatalf("normal offline CLI failed: %v %s", err, stderr.String())
	}
	var result chain.OfflinePQCopyResult
	if err := json.Unmarshal(raw, &result); err != nil || result.Classification != "DATA" || result.SourceStopProven || result.ActivationAuthorized || result.PinOriginVerified {
		t.Fatal("normal CLI did not report its authority limits", err, string(raw))
	}
	after, err := chain.ExportConsensusMigrationCheckpoint(cfg.PQScheduledCopy)
	if err != nil || chain.VerifyConsensusPQSchedulePreservation(before, after, result.AdmissionHeight) != nil {
		t.Fatal("normal CLI durable copy did not preserve source", err)
	}
	assertConsensusExportFilesUnchanged(t, cfg.DataDir, original)
}

func TestOfflinePQScheduledCopyEmptyCLIRefusesStartup(t *testing.T) {
	parent := t.TempDir()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, executable, "-test.run=^TestOfflinePQScheduledCopyCLIHelper$", "--", "--data-dir", filepath.Join(parent, "absent"), "--prepare-pq-scheduled-copy", "")
	cmd.Env = append(os.Environ(), "YNX_OFFLINE_PQ_COPY_TEST_HELPER=synthetic")
	raw, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(raw), "a new target directory is required") {
		t.Fatal("empty copy flag did not fail before normal node startup", err, string(raw))
	}
	entries, err := os.ReadDir(parent)
	if err != nil || len(entries) != 0 {
		t.Fatal("empty copy flag changed source directory or started a node", err)
	}
}

func TestOfflinePQScheduledCopyCLIHelper(t *testing.T) {
	if os.Getenv("YNX_OFFLINE_PQ_COPY_TEST_HELPER") != "synthetic" {
		return
	}
	args := append([]string(nil), flag.Args()...)
	if (len(args) != 12 && len(args) != 4) || args[0] != "--data-dir" {
		t.Fatal("exact synthetic offline CLI arguments required")
	}
	flag.CommandLine = flag.NewFlagSet("ynx-chaind", flag.ExitOnError)
	os.Args = append([]string{"ynx-chaind"}, args...)
	main()
	os.Exit(0)
}
