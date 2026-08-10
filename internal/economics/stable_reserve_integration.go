package economics

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/stablereserve"
)

const StableReserveAttestedEventType = "ynx.stable.reserve_attested.v1"

type StableReserveEvent struct {
	Version    int                    `json:"version"`
	Type       string                 `json:"type"`
	ID         string                 `json:"id"`
	Source     string                 `json:"source"`
	OccurredAt time.Time              `json:"occurredAt"`
	Snapshot   stablereserve.Snapshot `json:"snapshot"`
	AuditHash  string                 `json:"auditHash"`
}

type StableReserveIntegration struct {
	SchemaVersion   int                          `json:"schemaVersion"`
	ContractID      string                       `json:"contractId"`
	SourceCommit    string                       `json:"sourceCommit"`
	Envelope        EconomicsIntegrationEnvelope `json:"envelope"`
	Explorer        EconomicsExplorerProjection  `json:"explorer"`
	Monitor         []EconomicsMonitorCheck      `json:"monitor"`
	ReleaseStates   IntegrationReleaseStates     `json:"releaseStates"`
	IntegrationHash string                       `json:"integrationHash"`
}

func BuildStableReserveIntegration(sourceCommit string, verifier stablereserve.Verifier, attestation stablereserve.Attestation) (StableReserveIntegration, error) {
	if !validIntegrationSourceCommit(sourceCommit) {
		return StableReserveIntegration{}, runtimeError(CodeIntegrationInvalidBundle, "stable reserve source commit is invalid")
	}
	snapshot, err := verifier.Verify(attestation)
	if err != nil {
		return StableReserveIntegration{}, err
	}
	if snapshot.ReserveUnits > math.MaxInt64 || snapshot.ReportedSupplyUnits > math.MaxInt64 ||
		snapshot.PendingRedemptionUnits > math.MaxInt64 || snapshot.RequiredBackingUnits > math.MaxInt64 ||
		snapshot.ExcessReserveUnits > math.MaxInt64 || snapshot.ShortfallUnits > math.MaxInt64 ||
		snapshot.CoverageBPS > math.MaxInt64 {
		return StableReserveIntegration{}, runtimeError(CodeIntegrationInvalidProjection, "stable reserve values exceed Explorer signed integer bounds")
	}
	occurredAt, _ := time.Parse(time.RFC3339Nano, snapshot.AsOf)
	event := StableReserveEvent{
		Version: 1, Type: StableReserveAttestedEventType,
		Source: snapshot.Source, OccurredAt: occurredAt.UTC(), Snapshot: snapshot,
	}
	event.ID = stableReserveEventID(event)
	event.AuditHash = stableReserveEventHash(event)
	envelope, err := newIntegrationEnvelope(
		event.Type, event.Version, event.ID, event.Source, sourceCommit, event.AuditHash,
		event.OccurredAt, event.OccurredAt.UnixNano(), "stable-reserve:"+snapshot.Asset, event,
	)
	if err != nil {
		return StableReserveIntegration{}, err
	}
	projection := EconomicsExplorerProjection{
		SchemaVersion: EconomicsIntegrationSchemaVersion, ContractID: EconomicsIntegrationContractID,
		SourceCommit: sourceCommit, SourceEventID: event.ID, EventType: event.Type, EventVersion: event.Version,
		OccurredAt: event.OccurredAt, Source: event.Source, AuthorityOwner: "17 Economics", Candidate: true,
		Metrics: map[string]int64{
			"reserveUnits": int64(snapshot.ReserveUnits), "reportedSupplyUnits": int64(snapshot.ReportedSupplyUnits),
			"pendingRedemptionUnits": int64(snapshot.PendingRedemptionUnits), "requiredBackingUnits": int64(snapshot.RequiredBackingUnits),
			"excessReserveUnits": int64(snapshot.ExcessReserveUnits), "shortfallUnits": int64(snapshot.ShortfallUnits),
			"coverageBps": int64(snapshot.CoverageBPS),
		},
		Labels: map[string]string{
			"asset": snapshot.Asset, "network": snapshot.Network, "provider": snapshot.Provider,
			"custodian": snapshot.Custodian, "status": snapshot.ExplorerStatus,
			"externalReserveAttested": "true", "testnetOnly": "true", "realityValue": "false",
			"productionReady": "false", "evidenceHash": snapshot.EvidenceHash, "payloadHash": snapshot.PayloadHash,
		},
		ReleaseStates: LocalCandidateIntegrationReleaseStates(),
	}
	projection.ID = economicsExplorerProjectionID(projection)
	projection.AuditHash = economicsExplorerProjectionHash(projection)
	if err := ValidateEconomicsExplorerProjection(projection); err != nil {
		return StableReserveIntegration{}, err
	}
	checks := make([]EconomicsMonitorCheck, 0, 3)
	for _, spec := range []struct{ name, status, severity, observed, expected string }{
		{"stable_reserve_attestation_signature", "pass", "critical", snapshot.PayloadHash, "provider signature verifies against the configured key and asset/network binding"},
		{"stable_reserve_attestation_freshness", "pass", "critical", "asOf=" + snapshot.AsOf + " expiresAt=" + snapshot.ExpiresAt, "attestation is fresh and unexpired"},
		{"stable_reserve_coverage", map[bool]string{true: "pass", false: "fail"}[snapshot.Solvent], "critical", fmt.Sprintf("reserve=%d required=%d coverageBps=%d", snapshot.ReserveUnits, snapshot.RequiredBackingUnits, snapshot.CoverageBPS), "reserve covers reported supply plus pending redemptions at or above 10000 bps"},
	} {
		check, checkErr := newMonitorCheck(sourceCommit, event.ID, spec.name, spec.status, spec.severity, spec.observed, spec.expected, event.OccurredAt)
		if checkErr != nil {
			return StableReserveIntegration{}, checkErr
		}
		checks = append(checks, check)
	}
	result := StableReserveIntegration{
		SchemaVersion: EconomicsIntegrationSchemaVersion, ContractID: EconomicsIntegrationContractID,
		SourceCommit: sourceCommit, Envelope: envelope, Explorer: projection, Monitor: checks,
		ReleaseStates: LocalCandidateIntegrationReleaseStates(),
	}
	result.IntegrationHash = stableReserveIntegrationHash(result)
	if err := ValidateStableReserveIntegration(result); err != nil {
		return StableReserveIntegration{}, err
	}
	return result, nil
}

func ValidateStableReserveIntegration(input StableReserveIntegration) error {
	if input.SchemaVersion != EconomicsIntegrationSchemaVersion || input.ContractID != EconomicsIntegrationContractID ||
		!validIntegrationSourceCommit(input.SourceCommit) || input.ReleaseStates != LocalCandidateIntegrationReleaseStates() ||
		input.Envelope.SourceCommit != input.SourceCommit || input.Explorer.SourceCommit != input.SourceCommit ||
		input.Explorer.SourceEventID != input.Envelope.EventID || len(input.Monitor) != 3 ||
		input.IntegrationHash != stableReserveIntegrationHash(input) {
		return runtimeError(CodeIntegrationInvalidBundle, "stable reserve integration metadata or hash is invalid")
	}
	if err := ValidateEconomicsIntegrationEnvelope(input.Envelope); err != nil {
		return err
	}
	if err := ValidateEconomicsExplorerProjection(input.Explorer); err != nil {
		return err
	}
	if err := validateProjectionAgainstEnvelope(input.Explorer, input.Envelope); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, check := range input.Monitor {
		if err := ValidateEconomicsMonitorCheck(check); err != nil {
			return err
		}
		if check.SourceCommit != input.SourceCommit || check.SourceEventID != input.Envelope.EventID || seen[check.Check] {
			return runtimeError(CodeIntegrationInvalidMonitor, "stable reserve monitor mapping is invalid")
		}
		seen[check.Check] = true
	}
	for _, required := range []string{"stable_reserve_attestation_signature", "stable_reserve_attestation_freshness", "stable_reserve_coverage"} {
		if !seen[required] {
			return runtimeError(CodeIntegrationInvalidMonitor, "stable reserve monitor mapping is incomplete")
		}
	}
	return nil
}

func validateStableReserveEvent(event StableReserveEvent) error {
	if event.Version != 1 || event.Type != StableReserveAttestedEventType || event.Source != "provider-signed-testnet-reserve-attestation" ||
		strings.TrimSpace(event.ID) == "" || event.OccurredAt.IsZero() || event.ID != stableReserveEventID(event) ||
		event.AuditHash != stableReserveEventHash(event) {
		return runtimeError(CodeIntegrationInvalidEnvelope, "stable reserve event identity or audit hash is invalid")
	}
	if err := stablereserve.ValidateSnapshot(event.Snapshot); err != nil {
		return runtimeError(CodeIntegrationInvalidEnvelope, err.Error())
	}
	asOf, _ := time.Parse(time.RFC3339Nano, event.Snapshot.AsOf)
	if !event.OccurredAt.Equal(asOf.UTC()) {
		return runtimeError(CodeIntegrationInvalidEnvelope, "stable reserve event time does not match snapshot")
	}
	return nil
}

func stableReserveEventID(event StableReserveEvent) string {
	event.ID, event.AuditHash = "", ""
	return "stable_" + strings.TrimPrefix(integrationCanonicalHash("YNX_STABLE_RESERVE_EVENT_ID_V1", event), "sha256:")[:24]
}

func stableReserveEventHash(event StableReserveEvent) string {
	event.AuditHash = ""
	return integrationCanonicalHash("YNX_STABLE_RESERVE_EVENT_V1", event)
}

func stableReserveIntegrationHash(input StableReserveIntegration) string {
	input.IntegrationHash = ""
	return integrationCanonicalHash("YNX_STABLE_RESERVE_INTEGRATION_V1", input)
}

func decodeStableReserveEvent(payload json.RawMessage) (StableReserveEvent, error) {
	var event StableReserveEvent
	if err := json.Unmarshal(payload, &event); err != nil {
		return StableReserveEvent{}, err
	}
	return event, validateStableReserveEvent(event)
}
