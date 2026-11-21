package main

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Fixed numeric projection controls only; these are not measured durations or
// performance evidence. Real recorder/parity/failed persistence assertions reuse
// the original BlockExecutor and failure tests in this package.
func commitValidationProjectionFixture() (consensus.CommitTimingSample, consensus.CommitValidationTimingSample) {
	detail := consensus.CommitValidationTimingSample{Height: 9, Valid: true, PhaseNs: map[string]int64{}, HashDocumentNs: 3, HashEncodeDigestNs: 4}
	for _, phase := range []string{
		"anchor", "validator_registry", "engine_schedule", "engine_snapshot", "pq_state",
		"migration_trace_lots", "legacy_sponsor", "legacy_resource_market", "legacy_contracts",
		"legacy_pay", "legacy_ai", "legacy_trust", "ledger_records", "pay", "resource",
		"resource_sponsor", "trust", "ide", "pq_resources", "pq_dex", "pq_contracts",
		"pq_native_actions", "pq_ethereum", "pq_ordered_resources", "fee_events", "governance",
		"dex", "asset_auth", "account_abstraction", "account_abstraction_policy",
		"ownership_and_vault_supply", "staking", "supply", "app_hash",
	} {
		detail.PhaseNs[phase] = 10
		detail.ElapsedNs += 10
	}
	outer := consensus.CommitTimingSample{Height: 9, Storage: "atomic-json", Durable: true, ElapsedNs: 1000, PayloadBytes: 42,
		StagesNs: map[string]int64{"validate": 350, "json_encode": 40, "delta_encode": 20, "journal_maintenance": 30, "prepare_file": 5,
			"write": 8, "file_sync": 12, "close_file": 3, "rename": 4, "directory_sync": 9, "version_checkpoint": 15}}
	return outer, detail
}

func TestOperatorCommitObservationValidationProjection(t *testing.T) {
	t.Run("closed-shape-and-owned-child-intervals", func(t *testing.T) {
		outer, detail := commitValidationProjectionFixture()
		before, _ := json.Marshal(outer)
		projected, reason := projectCommitValidationTiming(outer, detail, true)
		if reason != "" || !validObservedCommitTiming(projected) || len(projected.StagesNs) != 31 {
			t.Fatal("fixed projection does not fit the original closed bound", reason)
		}
		for name, ns := range outer.StagesNs {
			if projected.StagesNs[name] != ns {
				t.Fatal("original persistence stage changed", name)
			}
		}
		for _, name := range []string{"anchor", "validator_registry", "engine_schedule", "engine_snapshot", "pq_state", "migration_trace_lots", "ledger_records", "pq_resources", "pq_dex", "pq_contracts", "pq_native_actions", "pq_ethereum", "pq_ordered_resources", "fee_events", "account_abstraction", "account_abstraction_policy", "ownership_and_vault_supply", "app_hash"} {
			if got, ok := projected.StagesNs["validate_child_"+name]; !ok || got != detail.PhaseNs[name] {
				t.Fatal("selected original phase absent or changed", name)
			}
		}
		if projected.StagesNs["validate_child_hash_document"] != 3 || projected.StagesNs["validate_child_hash_encode_digest"] != 4 {
			t.Fatal("hash children were not retained as their original intervals")
		}
		if _, ok := projected.StagesNs["validate_child_legacy_pay"]; ok {
			t.Fatal("unselected phase invented")
		}
		raw, err := json.Marshal(projected)
		var fields map[string]json.RawMessage
		if err != nil || json.Unmarshal(raw, &fields) != nil || len(fields) != 6 {
			t.Fatal("original Commit six-field schema changed", err)
		}
		for _, name := range []string{"height", "storage", "durable", "elapsedNs", "payloadBytes", "stagesNs"} {
			if _, ok := fields[name]; !ok {
				t.Fatal("original field absent", name)
			}
		}
		projected.StagesNs["validate"] = 0
		projected.StagesNs["validate_child_pq_state"] = 0
		after, _ := json.Marshal(outer)
		if string(before) != string(after) || detail.PhaseNs["pq_state"] != 10 {
			t.Fatal("projection aliases an owned original sample")
		}
	})
	t.Run("unavailable-and-unsampled-are-not-zero", func(t *testing.T) {
		outer, detail := commitValidationProjectionFixture()
		before, _ := json.Marshal(outer)
		unchanged, reason := projectCommitValidationTiming(outer, consensus.CommitValidationTimingSample{}, false)
		after, _ := json.Marshal(unchanged)
		if reason != "" || string(before) != string(after) {
			t.Fatal("an old stream or missing detail changed")
		}
		detail.HashDocumentNs, detail.HashEncodeDigestNs = 0, 0
		detail.PhaseNs["anchor"] = 0 // map presence is an actual sampled zero
		detail.ElapsedNs -= 10
		projected, reason := projectCommitValidationTiming(outer, detail, true)
		if reason != "" {
			t.Fatal(reason)
		}
		if ns, ok := projected.StagesNs["validate_child_anchor"]; !ok || ns != 0 {
			t.Fatal("present sampled zero was discarded")
		}
		for _, key := range []string{"validate_child_hash_document", "validate_child_hash_encode_digest"} {
			if _, ok := projected.StagesNs[key]; ok {
				t.Fatal("absent scalar probe was manufactured as zero", key)
			}
		}
	})
	t.Run("failed-validation-is-partial-and-not-durable", func(t *testing.T) {
		outer, detail := commitValidationProjectionFixture()
		outer.Durable, outer.PayloadBytes = false, 0
		outer.StagesNs = map[string]int64{}
		detail.Valid, detail.FailedPhase, detail.ElapsedNs = false, "pq_state", 50
		detail.HashDocumentNs, detail.HashEncodeDigestNs = 0, 0
		detail.PhaseNs = map[string]int64{"anchor": 10, "validator_registry": 10, "engine_schedule": 10, "engine_snapshot": 10, "pq_state": 10}
		projected, reason := projectCommitValidationTiming(outer, detail, true)
		if reason != "" || projected.Durable || projected.PayloadBytes != 0 || len(projected.StagesNs) != 5 {
			t.Fatal("partial validation became durable or fabricated later phases", reason)
		}
		if _, ok := projected.StagesNs["validate_child_app_hash"]; ok {
			t.Fatal("failed early validation acquired a later hash interval")
		}
	})
	t.Run("valid-state-with-failed-storage-remains-failed", func(t *testing.T) {
		outer, detail := commitValidationProjectionFixture()
		outer.Durable = false
		projected, reason := projectCommitValidationTiming(outer, detail, true)
		if reason != "" || projected.Durable || projected.ElapsedNs != outer.ElapsedNs {
			t.Fatal("state-validation success promoted failed storage", reason)
		}
	})
	for _, kind := range []string{"wrong-height", "negative", "sum", "non-prefix", "foreign-phase", "missing-valid-phase", "failed-phase", "durable-invalid", "parent", "hash-child", "collision", "bound"} {
		t.Run(kind, func(t *testing.T) {
			outer, detail := commitValidationProjectionFixture()
			switch kind {
			case "wrong-height":
				detail.Height++
			case "negative":
				detail.PhaseNs["pq_state"] = -1
			case "sum":
				detail.ElapsedNs++
			case "non-prefix":
				delete(detail.PhaseNs, "anchor")
				detail.Valid, detail.FailedPhase, outer.Durable = false, "supply", false
			case "foreign-phase":
				delete(detail.PhaseNs, "pq_state")
				detail.PhaseNs["caller_phase"] = 10
			case "missing-valid-phase":
				delete(detail.PhaseNs, "app_hash")
			case "failed-phase":
				detail.FailedPhase = "pq_state"
			case "durable-invalid":
				detail.Valid, detail.FailedPhase = false, "app_hash"
			case "parent":
				outer.StagesNs["validate"] = 1
			case "hash-child":
				detail.HashEncodeDigestNs = 8
			case "collision":
				outer.StagesNs["validate_child_pq_state"] = 1
			case "bound":
				outer.StagesNs["future_original_a"], outer.StagesNs["future_original_b"] = 1, 1
			}
			before, _ := json.Marshal(outer)
			unchanged, reason := projectCommitValidationTiming(outer, detail, true)
			after, _ := json.Marshal(unchanged)
			if !strings.HasPrefix(reason, "validation-timing-") || string(before) != string(after) || !reflect.DeepEqual(outer, unchanged) {
				t.Fatal("invalid/overfull detail was accepted, truncated or overwrote the original", kind, reason)
			}
		})
	}
}
