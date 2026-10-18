package chain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// These are actual persistent ledgers, real compiled execution and dual-PQ
// signatures. The exporter never manufactures a replacement genesis or a
// privileged fixture state. No external node, account or key is used.
func TestOfflineConsensusExportPreservesCompiledRuntimeAndPQHistory(t *testing.T) {
	f := newPQContractVerifyLedger(t)
	root, ok := repoRoot()
	if !ok {
		t.Fatal("fixed source repository is required")
	}
	name := "SampleEVMWriteCounter"
	source, err := os.ReadFile(filepath.Join(root, consensusContractSources[name]))
	pqMust(t, err)
	artifact, _, err := f.d.DeployContractWithArgs(f.owner, name, strings.TrimSpace(string(source)), []string{"7"})
	pqMust(t, err)
	if artifact.CompilerArtifact == nil || artifact.ArtifactKind != contractPinnedArtifactKind {
		t.Fatal("fixture requires actual pinned compiler material")
	}
	result, _, err := f.d.ExecuteContract(f.owner, artifact.Address, "0x7cf5dab0"+fmt.Sprintf("%064x", 5))
	pqMust(t, err)
	if result.OpcodeStepCount <= 0 || len(result.StorageWrites) == 0 {
		t.Fatal("fixture did not execute real compiled storage writes")
	}
	account, _ := f.d.Account(f.owner)
	_, height := f.d.AccountAuthorization(f.owner)
	_, _, err = f.d.SubmitAccountMigration(f.migration(t, height+1, account.Nonce+1))
	pqMust(t, err)
	f.d.ProduceBlock()
	account, _ = f.d.Account(f.owner)
	_, _, err = f.d.SubmitPQTransfer(f.member(t, account.Nonce+1, 3))
	pqMust(t, err)
	account, _ = f.d.Account(f.owner)
	_, height = f.d.AccountAuthorization(f.owner)
	_, _, err = f.d.SubmitAccountRevocation(pqRevocationWire(t, f, account.Nonce+1, height, 1))
	pqMust(t, err)
	f.d.ProduceBlock()
	policy, height := f.d.AccountAuthorization(f.owner)
	if _, err := policy.TrustedRegistration(f.owner, ynxauth.TransactionPurpose, height); err == nil {
		t.Fatal("fixture must include effective terminal history")
	}
	written, ok := f.d.Contract(artifact.Address)
	if !ok || reflect.DeepEqual(written.RuntimeStorage, artifact.RuntimeStorage) {
		t.Fatal("fixture lost executed contract state")
	}
	expected, err := f.d.ExportConsensusMigrationState()
	pqMust(t, err)
	expectedJSON, err := expected.CanonicalJSON()
	pqMust(t, err)
	before := captureOfflineConsensusSource(t, f.d.dataDir)
	var checkpoint devnetSnapshot
	pqMust(t, json.Unmarshal(before.files["devnet-state.json"].data, &checkpoint))
	checkpointContract, ok := checkpoint.Contracts[artifact.Address]
	if !ok || checkpoint.AccountPolicy == nil || len(checkpoint.AccountPolicy.Revocations) == 0 {
		t.Fatal("original checkpoint lacks complete executed contract or terminal policy history")
	}
	// Compare the full durable representation. Compiler ABI builders retain
	// empty non-nil Inputs (for example count()); their omitempty JSON fields
	// decode as nil. No contract field is removed from either serialized value.
	liveContractJSON, err := json.Marshal(written)
	pqMust(t, err)
	checkpointContractJSON, err := json.Marshal(checkpointContract)
	pqMust(t, err)
	if !bytes.Equal(liveContractJSON, checkpointContractJSON) {
		t.Fatal("original checkpoint changed complete live contract artifact")
	}
	for i := 0; i < 2; i++ {
		actual, err := ExportConsensusMigrationCheckpoint(f.d.dataDir)
		pqMust(t, err)
		wire, err := actual.CanonicalJSON()
		pqMust(t, err)
		if !bytes.Equal(wire, expectedJSON) {
			t.Fatal("offline export changed canonical V2 identity, accounts, nonce, runtime or history")
		}
		if !reflect.DeepEqual(actual.Runtime.Contracts, checkpoint.Contracts) {
			t.Fatal("offline export changed complete checkpoint contract inventory or artifact")
		}
		// AccountAuthorization is an owner projection; the source checkpoint
		// contains the complete global history that both export fields must keep.
		if !reflect.DeepEqual(actual.AccountPolicy, checkpoint.AccountPolicy) || !reflect.DeepEqual(actual.Runtime.AccountPolicy, checkpoint.AccountPolicy) {
			t.Fatal("offline export changed complete global terminal policy history")
		}
		restored, err := actual.RestoreSourceRuntime()
		pqMust(t, err)
		roundTrip, err := restored.ExportConsensusMigrationState()
		pqMust(t, err)
		roundTripJSON, err := roundTrip.CanonicalJSON()
		pqMust(t, err)
		if !bytes.Equal(wire, roundTripJSON) {
			t.Fatal("V2 restore lost original source semantics")
		}
		pqContractVerifyReadback(t, restored, written, f.owner, f.to)
		before.assertUnchanged(t)
	}
}

func TestOfflineConsensusExportRequiresExistingQuiescentCheckpoint(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "absent", "source")
	if _, err := ExportConsensusMigrationCheckpoint(missing); err == nil {
		t.Fatal("missing source manufactured a chain")
	}
	if _, err := os.Stat(filepath.Dir(missing)); !os.IsNotExist(err) {
		t.Fatalf("missing source created directories: %v", err)
	}
	if _, err := ExportConsensusMigrationCheckpoint(""); err == nil {
		t.Fatal("empty data directory selected an implicit source")
	}
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
	pqMust(t, err)
	d.ProduceBlock()
	_, err = d.Faucet("ynx_offline_pending", 23)
	pqMust(t, err)
	before := captureOfflineConsensusSource(t, d.dataDir)
	if _, err := ExportConsensusMigrationCheckpoint(d.dataDir); err == nil || !strings.Contains(err.Error(), "pending") {
		t.Fatalf("pending effects were exported as committed state: %v", err)
	}
	before.assertUnchanged(t)
}

func TestOfflineConsensusExportRejectsInvalidSourceWithoutRepair(t *testing.T) {
	for _, name := range []string{"missing-marker", "wrong-marker", "snapshot-temp", "marker-temp", "integrity", "history", "empty-validators", "invalid-power", "unknown-module", "trailing-json", "snapshot-symlink", "marker-symlink"} {
		t.Run(name, func(t *testing.T) {
			d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
			pqMust(t, err)
			_, err = d.Faucet("ynx_offline_source", 50)
			pqMust(t, err)
			d.ProduceBlock()
			path, marker := d.snapshotPath(), d.snapshotIntegrityMarkerPath()
			wire, err := os.ReadFile(path)
			pqMust(t, err)
			var snapshot devnetSnapshot
			pqMust(t, json.Unmarshal(wire, &snapshot))
			switch name {
			case "missing-marker":
				pqMust(t, os.Remove(marker))
			case "wrong-marker":
				pqMust(t, os.WriteFile(marker, []byte("3\n"), 0o600))
			case "snapshot-temp":
				pqMust(t, os.WriteFile(path+".tmp", []byte("unreconciled"), 0o600))
			case "marker-temp":
				pqMust(t, os.WriteFile(marker+".tmp", []byte("3\n"), 0o600))
			case "integrity":
				snapshot.Accounts["ynx_offline_source"].Balance++
				writeOfflineConsensusFixture(t, path, snapshot, false)
			case "history":
				snapshot.Blocks[1].ParentHash = strings.Repeat("f", 64)
				writeOfflineConsensusFixture(t, path, snapshot, true)
			case "empty-validators":
				snapshot.Validators = nil
				writeOfflineConsensusFixture(t, path, snapshot, true)
			case "invalid-power":
				snapshot.Validators[0].VotingPower = 0
				writeOfflineConsensusFixture(t, path, snapshot, true)
			case "unknown-module":
				var document map[string]json.RawMessage
				pqMust(t, json.Unmarshal(wire, &document))
				document["unhandledFutureModule"] = json.RawMessage(`{"asset":123}`)
				wire, err = json.Marshal(document)
				pqMust(t, err)
				pqMust(t, os.WriteFile(path, wire, 0o600))
			case "trailing-json":
				pqMust(t, os.WriteFile(path, append(wire, []byte("\n{}")...), 0o600))
			case "snapshot-symlink", "marker-symlink":
				target := path
				if name == "marker-symlink" {
					target = marker
				}
				pqMust(t, os.Rename(target, target+".original"))
				pqMust(t, os.Symlink(target+".original", target))
			}
			before := captureOfflineConsensusSource(t, d.dataDir)
			if _, err := ExportConsensusMigrationCheckpoint(d.dataDir); err == nil {
				t.Fatal("invalid source was accepted or normalized into replacement authority")
			}
			before.assertUnchanged(t)
		})
	}
}

func TestOfflineConsensusExportLegacyV1DoesNotCreateMarker(t *testing.T) {
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
	pqMust(t, err)
	_, err = d.Faucet("ynx_offline_legacy", 47)
	pqMust(t, err)
	d.ProduceBlock()
	expected, err := d.ExportConsensusMigrationState()
	pqMust(t, err)
	wire, err := os.ReadFile(d.snapshotPath())
	pqMust(t, err)
	var snapshot devnetSnapshot
	pqMust(t, json.Unmarshal(wire, &snapshot))
	snapshot.Version, snapshot.StateIntegrity = legacyDevnetSnapshotVersion, ""
	writeOfflineConsensusFixture(t, d.snapshotPath(), snapshot, false)
	pqMust(t, os.Remove(d.snapshotIntegrityMarkerPath()))
	before := captureOfflineConsensusSource(t, d.dataDir)
	actual, err := ExportConsensusMigrationCheckpoint(d.dataDir)
	pqMust(t, err)
	if actual.StateHash != expected.StateHash {
		t.Fatal("legacy source did not retain the existing V2 export semantics")
	}
	before.assertUnchanged(t)
}

func TestOfflineConsensusFileDetectsReplacementAndNewMarker(t *testing.T) {
	path := filepath.Join(t.TempDir(), "source")
	pqMust(t, os.WriteFile(path, []byte("original"), 0o600))
	source, err := readOfflineConsensusFile(path, false)
	pqMust(t, err)
	pqMust(t, os.WriteFile(path+".new", source.data, 0o600))
	pqMust(t, os.Chtimes(path+".new", source.info.ModTime(), source.info.ModTime()))
	pqMust(t, os.Rename(path+".new", path))
	if err := source.unchanged(); err == nil {
		t.Fatal("replacement with equal bytes and mtime was not detected")
	}
	marker, err := readOfflineConsensusFile(path+".marker", true)
	pqMust(t, err)
	pqMust(t, os.WriteFile(marker.path, []byte("2\n"), 0o600))
	if err := marker.unchanged(); err == nil {
		t.Fatal("new marker during export was not detected")
	}
}

func TestOfflineConsensusFileDetectsSameInodeContentChange(t *testing.T) {
	for _, offset := range []int{0, (64 << 10) - 1, 64 << 10, (64 << 10) + 16} {
		t.Run(fmt.Sprint(offset), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "source")
			pqMust(t, os.WriteFile(path, bytes.Repeat([]byte{0x5a}, (64<<10)+17), 0o600))
			source, err := readOfflineConsensusFile(path, false)
			pqMust(t, err)
			pqMust(t, source.unchanged())
			file, err := os.OpenFile(path, os.O_WRONLY, 0)
			pqMust(t, err)
			_, writeErr := file.WriteAt([]byte{source.data[offset] ^ 1}, int64(offset))
			closeErr := file.Close()
			pqMust(t, writeErr)
			pqMust(t, closeErr)
			pqMust(t, os.Chtimes(path, source.info.ModTime(), source.info.ModTime()))
			current, err := os.Stat(path)
			pqMust(t, err)
			if !sameOfflineConsensusFile(source.info, current) {
				t.Fatal("fixture must retain inode, size, mtime and mode so only the byte comparison detects corruption")
			}
			before := captureOfflineConsensusSource(t, filepath.Dir(path))
			if err := source.unchanged(); err == nil {
				t.Fatal("same-inode byte mutation with restored metadata was not detected")
			}
			before.assertUnchanged(t)
		})
	}
}

func writeOfflineConsensusFixture(t *testing.T, path string, snapshot devnetSnapshot, reseal bool) {
	t.Helper()
	if reseal {
		var err error
		snapshot, err = sealDevnetSnapshot(snapshot)
		pqMust(t, err)
	}
	wire, err := json.Marshal(snapshot)
	pqMust(t, err)
	pqMust(t, os.WriteFile(path, wire, 0o600))
}

type offlineConsensusSourceCapture struct {
	dir   string
	files map[string]offlineConsensusFile
}

func captureOfflineConsensusSource(t *testing.T, dir string) offlineConsensusSourceCapture {
	t.Helper()
	entries, err := os.ReadDir(dir)
	pqMust(t, err)
	before := offlineConsensusSourceCapture{dir: dir, files: make(map[string]offlineConsensusFile)}
	for _, entry := range entries {
		path := filepath.Join(dir, entry.Name())
		info, err := os.Lstat(path)
		pqMust(t, err)
		var wire []byte
		if info.Mode()&os.ModeSymlink != 0 {
			target, err := os.Readlink(path)
			pqMust(t, err)
			wire = []byte(target)
		} else {
			wire, err = os.ReadFile(path)
			pqMust(t, err)
		}
		before.files[entry.Name()] = offlineConsensusFile{path: path, info: info, data: wire}
	}
	return before
}

func (before offlineConsensusSourceCapture) assertUnchanged(t *testing.T) {
	t.Helper()
	after := captureOfflineConsensusSource(t, before.dir)
	if len(before.files) != len(after.files) {
		t.Fatal("offline export changed source directory inventory")
	}
	for name, original := range before.files {
		current, ok := after.files[name]
		if !ok || !sameOfflineConsensusFile(original.info, current.info) || !bytes.Equal(original.data, current.data) {
			t.Fatalf("offline export changed source bytes/inode/mtime/mode: %s", name)
		}
	}
}
