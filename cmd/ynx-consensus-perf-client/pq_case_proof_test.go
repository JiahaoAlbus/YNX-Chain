package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestPQMemberCaseProofCollectionPreservesRawAndMeasuresWaits(t *testing.T) {
	wire, registration := pqMemberUnitFixture(t)
	p, err := preparePQMemberCase(wire)
	if err != nil {
		t.Fatal(err)
	}
	index := uint32(0)
	// Explicitly NOT a consensus proof: the collector test must never upgrade
	// this RPC object into independently verified finality.
	view := bftgateway.PQFinalityView{Version: "YNX-PQ-RPC-TRANSACTION-PROOF/v1", Source: "configured-comet-rpc", Status: "collected", ObservedExecutionStatus: "committed", NativeTransactionHash: p.native, ABCITransactionHash: p.outer, ExecutionHeight: 7, CometIndex: &index, ProofVerification: "not-performed", Proof: &consensus.PQTransactionProofRequest{Version: consensus.PQTransactionProofVersion}}
	raw, _ := json.MarshalIndent(view, "", "  ")
	raw = append(raw, '\n')
	var posts, proofGets atomic.Int32
	const delay = 4 * time.Millisecond
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts.Add(1)
			if verifyPQMemberUnit(wire, registration) != nil {
				t.Error("invalid real dual signature")
			}
			time.Sleep(delay)
		}
		if r.URL.Path == "/txs/"+p.outer+"/pq-finality-proof" {
			proofGets.Add(1)
			time.Sleep(delay)
			w.Write(raw)
			return
		}
		if r.Method == http.MethodGet {
			time.Sleep(delay)
		}
		json.NewEncoder(w).Encode(pqMemberUnitView(p))
	}))
	defer server.Close()
	dir := t.TempDir()
	input := filepath.Join(dir, "member.bin")
	os.WriteFile(input, wire, 0600)
	o := options{pqMemberWire: input, pqGateway: server.URL, pqCollectProof: true, output: filepath.Join(dir, "report.json"), timeout: 5 * time.Second}
	if err = execute(o); err != nil {
		t.Fatal(err)
	}
	var report pqWholeCaseReport
	reportRaw, _ := os.ReadFile(o.output)
	if err = json.Unmarshal(reportRaw, &report); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(o.output + ".pq-proof.json")
	hash := sha256.Sum256(raw)
	if !bytes.Equal(got, raw) || report.ProofEvidenceSHA256 != hex.EncodeToString(hash[:]) || report.ProofEvidenceBytes != len(raw) || report.ProofCollectionStatus != "collected_unverified" {
		t.Fatal("raw collector evidence changed", report)
	}
	if report.IndependentFinalityVerified || report.SustainedTPSQualified || !report.ConfiguredRPCObservationOnly || report.EffectiveBusinessIncludedObserved != 1 || posts.Load() != 1 || proofGets.Load() != 1 {
		t.Fatal("collection forged finality or replayed submission", report)
	}
	phases := report.Phases
	if phases.SubmissionHTTPNs < int64(delay) || phases.OriginalReadbackHTTPNs < int64(delay) || phases.ProofCollectionHTTPNs < int64(delay) || phases.InputPreparationNs <= 0 || phases.IntentDurabilityNs <= 0 || phases.ProofDurabilityNs <= 0 {
		t.Fatal("missing actual monotonic phase measurements", phases)
	}
	sum := phases.SubmissionHTTPNs + phases.SubmissionValidationNs + phases.OriginalReadbackHTTPNs + phases.OriginalReadbackValidationNs
	if sum > report.ObservationElapsedNs {
		t.Fatal("phase intervals overlap or observation includes proof wait", report)
	}
	if err = execute(o); err == nil || posts.Load() != 1 {
		t.Fatal("repeated output rebroadcast original")
	}
	if err = persistPQCaseProof(report.ProofEvidencePath, []byte("replacement")); err == nil {
		t.Fatal("proof evidence overwritten")
	}
	if _, err = consensus.VerifyPQTransactionProof(consensus.PQLightProofTrust{}, consensus.PQTransactionProofExpectation{}, *view.Proof); err == nil {
		t.Fatal("untrusted collector became finality")
	}
	// Recovery is explicit read-only, including re-collecting proof into a NEW file.
	o.pqReadbackOnly = true
	o.output = filepath.Join(dir, "recovery.json")
	if err = execute(o); err != nil || posts.Load() != 1 || proofGets.Load() != 2 {
		t.Fatal("read-only recovery replayed original", err)
	}
	t.Logf("UNIT_ONLY client phases ns: %+v; observation=%d; proof bytes=%d; independentFinality=false", phases, report.ObservationElapsedNs, len(raw))
}

func TestPQMemberCaseProofPendingOrMismatchedNeverFinalizes(t *testing.T) {
	wire, _ := pqMemberUnitFixture(t)
	p, err := preparePQMemberCase(wire)
	if err != nil {
		t.Fatal(err)
	}
	index := uint32(0)
	base := bftgateway.PQFinalityView{Version: "YNX-PQ-RPC-TRANSACTION-PROOF/v1", Source: "configured-comet-rpc", Status: "collected", ObservedExecutionStatus: "committed", NativeTransactionHash: p.native, ABCITransactionHash: p.outer, ExecutionHeight: 7, CometIndex: &index, ProofVerification: "not-performed", Proof: &consensus.PQTransactionProofRequest{Version: consensus.PQTransactionProofVersion}}
	for name, mutate := range map[string]func(*bftgateway.PQFinalityView){
		"pending":             func(v *bftgateway.PQFinalityView) { v.Status = "pending"; v.Proof = nil },
		"other-native":        func(v *bftgateway.PQFinalityView) { v.NativeTransactionHash = p.outer },
		"other-height":        func(v *bftgateway.PQFinalityView) { v.ExecutionHeight++ },
		"other-index":         func(v *bftgateway.PQFinalityView) { i := uint32(1); v.CometIndex = &i },
		"rpc-claims-finality": func(v *bftgateway.PQFinalityView) { v.IndependentFinality = true },
	} {
		t.Run(name, func(t *testing.T) {
			view := base
			mutate(&view)
			var posts atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodPost {
					posts.Add(1)
				}
				if r.URL.Path == "/txs/"+p.outer+"/pq-finality-proof" {
					json.NewEncoder(w).Encode(view)
					return
				}
				json.NewEncoder(w).Encode(pqMemberUnitView(p))
			}))
			defer server.Close()
			dir := t.TempDir()
			input := filepath.Join(dir, "wire")
			os.WriteFile(input, wire, 0600)
			o := options{pqMemberWire: input, pqGateway: server.URL, pqCollectProof: true, output: filepath.Join(dir, "report"), timeout: time.Second}
			if execute(o) == nil {
				t.Fatal("unavailable or mismatched proof accepted")
			}
			var report pqWholeCaseReport
			b, _ := os.ReadFile(o.output)
			json.Unmarshal(b, &report)
			if report.Status != "committed_observed" || report.ProofCollectionStatus != "unavailable" || report.ProofCollectionError == "" || report.IndependentFinalityVerified || report.ProofEvidencePath == "" || posts.Load() != 1 {
				t.Fatal("lost committed state or proof failure evidence", report)
			}
		})
	}
}

func TestPQWholeCaseProofOptions(t *testing.T) {
	// Option validation only: these are paths/pins, not generated authority.
	base := options{pqWholeWire: "original-whole", pqGateway: "http://127.0.0.1:1234", pqCollectProof: true, output: "new-report", timeout: time.Second}
	if err := validatePQWholeCaseOptions(base); err != nil {
		t.Fatal("canonical Whole proof collection must use its original ABCI route", err)
	}
	base.pqReadbackOnly = true
	base.pqProofVerifier, base.pqTrustContext = "/original/verifier", "/original/context"
	base.pqProofVerifierSHA256, base.pqTrustContextSHA256 = strings.Repeat("a", 64), strings.Repeat("b", 64)
	if err := validatePQWholeCaseOptions(base); err != nil {
		t.Fatal("read-only Whole verification with independent pins", err)
	}
	base.pqReadbackOnly = false
	if validatePQWholeCaseOptions(base) == nil {
		t.Fatal("Whole proof verification must never submit")
	}
}

func TestPQWholeCaseCollectorContractKeepsPartialUnverified(t *testing.T) {
	// DATA-only identity contract. A collector object is not a valid signed proof.
	p := pqWholeCase{kind: consensus.PQWholeType, native: "native-original", outer: "abci-original", members: []string{"effect0", "effect1"}}
	index := uint32(2)
	report := pqWholeCaseReport{ExecutionHeight: 7, CometIndex: &index, EffectiveBusinessIncludedObserved: 1, RejectedMembers: 1}
	v := bftgateway.PQFinalityView{Version: "YNX-PQ-RPC-TRANSACTION-PROOF/v1", Source: "configured-comet-rpc", Status: "collected", ObservedExecutionStatus: "partial", NativeTransactionHash: p.native, ABCITransactionHash: p.outer, ExecutionHeight: 7, CometIndex: &index, ProofVerification: "not-performed", Proof: &consensus.PQTransactionProofRequest{Version: consensus.PQTransactionProofVersion}}
	if err := p.validateCollectedProof(v, &report); err != nil {
		t.Fatal(err)
	}
	if report.IndependentFinalityVerified || report.EffectiveBusinessFinalized != 0 {
		t.Fatal("collector DATA became independent finality")
	}
	v.ObservedExecutionStatus = "committed"
	if p.validateCollectedProof(v, &report) == nil {
		t.Fatal("partial Whole advertised as complete success")
	}
	v.ObservedExecutionStatus = "partial"
	v.IndependentFinality = true
	if p.validateCollectedProof(v, &report) == nil {
		t.Fatal("RPC self-authorized independent finality")
	}
}
