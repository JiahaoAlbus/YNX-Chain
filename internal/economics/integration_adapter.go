package economics

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	EconomicsIntegrationSchemaVersion = 1
	EconomicsIntegrationContractID    = "ynx.economics.integration.v1"
	IntegrationEvidenceClass          = "local-deterministic-integration"
)

const (
	CodeIntegrationInvalidEnvelope   = "YNX_ECONOMICS_INTEGRATION_INVALID_ENVELOPE"
	CodeIntegrationInvalidLedger     = "YNX_ECONOMICS_INTEGRATION_INVALID_LEDGER"
	CodeIntegrationInvalidProjection = "YNX_ECONOMICS_INTEGRATION_INVALID_PROJECTION"
	CodeIntegrationInvalidMonitor    = "YNX_ECONOMICS_INTEGRATION_INVALID_MONITOR"
	CodeIntegrationInvalidBundle     = "YNX_ECONOMICS_INTEGRATION_INVALID_BUNDLE"
)

const (
	IntegrationFlowBaseFeeBurn = "base_fee_burn"
	IntegrationFlowServiceBurn = "service_burn"
	IntegrationFlowValidator   = "validator_fee"
	IntegrationFlowProvider    = "provider_fee"
	IntegrationFlowProtocol    = "protocol_fee"
	IntegrationFlowTreasury    = "treasury_fee"
)

type IntegrationReleaseStates struct {
	ImplementedLocal  bool `json:"implementedLocal"`
	TestedLocal       bool `json:"testedLocal"`
	InstalledLocal    bool `json:"installedLocal"`
	IntegratedCentral bool `json:"integratedCentral"`
	DeployedStaging   bool `json:"deployedStaging"`
	DeployedPublic    bool `json:"deployedPublic"`
	DownloadHosted    bool `json:"downloadHosted"`
	ProductionSigned  bool `json:"productionSigned"`
	StoreReleased     bool `json:"storeReleased"`
}

func LocalCandidateIntegrationReleaseStates() IntegrationReleaseStates {
	return IntegrationReleaseStates{ImplementedLocal: true, TestedLocal: true}
}

type EconomicsIntegrationEnvelope struct {
	SchemaVersion        int             `json:"schemaVersion"`
	ContractID           string          `json:"contractId"`
	EventType            string          `json:"eventType"`
	EventVersion         int             `json:"eventVersion"`
	EventID              string          `json:"eventId"`
	Source               string          `json:"source"`
	SourceCommit         string          `json:"sourceCommit"`
	SourceEventAuditHash string          `json:"sourceEventAuditHash"`
	OccurredAt           time.Time       `json:"occurredAt"`
	Sequence             int64           `json:"sequence"`
	PartitionKey         string          `json:"partitionKey"`
	AuthorityOwner       string          `json:"authorityOwner"`
	EvidenceClass        string          `json:"evidenceClass"`
	SharedTestnet        bool            `json:"sharedTestnet"`
	PublicDeployment     bool            `json:"publicDeployment"`
	Production           bool            `json:"production"`
	Payload              json.RawMessage `json:"payload"`
	PayloadHash          string          `json:"payloadHash"`
	AuditHash            string          `json:"auditHash"`
}

type EconomicsBillingLedgerEntry struct {
	SchemaVersion      int       `json:"schemaVersion"`
	ID                 string    `json:"id"`
	ContractID         string    `json:"contractId"`
	SourceCommit       string    `json:"sourceCommit"`
	SourceEventID      string    `json:"sourceEventId"`
	SourceEventType    string    `json:"sourceEventType"`
	OccurredAt         time.Time `json:"occurredAt"`
	Asset              string    `json:"asset"`
	AmountYNXT         int64     `json:"amountYnxt"`
	GrossFeeYNXT       int64     `json:"grossFeeYnxt"`
	FlowClass          string    `json:"flowClass"`
	RecipientClass     string    `json:"recipientClass"`
	Burn               bool      `json:"burn"`
	RevenueRecognition bool      `json:"revenueRecognition"`
	InternalTransfer   bool      `json:"internalTransfer"`
	TestSubsidy        bool      `json:"testSubsidy"`
	EvidenceClass      string    `json:"evidenceClass"`
	AuditHash          string    `json:"auditHash"`
}

type EconomicsExplorerProjection struct {
	SchemaVersion    int                      `json:"schemaVersion"`
	ID               string                   `json:"id"`
	ContractID       string                   `json:"contractId"`
	SourceCommit     string                   `json:"sourceCommit"`
	SourceEventID    string                   `json:"sourceEventId"`
	EventType        string                   `json:"eventType"`
	EventVersion     int                      `json:"eventVersion"`
	OccurredAt       time.Time                `json:"occurredAt"`
	Source           string                   `json:"source"`
	AuthorityOwner   string                   `json:"authorityOwner"`
	Candidate        bool                     `json:"candidate"`
	SharedTestnet    bool                     `json:"sharedTestnet"`
	PublicDeployment bool                     `json:"publicDeployment"`
	Metrics          map[string]int64         `json:"metrics"`
	Labels           map[string]string        `json:"labels"`
	ReleaseStates    IntegrationReleaseStates `json:"releaseStates"`
	AuditHash        string                   `json:"auditHash"`
}

type EconomicsMonitorCheck struct {
	SchemaVersion int       `json:"schemaVersion"`
	ID            string    `json:"id"`
	ContractID    string    `json:"contractId"`
	SourceCommit  string    `json:"sourceCommit"`
	SourceEventID string    `json:"sourceEventId"`
	Check         string    `json:"check"`
	Status        string    `json:"status"`
	Severity      string    `json:"severity"`
	Observed      string    `json:"observed"`
	Expected      string    `json:"expected"`
	OccurredAt    time.Time `json:"occurredAt"`
	EvidenceClass string    `json:"evidenceClass"`
	SharedTestnet bool      `json:"sharedTestnet"`
	AuditHash     string    `json:"auditHash"`
}

type EconomicsIntegrationBundle struct {
	SchemaVersion     int                            `json:"schemaVersion"`
	ContractID        string                         `json:"contractId"`
	SourceCommit      string                         `json:"sourceCommit"`
	GeneratedAt       time.Time                      `json:"generatedAt"`
	EvidenceClass     string                         `json:"evidenceClass"`
	EconomicStateHash string                         `json:"economicStateHash"`
	StakingStateHash  string                         `json:"stakingStateHash"`
	SafetyStateHash   string                         `json:"safetyStateHash,omitempty"`
	Envelopes         []EconomicsIntegrationEnvelope `json:"envelopes"`
	BillingLedger     []EconomicsBillingLedgerEntry  `json:"billingLedger"`
	Explorer          []EconomicsExplorerProjection  `json:"explorer"`
	Monitor           []EconomicsMonitorCheck        `json:"monitor"`
	ReleaseStates     IntegrationReleaseStates       `json:"releaseStates"`
	BundleHash        string                         `json:"bundleHash"`
}

func BuildEconomicsIntegrationBundle(sourceCommit string, economicState EconomicRuntimeState, stakingState StakingRiskState) (EconomicsIntegrationBundle, error) {
	return BuildEconomicsIntegrationBundleWithSafety(sourceCommit, economicState, stakingState, nil)
}

func BuildEconomicsIntegrationBundleWithSafety(sourceCommit string, economicState EconomicRuntimeState, stakingState StakingRiskState, safetyState *SafetyModuleRuntimeState) (EconomicsIntegrationBundle, error) {
	if !validIntegrationSourceCommit(sourceCommit) {
		return EconomicsIntegrationBundle{}, runtimeError(CodeIntegrationInvalidBundle, "integration source commit must be a canonical 40-character lowercase git commit")
	}
	if err := ValidateEconomicRuntimeState(economicState); err != nil {
		return EconomicsIntegrationBundle{}, err
	}
	if err := ValidateStakingRiskState(stakingState); err != nil {
		return EconomicsIntegrationBundle{}, err
	}
	if safetyState != nil {
		if err := ValidateSafetyModuleRuntimeState(*safetyState); err != nil {
			return EconomicsIntegrationBundle{}, err
		}
	}

	bundle := EconomicsIntegrationBundle{
		SchemaVersion:     EconomicsIntegrationSchemaVersion,
		ContractID:        EconomicsIntegrationContractID,
		SourceCommit:      sourceCommit,
		GeneratedAt:       laterTime(economicState.LastAsOf, stakingState.LastAsOf),
		EvidenceClass:     IntegrationEvidenceClass,
		EconomicStateHash: economicState.StateHash,
		StakingStateHash:  stakingState.StateHash,
		Envelopes:         []EconomicsIntegrationEnvelope{},
		BillingLedger:     []EconomicsBillingLedgerEntry{},
		Explorer:          []EconomicsExplorerProjection{},
		Monitor:           []EconomicsMonitorCheck{},
		ReleaseStates:     LocalCandidateIntegrationReleaseStates(),
	}
	if safetyState != nil {
		bundle.GeneratedAt = laterTime(bundle.GeneratedAt, safetyState.LastAsOf)
		bundle.SafetyStateHash = safetyState.StateHash
	}

	for _, event := range economicState.EconomicEvents {
		envelope, err := newEconomicIntegrationEnvelope(event, sourceCommit)
		if err != nil {
			return EconomicsIntegrationBundle{}, err
		}
		bundle.Envelopes = append(bundle.Envelopes, envelope)
		entries, err := newFeeLedgerEntries(event, sourceCommit)
		if err != nil {
			return EconomicsIntegrationBundle{}, err
		}
		bundle.BillingLedger = append(bundle.BillingLedger, entries...)
		projection, err := newEconomicExplorerProjection(event, sourceCommit)
		if err != nil {
			return EconomicsIntegrationBundle{}, err
		}
		bundle.Explorer = append(bundle.Explorer, projection)
		checks, err := newEconomicMonitorChecks(event, sourceCommit)
		if err != nil {
			return EconomicsIntegrationBundle{}, err
		}
		bundle.Monitor = append(bundle.Monitor, checks...)
	}
	for _, event := range economicState.GovernanceEvents {
		envelope, err := newGovernanceIntegrationEnvelope(event, sourceCommit)
		if err != nil {
			return EconomicsIntegrationBundle{}, err
		}
		bundle.Envelopes = append(bundle.Envelopes, envelope)
		projection, err := newGovernanceExplorerProjection(event, sourceCommit)
		if err != nil {
			return EconomicsIntegrationBundle{}, err
		}
		bundle.Explorer = append(bundle.Explorer, projection)
		check, err := newMonitorCheck(sourceCommit, event.ID, "governance_event_integrity", "pass", "info", event.AuditHash, "canonical governance event audit hash", event.OccurredAt)
		if err != nil {
			return EconomicsIntegrationBundle{}, err
		}
		bundle.Monitor = append(bundle.Monitor, check)
	}
	for index, event := range stakingState.Events {
		envelope, err := newStakingIntegrationEnvelope(event, int64(index+1), sourceCommit)
		if err != nil {
			return EconomicsIntegrationBundle{}, err
		}
		bundle.Envelopes = append(bundle.Envelopes, envelope)
		projection, err := newStakingExplorerProjection(event, sourceCommit)
		if err != nil {
			return EconomicsIntegrationBundle{}, err
		}
		bundle.Explorer = append(bundle.Explorer, projection)
		checks, err := newStakingMonitorChecks(event, stakingState.Policy, sourceCommit)
		if err != nil {
			return EconomicsIntegrationBundle{}, err
		}
		bundle.Monitor = append(bundle.Monitor, checks...)
	}
	if safetyState != nil {
		for index, event := range safetyState.Events {
			envelope, err := newSafetyIntegrationEnvelope(event, int64(index+1), sourceCommit)
			if err != nil {
				return EconomicsIntegrationBundle{}, err
			}
			bundle.Envelopes = append(bundle.Envelopes, envelope)
			projection, err := newSafetyExplorerProjection(event, sourceCommit)
			if err != nil {
				return EconomicsIntegrationBundle{}, err
			}
			bundle.Explorer = append(bundle.Explorer, projection)
			checks, err := newSafetyMonitorChecks(event, safetyState.Policy, sourceCommit)
			if err != nil {
				return EconomicsIntegrationBundle{}, err
			}
			bundle.Monitor = append(bundle.Monitor, checks...)
		}
	}

	sort.Slice(bundle.Envelopes, func(i, j int) bool {
		if bundle.Envelopes[i].OccurredAt.Equal(bundle.Envelopes[j].OccurredAt) {
			return bundle.Envelopes[i].EventID < bundle.Envelopes[j].EventID
		}
		return bundle.Envelopes[i].OccurredAt.Before(bundle.Envelopes[j].OccurredAt)
	})
	sort.Slice(bundle.BillingLedger, func(i, j int) bool {
		if bundle.BillingLedger[i].OccurredAt.Equal(bundle.BillingLedger[j].OccurredAt) {
			if bundle.BillingLedger[i].SourceEventID == bundle.BillingLedger[j].SourceEventID {
				return bundle.BillingLedger[i].FlowClass < bundle.BillingLedger[j].FlowClass
			}
			return bundle.BillingLedger[i].SourceEventID < bundle.BillingLedger[j].SourceEventID
		}
		return bundle.BillingLedger[i].OccurredAt.Before(bundle.BillingLedger[j].OccurredAt)
	})
	sort.Slice(bundle.Explorer, func(i, j int) bool {
		if bundle.Explorer[i].OccurredAt.Equal(bundle.Explorer[j].OccurredAt) {
			return bundle.Explorer[i].SourceEventID < bundle.Explorer[j].SourceEventID
		}
		return bundle.Explorer[i].OccurredAt.Before(bundle.Explorer[j].OccurredAt)
	})
	sort.Slice(bundle.Monitor, func(i, j int) bool {
		if bundle.Monitor[i].OccurredAt.Equal(bundle.Monitor[j].OccurredAt) {
			if bundle.Monitor[i].SourceEventID == bundle.Monitor[j].SourceEventID {
				return bundle.Monitor[i].Check < bundle.Monitor[j].Check
			}
			return bundle.Monitor[i].SourceEventID < bundle.Monitor[j].SourceEventID
		}
		return bundle.Monitor[i].OccurredAt.Before(bundle.Monitor[j].OccurredAt)
	})

	bundle.BundleHash = economicsIntegrationBundleHash(bundle)
	if err := ValidateEconomicsIntegrationBundle(bundle); err != nil {
		return EconomicsIntegrationBundle{}, err
	}
	return bundle, nil
}

func ValidateEconomicsIntegrationBundle(bundle EconomicsIntegrationBundle) error {
	if bundle.SchemaVersion != EconomicsIntegrationSchemaVersion || bundle.ContractID != EconomicsIntegrationContractID || !validIntegrationSourceCommit(bundle.SourceCommit) || bundle.GeneratedAt.IsZero() || bundle.EvidenceClass != IntegrationEvidenceClass {
		return runtimeError(CodeIntegrationInvalidBundle, "integration bundle metadata is invalid")
	}
	if !validEvidenceHash(bundle.EconomicStateHash) || !validEvidenceHash(bundle.StakingStateHash) || (bundle.SafetyStateHash != "" && !validEvidenceHash(bundle.SafetyStateHash)) || bundle.ReleaseStates != LocalCandidateIntegrationReleaseStates() {
		return runtimeError(CodeIntegrationInvalidBundle, "integration bundle state hashes or release truth are invalid")
	}
	if len(bundle.Envelopes) == 0 || len(bundle.Explorer) != len(bundle.Envelopes) || len(bundle.Monitor) == 0 {
		return runtimeError(CodeIntegrationInvalidBundle, "integration bundle is missing canonical consumers")
	}

	envelopes := make(map[string]EconomicsIntegrationEnvelope, len(bundle.Envelopes))
	var previousEnvelopeAt time.Time
	for _, envelope := range bundle.Envelopes {
		if err := ValidateEconomicsIntegrationEnvelope(envelope); err != nil {
			return err
		}
		if envelope.SourceCommit != bundle.SourceCommit || envelope.OccurredAt.After(bundle.GeneratedAt) || (!previousEnvelopeAt.IsZero() && envelope.OccurredAt.Before(previousEnvelopeAt)) {
			return runtimeError(CodeIntegrationInvalidBundle, "integration envelope order or source commit mismatch")
		}
		if _, exists := envelopes[envelope.EventID]; exists {
			return runtimeError(CodeIntegrationInvalidBundle, "duplicate integration event id")
		}
		envelopes[envelope.EventID] = envelope
		previousEnvelopeAt = envelope.OccurredAt
	}

	billingByEvent := map[string][]EconomicsBillingLedgerEntry{}
	var previousBillingAt time.Time
	for _, entry := range bundle.BillingLedger {
		if err := ValidateEconomicsBillingLedgerEntry(entry); err != nil {
			return err
		}
		envelope, exists := envelopes[entry.SourceEventID]
		if !exists || envelope.EventType != "ynx.economics.epoch_settled.v1" || entry.SourceCommit != bundle.SourceCommit || entry.OccurredAt.After(bundle.GeneratedAt) || (!previousBillingAt.IsZero() && entry.OccurredAt.Before(previousBillingAt)) {
			return runtimeError(CodeIntegrationInvalidLedger, "billing entry does not reference a canonical economic envelope")
		}
		billingByEvent[entry.SourceEventID] = append(billingByEvent[entry.SourceEventID], entry)
		previousBillingAt = entry.OccurredAt
	}
	for eventID, entries := range billingByEvent {
		if err := validateBillingLedgerGroup(envelopes[eventID], entries); err != nil {
			return err
		}
	}
	for eventID, envelope := range envelopes {
		if envelope.EventType == "ynx.economics.epoch_settled.v1" && len(billingByEvent[eventID]) != 6 {
			return runtimeError(CodeIntegrationInvalidLedger, "economic event must have six explicit fee and burn ledger entries")
		}
	}

	projected := map[string]bool{}
	var previousProjectionAt time.Time
	for _, projection := range bundle.Explorer {
		if err := ValidateEconomicsExplorerProjection(projection); err != nil {
			return err
		}
		envelope, exists := envelopes[projection.SourceEventID]
		if !exists || projection.SourceCommit != bundle.SourceCommit || projection.EventType != envelope.EventType || projection.EventVersion != envelope.EventVersion || projected[projection.SourceEventID] || projection.OccurredAt.After(bundle.GeneratedAt) || (!previousProjectionAt.IsZero() && projection.OccurredAt.Before(previousProjectionAt)) {
			return runtimeError(CodeIntegrationInvalidProjection, "Explorer projection does not map one-to-one to a canonical envelope")
		}
		if err := validateProjectionAgainstEnvelope(projection, envelope); err != nil {
			return err
		}
		projected[projection.SourceEventID] = true
		previousProjectionAt = projection.OccurredAt
	}

	monitorCounts := map[string]int{}
	var previousMonitorAt time.Time
	for _, check := range bundle.Monitor {
		if err := ValidateEconomicsMonitorCheck(check); err != nil {
			return err
		}
		if _, exists := envelopes[check.SourceEventID]; !exists || check.SourceCommit != bundle.SourceCommit || check.OccurredAt.After(bundle.GeneratedAt) || (!previousMonitorAt.IsZero() && check.OccurredAt.Before(previousMonitorAt)) {
			return runtimeError(CodeIntegrationInvalidMonitor, "monitor check does not reference a canonical envelope")
		}
		monitorCounts[check.SourceEventID]++
		previousMonitorAt = check.OccurredAt
	}
	for eventID := range envelopes {
		if monitorCounts[eventID] == 0 {
			return runtimeError(CodeIntegrationInvalidMonitor, "every canonical event requires at least one monitor check")
		}
	}

	if bundle.BundleHash != economicsIntegrationBundleHash(bundle) {
		return runtimeError(CodeIntegrationInvalidBundle, "integration bundle hash mismatch")
	}
	return nil
}

func ValidateEconomicsIntegrationEnvelope(envelope EconomicsIntegrationEnvelope) error {
	if envelope.SchemaVersion != EconomicsIntegrationSchemaVersion || envelope.ContractID != EconomicsIntegrationContractID || !validIntegrationSourceCommit(envelope.SourceCommit) || envelope.EventVersion != 1 || strings.TrimSpace(envelope.EventID) == "" || strings.TrimSpace(envelope.EventType) == "" || strings.TrimSpace(envelope.Source) == "" || strings.TrimSpace(envelope.PartitionKey) == "" || envelope.AuthorityOwner != "17 Economics" || envelope.EvidenceClass != IntegrationEvidenceClass || envelope.SharedTestnet || envelope.PublicDeployment || envelope.Production || envelope.OccurredAt.IsZero() || envelope.Sequence < 1 || !validEvidenceHash(envelope.SourceEventAuditHash) || !json.Valid(envelope.Payload) {
		return runtimeError(CodeIntegrationInvalidEnvelope, "canonical integration envelope metadata is invalid")
	}
	if !integrationEventTypeAllowed(envelope.EventType) || envelope.PayloadHash != integrationPayloadHash(envelope.Payload) || envelope.AuditHash != economicsIntegrationEnvelopeHash(envelope) {
		return runtimeError(CodeIntegrationInvalidEnvelope, "canonical integration envelope payload or audit hash mismatch")
	}
	if err := validateIntegrationEnvelopePayload(envelope); err != nil {
		return err
	}
	return nil
}

func validateIntegrationEnvelopePayload(envelope EconomicsIntegrationEnvelope) error {
	switch envelope.EventType {
	case "ynx.economics.epoch_settled.v1":
		var event CanonicalEconomicEvent
		if err := json.Unmarshal(envelope.Payload, &event); err != nil || event.ID != envelope.EventID || event.Type != envelope.EventType || event.Version != envelope.EventVersion || event.Source != envelope.Source || !event.AsOf.UTC().Equal(envelope.OccurredAt) || event.Epoch != envelope.Sequence || event.AuditHash != envelope.SourceEventAuditHash || event.ID != economicEventID(event) || event.AuditHash != economicEventAuditHash(event) {
			return runtimeError(CodeIntegrationInvalidEnvelope, "economic envelope payload is not the canonical source event")
		}
	case "ynx.economics.policy_change_scheduled.v1", "ynx.economics.policy_change_activated.v1":
		var event PolicyGovernanceEvent
		if err := json.Unmarshal(envelope.Payload, &event); err != nil || event.ID != envelope.EventID || event.Type != envelope.EventType || event.Version != envelope.EventVersion || event.GovernanceSource != envelope.Source || !event.OccurredAt.UTC().Equal(envelope.OccurredAt) || event.AuditHash != envelope.SourceEventAuditHash || event.ID != governanceEventID(event) || event.AuditHash != governanceEventAuditHash(event) {
			return runtimeError(CodeIntegrationInvalidEnvelope, "governance envelope payload is not the canonical source event")
		}
	case "ynx.staking.validator_slashed.v1", "ynx.staking.validator_unjailed.v1":
		var event StakingRiskEvent
		if err := json.Unmarshal(envelope.Payload, &event); err != nil || event.ID != envelope.EventID || event.Type != envelope.EventType || event.Version != envelope.EventVersion || event.Source != envelope.Source || !event.ExecutedAt.UTC().Equal(envelope.OccurredAt) || event.AuditHash != envelope.SourceEventAuditHash || event.ID != stakingRiskEventID(event) || event.AuditHash != stakingRiskEventAuditHash(event) {
			return runtimeError(CodeIntegrationInvalidEnvelope, "staking envelope payload is not the canonical source event")
		}
	case "ynx.safety.stake_registered.v1", "ynx.safety.exit_requested.v1", "ynx.safety.exit_completed.v1", "ynx.safety.insurance_funding_recorded.v1", "ynx.safety.shortfall_processed.v1":
		var event SafetyModuleRuntimeEvent
		if err := json.Unmarshal(envelope.Payload, &event); err != nil || event.ID != envelope.EventID || event.Type != envelope.EventType || event.Version != envelope.EventVersion || event.Source != envelope.Source || !event.OccurredAt.UTC().Equal(envelope.OccurredAt) || event.AuditHash != envelope.SourceEventAuditHash || event.ID != safetyRuntimeEventID(event) || event.AuditHash != safetyRuntimeEventAuditHash(event) {
			return runtimeError(CodeIntegrationInvalidEnvelope, "Safety Module envelope payload is not the canonical source event")
		}
		if err := validateSafetyIntegrationEvent(event); err != nil {
			return err
		}
	case StableReserveAttestedEventType:
		event, err := decodeStableReserveEvent(envelope.Payload)
		if err != nil || event.ID != envelope.EventID || event.Type != envelope.EventType ||
			event.Version != envelope.EventVersion || event.Source != envelope.Source ||
			!event.OccurredAt.UTC().Equal(envelope.OccurredAt) || event.AuditHash != envelope.SourceEventAuditHash {
			return runtimeError(CodeIntegrationInvalidEnvelope, "stable reserve envelope payload is not the canonical source event")
		}
	default:
		return runtimeError(CodeIntegrationInvalidEnvelope, "integration envelope event type is unsupported")
	}
	return nil
}

func ValidateEconomicsBillingLedgerEntry(entry EconomicsBillingLedgerEntry) error {
	if entry.SchemaVersion != EconomicsIntegrationSchemaVersion || entry.ContractID != EconomicsIntegrationContractID || !validIntegrationSourceCommit(entry.SourceCommit) || strings.TrimSpace(entry.ID) == "" || strings.TrimSpace(entry.SourceEventID) == "" || entry.SourceEventType != "ynx.economics.epoch_settled.v1" || entry.OccurredAt.IsZero() || entry.Asset != "YNXT" || entry.AmountYNXT < 0 || entry.GrossFeeYNXT < 0 || entry.InternalTransfer || entry.TestSubsidy || entry.EvidenceClass != IntegrationEvidenceClass {
		return runtimeError(CodeIntegrationInvalidLedger, "billing ledger entry metadata is invalid")
	}
	burnFlow := entry.FlowClass == IntegrationFlowBaseFeeBurn || entry.FlowClass == IntegrationFlowServiceBurn
	revenueFlow := entry.FlowClass == IntegrationFlowValidator || entry.FlowClass == IntegrationFlowProvider || entry.FlowClass == IntegrationFlowProtocol || entry.FlowClass == IntegrationFlowTreasury
	if (!burnFlow && !revenueFlow) || entry.Burn != burnFlow || entry.RevenueRecognition != revenueFlow || (entry.Burn && entry.RevenueRecognition) || entry.AuditHash != economicsBillingEntryHash(entry) || entry.ID != economicsBillingEntryID(entry) {
		return runtimeError(CodeIntegrationInvalidLedger, "billing ledger entry classification or audit hash is invalid")
	}
	return nil
}

func ValidateEconomicsExplorerProjection(projection EconomicsExplorerProjection) error {
	if projection.SchemaVersion != EconomicsIntegrationSchemaVersion || projection.ContractID != EconomicsIntegrationContractID || !validIntegrationSourceCommit(projection.SourceCommit) || strings.TrimSpace(projection.ID) == "" || strings.TrimSpace(projection.SourceEventID) == "" || !integrationEventTypeAllowed(projection.EventType) || projection.EventVersion != 1 || projection.OccurredAt.IsZero() || strings.TrimSpace(projection.Source) == "" || projection.AuthorityOwner != "17 Economics" || !projection.Candidate || projection.SharedTestnet || projection.PublicDeployment || projection.ReleaseStates != LocalCandidateIntegrationReleaseStates() || projection.Metrics == nil || projection.Labels == nil || projection.AuditHash != economicsExplorerProjectionHash(projection) || projection.ID != economicsExplorerProjectionID(projection) {
		return runtimeError(CodeIntegrationInvalidProjection, "Explorer projection metadata or audit hash is invalid")
	}
	return nil
}

func ValidateEconomicsMonitorCheck(check EconomicsMonitorCheck) error {
	if check.SchemaVersion != EconomicsIntegrationSchemaVersion || check.ContractID != EconomicsIntegrationContractID || !validIntegrationSourceCommit(check.SourceCommit) || strings.TrimSpace(check.ID) == "" || strings.TrimSpace(check.SourceEventID) == "" || strings.TrimSpace(check.Check) == "" || (check.Status != "pass" && check.Status != "fail") || (check.Severity != "info" && check.Severity != "critical") || strings.TrimSpace(check.Observed) == "" || strings.TrimSpace(check.Expected) == "" || check.OccurredAt.IsZero() || check.EvidenceClass != IntegrationEvidenceClass || check.SharedTestnet || check.AuditHash != economicsMonitorCheckHash(check) || check.ID != economicsMonitorCheckID(check) {
		return runtimeError(CodeIntegrationInvalidMonitor, "monitor check metadata or audit hash is invalid")
	}
	return nil
}

func newEconomicIntegrationEnvelope(event CanonicalEconomicEvent, sourceCommit string) (EconomicsIntegrationEnvelope, error) {
	if event.Type != "ynx.economics.epoch_settled.v1" || event.Version != 1 || strings.TrimSpace(event.ID) == "" || !validEvidenceHash(event.AuditHash) || event.AsOf.IsZero() || event.Epoch < 1 || event.Source != "ynx-economics-runtime-candidate-v1" || event.OpeningSupplyYNXT+event.IssuanceYNXT-event.FeeAccounting.BurnYNXT() != event.ClosingSupplyYNXT || event.IssuanceAllocation.Total() != event.IssuanceYNXT {
		return EconomicsIntegrationEnvelope{}, runtimeError(CodeIntegrationInvalidEnvelope, "economic event cannot be wrapped because it does not reconcile")
	}
	if err := event.FeeAccounting.Validate(); err != nil {
		return EconomicsIntegrationEnvelope{}, err
	}
	return newIntegrationEnvelope(event.Type, event.Version, event.ID, event.Source, sourceCommit, event.AuditHash, event.AsOf, event.Epoch, "economics:epoch", event)
}

func newGovernanceIntegrationEnvelope(event PolicyGovernanceEvent, sourceCommit string) (EconomicsIntegrationEnvelope, error) {
	if event.Version != 1 || (event.Type != "ynx.economics.policy_change_scheduled.v1" && event.Type != "ynx.economics.policy_change_activated.v1") || strings.TrimSpace(event.ID) == "" || strings.TrimSpace(event.ProposalID) == "" || !validEvidenceHash(event.AuditHash) || event.OccurredAt.IsZero() {
		return EconomicsIntegrationEnvelope{}, runtimeError(CodeIntegrationInvalidEnvelope, "governance event cannot be wrapped")
	}
	sequence := event.OccurredAt.UTC().UnixNano()
	if sequence < 1 {
		return EconomicsIntegrationEnvelope{}, runtimeError(CodeIntegrationInvalidEnvelope, "governance event sequence is invalid")
	}
	return newIntegrationEnvelope(event.Type, event.Version, event.ID, event.GovernanceSource, sourceCommit, event.AuditHash, event.OccurredAt, sequence, "economics:governance", event)
}

func newStakingIntegrationEnvelope(event StakingRiskEvent, sequence int64, sourceCommit string) (EconomicsIntegrationEnvelope, error) {
	if event.Version != 1 || (event.Type != "ynx.staking.validator_slashed.v1" && event.Type != "ynx.staking.validator_unjailed.v1") || strings.TrimSpace(event.ID) == "" || !validEvidenceHash(event.AuditHash) || event.ExecutedAt.IsZero() || !validValidatorIdentifier(event.Validator) || event.Source != "ynx-staking-risk-runtime-candidate-v1" {
		return EconomicsIntegrationEnvelope{}, runtimeError(CodeIntegrationInvalidEnvelope, "staking event cannot be wrapped")
	}
	return newIntegrationEnvelope(event.Type, event.Version, event.ID, event.Source, sourceCommit, event.AuditHash, event.ExecutedAt, sequence, "staking:"+event.Validator, event)
}

func newSafetyIntegrationEnvelope(event SafetyModuleRuntimeEvent, sequence int64, sourceCommit string) (EconomicsIntegrationEnvelope, error) {
	if err := validateSafetyIntegrationEvent(event); err != nil {
		return EconomicsIntegrationEnvelope{}, err
	}
	partition := "safety:module"
	if strings.TrimSpace(event.Participant) != "" {
		partition = "safety:" + strings.TrimSpace(event.Participant)
	}
	return newIntegrationEnvelope(event.Type, event.Version, event.ID, event.Source, sourceCommit, event.AuditHash, event.OccurredAt, sequence, partition, event)
}

func newIntegrationEnvelope(eventType string, eventVersion int, eventID, source, sourceCommit, sourceAudit string, occurredAt time.Time, sequence int64, partition string, payload any) (EconomicsIntegrationEnvelope, error) {
	if !validIntegrationSourceCommit(sourceCommit) {
		return EconomicsIntegrationEnvelope{}, runtimeError(CodeIntegrationInvalidEnvelope, "integration envelope source commit is invalid")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return EconomicsIntegrationEnvelope{}, err
	}
	envelope := EconomicsIntegrationEnvelope{
		SchemaVersion:        EconomicsIntegrationSchemaVersion,
		ContractID:           EconomicsIntegrationContractID,
		EventType:            eventType,
		EventVersion:         eventVersion,
		EventID:              eventID,
		Source:               source,
		SourceCommit:         sourceCommit,
		SourceEventAuditHash: sourceAudit,
		OccurredAt:           occurredAt.UTC(),
		Sequence:             sequence,
		PartitionKey:         partition,
		AuthorityOwner:       "17 Economics",
		EvidenceClass:        IntegrationEvidenceClass,
		Payload:              raw,
		PayloadHash:          integrationPayloadHash(raw),
	}
	envelope.AuditHash = economicsIntegrationEnvelopeHash(envelope)
	if err := ValidateEconomicsIntegrationEnvelope(envelope); err != nil {
		return EconomicsIntegrationEnvelope{}, err
	}
	return envelope, nil
}

func newFeeLedgerEntries(event CanonicalEconomicEvent, sourceCommit string) ([]EconomicsBillingLedgerEntry, error) {
	components := []struct {
		flow      string
		recipient string
		amount    int64
		burn      bool
		revenue   bool
	}{
		{IntegrationFlowBaseFeeBurn, "supply", event.FeeAccounting.BaseFeeBurnYNXT, true, false},
		{IntegrationFlowServiceBurn, "supply", event.FeeAccounting.ServiceBurnYNXT, true, false},
		{IntegrationFlowValidator, "validator", event.FeeAccounting.ValidatorYNXT, false, true},
		{IntegrationFlowProvider, "provider", event.FeeAccounting.ProviderYNXT, false, true},
		{IntegrationFlowProtocol, "protocol", event.FeeAccounting.ProtocolYNXT, false, true},
		{IntegrationFlowTreasury, "treasury", event.FeeAccounting.TreasuryYNXT, false, true},
	}
	entries := make([]EconomicsBillingLedgerEntry, 0, len(components))
	for _, component := range components {
		entry := EconomicsBillingLedgerEntry{
			SchemaVersion:      EconomicsIntegrationSchemaVersion,
			ContractID:         EconomicsIntegrationContractID,
			SourceCommit:       sourceCommit,
			SourceEventID:      event.ID,
			SourceEventType:    event.Type,
			OccurredAt:         event.AsOf.UTC(),
			Asset:              "YNXT",
			AmountYNXT:         component.amount,
			GrossFeeYNXT:       event.FeeAccounting.GrossFeeYNXT,
			FlowClass:          component.flow,
			RecipientClass:     component.recipient,
			Burn:               component.burn,
			RevenueRecognition: component.revenue,
			EvidenceClass:      IntegrationEvidenceClass,
		}
		entry.ID = economicsBillingEntryID(entry)
		entry.AuditHash = economicsBillingEntryHash(entry)
		if err := ValidateEconomicsBillingLedgerEntry(entry); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

func newEconomicExplorerProjection(event CanonicalEconomicEvent, sourceCommit string) (EconomicsExplorerProjection, error) {
	projection := EconomicsExplorerProjection{
		SchemaVersion:  EconomicsIntegrationSchemaVersion,
		ContractID:     EconomicsIntegrationContractID,
		SourceCommit:   sourceCommit,
		SourceEventID:  event.ID,
		EventType:      event.Type,
		EventVersion:   event.Version,
		OccurredAt:     event.AsOf.UTC(),
		Source:         event.Source,
		AuthorityOwner: "17 Economics",
		Candidate:      true,
		Metrics: map[string]int64{
			"annualIssuanceRateBps": event.AnnualIssuanceRateBPS,
			"baseFeeBurnYnxt":       event.FeeAccounting.BaseFeeBurnYNXT,
			"closingSupplyYnxt":     event.ClosingSupplyYNXT,
			"grossFeeYnxt":          event.FeeAccounting.GrossFeeYNXT,
			"issuanceYnxt":          event.IssuanceYNXT,
			"openingSupplyYnxt":     event.OpeningSupplyYNXT,
			"providerYnxt":          event.FeeAccounting.ProviderYNXT,
			"protocolYnxt":          event.FeeAccounting.ProtocolYNXT,
			"serviceBurnYnxt":       event.FeeAccounting.ServiceBurnYNXT,
			"treasuryYnxt":          event.FeeAccounting.TreasuryYNXT,
			"validatorYnxt":         event.FeeAccounting.ValidatorYNXT,
		},
		Labels: map[string]string{
			"burnIsRevenue": "false",
			"emergencyMode": fmt.Sprintf("%t", event.EmergencyMode),
			"policyHash":    event.PolicyHash,
		},
		ReleaseStates: LocalCandidateIntegrationReleaseStates(),
	}
	projection.ID = economicsExplorerProjectionID(projection)
	projection.AuditHash = economicsExplorerProjectionHash(projection)
	if err := ValidateEconomicsExplorerProjection(projection); err != nil {
		return EconomicsExplorerProjection{}, err
	}
	return projection, nil
}

func newGovernanceExplorerProjection(event PolicyGovernanceEvent, sourceCommit string) (EconomicsExplorerProjection, error) {
	projection := EconomicsExplorerProjection{
		SchemaVersion:  EconomicsIntegrationSchemaVersion,
		ContractID:     EconomicsIntegrationContractID,
		SourceCommit:   sourceCommit,
		SourceEventID:  event.ID,
		EventType:      event.Type,
		EventVersion:   event.Version,
		OccurredAt:     event.OccurredAt.UTC(),
		Source:         event.GovernanceSource,
		AuthorityOwner: "17 Economics",
		Candidate:      true,
		Metrics: map[string]int64{
			"activateAfterUnix": event.ActivateAfter.UTC().Unix(),
		},
		Labels: map[string]string{
			"candidateHash": event.CandidateHash,
			"previousHash":  event.PreviousHash,
			"proposalId":    event.ProposalID,
		},
		ReleaseStates: LocalCandidateIntegrationReleaseStates(),
	}
	projection.ID = economicsExplorerProjectionID(projection)
	projection.AuditHash = economicsExplorerProjectionHash(projection)
	if err := ValidateEconomicsExplorerProjection(projection); err != nil {
		return EconomicsExplorerProjection{}, err
	}
	return projection, nil
}

func newStakingExplorerProjection(event StakingRiskEvent, sourceCommit string) (EconomicsExplorerProjection, error) {
	projection := EconomicsExplorerProjection{
		SchemaVersion:  EconomicsIntegrationSchemaVersion,
		ContractID:     EconomicsIntegrationContractID,
		SourceCommit:   sourceCommit,
		SourceEventID:  event.ID,
		EventType:      event.Type,
		EventVersion:   event.Version,
		OccurredAt:     event.ExecutedAt.UTC(),
		Source:         event.Source,
		AuthorityOwner: "17 Economics",
		Candidate:      true,
		Metrics: map[string]int64{
			"closingExposureYnxt":      event.ClosingExposureYNXT,
			"delegatorSlashYnxt":       event.DelegatorSlashYNXT,
			"openingExposureYnxt":      event.OpeningExposureYNXT,
			"operatorSlashYnxt":        event.OperatorSlashYNXT,
			"queuedUnbondingSlashYnxt": event.QueuedUnbondingSlashYNXT,
			"slashBps":                 event.SlashBPS,
			"threshold":                int64(event.Threshold),
			"totalSlashYnxt":           event.TotalSlashYNXT,
			"verifiedSignatures":       int64(event.VerifiedSignatures),
		},
		Labels: map[string]string{
			"actionHash":   event.ActionHash,
			"evidenceHash": event.EvidenceHash,
			"infraction":   event.Infraction,
			"proposalId":   event.ProposalID,
			"validator":    event.Validator,
		},
		ReleaseStates: LocalCandidateIntegrationReleaseStates(),
	}
	if event.JailedUntil != nil {
		projection.Metrics["jailedUntilUnix"] = event.JailedUntil.UTC().Unix()
	}
	projection.ID = economicsExplorerProjectionID(projection)
	projection.AuditHash = economicsExplorerProjectionHash(projection)
	if err := ValidateEconomicsExplorerProjection(projection); err != nil {
		return EconomicsExplorerProjection{}, err
	}
	return projection, nil
}

func newSafetyExplorerProjection(event SafetyModuleRuntimeEvent, sourceCommit string) (EconomicsExplorerProjection, error) {
	projection := EconomicsExplorerProjection{
		SchemaVersion:  EconomicsIntegrationSchemaVersion,
		ContractID:     EconomicsIntegrationContractID,
		SourceCommit:   sourceCommit,
		SourceEventID:  event.ID,
		EventType:      event.Type,
		EventVersion:   event.Version,
		OccurredAt:     event.OccurredAt.UTC(),
		Source:         event.Source,
		AuthorityOwner: "17 Economics",
		Candidate:      true,
		Metrics: map[string]int64{
			"amountYnxt":             event.AmountYNXT,
			"closingInsuranceYnxt":   event.ClosingInsuranceYNXT,
			"insuranceFundedYnxt":    event.InsuranceFundedYNXT,
			"insuranceUsedYnxt":      event.InsuranceUsedYNXT,
			"openingInsuranceYnxt":   event.OpeningInsuranceYNXT,
			"slashAllocationCount":   int64(len(event.SlashAllocations)),
			"stakeSlashedYnxt":       event.StakeSlashedYNXT,
			"threshold":              int64(event.Threshold),
			"uncoveredShortfallYnxt": event.UncoveredShortfallYNXT,
			"verifiedSignatures":     int64(event.VerifiedSignatures),
		},
		Labels: map[string]string{
			"actionId":                 event.ActionID,
			"evidenceHash":             event.EvidenceHash,
			"externalTransferExecuted": fmt.Sprintf("%t", event.ExternalTransferExecuted),
			"participant":              event.Participant,
			"trigger":                  event.Trigger,
		},
		ReleaseStates: LocalCandidateIntegrationReleaseStates(),
	}
	projection.ID = economicsExplorerProjectionID(projection)
	projection.AuditHash = economicsExplorerProjectionHash(projection)
	if err := ValidateEconomicsExplorerProjection(projection); err != nil {
		return EconomicsExplorerProjection{}, err
	}
	return projection, nil
}

func newEconomicMonitorChecks(event CanonicalEconomicEvent, sourceCommit string) ([]EconomicsMonitorCheck, error) {
	checks := []struct {
		name     string
		observed string
		expected string
	}{
		{"supply_reconciliation", fmt.Sprintf("%d+%d-%d=%d", event.OpeningSupplyYNXT, event.IssuanceYNXT, event.FeeAccounting.BurnYNXT(), event.ClosingSupplyYNXT), "openingSupply+issuance-burn=closingSupply"},
		{"fee_reconciliation", fmt.Sprintf("gross=%d burn=%d revenue=%d", event.FeeAccounting.GrossFeeYNXT, event.FeeAccounting.BurnYNXT(), event.FeeAccounting.RevenueYNXT()), "grossFee=burn+revenue with burn excluded from revenue"},
		{"issuance_allocation", fmt.Sprintf("allocation=%d issuance=%d", event.IssuanceAllocation.Total(), event.IssuanceYNXT), "issuance allocations equal issuance"},
	}
	result := make([]EconomicsMonitorCheck, 0, len(checks))
	for _, item := range checks {
		check, err := newMonitorCheck(sourceCommit, event.ID, item.name, "pass", "critical", item.observed, item.expected, event.AsOf)
		if err != nil {
			return nil, err
		}
		result = append(result, check)
	}
	return result, nil
}

func newStakingMonitorChecks(event StakingRiskEvent, policy StakingRiskPolicy, sourceCommit string) ([]EconomicsMonitorCheck, error) {
	checks := []struct {
		name     string
		severity string
		observed string
		expected string
	}{
		{"staking_exposure_reconciliation", "critical", fmt.Sprintf("%d-%d=%d", event.OpeningExposureYNXT, event.TotalSlashYNXT, event.ClosingExposureYNXT), "openingExposure-totalSlash=closingExposure"},
		{"staking_authorization_threshold", "critical", fmt.Sprintf("verified=%d threshold=%d", event.VerifiedSignatures, event.Threshold), "verified signatures meet the governance threshold"},
	}
	if event.Type == "ynx.staking.validator_slashed.v1" {
		maximum, valid := stakingInfractionMaximum(policy, event.Infraction)
		if !valid {
			return nil, runtimeError(CodeIntegrationInvalidMonitor, "staking monitor cannot resolve the infraction maximum")
		}
		checks = append(checks, struct {
			name     string
			severity string
			observed string
			expected string
		}{"staking_slash_bound", "critical", fmt.Sprintf("slashBps=%d maximumBps=%d", event.SlashBPS, maximum), "slash basis points do not exceed the published infraction or global maximum"})
	} else {
		checks = append(checks, struct {
			name     string
			severity string
			observed string
			expected string
		}{"staking_recovery_zero_value", "critical", fmt.Sprintf("slashBps=%d totalSlash=%d", event.SlashBPS, event.TotalSlashYNXT), "governed recovery does not mint restore or slash stake"})
	}
	result := make([]EconomicsMonitorCheck, 0, len(checks))
	for _, item := range checks {
		check, err := newMonitorCheck(sourceCommit, event.ID, item.name, "pass", item.severity, item.observed, item.expected, event.ExecutedAt)
		if err != nil {
			return nil, err
		}
		result = append(result, check)
	}
	return result, nil
}

func newSafetyMonitorChecks(event SafetyModuleRuntimeEvent, policy SafetyModuleRuntimePolicy, sourceCommit string) ([]EconomicsMonitorCheck, error) {
	checks := []struct {
		name     string
		severity string
		observed string
		expected string
	}{
		{"safety_external_execution_disabled", "critical", fmt.Sprintf("externalTransferExecuted=%t", event.ExternalTransferExecuted), "candidate integration events never execute custody Treasury insurance or withdrawal transfers"},
		{"safety_event_integrity", "info", event.AuditHash, "canonical Safety Module event audit hash"},
	}
	switch event.Type {
	case "ynx.safety.stake_registered.v1", "ynx.safety.exit_requested.v1", "ynx.safety.exit_completed.v1":
		checks = append(checks, struct {
			name     string
			severity string
			observed string
			expected string
		}{"safety_participant_amount", "critical", fmt.Sprintf("participant=%s amount=%d", event.Participant, event.AmountYNXT), "participant is explicit and amount is positive"})
	case "ynx.safety.insurance_funding_recorded.v1":
		checks = append(checks,
			struct {
				name     string
				severity string
				observed string
				expected string
			}{"safety_insurance_funding_reconciliation", "critical", fmt.Sprintf("%d+%d=%d", event.OpeningInsuranceYNXT, event.InsuranceFundedYNXT, event.ClosingInsuranceYNXT), "openingInsurance+insuranceFunding=closingInsurance"},
			struct {
				name     string
				severity string
				observed string
				expected string
			}{"safety_authorization_threshold", "critical", fmt.Sprintf("verified=%d threshold=%d", event.VerifiedSignatures, event.Threshold), "verified signatures meet the governance threshold"},
		)
	case "ynx.safety.shortfall_processed.v1":
		checks = append(checks,
			struct {
				name     string
				severity string
				observed string
				expected string
			}{"safety_shortfall_reconciliation", "critical", fmt.Sprintf("insurance=%d stake=%d uncovered=%d shortfall=%d", event.InsuranceUsedYNXT, event.StakeSlashedYNXT, event.UncoveredShortfallYNXT, event.AmountYNXT), "insuranceUsed+stakeSlashed+uncoveredShortfall=shortfall"},
			struct {
				name     string
				severity string
				observed string
				expected string
			}{"safety_insurance_waterfall", "critical", fmt.Sprintf("opening=%d used=%d closing=%d maximumDrawBps=%d", event.OpeningInsuranceYNXT, event.InsuranceUsedYNXT, event.ClosingInsuranceYNXT, policy.MaximumInsuranceDrawBPS), "insurance draw respects the published cap and closing reserve reconciliation"},
			struct {
				name     string
				severity string
				observed string
				expected string
			}{"safety_authorization_threshold", "critical", fmt.Sprintf("verified=%d threshold=%d", event.VerifiedSignatures, event.Threshold), "verified signatures meet the governance threshold"},
		)
	default:
		return nil, runtimeError(CodeIntegrationInvalidMonitor, "Safety Module monitor event type is unsupported")
	}
	result := make([]EconomicsMonitorCheck, 0, len(checks))
	for _, item := range checks {
		check, err := newMonitorCheck(sourceCommit, event.ID, item.name, "pass", item.severity, item.observed, item.expected, event.OccurredAt)
		if err != nil {
			return nil, err
		}
		result = append(result, check)
	}
	return result, nil
}

func newMonitorCheck(sourceCommit, eventID, name, status, severity, observed, expected string, occurredAt time.Time) (EconomicsMonitorCheck, error) {
	check := EconomicsMonitorCheck{
		SchemaVersion: EconomicsIntegrationSchemaVersion,
		ContractID:    EconomicsIntegrationContractID,
		SourceCommit:  sourceCommit,
		SourceEventID: eventID,
		Check:         name,
		Status:        status,
		Severity:      severity,
		Observed:      observed,
		Expected:      expected,
		OccurredAt:    occurredAt.UTC(),
		EvidenceClass: IntegrationEvidenceClass,
	}
	check.ID = economicsMonitorCheckID(check)
	check.AuditHash = economicsMonitorCheckHash(check)
	if err := ValidateEconomicsMonitorCheck(check); err != nil {
		return EconomicsMonitorCheck{}, err
	}
	return check, nil
}

func validateBillingLedgerGroup(envelope EconomicsIntegrationEnvelope, entries []EconomicsBillingLedgerEntry) error {
	if len(entries) != 6 {
		return runtimeError(CodeIntegrationInvalidLedger, "billing ledger group must contain all six fee and burn components")
	}
	var event CanonicalEconomicEvent
	if err := json.Unmarshal(envelope.Payload, &event); err != nil {
		return runtimeError(CodeIntegrationInvalidLedger, "economic envelope payload cannot be decoded for billing reconciliation")
	}
	expected := map[string]int64{
		IntegrationFlowBaseFeeBurn: event.FeeAccounting.BaseFeeBurnYNXT,
		IntegrationFlowServiceBurn: event.FeeAccounting.ServiceBurnYNXT,
		IntegrationFlowValidator:   event.FeeAccounting.ValidatorYNXT,
		IntegrationFlowProvider:    event.FeeAccounting.ProviderYNXT,
		IntegrationFlowProtocol:    event.FeeAccounting.ProtocolYNXT,
		IntegrationFlowTreasury:    event.FeeAccounting.TreasuryYNXT,
	}
	seen := map[string]bool{}
	var total, burn, revenue int64
	for _, entry := range entries {
		if seen[entry.FlowClass] || entry.AmountYNXT != expected[entry.FlowClass] || entry.GrossFeeYNXT != event.FeeAccounting.GrossFeeYNXT {
			return runtimeError(CodeIntegrationInvalidLedger, "billing ledger component is duplicated or does not match the source event")
		}
		seen[entry.FlowClass] = true
		var err error
		total, err = checkedSum(total, entry.AmountYNXT)
		if err != nil {
			return err
		}
		if entry.Burn {
			burn, err = checkedSum(burn, entry.AmountYNXT)
		} else if entry.RevenueRecognition {
			revenue, err = checkedSum(revenue, entry.AmountYNXT)
		}
		if err != nil {
			return err
		}
	}
	if len(seen) != len(expected) || total != event.FeeAccounting.GrossFeeYNXT || burn != event.FeeAccounting.BurnYNXT() || revenue != event.FeeAccounting.RevenueYNXT() {
		return runtimeError(CodeIntegrationInvalidLedger, "billing ledger group does not reconcile burn and revenue separately")
	}
	return nil
}

func validateProjectionAgainstEnvelope(projection EconomicsExplorerProjection, envelope EconomicsIntegrationEnvelope) error {
	switch envelope.EventType {
	case "ynx.economics.epoch_settled.v1":
		var event CanonicalEconomicEvent
		if err := json.Unmarshal(envelope.Payload, &event); err != nil || projection.Metrics["openingSupplyYnxt"] != event.OpeningSupplyYNXT || projection.Metrics["closingSupplyYnxt"] != event.ClosingSupplyYNXT || projection.Metrics["issuanceYnxt"] != event.IssuanceYNXT || projection.Metrics["grossFeeYnxt"] != event.FeeAccounting.GrossFeeYNXT || projection.Labels["burnIsRevenue"] != "false" || projection.Labels["policyHash"] != event.PolicyHash {
			return runtimeError(CodeIntegrationInvalidProjection, "economic Explorer projection does not match the source envelope")
		}
	case "ynx.economics.policy_change_scheduled.v1", "ynx.economics.policy_change_activated.v1":
		var event PolicyGovernanceEvent
		if err := json.Unmarshal(envelope.Payload, &event); err != nil || projection.Labels["proposalId"] != event.ProposalID || projection.Labels["candidateHash"] != event.CandidateHash || projection.Labels["previousHash"] != event.PreviousHash {
			return runtimeError(CodeIntegrationInvalidProjection, "governance Explorer projection does not match the source envelope")
		}
	case "ynx.staking.validator_slashed.v1", "ynx.staking.validator_unjailed.v1":
		var event StakingRiskEvent
		if err := json.Unmarshal(envelope.Payload, &event); err != nil || projection.Labels["validator"] != event.Validator || projection.Labels["proposalId"] != event.ProposalID || projection.Metrics["openingExposureYnxt"] != event.OpeningExposureYNXT || projection.Metrics["closingExposureYnxt"] != event.ClosingExposureYNXT || projection.Metrics["totalSlashYnxt"] != event.TotalSlashYNXT {
			return runtimeError(CodeIntegrationInvalidProjection, "staking Explorer projection does not match the source envelope")
		}
	case "ynx.safety.stake_registered.v1", "ynx.safety.exit_requested.v1", "ynx.safety.exit_completed.v1", "ynx.safety.insurance_funding_recorded.v1", "ynx.safety.shortfall_processed.v1":
		var event SafetyModuleRuntimeEvent
		if err := json.Unmarshal(envelope.Payload, &event); err != nil || projection.Labels["actionId"] != event.ActionID || projection.Labels["participant"] != event.Participant || projection.Labels["trigger"] != event.Trigger || projection.Labels["externalTransferExecuted"] != "false" || projection.Metrics["amountYnxt"] != event.AmountYNXT || projection.Metrics["openingInsuranceYnxt"] != event.OpeningInsuranceYNXT || projection.Metrics["closingInsuranceYnxt"] != event.ClosingInsuranceYNXT || projection.Metrics["insuranceUsedYnxt"] != event.InsuranceUsedYNXT || projection.Metrics["stakeSlashedYnxt"] != event.StakeSlashedYNXT || projection.Metrics["uncoveredShortfallYnxt"] != event.UncoveredShortfallYNXT {
			return runtimeError(CodeIntegrationInvalidProjection, "Safety Module Explorer projection does not match the source envelope")
		}
	case StableReserveAttestedEventType:
		event, err := decodeStableReserveEvent(envelope.Payload)
		if err != nil || projection.Labels["asset"] != event.Snapshot.Asset ||
			projection.Labels["network"] != event.Snapshot.Network ||
			projection.Labels["provider"] != event.Snapshot.Provider ||
			projection.Labels["custodian"] != event.Snapshot.Custodian ||
			projection.Labels["status"] != event.Snapshot.ExplorerStatus ||
			projection.Labels["externalReserveAttested"] != "true" ||
			projection.Labels["testnetOnly"] != "true" ||
			projection.Labels["realityValue"] != "false" ||
			projection.Labels["productionReady"] != "false" ||
			projection.Metrics["reserveUnits"] != int64(event.Snapshot.ReserveUnits) ||
			projection.Metrics["requiredBackingUnits"] != int64(event.Snapshot.RequiredBackingUnits) ||
			projection.Metrics["coverageBps"] != int64(event.Snapshot.CoverageBPS) {
			return runtimeError(CodeIntegrationInvalidProjection, "stable reserve Explorer projection does not match the source envelope")
		}
	default:
		return runtimeError(CodeIntegrationInvalidProjection, "Explorer projection references an unsupported event type")
	}
	return nil
}

func validateSafetyIntegrationEvent(event SafetyModuleRuntimeEvent) error {
	if event.Version != 1 || !safetyIntegrationEventTypeAllowed(event.Type) || !validSafetyActionID(event.ActionID) || event.ID != safetyRuntimeEventID(event) || event.AuditHash != safetyRuntimeEventAuditHash(event) || event.OccurredAt.IsZero() || event.ExternalTransferExecuted || event.Source != "ynx-safety-module-runtime-candidate-v1" || !validEvidenceHash(event.EvidenceHash) {
		return runtimeError(CodeIntegrationInvalidEnvelope, "Safety Module event metadata, audit hash, or execution boundary is invalid")
	}
	switch event.Type {
	case "ynx.safety.stake_registered.v1", "ynx.safety.exit_requested.v1", "ynx.safety.exit_completed.v1":
		if !validSafetyParticipant(event.Participant) || event.AmountYNXT <= 0 || event.Trigger != "" || event.OpeningInsuranceYNXT != 0 || event.InsuranceFundedYNXT != 0 || event.InsuranceUsedYNXT != 0 || event.StakeSlashedYNXT != 0 || event.UncoveredShortfallYNXT != 0 || event.ClosingInsuranceYNXT != 0 || len(event.SlashAllocations) != 0 || event.Threshold != 0 || event.VerifiedSignatures != 0 {
			return runtimeError(CodeIntegrationInvalidEnvelope, "Safety Module participant event contains conflicting accounting or authorization fields")
		}
	case "ynx.safety.insurance_funding_recorded.v1":
		closing, err := checkedSum(event.OpeningInsuranceYNXT, event.InsuranceFundedYNXT)
		if err != nil || event.Participant != "" || event.Trigger != "" || event.AmountYNXT <= 0 || event.InsuranceFundedYNXT != event.AmountYNXT || closing != event.ClosingInsuranceYNXT || event.InsuranceUsedYNXT != 0 || event.StakeSlashedYNXT != 0 || event.UncoveredShortfallYNXT != 0 || len(event.SlashAllocations) != 0 || event.Threshold < 1 || event.VerifiedSignatures < event.Threshold {
			return runtimeError(CodeIntegrationInvalidEnvelope, "Safety Module insurance funding event does not reconcile")
		}
	case "ynx.safety.shortfall_processed.v1":
		covered, err := checkedSum(event.InsuranceUsedYNXT, event.StakeSlashedYNXT, event.UncoveredShortfallYNXT)
		if err != nil || event.Participant != "" || (event.Trigger != "protocol_shortfall" && event.Trigger != "consensus_safety_failure") || event.AmountYNXT <= 0 || event.InsuranceFundedYNXT != 0 || covered != event.AmountYNXT || event.OpeningInsuranceYNXT < event.InsuranceUsedYNXT || event.OpeningInsuranceYNXT-event.InsuranceUsedYNXT != event.ClosingInsuranceYNXT || event.Threshold < 1 || event.VerifiedSignatures < event.Threshold {
			return runtimeError(CodeIntegrationInvalidEnvelope, "Safety Module shortfall event does not reconcile")
		}
		var allocated int64
		previousParticipant := ""
		for _, allocation := range event.SlashAllocations {
			if !validSafetyParticipant(allocation.Participant) || allocation.Participant <= previousParticipant || allocation.OpeningYNXT < allocation.SlashYNXT || allocation.OpeningYNXT-allocation.SlashYNXT != allocation.RemainingYNXT || allocation.SlashYNXT <= 0 || (allocation.Status != SafetyStakeStatusActive && allocation.Status != SafetyStakeStatusCooling) {
				return runtimeError(CodeIntegrationInvalidEnvelope, "Safety Module slash allocation is invalid")
			}
			allocated, err = checkedSum(allocated, allocation.SlashYNXT)
			if err != nil {
				return runtimeError(CodeIntegrationInvalidEnvelope, "Safety Module slash allocation overflows")
			}
			previousParticipant = allocation.Participant
		}
		if allocated != event.StakeSlashedYNXT {
			return runtimeError(CodeIntegrationInvalidEnvelope, "Safety Module slash allocations do not equal the event stake slash")
		}
	default:
		return runtimeError(CodeIntegrationInvalidEnvelope, "Safety Module event type is unsupported")
	}
	return nil
}

func integrationEventTypeAllowed(eventType string) bool {
	switch eventType {
	case "ynx.economics.epoch_settled.v1", "ynx.economics.policy_change_scheduled.v1", "ynx.economics.policy_change_activated.v1", "ynx.staking.validator_slashed.v1", "ynx.staking.validator_unjailed.v1", StableReserveAttestedEventType:
		return true
	default:
		return safetyIntegrationEventTypeAllowed(eventType)
	}
}

func safetyIntegrationEventTypeAllowed(eventType string) bool {
	switch eventType {
	case "ynx.safety.stake_registered.v1", "ynx.safety.exit_requested.v1", "ynx.safety.exit_completed.v1", "ynx.safety.insurance_funding_recorded.v1", "ynx.safety.shortfall_processed.v1":
		return true
	default:
		return false
	}
}

func validIntegrationSourceCommit(value string) bool {
	if len(value) != 40 || value != strings.ToLower(value) {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 20
}

func laterTime(left, right time.Time) time.Time {
	if right.After(left) {
		return right.UTC()
	}
	return left.UTC()
}

func integrationPayloadHash(payload []byte) string {
	canonical := payload
	var compact bytes.Buffer
	if json.Compact(&compact, payload) == nil {
		canonical = compact.Bytes()
	}
	sum := sha256.Sum256(canonical)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func economicsIntegrationEnvelopeHash(envelope EconomicsIntegrationEnvelope) string {
	envelope.AuditHash = ""
	return integrationCanonicalHash("YNX_ECONOMICS_INTEGRATION_ENVELOPE_V1", envelope)
}

func economicsBillingEntryID(entry EconomicsBillingLedgerEntry) string {
	entry.ID, entry.AuditHash = "", ""
	raw, _ := json.Marshal(entry)
	sum := sha256.Sum256(append([]byte("YNX_ECONOMICS_BILLING_ENTRY_ID_V1\x00"), raw...))
	return "econbill_" + hex.EncodeToString(sum[:12])
}

func economicsBillingEntryHash(entry EconomicsBillingLedgerEntry) string {
	entry.AuditHash = ""
	return integrationCanonicalHash("YNX_ECONOMICS_BILLING_ENTRY_V1", entry)
}

func economicsExplorerProjectionID(projection EconomicsExplorerProjection) string {
	projection.ID, projection.AuditHash = "", ""
	raw, _ := json.Marshal(projection)
	sum := sha256.Sum256(append([]byte("YNX_ECONOMICS_EXPLORER_PROJECTION_ID_V1\x00"), raw...))
	return "econview_" + hex.EncodeToString(sum[:12])
}

func economicsExplorerProjectionHash(projection EconomicsExplorerProjection) string {
	projection.AuditHash = ""
	return integrationCanonicalHash("YNX_ECONOMICS_EXPLORER_PROJECTION_V1", projection)
}

func economicsMonitorCheckID(check EconomicsMonitorCheck) string {
	check.ID, check.AuditHash = "", ""
	raw, _ := json.Marshal(check)
	sum := sha256.Sum256(append([]byte("YNX_ECONOMICS_MONITOR_CHECK_ID_V1\x00"), raw...))
	return "econmon_" + hex.EncodeToString(sum[:12])
}

func economicsMonitorCheckHash(check EconomicsMonitorCheck) string {
	check.AuditHash = ""
	return integrationCanonicalHash("YNX_ECONOMICS_MONITOR_CHECK_V1", check)
}

func economicsIntegrationBundleHash(bundle EconomicsIntegrationBundle) string {
	bundle.BundleHash = ""
	return integrationCanonicalHash("YNX_ECONOMICS_INTEGRATION_BUNDLE_V1", bundle)
}

func integrationCanonicalHash(domain string, value any) string {
	raw, _ := json.Marshal(value)
	sum := sha256.Sum256(append([]byte(domain+"\x00"), raw...))
	return "sha256:" + hex.EncodeToString(sum[:])
}
