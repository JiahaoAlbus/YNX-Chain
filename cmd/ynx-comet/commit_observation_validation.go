package main

import "github.com/JiahaoAlbus/YNX-Chain/internal/consensus"

// This is a bounded projection of the original validator's named intervals,
// not a second validator or an extension of CommitTimingSample's JSON shape.
// validate_child_* intervals are INSIDE validate; the two hash children are
// also inside validate_child_app_hash. Never sum these with their parents.
// Unselected phases and unavailable/zero hash probes remain absent/UNKNOWN.
// Presence is not validity, durability, signer fsync or independent finality.
const operatorCommitValidationPrefix = "validate_child_"

var operatorCommitValidationPhases = [...]string{
	"anchor", "validator_registry", "engine_schedule", "engine_snapshot", "pq_state",
	"migration_trace_lots", "legacy_sponsor", "legacy_resource_market", "legacy_contracts",
	"legacy_pay", "legacy_ai", "legacy_trust", "ledger_records", "pay", "resource",
	"resource_sponsor", "trust", "ide", "pq_resources", "pq_dex", "pq_contracts",
	"pq_native_actions", "pq_ethereum", "pq_ordered_resources", "fee_events", "governance",
	"dex", "asset_auth", "account_abstraction", "account_abstraction_policy",
	"ownership_and_vault_supply", "staking", "supply", "app_hash",
}

// At most eighteen directly measured phases plus two hash children are added.
// All original persistence entries remain unchanged and the original 32-entry
// bound still applies. A future producer cannot silently truncate or overwrite.
func selectedCommitValidationPhase(phase string) bool {
	switch phase {
	case "anchor", "validator_registry", "engine_schedule", "engine_snapshot", "pq_state",
		"migration_trace_lots", "ledger_records", "pq_resources", "pq_dex", "pq_contracts",
		"pq_native_actions", "pq_ethereum", "pq_ordered_resources", "fee_events",
		"account_abstraction", "account_abstraction_policy", "ownership_and_vault_supply", "app_hash":
		return true
	default:
		return false
	}
}

func projectCommitValidationTiming(outer consensus.CommitTimingSample, detail consensus.CommitValidationTimingSample, available bool) (consensus.CommitTimingSample, string) {
	if !available {
		return outer, "" // Existing streams and genuinely unobserved stages stay exact.
	}
	bad := func() (consensus.CommitTimingSample, string) { return outer, "validation-timing-malformed" }
	if !validObservedCommitTiming(outer) || detail.Height != outer.Height || detail.ElapsedNs < 0 || detail.ElapsedNs > outer.ElapsedNs || len(detail.PhaseNs) == 0 || len(detail.PhaseNs) > len(operatorCommitValidationPhases) {
		return bad()
	}
	if detail.Valid {
		parent, ok := outer.StagesNs["validate"]
		if !ok || detail.FailedPhase != "" || len(detail.PhaseNs) != len(operatorCommitValidationPhases) || detail.ElapsedNs > parent {
			return bad()
		}
	} else if outer.Durable || detail.FailedPhase != operatorCommitValidationPhases[len(detail.PhaseNs)-1] {
		return bad()
	}
	var total int64
	for _, phase := range operatorCommitValidationPhases[:len(detail.PhaseNs)] {
		ns, ok := detail.PhaseNs[phase]
		if !ok || ns < 0 || ns > detail.ElapsedNs-total {
			return bad()
		}
		total += ns
	}
	if total != detail.ElapsedNs || detail.HashDocumentNs < 0 || detail.HashEncodeDigestNs < 0 {
		return bad()
	}
	hashNs := detail.PhaseNs["app_hash"]
	if detail.HashDocumentNs > hashNs || detail.HashEncodeDigestNs > hashNs-detail.HashDocumentNs {
		return bad()
	}
	added := make(map[string]int64, 20)
	for phase, ns := range detail.PhaseNs {
		if selectedCommitValidationPhase(phase) {
			added[operatorCommitValidationPrefix+phase] = ns
		}
	}
	// The owned API has no sampled bit for these two scalar probes. Zero can
	// mean the unchanged-genesis shortcut, so it must not become measured zero.
	if detail.HashDocumentNs > 0 {
		added[operatorCommitValidationPrefix+"hash_document"] = detail.HashDocumentNs
	}
	if detail.HashEncodeDigestNs > 0 {
		added[operatorCommitValidationPrefix+"hash_encode_digest"] = detail.HashEncodeDigestNs
	}
	if len(outer.StagesNs)+len(added) > 32 {
		return outer, "validation-timing-projection-bound"
	}
	for name := range added {
		if _, exists := outer.StagesNs[name]; exists {
			return outer, "validation-timing-stage-collision"
		}
	}
	projected := outer
	projected.StagesNs = make(map[string]int64, len(outer.StagesNs)+len(added))
	for name, ns := range outer.StagesNs {
		projected.StagesNs[name] = ns
	}
	for name, ns := range added {
		projected.StagesNs[name] = ns
	}
	return projected, ""
}

// Fence the private detail with the SAME original outer attempt. No caller or
// logger can supply these metrics, and a changing attempt cannot be combined.
func observedCommitAttempt(app *consensus.Application) (consensus.CommitTimingSample, bool, string) {
	first, ok := app.LastCommitTiming()
	if !ok {
		return first, false, ""
	}
	if !validObservedCommitTiming(first) {
		return first, true, "timing-malformed"
	}
	detail, available := app.LastCommitValidationTiming()
	second, ok := app.LastCommitTiming()
	if !ok || !equalCommitTiming(first, second) {
		return first, true, "attempt-changed-during-capture"
	}
	projected, reason := projectCommitValidationTiming(first, detail, available)
	return projected, true, reason
}
