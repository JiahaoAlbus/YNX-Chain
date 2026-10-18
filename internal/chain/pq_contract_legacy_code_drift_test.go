package chain

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// Intentionally NOT parallel: this regression temporarily replaces one field
// in the actual repository compiler artifact used by the legacy loader. It
// preserves the original bytes and mode with t.Cleanup, including on fatal
// failure. The contract's recorded metadata/path and signed prestate are never
// altered by setup. Run only in the authorized isolated remote CI checkout.
func TestPQContractLegacyCodeDriftRejectsBeforeCheckpointMutation(t *testing.T) {
	f := newPQContractVerifyLedger(t)
	f.activate(t)
	_, err := f.d.Faucet(f.to, 100)
	pqMust(t, err)
	artifact, deploy, deployWire := pqContractTestDeploy(t, f, ynxauth.ContractCounterName)
	policy, height := f.d.AccountAuthorization(f.to)
	pqMust(t, policy.RequireLegacy(f.to, height))

	// Genuine compiled deployment and legal unmigrated caller form the positive
	// control. This is the real legacy entrypoint, not a synthetic signature or
	// a privileged ledger-storage fixture. Existing legacy Fee 2 is metadata.
	callerBefore, _ := f.d.Account(f.to)
	result, call, err := f.d.ExecuteContract(f.to, artifact.Address, pqContractTestCalldata(artifact.Name, f.to, 3))
	pqMust(t, err)
	if result.OpcodeStepCount <= 0 || len(result.StorageWrites) == 0 || result.LogCount != 1 || call.Hash == "" || call.Fee != 2 || len(call.LotFlows) != 0 {
		t.Fatal("positive control did not execute the real compiled legacy counter")
	}
	callerAfter, _ := f.d.Account(f.to)
	if !reflect.DeepEqual(callerBefore, callerAfter) {
		t.Fatal("positive control changed existing legacy balance/nonce/resource semantics")
	}
	pqContractTestRead(t, f.d, artifact, f.owner, f.to, 10, 0, 0)
	f.d.ProduceBlock()
	cold, err := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
	pqMust(t, err)
	assertModuleState(t, cold, moduleBusinessState(t, f.d))
	f.d = cold
	pqContractTestRead(t, f.d, artifact, f.owner, f.to, 10, 0, 0)

	beforeState := moduleBusinessState(t, f.d)
	beforeSnapshot, err := os.ReadFile(f.d.snapshotPath())
	pqMust(t, err)
	beforeMarker, err := os.ReadFile(f.d.snapshotIntegrityMarkerPath())
	pqMust(t, err)
	beforeOwner, _ := f.d.Account(f.owner)
	beforeCaller, _ := f.d.Account(f.to)
	beforeDeployment, beforeProof, found := f.d.TransactionWithDurability(deploy.Hash)
	if !found || beforeProof.Status != "durable" {
		t.Fatal("positive control did not establish the original PQ checkpoint proof")
	}
	beforeArtifact, _ := f.d.Contract(artifact.Address)
	beforeCommitment, err := ContractExecutionStateCommitment(beforeArtifact)
	pqMust(t, err)

	root, ok := repoRoot()
	if !ok || beforeArtifact.CompilerArtifact == nil {
		t.Fatal("actual compiler artifact required")
	}
	relative := beforeArtifact.CompilerArtifact.ArtifactPath
	original, err := readConfinedConsensusArtifact(root, "artifacts/contracts", relative, consensusArtifactLimit)
	pqMust(t, err)
	path := filepath.Join(root, filepath.FromSlash(relative))
	info, err := os.Stat(path)
	pqMust(t, err)
	if !info.Mode().IsRegular() {
		t.Fatal("compiler artifact must be a regular file")
	}
	originalMode := info.Mode()
	restore := func() error {
		if err := os.WriteFile(path, original, originalMode.Perm()); err != nil {
			return err
		}
		return os.Chmod(path, originalMode)
	}
	t.Cleanup(func() {
		if err := restore(); err != nil {
			t.Errorf("restore exact original compiler artifact: %v", err)
			return
		}
		raw, readErr := os.ReadFile(path)
		restoredInfo, statErr := os.Stat(path)
		if readErr != nil || statErr != nil || !bytes.Equal(raw, original) || restoredInfo.Mode() != originalMode {
			t.Error("compiler artifact cleanup did not restore exact bytes and mode")
		}
	})

	// Replace only the JSON value's byte span. Re-marshalling the artifact would
	// also reformat its raw ABI and change ABIHash, masking the deployed-code
	// drift with a second, unrelated metadata mismatch.
	value := regexp.MustCompile(`"deployedBytecode"\s*:\s*("(?:[^"\\]|\\.)*")`)
	positions := value.FindAllSubmatchIndex(original, -1)
	if len(positions) != 1 {
		t.Fatal("actual artifact must have one deployedBytecode property")
	}
	start, end := positions[0][2], positions[0][3]
	var originalCode string
	pqMust(t, json.Unmarshal(original[start:end], &originalCode))
	if originalCode == "" || hashParts("solc-deployed-bytecode", originalCode) != beforeArtifact.DeployedBytecodeHash {
		t.Fatal("positive control artifact did not match the anchored runtime hash")
	}
	// PUSH1 99; PUSH1 0; SSTORE; STOP. It has no selector dispatch and no LOG,
	// but the old entrypoint trusts its cached SelectorMatched and accepts SSTORE.
	const driftCode = "0x606360005500"
	forged := append([]byte(nil), original[:start]...)
	forged = append(forged, []byte(`"`+driftCode+`"`)...)
	forged = append(forged, original[end:]...)
	pqMust(t, os.WriteFile(path, forged, originalMode.Perm()))
	pqMust(t, os.Chmod(path, originalMode))
	if code, available := hardhatDeployedBytecode(relative); !available || code != driftCode {
		t.Fatal("test did not replace the actual code read by the legacy entrypoint")
	}
	stillOriginal, _ := f.d.Contract(artifact.Address)
	commitment, err := ContractExecutionStateCommitment(stillOriginal)
	pqMust(t, err)
	if commitment != beforeCommitment || !reflect.DeepEqual(stillOriginal, beforeArtifact) {
		t.Fatal("setup changed the signed ledger prestate instead of only the external code file")
	}

	result, attempted, executeErr := f.d.ExecuteContract(f.to, artifact.Address, pqContractTestCalldata(artifact.Name, f.to, 1))
	if executeErr == nil {
		t.Errorf("legacy entrypoint accepted drifted code before checkpoint: hash=%s writes=%d logs=%d", attempted.Hash, len(result.StorageWrites), result.LogCount)
	}
	if attempted.Hash != "" || result.TransactionHash != "" || len(result.StorageWrites) != 0 {
		t.Error("code mismatch returned an executed transaction or state transition")
	}
	if !bytes.Equal(moduleBusinessState(t, f.d), beforeState) {
		t.Error("code mismatch mutated complete runtime/accounts/lots/history/pending state")
	}
	afterOwner, _ := f.d.Account(f.owner)
	afterCaller, _ := f.d.Account(f.to)
	if !reflect.DeepEqual(beforeOwner, afterOwner) || !reflect.DeepEqual(beforeCaller, afterCaller) {
		t.Error("code mismatch consumed account balance, nonce, fee or resources")
	}
	afterDeployment, afterProof, found := f.d.TransactionWithDurability(deploy.Hash)
	if !found || !reflect.DeepEqual(beforeDeployment, afterDeployment) || !reflect.DeepEqual(beforeProof, afterProof) {
		t.Error("code mismatch replaced original PQ history or its exact checkpoint proof")
	}
	afterSnapshot, err := os.ReadFile(f.d.snapshotPath())
	pqMust(t, err)
	afterMarker, err := os.ReadFile(f.d.snapshotIntegrityMarkerPath())
	pqMust(t, err)
	if !bytes.Equal(beforeSnapshot, afterSnapshot) || !bytes.Equal(beforeMarker, afterMarker) {
		t.Error("code mismatch wrote a new snapshot or integrity marker")
	}
	// A rejected call must leave a loadable checkpoint even while the external
	// artifact is still wrong; historical anchored replay uses retained code.
	recovered, loadErr := NewPersistentDevnet(f.d.cfg, f.d.dataDir)
	if loadErr != nil {
		t.Errorf("code mismatch left a checkpoint rejected by cold history validation: %v", loadErr)
	} else if !bytes.Equal(moduleBusinessState(t, recovered), beforeState) {
		t.Error("cold recovery after rejected code drift changed the original state")
	}
	pqMust(t, restore())
	if t.Failed() {
		return
	}

	// Restoring the exact original compiler file must keep ordinary legacy
	// callers usable. No production repair is applied by this regression.
	f.d = recovered
	result, restoredCall, err := f.d.ExecuteContract(f.to, artifact.Address, pqContractTestCalldata(artifact.Name, f.to, 2))
	pqMust(t, err)
	if restoredCall.Hash == "" || result.OpcodeStepCount <= 0 || result.LogCount != 1 {
		t.Fatal("restoring original code did not restore valid compiled execution")
	}
	pqContractTestRead(t, f.d, artifact, f.owner, f.to, 12, 0, 0)
	f.d.ProduceBlock()
	recovered, err = NewPersistentDevnet(f.d.cfg, f.d.dataDir)
	pqMust(t, err)
	assertModuleState(t, recovered, moduleBusinessState(t, f.d))
	pqContractTestRead(t, recovered, artifact, f.owner, f.to, 12, 0, 0)
	if originalTx, replayed, err := recovered.SubmitPQAction(deployWire); err != nil || !replayed || originalTx.Hash != deploy.Hash {
		t.Fatal("code restoration/restart changed original signed deployment replay")
	}
}
