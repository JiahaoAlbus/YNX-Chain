//go:build unix

package consensus

import (
	"encoding/hex"
	"path/filepath"
	"reflect"
	"testing"
)

func TestProofHostSourceInitialAccountFromOriginalLedger(t *testing.T) {
	// Reuse original four-member registration/engine activation, real
	// BlockExecutor and actual stored H/H+1. No Node.Start or new authority is
	// synthesized by this test's Source/delivery serialization.
	signed := newPQTransactionProofFixtureWithInitial(t, true)
	if len(signed.expected) != 4 || signed.expected[3].TransactionType != PQInitialRegistrationType {
		t.Fatal("actual ledger did not include the original initial-registration target")
	}
	f := newProofHostSourceFixtureFromTransaction(t, signed, "atomic-json", "")
	target := signed.expected[3]
	f.plan.SourceID = "qa-initial-account-proof-source"
	f.plan.OperationID = "qa-original-initial-registration"
	f.plan.Account = "0x4444444444444444444444444444444444444444"
	f.plan.OriginalHash = "0x" + hex.EncodeToString(target.NativeWireHash)
	f.plan.ExpectedTransaction = proofSourceExpected(target)
	before := proofSourceTree(t, filepath.Join(f.root, "original"))
	output := filepath.Join(f.root, "delivery")
	captured, err := f.export(t, output)
	if err != nil {
		t.Fatal("normal stopped Source producer rejected authentic initial registration", err)
	}
	if !captured.SourceReadOnly || !captured.LedgerProofVerified || captured.NativeRootAuthorized || captured.DeploymentVerified || len(captured.Files) != 8 {
		t.Fatal("initial account Source export changed DATA or authority semantics")
	}
	proof, err := DecodePQTransactionProofRequest(captured.Proof)
	if err != nil {
		t.Fatal(err)
	}
	result, err := VerifyPQTransactionProof(signed.light.trust, target, proof)
	if err != nil || !result.Finalized || !result.ExecutionSuccessful || result.TransactionType != PQInitialRegistrationType || result.NativeGrant {
		t.Fatal("normal independent H/H+1 verifier rejected actual initial execution", result, err)
	}
	receipt, err := WriteProofHostDelivery(output, captured)
	if err != nil || receipt.SourceSHA256 != captured.SourceSHA256 || receipt.NativeRootAuthorized || receipt.DeploymentVerified {
		t.Fatal("normal delivery failed or elevated initial account Source", err)
	}
	if !reflect.DeepEqual(before, proofSourceTree(t, filepath.Join(f.root, "original"))) {
		t.Fatal("initial account Source export changed original ledger or signing sentinel")
	}
}
