//go:build unix

package consensus

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestProofHostSourceInitialAccountFromOriginalLedger(t *testing.T) {
	// Reuse original four-member registration/engine activation, real
	// BlockExecutor and actual stored H/H+1. No Node.Start or new authority is
	// synthesized by this test's Source/delivery serialization.
	signed := newPQTransactionProofFixtureWithInitial(t, true)
	if len(signed.expected) != 4 || signed.expected[3].TransactionType != PQInitialRegistrationType {
		t.Fatal("actual ledger did not include the original initial-registration target")
	}
	f := newProofHostSourceFixtureFromTransaction(t, signed, "atomic-json", filepath.Join(t.TempDir(), "private-source"))
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
	// The actual publisher must reject the original CI failure shape (0755
	// publication parent), without creating or overwriting any destination.
	if err := os.Chmod(f.root, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := WriteProofHostDelivery(output, captured); err == nil {
		t.Fatal("normal publisher accepted a nonprivate publication parent")
	}
	if _, err := os.Lstat(output); !os.IsNotExist(err) {
		t.Fatal("refused publication left a destination", err)
	}
	if err := os.Chmod(f.root, 0o700); err != nil {
		t.Fatal(err)
	}
	receipt, err := WriteProofHostDelivery(output, captured)
	if err != nil || receipt.SourceSHA256 != captured.SourceSHA256 || receipt.NativeRootAuthorized || receipt.DeploymentVerified {
		t.Fatal("normal delivery failed or elevated initial account Source", err)
	}
	if !reflect.DeepEqual(before, proofSourceTree(t, filepath.Join(f.root, "original"))) {
		t.Fatal("initial account Source export changed original ledger or signing sentinel")
	}
}

type pqInitialPublicLot struct {
	LotID  string `json:"lotId"`
	Amount string `json:"amount"`
}

type pqInitialPublicAccount struct {
	Address string               `json:"address"`
	Balance string               `json:"balance"`
	Staked  string               `json:"staked"`
	Nonce   string               `json:"nonce"`
	Lots    []pqInitialPublicLot `json:"lots"`
}

func initialPublicAccount(account chain.ConsensusAccount) pqInitialPublicAccount {
	result := pqInitialPublicAccount{Address: account.Address, Balance: strconv.FormatInt(account.Balance, 10), Staked: strconv.FormatInt(account.Staked, 10), Nonce: strconv.FormatUint(account.Nonce, 10), Lots: []pqInitialPublicLot{}}
	for lotID, amount := range account.Lots {
		result.Lots = append(result.Lots, pqInitialPublicLot{LotID: lotID, Amount: strconv.FormatInt(amount, 10)})
	}
	sort.Slice(result.Lots, func(i, j int) bool { return result.Lots[i].LotID < result.Lots[j].LotID })
	return result
}

func TestProofHostSourceInitialPreparedFundingFromOriginalLedger(t *testing.T) {
	// Normal Faucet -> pinned source -> initial registration -> fee1/nonce2
	// transfer all run through the original source/BlockExecutor/proof callees.
	// Only public DATA may leave this fixture; no private key or database does.
	signed := newPQTransactionProofFixtureWithInitialFunding(t, true, true)
	if len(signed.expected) != 5 || signed.expected[3].TransactionType != PQInitialRegistrationType || signed.expected[4].TransactionType != PQTransferType {
		t.Fatal("actual original ledger did not include initial registration and ordinary funded execution")
	}
	h := signed.light.harness
	binding := h.f.bootstrap.record.PQInitialAccounts.Accounts[0]
	beforeAccount, ok := h.f.bootstrap.initialPreparedAccount(h.f.migration, binding.Owner)
	if !ok || binding.PreparedFunding == nil {
		t.Fatal("actual fixture did not retain its independent prepared Faucet source")
	}
	index, ok := accountIndex(h.app.committed.Accounts, binding.Owner)
	if !ok || h.app.committed.Accounts[index].Balance != beforeAccount.Balance-8 || h.app.committed.Accounts[index].Nonce != 2 {
		t.Fatal("normal funded account did not retain its source value and pay the ordinary transfer fee")
	}
	cold, err := NewPersistentApplicationWithEngineAuthorization(h.f.migration, h.path, h.f.bootstrap, signed.light.authorization)
	if err != nil || !reflect.DeepEqual(cold.committed, h.app.committed) {
		t.Fatal("normal cold loader lost funded account state or original authorization history", err)
	}
	type publicTarget struct {
		Expected     ProofHostExpectedTransaction `json:"expected"`
		Request      []byte                       `json:"request"`
		Verification PQTransactionProofResult     `json:"verification"`
		Files        []ProofHostSourceFile        `json:"files"`
	}
	var targets []publicTarget
	for _, targetIndex := range []int{3, 4} {
		f := newProofHostSourceFixtureFromTransaction(t, signed, "atomic-json", filepath.Join(t.TempDir(), "private-source"))
		target := signed.expected[targetIndex]
		f.plan.SourceID = "qa-prepared-initial-source-" + strconv.Itoa(targetIndex)
		f.plan.OperationID = "qa-prepared-initial-" + strconv.Itoa(targetIndex)
		f.plan.Account = binding.Owner
		f.plan.OriginalHash = "0x" + hex.EncodeToString(target.NativeWireHash)
		f.plan.ExpectedTransaction = proofSourceExpected(target)
		before := proofSourceTree(t, filepath.Join(f.root, "original"))
		output := filepath.Join(f.root, "delivery")
		captured, err := f.export(t, output)
		if err != nil || !captured.SourceReadOnly || !captured.LedgerProofVerified || captured.NativeRootAuthorized || captured.DeploymentVerified {
			t.Fatal("normal source capture rejected authentic funded execution or conferred authority", err)
		}
		proof, err := DecodePQTransactionProofRequest(captured.Proof)
		if err != nil {
			t.Fatal(err)
		}
		verification, err := VerifyPQTransactionProof(signed.light.trust, target, proof)
		if err != nil || !verification.Finalized || !verification.ExecutionSuccessful || verification.NativeGrant {
			t.Fatal("independent H/H+1 proof rejected actual prepared-account execution", verification, err)
		}
		if _, err := WriteProofHostDelivery(output, captured); err != nil {
			t.Fatal("normal publisher rejected funded-account public capture", err)
		}
		if !reflect.DeepEqual(before, proofSourceTree(t, filepath.Join(f.root, "original"))) {
			t.Fatal("funded-account proof publication changed original source or signer sentinel")
		}
		request := proofSourceJSON(t, struct {
			Version  string                       `json:"version"`
			Expected ProofHostExpectedTransaction `json:"expected"`
			Proof    PQTransactionProofRequest    `json:"proof"`
		}{"YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1", f.plan.ExpectedTransaction, proof})
		targets = append(targets, publicTarget{Expected: f.plan.ExpectedTransaction, Request: request, Verification: verification, Files: captured.Files})
	}
	if output := os.Getenv("YNX_PQ_INITIAL_FUNDED_FIXTURE_OUT"); output != "" {
		var faucet chain.Transaction
		for _, tx := range h.f.migration.Runtime.Blocks[len(h.f.migration.Runtime.Blocks)-1].Transactions {
			if tx.Hash == binding.PreparedFunding.FaucetHash {
				faucet = tx
			}
		}
		original := proofSourceJSON(t, faucet)
		fixture := struct {
			Version              string                        `json:"version"`
			Classification       string                        `json:"classification"`
			SyntheticOnly        bool                          `json:"syntheticOnly"`
			NodeStarted          bool                          `json:"nodeStarted"`
			NativeGrant          bool                          `json:"nativeGrant"`
			PublicDeployment     bool                          `json:"publicDeployment"`
			Activation           bool                          `json:"activation"`
			FutureSigningCustody bool                          `json:"futureSigningCustody"`
			Configuration        PQInitialAccountConfiguration `json:"configuration"`
			SourceStateHash      string                        `json:"sourceStateHash"`
			FaucetReceipt        []byte                        `json:"faucetReceipt"`
			FaucetReceiptSHA256  string                        `json:"faucetReceiptSHA256"`
			AccountBefore        pqInitialPublicAccount        `json:"accountBefore"`
			AccountAfter         pqInitialPublicAccount        `json:"accountAfter"`
			Targets              []publicTarget                `json:"targets"`
		}{Version: "YNX-PQ-INITIAL-PREPARED-FUNDING-PUBLIC/v1", Classification: "data", SyntheticOnly: true, Configuration: *h.f.bootstrap.record.PQInitialAccounts, SourceStateHash: h.f.migration.StateHash, FaucetReceipt: original, FaucetReceiptSHA256: proofHostSHA(original), AccountBefore: initialPublicAccount(beforeAccount), AccountAfter: initialPublicAccount(h.app.committed.Accounts[index]), Targets: targets}
		raw, err := json.Marshal(fixture)
		if err != nil || len(raw) > 128<<20 {
			t.Fatal("bounded public prepared-account fixture encoding failed", err)
		}
		if err := writePQLightPublicFixture(output, raw); err != nil {
			t.Fatal(err)
		}
		t.Logf("PQ_INITIAL_PREPARED_FUNDING_PUBLIC_DATA bytes=%d sha256=%s", len(raw), proofHostSHA(raw))
	}
}
