//go:build unix

package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
)

type initialTransactionPublicTarget struct {
	Expected     transactionExpected                `json:"expected"`
	Request      []byte                             `json:"request"`
	Verification consensus.PQTransactionProofResult `json:"verification"`
	Files        []consensus.ProofHostSourceFile    `json:"files"`
}

type initialTransactionOriginal struct {
	path string
	info os.FileInfo
	raw  []byte
}

// As in materializeHostFixture, only public invocation paths are relocated to
// an isolated test directory. Every original material is first hash-checked
// and retained byte-for-byte. Fresh QA context/source pins grant no Host/Root.
func materializeInitialTransactionTarget(t *testing.T, target initialTransactionPublicTarget) (options, []byte, string, string, []initialTransactionOriginal) {
	t.Helper()
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(parent, "private-source")
	originalDir := filepath.Join(dir, "original")
	for _, path := range []string{dir, originalDir} {
		if err := os.Mkdir(path, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	names := map[string]string{"migration": "migration.json", "genesis": "genesis.json", "state": "committed-state.json", "schedule": "schedule.json",
		"trustedLightBlock": "trusted-light-block.json", "context": "trust-context.json", "lifecycle": "lifecycle.json", "source": "host-source.json"}
	if len(target.Files) != len(names) {
		t.Fatal("complete original eight-role public Source required")
	}
	materials := make(map[string]consensus.ProofHostSourceFile, len(names))
	var originals []initialTransactionOriginal
	for _, file := range target.Files {
		if names[file.Role] != file.Name || file.Name == "" || materials[file.Role].Role != "" || len(file.Bytes) == 0 || hostTestSHA(file.Bytes) != file.SHA256 {
			t.Fatal("original funded Source file identity mismatch", file.Role)
		}
		path := filepath.Join(originalDir, file.Name)
		if err := os.WriteFile(path, file.Bytes, 0o600); err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		originals = append(originals, initialTransactionOriginal{path: path, info: info, raw: bytes.Clone(file.Bytes)})
		materials[file.Role] = file
	}
	var source hostTrustSource
	if err := strictStringObject(materials["source"].Bytes, &source); err != nil {
		t.Fatal(err)
	}
	context, _, err := decodeTransactionTrustContext(materials["context"].Bytes, source.ContextSHA256)
	if err != nil || context.ExpectedTransaction != target.Expected {
		t.Fatal("original funded context did not bind the producer's exact target", err)
	}
	for role, pin := range map[string]string{"migration": source.MigrationSHA256, "genesis": source.GenesisSHA256, "state": source.StateSHA256,
		"schedule": source.ScheduleSHA256, "trustedLightBlock": source.TrustedLightBlockSHA256, "context": source.ContextSHA256, "lifecycle": source.LifecycleSHA256} {
		if pin != materials[role].SHA256 {
			t.Fatal("original Source pin differs from original material", role)
		}
	}
	for pointer, role := range map[*string]string{&context.LightTrust.MigrationFile: "migration", &context.LightTrust.GenesisFile: "genesis",
		&context.LightTrust.StateFile: "state", &context.LightTrust.ScheduleFile: "schedule", &context.LightTrust.TrustedLightBlockFile: "trustedLightBlock"} {
		if filepath.Base(*pointer) != names[role] {
			t.Fatal("original context file role differs", role)
		}
		*pointer = filepath.Join(originalDir, names[role])
	}
	if filepath.Base(source.ContextFile) != names["context"] || filepath.Base(source.LifecycleFile) != names["lifecycle"] || context.LightTrust.RuntimePlanFile != "" || source.RuntimePlanSHA256 != "" {
		t.Fatal("funded fixture is not the original eight-role Source layout")
	}
	contextRaw := transactionJSON(t, context)
	contextPath := filepath.Join(dir, "context.json")
	o := proofContextFile(t, contextPath, contextRaw)
	source.ContextFile, source.ContextSHA256 = contextPath, o.contextSHA256
	source.LifecycleFile = filepath.Join(originalDir, names["lifecycle"])
	sourceRaw := transactionJSON(t, source)
	sourcePath := filepath.Join(dir, "source.json")
	if err := os.WriteFile(sourcePath, sourceRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	return o, contextRaw, sourcePath, hostTestSHA(sourceRaw), originals
}

func assertInitialTransactionOriginals(t *testing.T, originals []initialTransactionOriginal) {
	t.Helper()
	for _, original := range originals {
		raw, err := os.ReadFile(original.path)
		info, statErr := os.Stat(original.path)
		if err != nil || statErr != nil || !bytes.Equal(raw, original.raw) || !os.SameFile(original.info, info) || original.info.Mode() != info.Mode() || !original.info.ModTime().Equal(info.ModTime()) {
			t.Fatal("normal proof CLI changed an original public Source", original.path, err, statErr)
		}
	}
}

func assertInitialTransactionResult(t *testing.T, output []byte, target initialTransactionPublicTarget) {
	t.Helper()
	var result transactionCommandResult
	if err := json.Unmarshal(output, &result); err != nil || result.Version != transactionResultVersion || result.Code != "VERIFIED_TRANSACTION_DATA" || result.Error != "" || result.Result == nil ||
		!result.Result.Included || !result.Result.Finalized || !result.Result.ExecutionSuccessful || result.Result.NativeGrant || result.Result.Outcome != "succeeded" || !reflect.DeepEqual(*result.Result, target.Verification) {
		t.Fatal("normal initial/following-transfer verifier lost the original proven result", string(output), err)
	}
}

func TestTransactionProofInitialPreparedFundingOriginalCLI(t *testing.T) {
	path := os.Getenv("YNX_PQ_INITIAL_FUNDED_FIXTURE_OUT")
	if path == "" {
		t.Skip("requires this CI's normal signed funded-account public fixture; skip is not proof-verifier evidence")
	}
	raw, err := readPublicFile(path, 128<<20)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Version              string                           `json:"version"`
		Classification       string                           `json:"classification"`
		SyntheticOnly        bool                             `json:"syntheticOnly"`
		NodeStarted          bool                             `json:"nodeStarted"`
		NativeGrant          bool                             `json:"nativeGrant"`
		PublicDeployment     bool                             `json:"publicDeployment"`
		Activation           bool                             `json:"activation"`
		FutureSigningCustody bool                             `json:"futureSigningCustody"`
		Targets              []initialTransactionPublicTarget `json:"targets"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil || fixture.Version != "YNX-PQ-INITIAL-PREPARED-FUNDING-PUBLIC/v1" || fixture.Classification != "data" || !fixture.SyntheticOnly ||
		fixture.NodeStarted || fixture.NativeGrant || fixture.PublicDeployment || fixture.Activation || fixture.FutureSigningCustody || len(fixture.Targets) != 2 ||
		fixture.Targets[0].Expected.TransactionType != consensus.PQInitialRegistrationType || fixture.Targets[1].Expected.TransactionType != consensus.PQTransferType {
		t.Fatal("requires the real normal funded-account producer's two DATA-only targets", err)
	}
	for index, target := range fixture.Targets {
		t.Run(target.Expected.TransactionType, func(t *testing.T) {
			o, contextRaw, sourcePath, sourcePin, originals := materializeInitialTransactionTarget(t, target)
			ref, err := acquireProofHost(sourcePath, sourcePin, time.Now)
			if err != nil {
				t.Fatal("normal Source acquisition rejected actual funded original", err)
			}
			defer ref.Close()
			before, err := ref.Current()
			if err != nil || before.ExpectedTransaction == nil || *before.ExpectedTransaction != target.Expected || before.NativeRootAuthorized || before.ProofVerified || before.SourceDeploymentQualified {
				t.Fatal("normal before-current changed target or supplied authority", err)
			}
			var output bytes.Buffer
			if status := runTransactionProof(o, contextRaw, bytes.NewReader(target.Request), &output, time.Now); status != 0 {
				t.Fatal("normal transaction proof rejected funded original", status, output.String())
			}
			assertInitialTransactionResult(t, output.Bytes(), target)
			args := []string{"--trust-context", o.contextPath, "--trust-context-sha256", o.contextSHA256}
			output.Reset()
			if status := run(args, bytes.NewReader(target.Request), &output, time.Now); status != 0 {
				t.Fatal("normal CLI dispatch rejected funded original", status, output.String())
			}
			assertInitialTransactionResult(t, output.Bytes(), target)
			after, err := ref.Current()
			if err != nil || !after.CurrentChecked || after.SourceFingerprint != before.SourceFingerprint || after.ExpectedTransaction == nil || *after.ExpectedTransaction != target.Expected ||
				!bytes.Equal(after.ContextBytes, before.ContextBytes) || after.NativeRootAuthorized || after.ProofVerified || after.SourceDeploymentQualified {
				t.Fatal("normal after-current failed to preserve the original Source", err)
			}
			if index == 0 {
				var request transactionInput
				if err := json.Unmarshal(target.Request, &request); err != nil || request.Expected != target.Expected {
					t.Fatal("original request bytes do not match original expectation", err)
				}
				wrong := request
				wrong.Expected.Index = "0"
				if wrong.Expected.Index == request.Expected.Index {
					wrong.Expected.Index = "1"
				}
				clockCalled := false
				output.Reset()
				if status := run(args, bytes.NewReader(transactionJSON(t, wrong)), &output, func() time.Time { clockCalled = true; return time.Now() }); status != 1 || clockCalled {
					t.Fatal("wrong initial target reached source verification or supplied a result", status)
				}
				var failure transactionCommandResult
				if err := json.Unmarshal(output.Bytes(), &failure); err != nil || failure.Code != "INVALID_REQUEST" || failure.Result != nil {
					t.Fatal("wrong initial target did not fail closed", output.String(), err)
				}
				proof, err := consensus.DecodePQTransactionProofRequest(request.Proof)
				if err != nil {
					t.Fatal(err)
				}
				var commit coretypes.ResultCommit
				if err := cmtjson.Unmarshal(proof.Successor.CommitResult, &commit); err != nil {
					t.Fatal(err)
				}
				changed := 0
				for i := range commit.Commit.Signatures {
					signature := commit.Commit.Signatures[i].Signature
					if len(signature) != 0 {
						signature[len(signature)-1] ^= 1
						changed++
					}
				}
				if changed == 0 {
					t.Fatal("tamper control lacks the actual signed successor commit")
				}
				proof.Successor.CommitResult, err = cmtjson.Marshal(commit)
				if err != nil {
					t.Fatal(err)
				}
				request.Proof = transactionJSON(t, proof)
				output.Reset()
				clockCalled = false
				if status := run(args, bytes.NewReader(transactionJSON(t, request)), &output, func() time.Time { clockCalled = true; return time.Now() }); status != 1 || !clockCalled {
					t.Fatal("tampered initial successor did not reach and fail real proof verification", status)
				}
				if err := json.Unmarshal(output.Bytes(), &failure); err != nil || failure.Code != "PROOF_REJECTED" || failure.Result != nil {
					t.Fatal("tampered initial successor released a verification result", output.String(), err)
				}
			}
			assertInitialTransactionOriginals(t, originals)
		})
	}
	if t.Failed() {
		return
	}
	if after, err := readPublicFile(path, 128<<20); err != nil || !bytes.Equal(after, raw) {
		t.Fatal("proof verification rewrote the producer fixture", err)
	}
	t.Log("PQ_INITIAL_FUNDED_TRANSACTION_CLI_VERIFIED_DATA_ONLY")
}
