package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
)

type pqTransactionPublicCase struct {
	Name                string          `json:"name"`
	ExpectedTransaction json.RawMessage `json:"expectedTransaction"`
	Request             json.RawMessage `json:"request"`
	ExpectedResponse    json.RawMessage `json:"expectedResponse"`
}

type pqTransactionPublicNegative struct {
	CaseIndex        string          `json:"caseIndex"`
	Name             string          `json:"name"`
	Request          json.RawMessage `json:"request"`
	ExpectedCode     string          `json:"expectedCode"`
	CLIExpectedCode  string          `json:"cliExpectedCode"`
	ExpectedExitCode string          `json:"expectedExitCode"`
	ObservedError    string          `json:"observedError"`
}

type pqTransactionPublicFixture struct {
	Version                      string                        `json:"version"`
	SourceTest                   string                        `json:"sourceTest"`
	SourceKind                   string                        `json:"sourceKind"`
	SyntheticOnly                bool                          `json:"syntheticOnly"`
	DataAuthorized               bool                          `json:"dataAuthorized"`
	NativeRootAuthorized         bool                          `json:"nativeRootAuthorized"`
	DeployedSourceQualification  bool                          `json:"deployedSourceQualification"`
	ActualCometNode              bool                          `json:"actualCometNode"`
	TransactionInclusionVerified bool                          `json:"transactionInclusionVerified"`
	DeterministicResultVerified  bool                          `json:"deterministicResultVerified"`
	NormalFileLoaderVerified     bool                          `json:"normalFileLoaderVerified"`
	Materials                    []pqLightPublicMaterial       `json:"materials"`
	TrustContextParameters       map[string]string             `json:"trustContextParameters"`
	TrustContextFiles            map[string]string             `json:"trustContextFiles"`
	ContextPinProcedure          string                        `json:"contextPinProcedure"`
	Cases                        []pqTransactionPublicCase     `json:"cases"`
	NegativeCases                []pqTransactionPublicNegative `json:"negativeCases"`
}

func pqTransactionPublicJSON(t *testing.T, v any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func pqTransactionPublicExpected(t *testing.T, e PQTransactionProofExpectation) json.RawMessage {
	t.Helper()
	header := func(e PQLightProofExpectation) map[string]string {
		return map[string]string{
			"chainId": e.ChainID, "headerHeight": strconv.FormatInt(e.HeaderHeight, 10), "blockHash": hex.EncodeToString(e.BlockHash),
			"stateHeight": strconv.FormatInt(e.StateHeight, 10), "stateAppHash": hex.EncodeToString(e.StateAppHash),
		}
	}
	return pqTransactionPublicJSON(t, map[string]any{
		"block": header(e.Block), "successor": header(e.Successor), "transactionType": e.TransactionType,
		"envelope": base64.StdEncoding.EncodeToString(e.Envelope), "nativeWire": base64.StdEncoding.EncodeToString(e.NativeWire),
		"transactionHash": hex.EncodeToString(e.TransactionHash), "nativeWireHash": hex.EncodeToString(e.NativeWireHash), "index": strconv.FormatInt(e.Index, 10),
	})
}

func pqTransactionPublicRequest(t *testing.T, e PQTransactionProofExpectation, p PQTransactionProofRequest) json.RawMessage {
	t.Helper()
	return pqTransactionPublicJSON(t, map[string]any{
		"version": "YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1", "expected": pqTransactionPublicExpected(t, e), "proof": p,
	})
}

// Reuse the core owner's real BlockExecutor/BlockStore and signed Comet
// fixture. Only selected public material is serialized; never serialize its
// harness, private signing keys, HRS, custody files or private temp paths.
// These synthetic QA roots are not deployed Native/Source authority. Index 1
// proves an actual committed failed execution, not proposal acceptance/retry.
func TestPQConsensusTransactionProofPublicFixture(t *testing.T) {
	f := newPQTransactionProofFixture(t)
	if len(f.expected) != 3 || len(f.proofs) != 3 {
		t.Fatal("missing real outcome fixtures")
	}
	l := f.light
	migrationRaw, err := l.harness.f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	stateRaw, err := os.ReadFile(l.harness.path)
	if err != nil {
		t.Fatal(err)
	}
	scheduleRaw, err := json.Marshal(l.schedule)
	if err != nil {
		t.Fatal(err)
	}
	scheduleHash, err := l.schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	trustedRaw, err := cmtjson.Marshal(l.trust.TrustedLightBlock)
	if err != nil {
		t.Fatal(err)
	}
	materials := []pqLightPublicMaterial{
		pqLightFixtureMaterial("migration.json", migrationRaw), pqLightFixtureMaterial("genesis.json", l.harness.f.raw),
		pqLightFixtureMaterial("committed-state.json", stateRaw), pqLightFixtureMaterial("schedule.json", scheduleRaw),
		pqLightFixtureMaterial("trusted-light-block.json", trustedRaw),
	}
	var migration chain.ConsensusMigrationState
	if err = json.Unmarshal(materials[0].Bytes, &migration); err != nil {
		t.Fatal(err)
	}
	bootstrap, err := NewConsensusBootstrap(materials[1].Bytes, l.harness.f.pins, migration)
	if err != nil {
		t.Fatal(err)
	}
	authorization, err := NewPQEngineAuthorization(materials[3].Bytes, scheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "committed-state.json")
	if err = os.WriteFile(path, materials[2].Bytes, 0600); err != nil {
		t.Fatal(err)
	}
	source, err := NewPQEngineFileSource(migration, path, bootstrap, authorization)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = source.CommittedPQEngineSnapshot(); err == nil {
		t.Fatal("public files supplied their own engine checkpoint")
	}
	engine, err := l.harness.raw.Load()
	if err != nil {
		t.Fatal(err)
	}
	authority, err := source.ConsensusAuthorityForState(engine.ChainID, engine.LastBlockHeight, engine.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, ok := authority.(*PQEngineSnapshot)
	if !ok {
		t.Fatal("normal file loader returned wrong authority")
	}
	trust := l.trust
	trust.Snapshot = snapshot
	trust.TrustedLightBlock, err = DecodePQTrustedLightBlock(materials[4].Bytes)
	if err != nil {
		t.Fatal(err)
	}
	// The normal CLI has no injected clock. Verify these actual signed headers
	// at generation time with the original explicit one-hour QA trust period.
	trust.Now = time.Now().UTC()
	e := f.expected[0].Block
	fixture := pqTransactionPublicFixture{
		Version: "YNX-PQ-CONSENSUS-TRANSACTION-PROOF-PUBLIC-FIXTURE/v1", SourceTest: "TestPQConsensusTransactionProofPublicFixture",
		SourceKind: "synthetic-standard-comet-engine-objects", SyntheticOnly: true,
		TransactionInclusionVerified: true, DeterministicResultVerified: true, NormalFileLoaderVerified: true, Materials: materials,
		TrustContextParameters: map[string]string{
			"version": "YNX-CONSENSUS-PROOF-TRUST/v1", "chainId": engine.ChainID, "scheduleHash": scheduleHash,
			"consensusGenesisSHA256": l.harness.f.pins.CometGenesisSHA256, "originalGenesisHash": l.harness.f.pins.OriginalGenesisHash, "migrationStateHash": l.harness.f.pins.MigrationStateHash,
			"runtimePlanFile": "", "runtimePlanHash": "", "engineHeight": strconv.FormatInt(engine.LastBlockHeight, 10), "engineAppHash": hex.EncodeToString(engine.AppHash),
			"trustedLightBlockSHA256": materials[4].SHA256, "expectedHeaderHeight": strconv.FormatInt(e.HeaderHeight, 10), "expectedBlockHash": hex.EncodeToString(e.BlockHash),
			"expectedStateHeight": strconv.FormatInt(e.StateHeight, 10), "expectedStateAppHash": hex.EncodeToString(e.StateAppHash),
			"trustingPeriodNanoseconds": strconv.FormatInt(int64(trust.TrustingPeriod), 10), "maxClockDriftNanoseconds": strconv.FormatInt(int64(trust.MaxClockDrift), 10),
			"trustLevelNumerator": strconv.FormatUint(trust.TrustLevel.Numerator, 10), "trustLevelDenominator": strconv.FormatUint(trust.TrustLevel.Denominator, 10),
		},
		TrustContextFiles:   map[string]string{"migrationFile": materials[0].Name, "genesisFile": materials[1].Name, "stateFile": materials[2].Name, "scheduleFile": materials[3].Name, "trustedLightBlockFile": materials[4].Name},
		ContextPinProcedure: "materialize exact public bytes in new files; fill five absolute lightTrust paths; for each case set context={version:YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1,lightTrust,expectedTransaction}; independently pin SHA256 of exact context bytes; synthetic QA roots only, no Native/Source/effect authorization",
	}
	names := []string{"succeeded-transfer", "terminal-rejected-duplicate", "partial-whole"}
	codes := []string{"VERIFIED_TRANSACTION_DATA", "VERIFIED_TRANSACTION_REJECTED_DATA", "VERIFIED_TRANSACTION_PARTIAL_DATA"}
	outcomes := []string{"succeeded", "rejected", "partial"}
	for i := range f.expected {
		if !reflect.DeepEqual(f.expected[i].Block, e) {
			t.Fatal("shared context cannot retarget different headers")
		}
		proof, err := DecodePQTransactionProofRequest(pqTransactionPublicJSON(t, f.proofs[i]))
		if err != nil {
			t.Fatal(err)
		}
		result, err := VerifyPQTransactionProof(trust, f.expected[i], proof)
		if err != nil || !result.Included || !result.Finalized || result.Classification != "data" || result.NativeGrant || result.Outcome != outcomes[i] || result.ExecutionSuccessful != (i == 0) {
			t.Fatal("actual public transaction proof did not verify its exact outcome", i, err)
		}
		reference, err := VerifyPQTransactionProof(l.trust, f.expected[i], f.proofs[i])
		if err != nil || !reflect.DeepEqual(reference, result) {
			t.Fatal("normal public reconstruction changed result", i, err)
		}
		fixture.Cases = append(fixture.Cases, pqTransactionPublicCase{
			Name: names[i], ExpectedTransaction: pqTransactionPublicExpected(t, f.expected[i]), Request: pqTransactionPublicRequest(t, f.expected[i], proof),
			ExpectedResponse: pqTransactionPublicJSON(t, map[string]any{"version": "YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-RESULT/v1", "code": codes[i], "result": result}),
		})
	}
	badSignature := f.proofs[0]
	var commit coretypes.ResultCommit
	if err = cmtjson.Unmarshal(badSignature.Successor.CommitResult, &commit); err != nil {
		t.Fatal(err)
	}
	for i := range commit.Commit.Signatures {
		sig := commit.Commit.Signatures[i].Signature
		if len(sig) == 0 {
			t.Fatal("positive proof omitted signer")
		}
		sig[len(sig)-1] ^= 1
	}
	badSignature.Successor.CommitResult, err = cmtjson.Marshal(&commit)
	if err != nil {
		t.Fatal(err)
	}
	badResult := f.proofs[0]
	var execution abci.ExecTxResult
	if err = execution.Unmarshal(badResult.ExecutionResult); err != nil {
		t.Fatal(err)
	}
	execution.GasUsed++
	badResult.ExecutionResult, err = execution.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	wrongIndex := f.expected[0]
	wrongIndex.Index = 1
	for _, negative := range []struct {
		name, code, cliCode string
		expected            PQTransactionProofExpectation
		proof               PQTransactionProofRequest
	}{
		{"invalid-successor-dual-commit-signatures", "commit_invalid", "PROOF_REJECTED", f.expected[0], badSignature},
		{"changed-deterministic-execution-result", "execution_proof_invalid", "PROOF_REJECTED", f.expected[0], badResult},
		{"wrong-exact-transaction-index", "transaction_proof_invalid", "INVALID_REQUEST", wrongIndex, f.proofs[0]},
	} {
		_, err := VerifyPQTransactionProof(trust, negative.expected, negative.proof)
		var rejected *PQLightProofError
		if !errors.As(err, &rejected) || rejected.Code != negative.code {
			t.Fatal("negative did not fail at exact original stage", negative.name, err)
		}
		fixture.NegativeCases = append(fixture.NegativeCases, pqTransactionPublicNegative{CaseIndex: "0", Name: negative.name,
			Request: pqTransactionPublicRequest(t, negative.expected, negative.proof), ExpectedCode: negative.code, CLIExpectedCode: negative.cliCode, ExpectedExitCode: "1", ObservedError: rejected.Error()})
	}
	for i := range f.expected {
		if _, err := VerifyPQTransactionProof(trust, f.expected[i], f.proofs[i]); err != nil {
			t.Fatal("negative changed original proof", err)
		}
	}
	retained, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(retained, materials[2].Bytes) {
		t.Fatal("proof verification changed original committed bytes", err)
	}
	data, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	var roundTrip pqTransactionPublicFixture
	if err = json.Unmarshal(data, &roundTrip); err != nil {
		t.Fatal(err)
	}
	if !roundTrip.SyntheticOnly || roundTrip.DataAuthorized || roundTrip.NativeRootAuthorized || roundTrip.DeployedSourceQualification || roundTrip.ActualCometNode || !roundTrip.NormalFileLoaderVerified || !roundTrip.TransactionInclusionVerified || !roundTrip.DeterministicResultVerified {
		t.Fatal("public fixture changed authority boundary")
	}
	if len(roundTrip.TrustContextParameters) != 19 || len(roundTrip.TrustContextFiles) != 5 || len(roundTrip.Cases) != 3 || len(roundTrip.NegativeCases) != 3 {
		t.Fatal("incomplete public context or real cases")
	}
	for i, m := range roundTrip.Materials {
		exact := pqLightFixtureMaterial(m.Name, m.Bytes)
		if m.Name != materials[i].Name || m.SHA256 != exact.SHA256 || m.ByteLength != exact.ByteLength || !bytes.Equal(m.Bytes, materials[i].Bytes) {
			t.Fatal("public material bytes changed")
		}
	}
	path = os.Getenv("YNX_PQ_TRANSACTION_PROOF_FIXTURE_OUT")
	if path == "" {
		return
	}
	if err = writePQLightPublicFixture(path, data); err != nil {
		t.Fatal(err)
	}
	readback, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(readback, data) {
		t.Fatal("public transaction fixture output changed", err)
	}
	sum := sha256.Sum256(data)
	t.Logf("PQ_TRANSACTION_PROOF_PUBLIC_FIXTURE version=%s bytes=%d sha256=%x syntheticOnly=true dataAuthorized=false nativeRootAuthorized=false actualCometNode=false cases=3", fixture.Version, len(data), sum)
}
