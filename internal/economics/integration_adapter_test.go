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
	return economicState, stakingState
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
