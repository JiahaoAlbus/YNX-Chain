package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

func TestPQRegistrationCaseOriginalProofCollectorNeverCountsBirthAsBusiness(t *testing.T) {
	wire, knownUnitBinding := pqInitialUnitFixture(t)
	p, e := preparePQInitialCase(wire)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = ynxauth.VerifyPQInitialRegistrationPossession(wire, knownUnitBinding, 7); e != nil {
		t.Fatal(e)
	}
	// Unit RPC collector object only. Complete original consensus verification
	// is supplied by the canonical owner's independent proof fixture, not this.
	index := uint32(0)
	view := bftgateway.PQFinalityView{Version: "YNX-PQ-RPC-TRANSACTION-PROOF/v1", Source: "configured-comet-rpc", Status: "collected", ObservedExecutionStatus: "committed", NativeTransactionHash: p.native, ABCITransactionHash: p.outer, ExecutionHeight: 7, CometIndex: &index, ProofVerification: "not-performed", Proof: &consensus.PQTransactionProofRequest{Version: consensus.PQTransactionProofVersion}}
	var posts, proofGets atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts.Add(1)
			if r.URL.Path != "/accounts/"+p.registration.Owner+"/authorization/register" {
				http.Error(w, "wrong birth route", 422)
				return
			}
		}
		if r.URL.Path == "/txs/"+p.outer+"/pq-finality-proof" {
			proofGets.Add(1)
			json.NewEncoder(w).Encode(view)
			return
		}
		json.NewEncoder(w).Encode(pqInitialUnitView(p))
	}))
	defer server.Close()
	dir := t.TempDir()
	input := filepath.Join(dir, "original-initial.bin")
	os.WriteFile(input, wire, 0600)
	o := options{pqRegistrationWire: input, pqGateway: server.URL, pqCollectProof: true, output: filepath.Join(dir, "birth.json"), timeout: 5 * time.Second}
	if e = execute(o); e != nil {
		t.Fatal(e)
	}
	var r pqWholeCaseReport
	b, e := os.ReadFile(o.output)
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(b, &r); e != nil {
		t.Fatal(e)
	}
	if !r.RegistrationObserved || r.RegistrationFinalized || r.EffectiveBusinessIncludedObserved != 0 || r.EffectiveBusinessFinalized != 0 || r.IndependentFinalityVerified || r.SustainedTPSQualified || r.ProofCollectionStatus != "collected_unverified" || r.ProofEvidencePath == "" || posts.Load() != 1 || proofGets.Load() != 1 {
		t.Fatal("birth collector became transfer/finality/funding", r)
	}
	o.pqReadbackOnly = true
	o.output = filepath.Join(dir, "birth-recovery.json")
	if e = execute(o); e != nil || posts.Load() != 1 || proofGets.Load() != 2 {
		t.Fatal("birth proof recovery replayed original", e)
	}
	// Wrong independent proof height cannot turn a committed birth observation
	// into finality. Preserve the original response and retain zero business.
	view.ExecutionHeight++
	o.output = filepath.Join(dir, "wrong-height.json")
	if execute(o) == nil {
		t.Fatal("wrong birth proof height accepted")
	}
}
