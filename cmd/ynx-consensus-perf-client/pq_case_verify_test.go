package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func pqCaseTestSHA(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func TestPQMemberCaseVerifierRequiresIndependentPinsAndReadOnly(t *testing.T) {
	for _, o := range []options{
		{pqProofVerifier: "/bin/false"},
		{pqProofVerifier: "/bin/false", pqProofVerifierSHA256: strings.Repeat("a", 64), pqTrustContext: "/tmp/context", pqTrustContextSHA256: strings.Repeat("b", 64), pqCollectProof: true, pqMemberWire: "wire"},
	} {
		if validatePQCaseVerifierOptions(o) == nil {
			t.Fatal("incomplete or broadcasting proof verification accepted")
		}
	}
	dir, e := filepath.EvalSymlinks(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	file := filepath.Join(dir, "original")
	os.WriteFile(file, []byte("original"), 0600)
	if _, e = readPQCasePinned(file, pqCaseTestSHA([]byte("other")), 64, false); e == nil {
		t.Fatal("unrelated pinned bytes accepted")
	}
	link := filepath.Join(dir, "link")
	os.Symlink(file, link)
	if _, e = readPQCasePinned(link, pqCaseTestSHA([]byte("original")), 64, false); e == nil {
		t.Fatal("symlink changed original identity")
	}
}

// Run with the canonical existing single-process signed BlockExecutor fixture
// and actual original verifier executable. No network, live accounts or
// production roots; absence is an explicit skip, never proof qualification.
func TestPQMemberCaseOriginalVerifierSignedPublicFixture(t *testing.T) {
	fixturePath, verifier := os.Getenv("YNX_PERF_PQ_PROOF_FIXTURE"), os.Getenv("YNX_PERF_PQ_PROOF_VERIFIER")
	if fixturePath == "" || verifier == "" {
		t.Skip("requires original signed public fixture and original verifier; no proof PASS from skip")
	}
	raw, e := os.ReadFile(fixturePath)
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Version              string `json:"version"`
		SyntheticOnly        bool   `json:"syntheticOnly"`
		ActualCometNode      bool   `json:"actualCometNode"`
		NativeRootAuthorized bool   `json:"nativeRootAuthorized"`
		Materials            []struct {
			Name   string `json:"name"`
			SHA256 string `json:"sha256"`
			Bytes  []byte `json:"bytes"`
		} `json:"materials"`
		TrustContextParameters map[string]string `json:"trustContextParameters"`
		TrustContextFiles      map[string]string `json:"trustContextFiles"`
		Cases                  []struct {
			ExpectedTransaction json.RawMessage `json:"expectedTransaction"`
			Request             json.RawMessage `json:"request"`
		} `json:"cases"`
	}
	if e = json.Unmarshal(raw, &f); e != nil || f.Version != "YNX-PQ-CONSENSUS-TRANSACTION-PROOF-PUBLIC-FIXTURE/v1" || !f.SyntheticOnly || f.ActualCometNode || f.NativeRootAuthorized || len(f.Cases) != 3 {
		t.Fatal("not the original bounded synthetic public fixture", e)
	}
	dir, e := filepath.EvalSymlinks(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	for _, m := range f.Materials {
		if filepath.Base(m.Name) != m.Name || pqCaseTestSHA(m.Bytes) != m.SHA256 {
			t.Fatal("material pin differs")
		}
		if e = os.WriteFile(filepath.Join(dir, m.Name), m.Bytes, 0600); e != nil {
			t.Fatal(e)
		}
	}
	light := f.TrustContextParameters
	for k, name := range f.TrustContextFiles {
		light[k] = filepath.Join(dir, name)
	}
	originalContext, e := json.Marshal(struct {
		Version    string            `json:"version"`
		LightTrust map[string]string `json:"lightTrust"`
		Expected   json.RawMessage   `json:"expectedTransaction"`
	}{"YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1", light, f.Cases[0].ExpectedTransaction})
	if e != nil {
		t.Fatal(e)
	}
	contextPath := filepath.Join(dir, "context.json")
	os.WriteFile(contextPath, originalContext, 0600)
	var expected struct {
		NativeWire []byte `json:"nativeWire"`
		Index      string `json:"index"`
		Block      struct {
			Height string `json:"headerHeight"`
		} `json:"block"`
	}
	json.Unmarshal(f.Cases[0].ExpectedTransaction, &expected)
	p, e := preparePQMemberCase(expected.NativeWire)
	if e != nil {
		t.Fatal("original signed fixture member", e)
	}
	height, e := strconv.ParseUint(expected.Block.Height, 10, 64)
	if e != nil {
		t.Fatal(e)
	}
	index64, e := strconv.ParseUint(expected.Index, 10, 32)
	if e != nil {
		t.Fatal(e)
	}
	index := uint32(index64)
	var request struct {
		Proof *consensus.PQTransactionProofRequest `json:"proof"`
	}
	json.Unmarshal(f.Cases[0].Request, &request)
	view := bftgateway.PQFinalityView{Version: "YNX-PQ-RPC-TRANSACTION-PROOF/v1", Source: "configured-comet-rpc", Status: "collected", ObservedExecutionStatus: "committed", NativeTransactionHash: p.native, ABCITransactionHash: p.outer, ExecutionHeight: height, CometIndex: &index, ProofVerification: "not-performed", Proof: request.Proof}
	response, _ := json.Marshal(view)
	proofPath := filepath.Join(dir, "original-collector.json")
	os.WriteFile(proofPath, response, 0600)
	verifier, e = filepath.EvalSymlinks(verifier)
	if e != nil {
		t.Fatal(e)
	}
	binary, e := os.ReadFile(verifier)
	if e != nil {
		t.Fatal(e)
	}
	o := options{pqMemberWire: "original", pqReadbackOnly: true, pqCollectProof: true, pqProofVerifier: verifier, pqProofVerifierSHA256: pqCaseTestSHA(binary), pqTrustContext: contextPath, pqTrustContextSHA256: pqCaseTestSHA(originalContext), output: filepath.Join(dir, "result")}
	if e = validatePQCaseVerifierOptions(o); e != nil {
		t.Fatal(e)
	}
	var posts atomic.Int32
	memberView := pqMemberUnitView(p)
	memberView.ExecutionHeight = height
	memberView.CometIndex = &index
	memberView.Transaction.BlockNum = height
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts.Add(1)
			http.Error(w, "read-only proof case must never submit", 500)
			return
		}
		if r.URL.Path == "/txs/"+p.outer+"/pq-finality-proof" {
			w.Write(response)
			return
		}
		if r.URL.Path != memberView.ReadbackURL {
			http.NotFound(w, r)
			return
		}
		json.NewEncoder(w).Encode(memberView)
	}))
	defer server.Close()
	memberPath := filepath.Join(dir, "original-member.bin")
	os.WriteFile(memberPath, p.wire, 0600)
	o.pqMemberWire = memberPath
	o.pqGateway = server.URL
	o.timeout = 10 * time.Second
	if e = execute(o); e != nil {
		t.Fatal("original production read-only proof entry", e)
	}
	var report pqWholeCaseReport
	reportRaw, e := os.ReadFile(o.output)
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(reportRaw, &report); e != nil {
		t.Fatal(e)
	}
	if posts.Load() != 0 || report.SubmissionAttempts != 0 || report.EffectiveBusinessIncludedObserved != 1 {
		t.Fatal("proof recovery rebroadcast or lost original business", report)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if !report.IndependentFinalityVerified || report.ConfiguredRPCObservationOnly || report.SustainedTPSQualified || report.ProofVerificationStatus != "verified_original_transaction" || report.ProofVerificationNs <= 0 || report.EffectiveBusinessFinalized != 1 || report.ActualOfferToFinalityMeasured || report.VerifierPreparationNs <= 0 || report.VerifierProcessNs <= 0 || report.VerifierEvidenceDurabilityNs <= 0 || report.VerifierResultValidationNs <= 0 {
		t.Fatal("original actual verifier did not verify signed fixture", report)
	}
	t.Logf("SYNTHETIC_SIGNED_QA_ONLY original canonical offline verifier PASS; totalNs=%d preparationNs=%d processNs=%d evidenceDurabilityNs=%d resultValidationNs=%d; no actual node/TPS/Native grant", report.ProofVerificationNs, report.VerifierPreparationNs, report.VerifierProcessNs, report.VerifierEvidenceDurabilityNs, report.VerifierResultValidationNs)
	// A valid independent context for another index cannot verify this original.
	bad := report
	bad.IndependentFinalityVerified = false
	bad.ProofVerificationStatus = ""
	other := index + 1
	bad.CometIndex = &other
	o.output = filepath.Join(dir, "wrong-target")
	verifyPQCaseCollectedProof(ctx, o, p, &bad)
	if bad.IndependentFinalityVerified || bad.ProofVerificationError == "" {
		t.Fatal("split independent target passed", bad)
	}
	// Corrupt original deterministic execution proof, retain a new raw collector
	// with its own hash. Exact canonical verifier must reject, not the file pin.
	request.Proof.ExecutionProof[0] ^= 1
	view.Proof = request.Proof
	corrupt, _ := json.Marshal(view)
	corruptPath := filepath.Join(dir, "corrupt-collector.json")
	os.WriteFile(corruptPath, corrupt, 0600)
	bad = pqWholeCaseReport{CometIndex: &index, ExecutionHeight: height, ProofEvidencePath: corruptPath, ProofEvidenceSHA256: pqCaseTestSHA(corrupt), ConfiguredRPCObservationOnly: true}
	o.output = filepath.Join(dir, "corrupt-proof")
	verifyPQCaseCollectedProof(ctx, o, p, &bad)
	if bad.IndependentFinalityVerified || bad.ProofVerificationError == "" || bad.VerifierEvidencePath == "" {
		t.Fatal("actual verifier accepted corrupted execution proof", bad)
	}
}
