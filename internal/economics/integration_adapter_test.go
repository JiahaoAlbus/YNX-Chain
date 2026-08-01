package economics

import (
	"encoding/json"
	"os"
	"testing"
)

const integrationFixtureSourceCommit = "48c9a160e3594f8bfd50cd78eec35e979e9b453a"

func TestEconomicsIntegrationBundleDeterministicAndReconciled(t *testing.T) {
	economicState, stakingState := integrationRuntimeFixture(t)
	first, err := BuildEconomicsIntegrationBundle(integrationFixtureSourceCommit, economicState, stakingState)
	if err != nil {
		t.Fatal(err)
	}
	second, err := BuildEconomicsIntegrationBundle(integrationFixtureSourceCommit, economicState, stakingState)
	if err != nil {
		t.Fatal(err)
	}
	if first.BundleHash != second.BundleHash {
		t.Fatalf("integration bundle replay changed hash: first=%s second=%s", first.BundleHash, second.BundleHash)
	}
	if len(first.Envelopes) != 5 || len(first.BillingLedger) != 18 || len(first.Explorer) != 5 || len(first.Monitor) != 15 {
		t.Fatalf("unexpected integration bundle cardinality: envelopes=%d ledger=%d explorer=%d monitor=%d", len(first.Envelopes), len(first.BillingLedger), len(first.Explorer), len(first.Monitor))
	}
	if first.ReleaseStates != LocalCandidateIntegrationReleaseStates() || first.ReleaseStates.IntegratedCentral || first.ReleaseStates.DeployedStaging || first.ReleaseStates.DeployedPublic || first.ReleaseStates.ProductionSigned {
		t.Fatalf("integration bundle promoted unsupported release states: %+v", first.ReleaseStates)
	}
	if err := ValidateEconomicsIntegrationBundle(first); err != nil {
		t.Fatal(err)
	}

	ledgerByEvent := map[string][]EconomicsBillingLedgerEntry{}
	for _, entry := range first.BillingLedger {
		ledgerByEvent[entry.SourceEventID] = append(ledgerByEvent[entry.SourceEventID], entry)
		if entry.InternalTransfer || entry.TestSubsidy || (entry.Burn && entry.RevenueRecognition) {
			t.Fatalf("ledger entry crossed a prohibited accounting boundary: %+v", entry)
		}
		if entry.Burn && entry.RecipientClass != "supply" {
			t.Fatalf("burn entry used a revenue recipient: %+v", entry)
		}
	}
	for _, event := range economicState.EconomicEvents {
		entries := ledgerByEvent[event.ID]
		if len(entries) != 6 {
			t.Fatalf("event %s has %d ledger components", event.ID, len(entries))
		}
		var gross, burn, revenue int64
		for _, entry := range entries {
			gross += entry.AmountYNXT
			if entry.Burn {
				burn += entry.AmountYNXT
			}
			if entry.RevenueRecognition {
				revenue += entry.AmountYNXT
			}
		}
		if gross != event.FeeAccounting.GrossFeeYNXT || burn != event.FeeAccounting.BurnYNXT() || revenue != event.FeeAccounting.RevenueYNXT() {
			t.Fatalf("event %s ledger did not reconcile: gross=%d burn=%d revenue=%d event=%+v", event.ID, gross, burn, revenue, event.FeeAccounting)
		}
	}
	for _, projection := range first.Explorer {
		if !projection.Candidate || projection.SharedTestnet || projection.PublicDeployment || projection.ReleaseStates.IntegratedCentral {
			t.Fatalf("Explorer projection made an unsupported activation claim: %+v", projection)
		}
	}
	for _, check := range first.Monitor {
		if check.Status != "pass" || check.SharedTestnet {
			t.Fatalf("monitor output made an unsupported status claim: %+v", check)
		}
	}
}

func TestEconomicsIntegrationBundleIncludesSafetyModuleCanonicalConsumers(t *testing.T) {
	economicState, stakingState, safetyState := integrationRuntimeFixtureWithSafety(t)
	first, err := BuildEconomicsIntegrationBundleWithSafety(integrationFixtureSourceCommit, economicState, stakingState, &safetyState)
	if err != nil {
		t.Fatal(err)
	}
	second, err := BuildEconomicsIntegrationBundleWithSafety(integrationFixtureSourceCommit, economicState, stakingState, &safetyState)
	if err != nil {
		t.Fatal(err)
	}
	if first.BundleHash != second.BundleHash {
		t.Fatalf("Safety Module integration replay changed hash: first=%s second=%s", first.BundleHash, second.BundleHash)
	}
	if first.SafetyStateHash != safetyState.StateHash {
		t.Fatalf("Safety Module state hash mismatch: got=%s want=%s", first.SafetyStateHash, safetyState.StateHash)
	}
	if len(first.Envelopes) != 5+len(safetyState.Events) || len(first.Explorer) != len(first.Envelopes) || len(first.Monitor) <= 15 {
		t.Fatalf("unexpected Safety Module integration cardinality: events=%d envelopes=%d explorer=%d monitor=%d", len(safetyState.Events), len(first.Envelopes), len(first.Explorer), len(first.Monitor))
	}
	safetyEnvelopes := 0
	monitorByEvent := map[string]int{}
	for _, check := range first.Monitor {
		monitorByEvent[check.SourceEventID]++
	}
	for _, envelope := range first.Envelopes {
		if !safetyIntegrationEventTypeAllowed(envelope.EventType) {
			continue
		}
		safetyEnvelopes++
		var event SafetyModuleRuntimeEvent
		if err := json.Unmarshal(envelope.Payload, &event); err != nil {
			t.Fatal(err)
		}
		if event.ExternalTransferExecuted || envelope.SharedTestnet || envelope.PublicDeployment || envelope.Production {
			t.Fatalf("Safety Module integration overclaimed execution or release state: envelope=%+v event=%+v", envelope, event)
		}
		if monitorByEvent[event.ID] < 1 {
			t.Fatalf("Safety Module event %s has no monitor checks", event.ID)
		}
	}
	if safetyEnvelopes != len(safetyState.Events) {
		t.Fatalf("wrapped %d of %d Safety Module events", safetyEnvelopes, len(safetyState.Events))
	}
	if err := ValidateEconomicsIntegrationBundle(first); err != nil {
		t.Fatal(err)
	}
}

func TestEconomicsIntegrationBundleRejectsRehashedSafetyPayloadTampering(t *testing.T) {
	economicState, stakingState, safetyState := integrationRuntimeFixtureWithSafety(t)
	bundle, err := BuildEconomicsIntegrationBundleWithSafety(integrationFixtureSourceCommit, economicState, stakingState, &safetyState)
	if err != nil {
		t.Fatal(err)
	}
	tampered := cloneIntegrationBundle(t, bundle)
	index := -1
	for candidate := range tampered.Envelopes {
		if safetyIntegrationEventTypeAllowed(tampered.Envelopes[candidate].EventType) {
			index = candidate
			break
		}
	}
	if index < 0 {
		t.Fatal("Safety Module event missing from integration fixture")
	}
	var event SafetyModuleRuntimeEvent
	if err := json.Unmarshal(tampered.Envelopes[index].Payload, &event); err != nil {
		t.Fatal(err)
	}
	event.AmountYNXT++
	event.ID = safetyRuntimeEventID(event)
	event.AuditHash = safetyRuntimeEventAuditHash(event)
	tampered.Envelopes[index].EventID = event.ID
	tampered.Envelopes[index].Payload = mustJSON(t, event)
	tampered.Envelopes[index].SourceEventAuditHash = event.AuditHash
	tampered.Envelopes[index].PayloadHash = integrationPayloadHash(tampered.Envelopes[index].Payload)
	tampered.Envelopes[index].AuditHash = economicsIntegrationEnvelopeHash(tampered.Envelopes[index])
	tampered.BundleHash = economicsIntegrationBundleHash(tampered)
	assertRuntimeErrorCode(t, ValidateEconomicsIntegrationBundle(tampered), CodeIntegrationInvalidProjection)
}

func TestEconomicsIntegrationBundleRejectsRehashedSafetySemanticConflict(t *testing.T) {
	economicState, stakingState, safetyState := integrationRuntimeFixtureWithSafety(t)
	bundle, err := BuildEconomicsIntegrationBundleWithSafety(integrationFixtureSourceCommit, economicState, stakingState, &safetyState)
	if err != nil {
		t.Fatal(err)
	}
	tampered := cloneIntegrationBundle(t, bundle)
	index := -1
	for candidate := range tampered.Envelopes {
		if tampered.Envelopes[candidate].EventType == "ynx.safety.stake_registered.v1" {
			index = candidate
			break
		}
	}
	if index < 0 {
		t.Fatal("Safety Module stake registration event missing from integration fixture")
	}
	var event SafetyModuleRuntimeEvent
	if err := json.Unmarshal(tampered.Envelopes[index].Payload, &event); err != nil {
		t.Fatal(err)
	}
	event.Threshold = 1
	event.VerifiedSignatures = 1
	event.ID = safetyRuntimeEventID(event)
	event.AuditHash = safetyRuntimeEventAuditHash(event)
	tampered.Envelopes[index].EventID = event.ID
	tampered.Envelopes[index].Payload = mustJSON(t, event)
	tampered.Envelopes[index].SourceEventAuditHash = event.AuditHash
	tampered.Envelopes[index].PayloadHash = integrationPayloadHash(tampered.Envelopes[index].Payload)
	tampered.Envelopes[index].AuditHash = economicsIntegrationEnvelopeHash(tampered.Envelopes[index])
	tampered.BundleHash = economicsIntegrationBundleHash(tampered)
	assertRuntimeErrorCode(t, ValidateEconomicsIntegrationBundle(tampered), CodeIntegrationInvalidEnvelope)
}

func TestEconomicsIntegrationBundleRejectsInvalidSafetyStateHash(t *testing.T) {
	economicState, stakingState, safetyState := integrationRuntimeFixtureWithSafety(t)
	bundle, err := BuildEconomicsIntegrationBundleWithSafety(integrationFixtureSourceCommit, economicState, stakingState, &safetyState)
	if err != nil {
		t.Fatal(err)
	}
	bundle.SafetyStateHash = "sha256:00"
	bundle.BundleHash = economicsIntegrationBundleHash(bundle)
	assertRuntimeErrorCode(t, ValidateEconomicsIntegrationBundle(bundle), CodeIntegrationInvalidBundle)
}

func TestEconomicsIntegrationBundleRejectsRehashedLedgerTampering(t *testing.T) {
	bundle := integrationBundleFixture(t)
	tampered := cloneIntegrationBundle(t, bundle)
	tampered.BillingLedger[0].AmountYNXT++
	tampered.BillingLedger[0].ID = economicsBillingEntryID(tampered.BillingLedger[0])
	tampered.BillingLedger[0].AuditHash = economicsBillingEntryHash(tampered.BillingLedger[0])
	tampered.BundleHash = economicsIntegrationBundleHash(tampered)
	assertRuntimeErrorCode(t, ValidateEconomicsIntegrationBundle(tampered), CodeIntegrationInvalidLedger)
}

func TestEconomicsIntegrationBundleRejectsRehashedSourcePayloadTampering(t *testing.T) {
	bundle := integrationBundleFixture(t)
	tampered := cloneIntegrationBundle(t, bundle)
	var event CanonicalEconomicEvent
	if err := json.Unmarshal(tampered.Envelopes[0].Payload, &event); err != nil {
		t.Fatal(err)
	}
	event.ClosingSupplyYNXT++
	tampered.Envelopes[0].Payload = mustJSON(t, event)
	tampered.Envelopes[0].PayloadHash = integrationPayloadHash(tampered.Envelopes[0].Payload)
	tampered.Envelopes[0].AuditHash = economicsIntegrationEnvelopeHash(tampered.Envelopes[0])
	tampered.BundleHash = economicsIntegrationBundleHash(tampered)
	assertRuntimeErrorCode(t, ValidateEconomicsIntegrationBundle(tampered), CodeIntegrationInvalidEnvelope)
}

func TestEconomicsIntegrationBundleRejectsRehashedProjectionTampering(t *testing.T) {
	bundle := integrationBundleFixture(t)
	tampered := cloneIntegrationBundle(t, bundle)
	tampered.Explorer[0].Metrics["closingSupplyYnxt"]++
	tampered.Explorer[0].ID = economicsExplorerProjectionID(tampered.Explorer[0])
	tampered.Explorer[0].AuditHash = economicsExplorerProjectionHash(tampered.Explorer[0])
	tampered.BundleHash = economicsIntegrationBundleHash(tampered)
	assertRuntimeErrorCode(t, ValidateEconomicsIntegrationBundle(tampered), CodeIntegrationInvalidProjection)
}

func TestEconomicsIntegrationBundleRejectsReleasePromotionWithoutEvidence(t *testing.T) {
	bundle := integrationBundleFixture(t)
	tampered := cloneIntegrationBundle(t, bundle)
	tampered.ReleaseStates.IntegratedCentral = true
	tampered.BundleHash = economicsIntegrationBundleHash(tampered)
	assertRuntimeErrorCode(t, ValidateEconomicsIntegrationBundle(tampered), CodeIntegrationInvalidBundle)
}

func TestEconomicsIntegrationBundleRejectsInvalidSourceCommit(t *testing.T) {
	economicState, stakingState := integrationRuntimeFixture(t)
	_, err := BuildEconomicsIntegrationBundle("not-a-source-commit", economicState, stakingState)
	assertRuntimeErrorCode(t, err, CodeIntegrationInvalidBundle)
}

func integrationBundleFixture(t *testing.T) EconomicsIntegrationBundle {
	t.Helper()
	economicState, stakingState := integrationRuntimeFixture(t)
	bundle, err := BuildEconomicsIntegrationBundle(integrationFixtureSourceCommit, economicState, stakingState)
	if err != nil {
		t.Fatal(err)
	}
	return bundle
}

func integrationRuntimeFixture(t *testing.T) (EconomicRuntimeState, StakingRiskState) {
	t.Helper()
	economicState, stakingState, _ := integrationRuntimeFixtureWithSafety(t)
	return economicState, stakingState
}

func integrationRuntimeFixtureWithSafety(t *testing.T) (EconomicRuntimeState, StakingRiskState, SafetyModuleRuntimeState) {
	t.Helper()
	var economicInput RuntimeReplayInput
	readIntegrationFixture(t, "../../economics/examples/runtime-replay.json", &economicInput)
	economicState, err := ReplayEconomicRuntime(economicInput)
	if err != nil {
		t.Fatal(err)
	}
	var stakingInput StakingRiskReplayInput
	readIntegrationFixture(t, "../../economics/examples/staking-risk-runtime-replay.json", &stakingInput)
	stakingState, err := ReplayStakingRiskRuntime(stakingInput)
	if err != nil {
		t.Fatal(err)
	}
	var safetyInput SafetyModuleRuntimeReplayInput
	readIntegrationFixture(t, "../../economics/examples/safety-module-runtime-replay.json", &safetyInput)
	safetyState, err := ReplaySafetyModuleRuntime(safetyInput)
	if err != nil {
		t.Fatal(err)
	}
	return economicState, stakingState, safetyState
}

func readIntegrationFixture(t *testing.T, path string, output any) {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(payload, output); err != nil {
		t.Fatal(err)
	}
}

func cloneIntegrationBundle(t *testing.T, input EconomicsIntegrationBundle) EconomicsIntegrationBundle {
	t.Helper()
	var cloned EconomicsIntegrationBundle
	payload := mustJSON(t, input)
	if err := json.Unmarshal(payload, &cloned); err != nil {
		t.Fatal(err)
	}
	return cloned
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return payload
}
