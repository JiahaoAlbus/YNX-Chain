package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

const importStorageChildEnv = "YNX_TEST_MIGRATION_IMPORT_STORAGE_CHILD"

// This entry is only in the compiled test binary. Both child processes execute
// the real command parser/callee; neither builds another binary or starts a
// node. The input is the original synthetic native export, not public-chain DATA.
func TestMigrationImportStorageCommandProcess(t *testing.T) {
	if os.Getenv(importStorageChildEnv) != "1" {
		return
	}
	var args []string
	if err := json.Unmarshal([]byte(os.Getenv("YNX_TEST_MIGRATION_IMPORT_STORAGE_ARGS")), &args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(23)
	}
	var output io.Writer = os.Stdout
	if os.Getenv("YNX_TEST_MIGRATION_IMPORT_STORAGE_STDOUT_FAIL") == "1" {
		output = importStorageFailedStdout{}
	}
	if err := runCommand(args, output, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(23)
	}
	os.Exit(0)
}

type importStorageFailedStdout struct{}

func (importStorageFailedStdout) Write([]byte) (int, error) {
	return 0, errors.New("synthetic original stdout unavailable")
}

func importStoragePrivateParent(t *testing.T) string {
	t.Helper()
	// testing's canonical temporary parent may be 0755. Create only our new
	// exclusive child; never chmod that parent or relax the production guard.
	parent := filepath.Join(canonicalPackageTempDir(t), "private-import-parent")
	if err := os.Mkdir(parent, 0700); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(parent)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode() != os.ModeDir|0700 {
		t.Fatalf("synthetic storage parent is not an actual private 0700 directory: %v", info.Mode())
	}
	return parent
}

func importStorageArgs(source, directory, phase, pin string) []string {
	args := []string{"-verify-migration-import-storage", source, "-import-storage-directory", directory, "-import-storage-phase", phase}
	if pin != "" {
		args = append(args, "-import-storage-sha256", pin)
	}
	return args
}

func importStorageProcess(t *testing.T, args []string, failedStdout bool) ([]byte, []byte, int, error) {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, executable, "-test.run=^TestMigrationImportStorageCommandProcess$")
	for _, value := range os.Environ() {
		if !strings.HasPrefix(value, "YNX_TEST_MIGRATION_IMPORT_STORAGE_") {
			command.Env = append(command.Env, value)
		}
	}
	command.Env = append(command.Env, importStorageChildEnv+"=1", "YNX_TEST_MIGRATION_IMPORT_STORAGE_ARGS="+string(raw))
	if failedStdout {
		command.Env = append(command.Env, "YNX_TEST_MIGRATION_IMPORT_STORAGE_STDOUT_FAIL=1")
	}
	var output, diagnostic bytes.Buffer
	command.Stdout, command.Stderr = &output, &diagnostic
	err = command.Run()
	if ctx.Err() != nil {
		t.Fatalf("original command child exceeded its finite test budget: %v", ctx.Err())
	}
	pid := -1
	if command.ProcessState != nil {
		pid = command.ProcessState.Pid()
	}
	return output.Bytes(), diagnostic.Bytes(), pid, err
}

func importStorageDigest(raw []byte) string {
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func importStorageReceiptFrom(t *testing.T, raw, original, checkpoint []byte, phase string, migration chain.ConsensusMigrationState) importStorageReceipt {
	t.Helper()
	var result importStorageReceipt
	if len(raw) == 0 || len(raw) > 64<<10 || json.Unmarshal(raw, &result) != nil {
		t.Fatalf("missing bounded normal receipt: %q", raw)
	}
	canonical, err := json.Marshal(result)
	if err != nil || !bytes.Equal(raw, append(canonical, '\n')) {
		t.Fatal("normal import-storage output differs from its single canonical receipt")
	}
	if result.Version != "YNX-MIGRATION-IMPORTED-STORAGE/v1" || result.Classification != "data" || result.Scope != "uninitialized-import-checkpoint" || result.Phase != phase || result.SourceSHA256 != importStorageDigest(original) || result.SourceBytes != strconv.Itoa(len(original)) || result.CheckpointSHA256 != importStorageDigest(checkpoint) || result.CheckpointBytes != strconv.Itoa(len(checkpoint)) || result.RestoredImportedState != (phase == "reopen") || result.ConsensusColdRestore != "unchecked" {
		t.Fatalf("import-storage receipt invented qualification or changed original identity: %+v", result)
	}
	p := result.Preservation
	if p.SourceSHA256 != result.SourceSHA256 || p.SourceBytes != result.SourceBytes {
		t.Fatal("nested preservation receipt changed the complete original source pin")
	}
	var transactions uint64
	for _, block := range migration.Runtime.Blocks {
		transactions += uint64(len(block.Transactions))
	}
	if p.Version != migrationPreservationVersion || p.Classification != "data" || p.ApplicationImport != "verified" || p.InfoInitialized || p.Height != strconv.FormatUint(migration.Height, 10) || p.StateHash != migration.StateHash || p.LastBlockHash != migration.LastBlockHash || p.AccountsChecked != strconv.Itoa(len(migration.Accounts)) || p.ContractsChecked != strconv.Itoa(len(migration.Runtime.Contracts)) || p.HistoryBlocksChecked != strconv.Itoa(len(migration.Runtime.Blocks)) || p.HistoryTxsChecked != strconv.FormatUint(transactions, 10) || !p.AccountPolicyChecked || !reflect.DeepEqual(p.Blockers, consensus.MigrationExecutionBlockers(migration)) || p.ExecutionCapabilities != "unresolved" || p.ValidatorBinding != "unchecked" || p.InitChain != "not-performed" || p.PQActivation != "not-performed" || p.Deployment != "not-performed" {
		t.Fatalf("complete original preservation checks or unresolved boundaries disappeared: %+v", p)
	}
	return result
}

type importStorageOriginal struct {
	info os.FileInfo
	raw  []byte
}

// Preserve every actual file, including lock sidecars, partials and UNKNOWN.
// Access time is deliberately excluded; inode/mode/size/mtime/bytes are not.
func importStorageOriginals(t *testing.T, directory string) map[string]importStorageOriginal {
	t.Helper()
	result := make(map[string]importStorageOriginal)
	err := filepath.WalkDir(directory, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		var raw []byte
		if info.Mode().IsRegular() {
			raw, err = os.ReadFile(path)
		} else if info.Mode()&os.ModeSymlink != 0 {
			var target string
			target, err = os.Readlink(path)
			raw = []byte(target)
		}
		result[path] = importStorageOriginal{info, raw}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func assertImportStorageOriginals(t *testing.T, directory string, before map[string]importStorageOriginal) {
	t.Helper()
	after := importStorageOriginals(t, directory)
	if len(before) != len(after) {
		t.Fatal("verification created, erased or repaired an import artifact")
	}
	for path, original := range before {
		actual, ok := after[path]
		if !ok || !os.SameFile(original.info, actual.info) || original.info.Size() != actual.info.Size() || original.info.Mode() != actual.info.Mode() || !original.info.ModTime().Equal(actual.info.ModTime()) || !bytes.Equal(original.raw, actual.raw) {
			t.Fatalf("verification changed retained original %s", filepath.Base(path))
		}
	}
}

func TestMigrationImportStorageNormalCommandSeparateCreateAndReopenProcesses(t *testing.T) {
	source, original, migration := migrationPreservationFixture(t)
	before, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(importStoragePrivateParent(t), "exclusive-import")
	created, diagnostic, firstPID, err := importStorageProcess(t, importStorageArgs(source, directory, "create", ""), false)
	if err != nil || len(diagnostic) != 0 {
		t.Fatalf("synthetic normal create failed: %v %s", err, diagnostic)
	}
	checkpointPath := filepath.Join(directory, "state.blocks")
	checkpoint, err := os.ReadFile(checkpointPath)
	if err != nil {
		t.Fatal(err)
	}
	receipt := importStorageReceiptFrom(t, created, original, checkpoint, "create", migration)
	retained := importStorageOriginals(t, directory)
	if len(retained) != 5 {
		t.Fatal("checkpoint directory is not the exact journal plus three sidecars")
	}
	reopened, diagnostic, secondPID, err := importStorageProcess(t, importStorageArgs(source, directory, "reopen", receipt.CheckpointSHA256), false)
	if err != nil || len(diagnostic) != 0 || firstPID == secondPID {
		t.Fatalf("independent cold command failed: %v %s", err, diagnostic)
	}
	importStorageReceiptFrom(t, reopened, original, checkpoint, "reopen", migration)
	decoded, err := consensus.DecodeBlockJournal(context.Background(), checkpoint, migration)
	if err != nil || decoded.IncompleteTail || decoded.CompleteBytes != len(checkpoint) || decoded.ReplayedBlocks != 0 || decoded.ReplayedTransactionInputs != 0 || decoded.State.Initialized || decoded.State.Height != int64(migration.Height) || !reflect.DeepEqual(decoded.State.Accounts, migration.Accounts) || !reflect.DeepEqual(decoded.State.AccountPolicy, migration.AccountPolicy) || decoded.State.LegacyContracts == nil || decoded.State.LegacyContracts.SourceAnchor != migration.StateHash || !reflect.DeepEqual(decoded.State.LegacyContracts.Contracts, migration.Runtime.Contracts) {
		t.Fatalf("import checkpoint lost real balances/nonces/policy/contract storage or initialized consensus: %v", err)
	}
	// The same normal cold constructor/query checker reads every original block,
	// contract field and account. No InitChain, FinalizeBlock or Commit is called.
	cold, err := consensus.NewBlockJournaledApplication(migration, checkpointPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := checkMigrationPreservationApplication(migration, cold); err != nil {
		t.Fatal("cold normal queries changed complete original history", err)
	}
	assertImportStorageOriginals(t, directory, retained)
	assertMigrationFileUnchanged(t, source, original, before)
	t.Log("MIGRATION_IMPORTED_STORAGE_CREATE_REOPEN_DATA_ONLY synthetic=true separateProcesses=true initChain=false consensusColdRestore=unchecked")
}

func TestMigrationImportStorageReaderKeepsWholePinAndHeldOriginal(t *testing.T) {
	source, original, migration := migrationPreservationFixture(t)
	sourceBefore, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(importStoragePrivateParent(t), "reader-import")
	var output, diagnostic bytes.Buffer
	if err := runCommand(importStorageArgs(source, directory, "create", ""), &output, &diagnostic); err != nil {
		t.Fatal(err)
	}
	retained := importStorageOriginals(t, directory)
	checkpointPath := filepath.Join(directory, importStorageStateName)
	checkpoint := retained[checkpointPath].raw
	expectedPin := importStorageDigest(checkpoint)
	d, err := openImportStorageDirectory(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer d.file.Close()
	files, err := openImportStorageFiles(d)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		for _, f := range files {
			_ = f.file.Close()
		}
	}()
	f := files[0]
	if _, err := f.file.Seek(7, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	actualPin, err := readImportStorageCheckpoint(f, migration, expectedPin)
	if err != nil || actualPin != expectedPin {
		t.Fatalf("original complete checkpoint did not retain its independent whole pin: %v", err)
	}
	position, err := f.file.Seek(0, io.SeekCurrent)
	if err != nil || position != int64(len(checkpoint)) {
		t.Fatalf("ReaderAt replay changed the whole-hash reader offset: %d, %v", position, err)
	}
	if actualPin, err := readImportStorageCheckpoint(f, migration, strings.Repeat("0", 64)); err == nil || !strings.Contains(err.Error(), "independent SHA256") || actualPin != "" {
		t.Fatalf("independent pin failure lost its first cause or returned a checkpoint pin: %v", err)
	}
	assertImportStorageOriginals(t, directory, retained)
	// Equal bytes at a replacement path cannot substitute for the original FD,
	// even when they also have the independently accepted complete digest.
	replacement := filepath.Join(filepath.Dir(directory), "replacement-checkpoint")
	if err := os.WriteFile(replacement, checkpoint, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(replacement, checkpointPath); err != nil {
		t.Fatal(err)
	}
	replaced := importStorageOriginals(t, directory)
	if actualPin, err := readImportStorageCheckpoint(f, migration, expectedPin); err == nil || !strings.Contains(err.Error(), "identity changed") || actualPin != "" {
		t.Fatalf("same-byte replacement bypassed the held original identity: %v", err)
	}
	assertImportStorageOriginals(t, directory, replaced)
	assertMigrationFileUnchanged(t, source, original, sourceBefore)
}

func TestMigrationImportStorageStdoutFailurePreservesUnknown(t *testing.T) {
	source, original, migration := migrationPreservationFixture(t)
	before, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(importStoragePrivateParent(t), "stdout-unknown")
	output, diagnostic, _, err := importStorageProcess(t, importStorageArgs(source, directory, "create", ""), true)
	if err == nil || len(output) != 0 || !bytes.Contains(diagnostic, []byte("synthetic original stdout unavailable")) {
		t.Fatalf("actual stdout failure became success: %v %s", err, diagnostic)
	}
	retained := importStorageOriginals(t, directory)
	checkpoint, err := os.ReadFile(filepath.Join(directory, "state.blocks"))
	if err != nil {
		t.Fatal("failed public receipt erased its original checkpoint", err)
	}
	var retry, retryDiagnostic bytes.Buffer
	if err := runCommand(importStorageArgs(source, directory, "create", ""), &retry, &retryDiagnostic); err == nil || retry.Len() != 0 {
		t.Fatal("a second create replayed an UNKNOWN outcome", err)
	}
	assertImportStorageOriginals(t, directory, retained)
	output, diagnostic, _, err = importStorageProcess(t, importStorageArgs(source, directory, "reopen", importStorageDigest(checkpoint)), false)
	if err != nil || len(diagnostic) != 0 {
		t.Fatalf("read-only original recovery failed: %v %s", err, diagnostic)
	}
	importStorageReceiptFrom(t, output, original, checkpoint, "reopen", migration)
	assertImportStorageOriginals(t, directory, retained)
	assertMigrationFileUnchanged(t, source, original, before)
}

func TestMigrationImportStorageRejectsOriginalAndCheckpointChanges(t *testing.T) {
	source, original, _ := migrationPreservationFixture(t)
	before, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	otherSource, otherOriginal, _ := migrationSummaryFixture(t)
	otherBefore, err := os.Stat(otherSource)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"wrong-original", "wrong-pin", "tampered-repinned", "torn-tail-repinned", "missing-sidecar", "symlink-directory", "nonprivate-directory", "symlink-checkpoint", "hardlink-checkpoint"} {
		t.Run(kind, func(t *testing.T) {
			directory := filepath.Join(importStoragePrivateParent(t), "retained")
			var output, diagnostic bytes.Buffer
			if err := runCommand(importStorageArgs(source, directory, "create", ""), &output, &diagnostic); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(directory, "state.blocks")
			checkpoint, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			pin, requestedSource, requestedDirectory := importStorageDigest(checkpoint), source, directory
			switch kind {
			case "wrong-original":
				requestedSource = otherSource
			case "wrong-pin":
				pin = strings.Repeat("f", 64)
			case "tampered-repinned":
				checkpoint[len(checkpoint)/2] ^= 1
				if err := os.WriteFile(path, checkpoint, 0600); err != nil {
					t.Fatal(err)
				}
				pin = importStorageDigest(checkpoint)
			case "torn-tail-repinned":
				checkpoint = append(checkpoint, 1)
				if err := os.WriteFile(path, checkpoint, 0600); err != nil {
					t.Fatal(err)
				}
				pin = importStorageDigest(checkpoint)
			case "missing-sidecar":
				if err := os.Rename(path+".read.lock", filepath.Join(filepath.Dir(directory), "retained-sidecar")); err != nil {
					t.Fatal(err)
				}
			case "symlink-directory":
				requestedDirectory = filepath.Join(filepath.Dir(directory), "alias")
				if err := os.Symlink(directory, requestedDirectory); err != nil {
					t.Fatal(err)
				}
			case "nonprivate-directory":
				if err := os.Chmod(directory, 0755); err != nil {
					t.Fatal(err)
				}
			case "symlink-checkpoint":
				target := filepath.Join(filepath.Dir(directory), "retained-checkpoint")
				if err := os.Rename(path, target); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, path); err != nil {
					t.Fatal(err)
				}
			case "hardlink-checkpoint":
				if err := os.Link(path, filepath.Join(filepath.Dir(directory), "retained-hardlink")); err != nil {
					t.Fatal(err)
				}
			}
			retained := importStorageOriginals(t, filepath.Dir(directory))
			output.Reset()
			diagnostic.Reset()
			if err := runCommand(importStorageArgs(requestedSource, requestedDirectory, "reopen", pin), &output, &diagnostic); err == nil || output.Len() != 0 {
				t.Fatalf("%s produced a restore receipt: %v", kind, err)
			}
			assertImportStorageOriginals(t, filepath.Dir(directory), retained)
		})
	}
	assertMigrationFileUnchanged(t, source, original, before)
	assertMigrationFileUnchanged(t, otherSource, otherOriginal, otherBefore)
}

func TestMigrationImportStorageRejectsArgumentsBeforeReadOrCreate(t *testing.T) {
	parent := importStoragePrivateParent(t)
	source, directory := filepath.Join(parent, "must-not-open.json"), filepath.Join(parent, "must-not-create")
	base := importStorageArgs(source, directory, "create", "")
	cases := [][]string{
		{"-verify-migration-import-storage", source},
		{"-verify-migration-import-storage", "", "-import-storage-directory", directory, "-import-storage-phase", "create"},
		{"-import-storage-directory", directory},
		{"-import-storage-phase", "create"},
		{"-import-storage-sha256", strings.Repeat("a", 64)},
		importStorageArgs(source, directory, "reopen", ""),
		append(importStorageArgs(source, directory, "reopen", ""), "-import-storage-sha256", ""),
		append(append([]string(nil), base...), "-import-storage-sha256", ""),
		append(append([]string(nil), base...), "-import-storage-sha256", strings.Repeat("a", 64)),
		importStorageArgs(source, directory, "CREATE", ""),
		importStorageArgs(source, directory, "", ""),
		append(append([]string(nil), base...), "positional"),
	}
	for _, pin := range []string{strings.Repeat("0", 64), strings.Repeat("A", 64), strings.Repeat("a", 63), strings.Repeat("a", 65)} {
		cases = append(cases, importStorageArgs(source, directory, "reopen", pin))
	}
	cases = append(cases, append(importStorageArgs(source, directory, "reopen", strings.Repeat("a", 64)), "-import-storage-sha256", strings.Repeat("b", 64)))
	for _, flag := range []string{"-verify-migration-import-storage", "-import-storage-directory", "-import-storage-phase"} {
		cases = append(cases, append(append([]string(nil), base...), flag, "duplicate"))
	}
	for _, flag := range []string{"-verify-migration-state", "-verify-migration-execution", "-verify-migration-preservation", "-verify-package", "-migration-state", "-output", "-operator-plan", "-operator-plan-hash", "-migration-public-summary"} {
		cases = append(cases, append(append([]string(nil), base...), flag, "foreign"))
	}
	for _, args := range cases {
		var output, diagnostic bytes.Buffer
		err := runCommand(args, &output, &diagnostic)
		if err == nil || output.Len() != 0 || strings.Contains(err.Error(), "no such file") {
			t.Fatalf("invalid flags reached source I/O or success: %q %v", args, err)
		}
	}
	entries, err := os.ReadDir(parent)
	if err != nil || len(entries) != 0 {
		t.Fatalf("rejected CLI reserved an output or invented input: %v %v", entries, err)
	}
}
