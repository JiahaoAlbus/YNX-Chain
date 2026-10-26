package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// Reuse the real synthetic source fixture, including executed compiled
// contracts and multiple complete blocks. Restore only a detached in-memory
// source, then call the normal operator rollout API. No node is started.
func migrationScheduleFixture(t *testing.T) (string, []byte, chain.ConsensusMigrationState, string, []byte, chain.ConsensusMigrationState, uint64) {
	t.Helper()
	beforePath, beforeRaw, before := migrationPreservationFixture(t)
	d, err := before.RestoreSourceRuntime()
	if err != nil {
		t.Fatal(err)
	}
	height := before.Height + 100
	if err := d.EnableAccountPQ(height); err != nil {
		t.Fatal(err)
	}
	after, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	afterPath, afterRaw := writeMigrationFixture(t, after)
	return beforePath, beforeRaw, before, afterPath, afterRaw, after, height
}

func migrationScheduleArgs(before, after string, height uint64) []string {
	return []string{"-verify-migration-schedule-preservation", before, "-scheduled-migration-state", after, "-pq-admission-height", strconv.FormatUint(height, 10)}
}

func TestMigrationSchedulePreservationNormalCommandAndReopen(t *testing.T) {
	beforePath, beforeRaw, before, afterPath, afterRaw, after, height := migrationScheduleFixture(t)
	originalInfo, err := os.Stat(beforePath)
	if err != nil {
		t.Fatal(err)
	}
	scheduledInfo, err := os.Stat(afterPath)
	if err != nil {
		t.Fatal(err)
	}
	var output, diagnostics bytes.Buffer
	if err := runCommand(migrationScheduleArgs(beforePath, afterPath, height), &output, &diagnostics); err != nil {
		t.Fatal(err)
	}
	var result migrationSchedulePreservationResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	beforeSHA, afterSHA := sha256.Sum256(beforeRaw), sha256.Sum256(afterRaw)
	if diagnostics.Len() != 0 || output.Len() > 4096 || result.Version != migrationSchedulePreservationVersion || result.Classification != "data" || result.Scope != "isolated-pq-schedule-comparison" || result.BeforeSHA256 != hex.EncodeToString(beforeSHA[:]) || result.BeforeBytes != strconv.Itoa(len(beforeRaw)) || result.AfterSHA256 != hex.EncodeToString(afterSHA[:]) || result.AfterBytes != strconv.Itoa(len(afterRaw)) || result.Height != strconv.FormatUint(before.Height, 10) || result.LastBlockHash != before.LastBlockHash || result.OriginalGenesisHash != before.OriginalGenesisHash || result.EnableAt != strconv.FormatUint(height, 10) || result.BeforeStateHash != before.StateHash || result.AfterStateHash != after.StateHash || result.Preservation != "verified" {
		t.Fatalf("normal schedule comparison receipt differs: %+v diagnostics=%q", result, diagnostics.String())
	}
	if result.ValidatorBinding != "unchecked" || result.Deployment != "not-performed" || result.PQActivation != "not-performed" {
		t.Fatal("source comparison invented runtime or authority qualification")
	}
	var shape map[string]json.RawMessage
	if json.Unmarshal(output.Bytes(), &shape) != nil || len(shape) != 17 {
		t.Fatal("schedule comparison receipt changed its closed public shape")
	}
	canonical, err := json.Marshal(result)
	if err != nil || !bytes.Equal(output.Bytes(), append(canonical, '\n')) {
		t.Fatal("normal schedule comparison is not one canonical receipt")
	}
	// A genuine source reload and equal-schedule call must preserve the same
	// typed ledger too. This does not claim the in-memory fixture is durable.
	reopened, err := after.RestoreSourceRuntime()
	if err != nil {
		t.Fatal(err)
	}
	if err := reopened.EnableAccountPQ(height); err != nil {
		t.Fatal(err)
	}
	reexported, err := reopened.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	reopenedPath, reopenedRaw := writeMigrationFixture(t, reexported)
	reopenedInfo, err := os.Stat(reopenedPath)
	if err != nil {
		t.Fatal(err)
	}
	output.Reset()
	if err := runCommand(migrationScheduleArgs(afterPath, reopenedPath, height), &output, &diagnostics); err != nil || diagnostics.Len() != 0 {
		t.Fatalf("same original schedule did not survive detached restore: %v", err)
	}
	assertMigrationFileUnchanged(t, reopenedPath, reopenedRaw, reopenedInfo)
	assertMigrationFileUnchanged(t, beforePath, beforeRaw, originalInfo)
	assertMigrationFileUnchanged(t, afterPath, afterRaw, scheduledInfo)
}

func TestMigrationSchedulePreservationRejectsArgumentsBeforeRead(t *testing.T) {
	missing := filepath.Join(canonicalPackageTempDir(t), "must-not-open")
	base := migrationScheduleArgs(missing, missing, 100)
	var cases [][]string
	for _, bad := range []string{"", "0", "00", "01", "+100", " 100", "100 ", "-1", "18446744073709551616"} {
		args := append([]string(nil), base...)
		args[len(args)-1] = bad
		cases = append(cases, args)
	}
	cases = append(cases,
		[]string{"-verify-migration-schedule-preservation", missing},
		[]string{"-verify-migration-schedule-preservation", "", "-scheduled-migration-state", missing, "-pq-admission-height", "100"},
		[]string{"-verify-migration-schedule-preservation", missing, "-scheduled-migration-state", "", "-pq-admission-height", "100"},
		[]string{"-scheduled-migration-state", missing}, []string{"-pq-admission-height", "100"},
	)
	for _, flag := range []string{"verify-package", "verify-migration-state", "verify-migration-execution", "verify-migration-preservation", "verify-migration-import-storage", "migration-state", "validator-manifest", "genesis-time", "output", "operator-plan", "operator-plan-hash", "migration-public-summary", "import-storage-directory", "import-storage-phase", "import-storage-sha256", "prepare-pq-initial-genesis"} {
		cases = append(cases, append(append([]string(nil), base...), "-"+flag, missing))
	}
	for _, flag := range []string{"verify-migration-schedule-preservation", "scheduled-migration-state", "pq-admission-height"} {
		for _, repeat := range []string{"-" + flag, "--" + flag, "-" + flag + "=100", "--" + flag + "=100"} {
			args := append(append([]string(nil), base...), repeat)
			if !strings.Contains(repeat, "=") {
				args = append(args, "100")
			}
			cases = append(cases, args)
		}
	}
	for _, args := range cases {
		var output, diagnostics bytes.Buffer
		if err := runCommand(args, &output, &diagnostics); err == nil || errors.Is(err, os.ErrNotExist) || strings.Contains(err.Error(), "requires an existing original path") || output.Len() != 0 {
			t.Fatalf("invalid schedule comparison arguments reached input I/O: %q %v", args, err)
		}
	}
	if _, err := os.Lstat(missing); !os.IsNotExist(err) {
		t.Fatal("rejected arguments created an input", err)
	}
}

type migrationScheduleFailedOutput struct{ cause error }

func (w migrationScheduleFailedOutput) Write([]byte) (int, error) { return 0, w.cause }

func TestMigrationSchedulePreservationRejectsWrongHeightAndFailedOutputKeepsOriginals(t *testing.T) {
	beforePath, beforeRaw, before, afterPath, afterRaw, _, height := migrationScheduleFixture(t)
	beforeInfo, err := os.Stat(beforePath)
	if err != nil {
		t.Fatal(err)
	}
	afterInfo, err := os.Stat(afterPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, wrong := range []uint64{before.Height, height + 1} {
		var output, diagnostics bytes.Buffer
		if err := runCommand(migrationScheduleArgs(beforePath, afterPath, wrong), &output, &diagnostics); err == nil || output.Len() != 0 {
			t.Fatal("comparison accepted a different operator height", err)
		}
	}
	cause := errors.New("synthetic original stdout unavailable")
	if err := runCommand(migrationScheduleArgs(beforePath, afterPath, height), migrationScheduleFailedOutput{cause}, io.Discard); !errors.Is(err, cause) {
		t.Fatal("output failure lost the first cause", err)
	}
	assertMigrationFileUnchanged(t, beforePath, beforeRaw, beforeInfo)
	assertMigrationFileUnchanged(t, afterPath, afterRaw, afterInfo)
}

func TestMigrationSchedulePreservationRejectsIncompleteInputsWithoutRepair(t *testing.T) {
	beforePath, beforeRaw, _, afterPath, afterRaw, _, height := migrationScheduleFixture(t)
	for _, side := range []string{"before", "after"} {
		for name, change := range map[string]func([]byte) []byte{
			"unknown-field": func(raw []byte) []byte { return append([]byte(`{"foreign":true,`), raw[1:]...) },
			"trailing":      func(raw []byte) []byte { return append(bytes.Clone(raw), []byte("{}")...) },
			"truncated":     func(raw []byte) []byte { return bytes.Clone(raw[:len(raw)/2]) },
		} {
			t.Run(side+"/"+name, func(t *testing.T) {
				path, raw := beforePath, beforeRaw
				if side == "after" {
					path, raw = afterPath, afterRaw
				}
				payload := change(raw)
				if err := os.WriteFile(path, payload, 0600); err != nil {
					t.Fatal(err)
				}
				info, err := os.Stat(path)
				if err != nil {
					t.Fatal(err)
				}
				var output, diagnostics bytes.Buffer
				if err := runCommand(migrationScheduleArgs(beforePath, afterPath, height), &output, &diagnostics); err == nil || output.Len() != 0 {
					t.Fatal("incomplete original emitted a preservation result", err)
				}
				assertMigrationFileUnchanged(t, path, payload, info)
				// Reset only this test's synthetic input for the next case; the
				// command itself must never repair or replace a failed input.
				if err := os.WriteFile(path, raw, 0600); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
	// An independently parsed migration remains identical after the pair check.
	first, err := verifyMigrationState(beforePath)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := runCommand(migrationScheduleArgs(beforePath, afterPath, height), &output, io.Discard); err != nil {
		t.Fatal(err)
	}
	last, err := verifyMigrationState(beforePath)
	if err != nil || !reflect.DeepEqual(first, last) {
		t.Fatal("normal comparison changed the original typed source", err)
	}
}
