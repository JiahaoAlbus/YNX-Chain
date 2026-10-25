package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestPQMemberCaseFirstCommittedObservationSeparatesOriginalGETWait(t *testing.T) {
	wire, registration := pqMemberUnitFixture(t)
	p, e := preparePQMemberCase(wire)
	if e != nil {
		t.Fatal(e)
	}
	const getWait = 20 * time.Millisecond
	var posts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts.Add(1)
			if verifyPQMemberUnit(wire, registration) != nil {
				t.Error("canonical signatures failed")
			}
		} else {
			time.Sleep(getWait)
		}
		json.NewEncoder(w).Encode(pqMemberUnitView(p))
	}))
	defer server.Close()
	r := runPQWholeCase(context.Background(), server.Client(), p, server.URL, false)
	if r.Status != "committed_observed" || r.ReadbackOnly || r.FirstCommittedRPCObservationSource != "post_response" || r.SubmissionToFirstCommittedRPCObservationNs == nil || *r.SubmissionToFirstCommittedRPCObservationNs <= 0 || r.FirstCommittedRPCHeight != 7 || r.FirstCommittedRPCIndex == nil || *r.FirstCommittedRPCIndex != 0 || posts.Load() != 1 {
		t.Fatal("first validated POST was lost", r)
	}
	if r.ObservationElapsedNs-*r.SubmissionToFirstCommittedRPCObservationNs < int64(getWait) {
		t.Fatal("original GET wait inflated first committed observation", r)
	}
	if r.IndependentFinalityVerified || r.ActualOfferToFinalityMeasured || r.SustainedTPSQualified {
		t.Fatal("RPC observation became finality/TPS")
	}
	readonly := runPQWholeCase(context.Background(), server.Client(), p, server.URL, true)
	if !readonly.ReadbackOnly || readonly.SubmissionToFirstCommittedRPCObservationNs != nil || readonly.FirstCommittedRPCObservationSource != "original_get" || posts.Load() != 1 {
		t.Fatal("read-only recovery invented original offer clock or replayed", readonly)
	}
	t.Logf("UNIT_HTTP_ONLY first POST committed observation=%dns full original reconciliation=%dns GET=%dns; no actual inclusion/finality/TPS", *r.SubmissionToFirstCommittedRPCObservationNs, r.ObservationElapsedNs, r.Phases.OriginalReadbackHTTPNs)
}

func TestPQMemberCaseUnknownThenOriginalReadbackAndConflictingCoordinates(t *testing.T) {
	wire, _ := pqMemberUnitFixture(t)
	p, e := preparePQMemberCase(wire)
	if e != nil {
		t.Fatal(e)
	}
	for _, conflict := range []bool{false, true} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodPost && !conflict {
				w.WriteHeader(202)
				json.NewEncoder(w).Encode(bftgateway.PQMemberView{Type: consensus.PQTransferType, Status: "unknown", Source: "comet-rpc", NativeTransactionHash: p.native, ABCITransactionHash: p.outer})
				return
			}
			v := pqMemberUnitView(p)
			if r.Method == http.MethodGet && conflict {
				v.ExecutionHeight++
				v.Transaction.BlockNum = v.ExecutionHeight
			}
			json.NewEncoder(w).Encode(v)
		}))
		r := runPQWholeCase(context.Background(), server.Client(), p, server.URL, false)
		server.Close()
		if conflict {
			if r.Status != "submission_unknown" || r.Error == "" || r.EffectiveBusinessIncludedObserved != 0 || r.FirstCommittedRPCHeight != 7 {
				t.Fatal("conflicting original coordinates became success", r)
			}
		} else {
			if r.Status != "committed_observed" || !r.InitialSubmissionUnknown || r.FirstCommittedRPCObservationSource != "original_get" || r.SubmissionToFirstCommittedRPCObservationNs == nil || r.SubmissionAttempts != 1 {
				t.Fatal("UNKNOWN original readback lost first observation or replayed", r)
			}
		}
	}
}
