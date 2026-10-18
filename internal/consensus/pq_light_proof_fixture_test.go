package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
)

// Only these explicitly selected public objects are exported. Never marshal
// the signing harness, its validator keys, signer/HRS files, or a vault.
type pqLightPublicMaterial struct {
	Name       string `json:"name"`
	SHA256     string `json:"sha256"`
	ByteLength string `json:"byteLength"`
	Bytes      []byte `json:"bytes"` // Exact original file bytes, encoded as base64.
}

type pqLightPublicNegative struct {
	Name            string          `json:"name"`
	Request         json.RawMessage `json:"request"`
	ExpectedCode    string          `json:"expectedCode"`
	CLIExpectedCode string          `json:"cliExpectedCode"`
	ObservedError   string          `json:"observedError"`
}

type pqLightPublicFixture struct {
	Version                     string                  `json:"version"`
	SourceTest                  string                  `json:"sourceTest"`
	SourceKind                  string                  `json:"sourceKind"`
	SyntheticOnly               bool                    `json:"syntheticOnly"`
	DataAuthorized              bool                    `json:"dataAuthorized"`
	NativeRootAuthorized        bool                    `json:"nativeRootAuthorized"`
	DeployedSourceQualification bool                    `json:"deployedSourceQualification"`
	ActualCometNode             bool                    `json:"actualCometNode"`
	TransactionInclusion        bool                    `json:"transactionInclusion"`
	NormalFileLoaderVerified    bool                    `json:"normalFileLoaderVerified"`
	Materials                   []pqLightPublicMaterial `json:"materials"`
	TrustContextParameters      map[string]string       `json:"trustContextParameters"`
	TrustContextFiles           map[string]string       `json:"trustContextFiles"`
	ContextPinProcedure         string                  `json:"contextPinProcedure"`
	Request                     json.RawMessage         `json:"request"`
	ExpectedResponse            json.RawMessage         `json:"expectedResponse"`
	NegativeCases               []pqLightPublicNegative `json:"negativeCases"`
}

func pqLightFixtureMaterial(name string, data []byte) pqLightPublicMaterial {
	sum := sha256.Sum256(data)
	return pqLightPublicMaterial{Name: name, SHA256: hex.EncodeToString(sum[:]), ByteLength: strconv.Itoa(len(data)), Bytes: bytes.Clone(data)}
}

func pqLightFixtureRequest(t *testing.T, expected PQLightProofExpectation, proof PQLightProofRequest) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"version": "YNX-CONSENSUS-PROOF-VERIFY-REQUEST/v1",
		"expected": map[string]string{
			"chainId": expected.ChainID, "headerHeight": strconv.FormatInt(expected.HeaderHeight, 10),
			"blockHash": hex.EncodeToString(expected.BlockHash), "stateHeight": strconv.FormatInt(expected.StateHeight, 10),
			"stateAppHash": hex.EncodeToString(expected.StateAppHash),
		},
		"proof": proof,
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// This is a public synthetic interoperability fixture, not a deployed trust
// root. Real standard Comet objects/signatures come only from the core owner's
// engine fixture; this test does not sign, manufacture a quorum or grant DATA.
// Ordinary tests verify it without exporting. The explicit env path exports
// only after reconstruction, normal FileSource loading and all proof checks.
func TestPQConsensusLightProofPublicFixture(t *testing.T) {
	f := newPQLightProofFixture(t)
	migrationBytes, err := f.harness.f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	stateBytes, err := os.ReadFile(f.harness.path)
	if err != nil {
		t.Fatal(err)
	}
	scheduleBytes, err := json.Marshal(f.schedule)
	if err != nil {
		t.Fatal(err)
	}
	scheduleHash, err := f.schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	trustedBytes, err := cmtjson.Marshal(f.trust.TrustedLightBlock)
	if err != nil {
		t.Fatal(err)
	}
	materials := []pqLightPublicMaterial{
		pqLightFixtureMaterial("migration.json", migrationBytes),
		pqLightFixtureMaterial("genesis.json", f.harness.f.raw),
		pqLightFixtureMaterial("committed-state.json", stateBytes),
		pqLightFixtureMaterial("schedule.json", scheduleBytes),
		pqLightFixtureMaterial("trusted-light-block.json", trustedBytes),
	}

	// Reconstruct exactly what a consumer receives. Authority pins are the
	// separately configured synthetic fixture pins, never inferred from RPC.
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(materials[0].Bytes, &migration); err != nil {
		t.Fatal(err)
	}
	bootstrap, err := NewConsensusBootstrap(materials[1].Bytes, f.harness.f.pins, migration)
	if err != nil {
		t.Fatal(err)
	}
	authorization, err := NewPQEngineAuthorization(materials[3].Bytes, scheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "committed-state.json")
	if err := os.WriteFile(path, materials[2].Bytes, 0600); err != nil {
		t.Fatal(err)
	}
	source, err := NewPQEngineFileSource(migration, path, bootstrap, authorization)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.CommittedPQEngineSnapshot(); err == nil {
		t.Fatal("fixture file primed authority without independent engine checkpoint")
	}
	engine, err := f.harness.raw.Load()
	if err != nil {
		t.Fatal(err)
	}
	authority, err := source.ConsensusAuthorityForState(engine.ChainID, engine.LastBlockHeight, engine.AppHash)
	if err != nil {
		t.Fatal("public materials failed normal exact engine file loading", err)
	}
	snapshot, ok := authority.(*PQEngineSnapshot)
	if !ok {
		t.Fatal("normal loader returned unexpected authority type")
	}
	trust := f.trust
	trust.Snapshot = snapshot
	trust.TrustedLightBlock, err = DecodePQTrustedLightBlock(materials[4].Bytes)
	if err != nil {
		t.Fatal(err)
	}
	// The exported request has no clock override. Its synthetic headers must
	// also be valid at generation time under the unchanged one-hour period,
	// so an immediately invoked normal CLI can use its own time.Now.
	trust.Now = time.Now().UTC()
	proofBytes, err := json.Marshal(f.proof)
	if err != nil {
		t.Fatal(err)
	}
	proof, err := DecodePQLightProofRequest(proofBytes)
	if err != nil {
		t.Fatal(err)
	}
	result, err := VerifyPQLightProof(trust, f.expected, proof)
	if err != nil || !result.CommitVerified || !result.LightTransitionVerified || result.Classification != "data" {
		t.Fatal("public normal-loader fixture did not verify actual Comet proof", err)
	}
	reference, err := VerifyPQLightProof(f.trust, f.expected, f.proof)
	if err != nil || result != reference {
		t.Fatal("reconstructed public files changed actual proof result", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(after, materials[2].Bytes) {
		t.Fatal("read-only proof loader changed reconstructed committed state", err)
	}

	response, err := json.Marshal(map[string]any{"version": "YNX-CONSENSUS-PROOF-VERIFY-RESULT/v1", "code": "VERIFIED_DATA", "result": result})
	if err != nil {
		t.Fatal(err)
	}
	fixture := pqLightPublicFixture{
		Version: "YNX-PQ-CONSENSUS-LIGHT-PROOF-PUBLIC-FIXTURE/v1", SourceTest: "TestPQConsensusLightProofPublicFixture",
		SourceKind: "synthetic-standard-comet-engine-objects", SyntheticOnly: true, NormalFileLoaderVerified: true,
		Materials: materials,
		TrustContextParameters: map[string]string{
			"version": "YNX-CONSENSUS-PROOF-TRUST/v1", "chainId": engine.ChainID,
			"scheduleHash": scheduleHash, "consensusGenesisSHA256": f.harness.f.pins.CometGenesisSHA256,
			"originalGenesisHash": f.harness.f.pins.OriginalGenesisHash, "migrationStateHash": f.harness.f.pins.MigrationStateHash,
			"runtimePlanFile": "", "runtimePlanHash": "", "engineHeight": strconv.FormatInt(engine.LastBlockHeight, 10),
			"engineAppHash": hex.EncodeToString(engine.AppHash), "trustedLightBlockSHA256": materials[4].SHA256,
			"expectedHeaderHeight":      strconv.FormatInt(f.expected.HeaderHeight, 10),
			"expectedBlockHash":         hex.EncodeToString(f.expected.BlockHash),
			"expectedStateHeight":       strconv.FormatInt(f.expected.StateHeight, 10),
			"expectedStateAppHash":      hex.EncodeToString(f.expected.StateAppHash),
			"trustingPeriodNanoseconds": strconv.FormatInt(int64(trust.TrustingPeriod), 10),
			"maxClockDriftNanoseconds":  strconv.FormatInt(int64(trust.MaxClockDrift), 10),
			"trustLevelNumerator":       strconv.FormatUint(trust.TrustLevel.Numerator, 10),
			"trustLevelDenominator":     strconv.FormatUint(trust.TrustLevel.Denominator, 10),
		},
		TrustContextFiles: map[string]string{
			"migrationFile": materials[0].Name, "genesisFile": materials[1].Name, "stateFile": materials[2].Name,
			"scheduleFile": materials[3].Name, "trustedLightBlockFile": materials[4].Name,
		},
		ContextPinProcedure: "write exact public material bytes to new files; fill absolute file paths; externally pin SHA256 of exact resulting context bytes; synthetic QA only, never a production DATA grant",
		Request:             pqLightFixtureRequest(t, f.expected, proof), ExpectedResponse: response,
	}

	// Keep the original typed objects; mutate detached public RPC data only.
	var badCommit coretypes.ResultCommit
	if err := cmtjson.Unmarshal(proof.CommitResult, &badCommit); err != nil {
		t.Fatal(err)
	}
	for i := range badCommit.Commit.Signatures {
		if len(badCommit.Commit.Signatures[i].Signature) == 0 {
			t.Fatal("positive fixture lacks an actual signature")
		}
		signature := badCommit.Commit.Signatures[i].Signature
		signature[len(signature)-1] ^= 1
	}
	badSignatures := proof
	badSignatures.CommitResult, err = cmtjson.Marshal(&badCommit)
	if err != nil {
		t.Fatal(err)
	}
	var incompleteValidators coretypes.ResultValidators
	if err := cmtjson.Unmarshal(proof.ValidatorsResult, &incompleteValidators); err != nil {
		t.Fatal(err)
	}
	incompleteValidators.Total++
	badValidators := proof
	badValidators.ValidatorsResult, err = cmtjson.Marshal(&incompleteValidators)
	if err != nil {
		t.Fatal(err)
	}
	wrongState := f.expected
	wrongState.StateAppHash = bytes.Clone(f.expected.StateAppHash)
	wrongState.StateAppHash[0] ^= 1
	for _, negative := range []struct {
		name, code, cliCode string
		expected            PQLightProofExpectation
		proof               PQLightProofRequest
	}{
		{"invalid-dual-commit-signatures", "commit_invalid", "PROOF_REJECTED", f.expected, badSignatures},
		{"incomplete-validator-result", "invalid_proof", "PROOF_REJECTED", f.expected, badValidators},
		{"wrong-preceding-state-apphash", "anchor_mismatch", "INVALID_REQUEST", wrongState, proof},
	} {
		_, verifyErr := VerifyPQLightProof(trust, negative.expected, negative.proof)
		var classified *PQLightProofError
		if !errors.As(verifyErr, &classified) || classified.Code != negative.code {
			t.Fatalf("public negative %s did not fail at its actual stage: %v", negative.name, verifyErr)
		}
		fixture.NegativeCases = append(fixture.NegativeCases, pqLightPublicNegative{Name: negative.name,
			Request: pqLightFixtureRequest(t, negative.expected, negative.proof), ExpectedCode: classified.Code,
			CLIExpectedCode: negative.cliCode, ObservedError: classified.Error()})
	}
	if result, err := VerifyPQLightProof(trust, f.expected, proof); err != nil || result != reference {
		t.Fatal("negative fixtures mutated original public proof", err)
	}

	data, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	data = append(data, '\n')
	var roundTrip pqLightPublicFixture
	if err := json.Unmarshal(data, &roundTrip); err != nil {
		t.Fatal(err)
	}
	if !roundTrip.SyntheticOnly || roundTrip.DataAuthorized || roundTrip.NativeRootAuthorized || roundTrip.DeployedSourceQualification || roundTrip.ActualCometNode || roundTrip.TransactionInclusion || !roundTrip.NormalFileLoaderVerified {
		t.Fatal("public fixture changed QA authority/execution boundaries")
	}
	if len(roundTrip.TrustContextParameters) != 19 || len(roundTrip.TrustContextFiles) != 5 ||
		roundTrip.TrustContextParameters["expectedHeaderHeight"] != strconv.FormatInt(f.expected.HeaderHeight, 10) ||
		roundTrip.TrustContextParameters["expectedBlockHash"] != hex.EncodeToString(f.expected.BlockHash) ||
		roundTrip.TrustContextParameters["expectedStateHeight"] != strconv.FormatInt(f.expected.StateHeight, 10) ||
		roundTrip.TrustContextParameters["expectedStateAppHash"] != hex.EncodeToString(f.expected.StateAppHash) {
		t.Fatal("public context lost complete schema or independently pinned target")
	}
	for i, material := range roundTrip.Materials {
		exact := pqLightFixtureMaterial(material.Name, material.Bytes)
		if exact.SHA256 != material.SHA256 || exact.ByteLength != material.ByteLength || !bytes.Equal(material.Bytes, materials[i].Bytes) {
			t.Fatal("public export changed exact trusted material bytes")
		}
	}
	path = os.Getenv("YNX_PQ_LIGHT_PROOF_FIXTURE_OUT")
	if path == "" {
		return
	}
	if err := writePQLightPublicFixture(path, data); err != nil {
		t.Fatal(err)
	}
	readback, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(readback, data) {
		t.Fatal("public fixture output differs from verified bytes", err)
	}
	sum := sha256.Sum256(data)
	t.Logf("PQ_LIGHT_PROOF_PUBLIC_FIXTURE version=%s bytes=%d sha256=%x syntheticOnly=true dataAuthorized=false nativeRootAuthorized=false actualCometNode=false transactionInclusion=false", fixture.Version, len(data), sum)
}

// No output directory is created, no previous result is overwritten, and an
// uncertain partial write is retained. An explicit env path is only consumed
// after real proof validation succeeds in TestPQConsensusLightProofPublicFixture.
func writePQLightPublicFixture(path string, data []byte) error {
	if !filepath.IsAbs(path) || strings.TrimSpace(path) != path || filepath.Clean(path) != path {
		return errors.New("public proof fixture requires an explicit absolute new file")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	n, writeErr := f.Write(data)
	if writeErr == nil && n != len(data) {
		writeErr = io.ErrShortWrite
	}
	if writeErr != nil {
		return errors.Join(writeErr, f.Close())
	}
	if err := errors.Join(f.Sync(), f.Close()); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	return errors.Join(dir.Sync(), dir.Close())
}

func TestPQLightPublicFixtureOutputPreservesExistingResults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "public-proof.json")
	original := []byte("retained-original-result\n")
	if err := writePQLightPublicFixture(path, original); err != nil {
		t.Fatal(err)
	}
	if err := writePQLightPublicFixture(path, []byte("replacement")); err == nil {
		t.Fatal("public fixture overwrote an existing result")
	}
	got, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(got, original) {
		t.Fatal("failed export changed original bytes", err)
	}
	if err := writePQLightPublicFixture("relative-fixture.json", original); err == nil {
		t.Fatal("public fixture accepted an implicit output location")
	}
	missingParent := filepath.Join(t.TempDir(), "missing", "proof.json")
	if err := writePQLightPublicFixture(missingParent, original); err == nil {
		t.Fatal("public fixture silently created an output directory")
	}
	if _, err := os.Lstat(filepath.Dir(missingParent)); !os.IsNotExist(err) {
		t.Fatal("refused output created an implicit directory", err)
	}
}
