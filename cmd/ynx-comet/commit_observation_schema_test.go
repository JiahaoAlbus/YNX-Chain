package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestOperatorCommitObservationSchemaFixture(t *testing.T) {
	empty := operatorCommitObservationResult{Version: operatorCommitObservationVersion, Scope: operatorWireObservationScope,
		ProcessID: os.Getpid(), ChainID: fmt.Sprintf("ynx_%d-1", consensus.PQLabNativeChainID), OriginalGenesisHash: strings.Repeat("a", 64),
		CaptureBoundary: "PUBLIC TEST FIXTURE ONLY; no runtime/authority/qualification evidence", MaxSamples: operatorCommitObservationMaxSamples,
		Samples: []operatorCommitSample{}, RejectedNotifications: map[string]uint64{},
		Coverage: operatorCommitCoverage{PrePersistenceFailuresHaveNoTiming: true, UnreportedStagesAreUnknown: true, ObservedHeightGaps: []operatorCommitGap{}}}
	gap := empty
	gap.Samples = []operatorCommitSample{{Height: 9, AppHash: strings.Repeat("b", 64), Persistence: consensus.CommitTimingSample{
		Height: 9, Storage: "atomic-json", Durable: true, ElapsedNs: 100, PayloadBytes: 42, StagesNs: map[string]int64{"validate": 15, "json_encode": 20, "file_sync": 30}}}}
	gap.SuccessNotifications = 3
	gap.DroppedSuccessSamples = 2
	gap.SampleOverflow = true
	gap.UnobservedLatest = &operatorCommitSample{Height: 11, AppHash: strings.Repeat("c", 64), Persistence: gap.Samples[0].Persistence}
	gap.UnobservedLatest.Persistence.Height = 11
	gap.Coverage.ObservedHeightGaps = []operatorCommitGap{{AfterHeight: 9, BeforeHeight: 11}}
	missing := empty
	missing.ErrorNotifications = 1
	missing.LastFailure = &operatorCommitFailure{CommittedCheckpoint: &operatorCommitPoint{Height: 8, AppHash: strings.Repeat("d", 64)}, NotificationObserved: true}
	fixture := struct {
		Classification     string                                     `json:"classification"`
		NotRuntimeEvidence bool                                       `json:"notRuntimeEvidence"`
		Cases              map[string]operatorCommitObservationResult `json:"cases"`
	}{"PUBLIC_TEST_FIXTURE", true, map[string]operatorCommitObservationResult{"empty": empty, "gap-and-overflow": gap, "missing-failure-timing": missing}}
	raw, err := json.MarshalIndent(fixture, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"attemptAppHash": null`)) || !bytes.Contains(raw, []byte(`"timing": null`)) || !bytes.Contains(raw, []byte(`"observedHeightGaps": []`)) {
		t.Fatal("schema lost explicit unknown/null or empty-array representation")
	}
	var decoded map[string]interface{}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["notRuntimeEvidence"] != true {
		t.Fatal("fixture cannot claim runtime evidence")
	}
	if path := os.Getenv("YNX_COMMIT_OBSERVATION_SCHEMA_FIXTURE"); path != "" {
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			t.Fatal(err)
		}
		n, e1 := f.Write(append(raw, '\n'))
		e2 := f.Sync()
		e3 := f.Close()
		if n != len(raw)+1 || e1 != nil || e2 != nil || e3 != nil {
			t.Fatal("fixture exclusive write failed", e1, e2, e3)
		}
	}
}
