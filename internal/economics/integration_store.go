package economics

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"
)

const (
	EconomicsIntegrationStoreSchemaVersion = 1
	EconomicsIntegrationStoreMaxBytes      = 64 << 20
)

const (
	CodeIntegrationStoreInvalidState = "YNX_ECONOMICS_INTEGRATION_STORE_INVALID_STATE"
	CodeIntegrationStoreConflict     = "YNX_ECONOMICS_INTEGRATION_STORE_CONFLICT"
	CodeIntegrationStoreInvalidTime  = "YNX_ECONOMICS_INTEGRATION_STORE_INVALID_TIME"
	CodeIntegrationStoreIO           = "YNX_ECONOMICS_INTEGRATION_STORE_IO"
	CodeIntegrationStoreTampered     = "YNX_ECONOMICS_INTEGRATION_STORE_TAMPERED"
)

type EconomicsIntegrationRecordCounts struct {
	Envelopes     int `json:"envelopes"`
	BillingLedger int `json:"billingLedger"`
	Explorer      int `json:"explorer"`
	Monitor       int `json:"monitor"`
}

type EconomicsIntegrationAcceptedBundle struct {
	SchemaVersion     int                              `json:"schemaVersion"`
	ID                string                           `json:"id"`
	ContractID        string                           `json:"contractId"`
	SourceCommit      string                           `json:"sourceCommit"`
	BundleHash        string                           `json:"bundleHash"`
	EconomicStateHash string                           `json:"economicStateHash"`
	StakingStateHash  string                           `json:"stakingStateHash"`
	SafetyStateHash   string                           `json:"safetyStateHash,omitempty"`
	GeneratedAt       time.Time                        `json:"generatedAt"`
	IngestedAt        time.Time                        `json:"ingestedAt"`
	BundleCounts      EconomicsIntegrationRecordCounts `json:"bundleCounts"`
	AddedCounts       EconomicsIntegrationRecordCounts `json:"addedCounts"`
	EvidenceClass     string                           `json:"evidenceClass"`
	SharedTestnet     bool                             `json:"sharedTestnet"`
	PublicDeployment  bool                             `json:"publicDeployment"`
	Production        bool                             `json:"production"`
	AuditHash         string                           `json:"auditHash"`
}

type EconomicsIntegrationStoreAuditEvent struct {
	SchemaVersion     int                              `json:"schemaVersion"`
	Version           int                              `json:"version"`
	ID                string                           `json:"id"`
	Type              string                           `json:"type"`
	ContractID        string                           `json:"contractId"`
	SourceCommit      string                           `json:"sourceCommit"`
	BundleHash        string                           `json:"bundleHash"`
	AcceptedBundleID  string                           `json:"acceptedBundleId"`
	IngestedAt        time.Time                        `json:"ingestedAt"`
	OpeningRevision   int64                            `json:"openingRevision"`
	ClosingRevision   int64                            `json:"closingRevision"`
	PreviousStateHash string                           `json:"previousStateHash"`
	AddedCounts       EconomicsIntegrationRecordCounts `json:"addedCounts"`
	EvidenceClass     string                           `json:"evidenceClass"`
	AuditHash         string                           `json:"auditHash"`
}

type EconomicsIntegrationStore struct {
	SchemaVersion   int                                   `json:"schemaVersion"`
	ContractID      string                                `json:"contractId"`
	CreatedAt       time.Time                             `json:"createdAt"`
	UpdatedAt       time.Time                             `json:"updatedAt"`
	Revision        int64                                 `json:"revision"`
	AcceptedBundles []EconomicsIntegrationAcceptedBundle  `json:"acceptedBundles"`
	Envelopes       []EconomicsIntegrationEnvelope        `json:"envelopes"`
	BillingLedger   []EconomicsBillingLedgerEntry         `json:"billingLedger"`
	Explorer        []EconomicsExplorerProjection         `json:"explorer"`
	Monitor         []EconomicsMonitorCheck               `json:"monitor"`
	AuditEvents     []EconomicsIntegrationStoreAuditEvent `json:"auditEvents"`
	StateHash       string                                `json:"stateHash"`
}

type EconomicsIntegrationIngestReceipt struct {
	SchemaVersion    int                              `json:"schemaVersion"`
	ContractID       string                           `json:"contractId"`
	SourceCommit     string                           `json:"sourceCommit"`
	BundleHash       string                           `json:"bundleHash"`
	IngestedAt       time.Time                        `json:"ingestedAt"`
	Applied          bool                             `json:"applied"`
	Idempotent       bool                             `json:"idempotent"`
	Revision         int64                            `json:"revision"`
	AddedCounts      EconomicsIntegrationRecordCounts `json:"addedCounts"`
	StoreStateHash   string                           `json:"storeStateHash"`
	AcceptedBundleID string                           `json:"acceptedBundleId"`
	AuditHash        string                           `json:"auditHash"`
}

func NewEconomicsIntegrationStore(createdAt time.Time) (EconomicsIntegrationStore, error) {
	if createdAt.IsZero() {
		return EconomicsIntegrationStore{}, runtimeError(CodeIntegrationStoreInvalidTime, "integration store creation time is required")
	}
	createdAt = createdAt.UTC()
	store := EconomicsIntegrationStore{
		SchemaVersion:   EconomicsIntegrationStoreSchemaVersion,
		ContractID:      EconomicsIntegrationContractID,
		CreatedAt:       createdAt,
		UpdatedAt:       createdAt,
		Revision:        1,
		AcceptedBundles: []EconomicsIntegrationAcceptedBundle{},
		Envelopes:       []EconomicsIntegrationEnvelope{},
		BillingLedger:   []EconomicsBillingLedgerEntry{},
		Explorer:        []EconomicsExplorerProjection{},
		Monitor:         []EconomicsMonitorCheck{},
		AuditEvents:     []EconomicsIntegrationStoreAuditEvent{},
	}
	store.StateHash = economicsIntegrationStoreHash(store)
	if err := ValidateEconomicsIntegrationStore(store); err != nil {
		return EconomicsIntegrationStore{}, err
	}
	return store, nil
}

func ApplyEconomicsIntegrationBundle(store EconomicsIntegrationStore, bundle EconomicsIntegrationBundle, ingestedAt time.Time) (EconomicsIntegrationStore, EconomicsIntegrationIngestReceipt, error) {
	if err := ValidateEconomicsIntegrationStore(store); err != nil {
		return EconomicsIntegrationStore{}, EconomicsIntegrationIngestReceipt{}, err
	}
	if err := ValidateEconomicsIntegrationBundle(bundle); err != nil {
		return EconomicsIntegrationStore{}, EconomicsIntegrationIngestReceipt{}, err
	}
	if bundle.ContractID != store.ContractID {
		return EconomicsIntegrationStore{}, EconomicsIntegrationIngestReceipt{}, runtimeError(CodeIntegrationStoreConflict, "integration bundle contract does not match the store contract")
	}
	if ingestedAt.IsZero() {
		return EconomicsIntegrationStore{}, EconomicsIntegrationIngestReceipt{}, runtimeError(CodeIntegrationStoreInvalidTime, "integration ingest time is required")
	}
	ingestedAt = ingestedAt.UTC()
	if ingestedAt.Before(store.CreatedAt) || ingestedAt.Before(bundle.GeneratedAt) {
		return EconomicsIntegrationStore{}, EconomicsIntegrationIngestReceipt{}, runtimeError(CodeIntegrationStoreInvalidTime, "integration ingest time predates the store or bundle evidence")
	}

	for _, accepted := range store.AcceptedBundles {
		if accepted.SourceCommit == bundle.SourceCommit {
			if accepted.BundleHash != bundle.BundleHash {
				return EconomicsIntegrationStore{}, EconomicsIntegrationIngestReceipt{}, runtimeError(CodeIntegrationStoreConflict, "the source commit is already bound to a different integration bundle")
			}
			receipt := newEconomicsIntegrationIngestReceipt(store, accepted, false, true, EconomicsIntegrationRecordCounts{})
			return store, receipt, nil
		}
		if accepted.BundleHash == bundle.BundleHash {
			return EconomicsIntegrationStore{}, EconomicsIntegrationIngestReceipt{}, runtimeError(CodeIntegrationStoreConflict, "the integration bundle hash is already bound to a different source commit")
		}
	}
	if !ingestedAt.After(store.UpdatedAt) {
		return EconomicsIntegrationStore{}, EconomicsIntegrationIngestReceipt{}, runtimeError(CodeIntegrationStoreInvalidTime, "new integration bundles must be ingested after the current store update time")
	}

	next := cloneEconomicsIntegrationStore(store)
	added, err := mergeEconomicsIntegrationBundle(&next, bundle)
	if err != nil {
		return EconomicsIntegrationStore{}, EconomicsIntegrationIngestReceipt{}, err
	}
	accepted := EconomicsIntegrationAcceptedBundle{
		SchemaVersion:     EconomicsIntegrationStoreSchemaVersion,
		ContractID:        EconomicsIntegrationContractID,
		SourceCommit:      bundle.SourceCommit,
		BundleHash:        bundle.BundleHash,
		EconomicStateHash: bundle.EconomicStateHash,
		StakingStateHash:  bundle.StakingStateHash,
		SafetyStateHash:   bundle.SafetyStateHash,
		GeneratedAt:       bundle.GeneratedAt.UTC(),
		IngestedAt:        ingestedAt,
		BundleCounts: EconomicsIntegrationRecordCounts{
			Envelopes:     len(bundle.Envelopes),
			BillingLedger: len(bundle.BillingLedger),
			Explorer:      len(bundle.Explorer),
			Monitor:       len(bundle.Monitor),
		},
		AddedCounts:      added,
		EvidenceClass:    IntegrationEvidenceClass,
		SharedTestnet:    false,
		PublicDeployment: false,
		Production:       false,
	}
	accepted.ID = economicsIntegrationAcceptedBundleID(accepted)
	accepted.AuditHash = economicsIntegrationAcceptedBundleHash(accepted)
	next.AcceptedBundles = append(next.AcceptedBundles, accepted)

	event := EconomicsIntegrationStoreAuditEvent{
		SchemaVersion:     EconomicsIntegrationStoreSchemaVersion,
		Version:           1,
		Type:              "ynx.economics.integration.bundle_ingested.v1",
		ContractID:        EconomicsIntegrationContractID,
		SourceCommit:      bundle.SourceCommit,
		BundleHash:        bundle.BundleHash,
		AcceptedBundleID:  accepted.ID,
		IngestedAt:        ingestedAt,
		OpeningRevision:   store.Revision,
		ClosingRevision:   store.Revision + 1,
		PreviousStateHash: store.StateHash,
		AddedCounts:       added,
		EvidenceClass:     IntegrationEvidenceClass,
	}
	event.ID = economicsIntegrationStoreAuditEventID(event)
	event.AuditHash = economicsIntegrationStoreAuditEventHash(event)
	next.AuditEvents = append(next.AuditEvents, event)
	next.UpdatedAt = ingestedAt
	next.Revision = store.Revision + 1
	sortEconomicsIntegrationStore(&next)
	next.StateHash = economicsIntegrationStoreHash(next)
	if err := ValidateEconomicsIntegrationStore(next); err != nil {
		return EconomicsIntegrationStore{}, EconomicsIntegrationIngestReceipt{}, err
	}
	receipt := newEconomicsIntegrationIngestReceipt(next, accepted, true, false, added)
	return next, receipt, nil
}

func ValidateEconomicsIntegrationStore(store EconomicsIntegrationStore) error {
	if store.SchemaVersion != EconomicsIntegrationStoreSchemaVersion || store.ContractID != EconomicsIntegrationContractID || store.CreatedAt.IsZero() || store.UpdatedAt.Before(store.CreatedAt) || store.Revision != int64(1+len(store.AcceptedBundles)) || len(store.AcceptedBundles) != len(store.AuditEvents) {
		return runtimeError(CodeIntegrationStoreInvalidState, "integration store metadata or revision is invalid")
	}
	if (len(store.AcceptedBundles) == 0 && !store.UpdatedAt.Equal(store.CreatedAt)) || (len(store.AcceptedBundles) > 0 && !store.UpdatedAt.Equal(store.AcceptedBundles[len(store.AcceptedBundles)-1].IngestedAt)) {
		return runtimeError(CodeIntegrationStoreInvalidState, "integration store update time does not match accepted bundle history")
	}

	acceptedCommits := map[string]bool{}
	acceptedHashes := map[string]bool{}
	acceptedIDs := map[string]EconomicsIntegrationAcceptedBundle{}
	cumulativeAdded := EconomicsIntegrationRecordCounts{}
	var previousAcceptedAt time.Time
	for _, accepted := range store.AcceptedBundles {
		if err := validateEconomicsIntegrationAcceptedBundle(accepted); err != nil {
			return err
		}
		if acceptedCommits[accepted.SourceCommit] || acceptedHashes[accepted.BundleHash] || acceptedIDs[accepted.ID].ID != "" || (!previousAcceptedAt.IsZero() && !accepted.IngestedAt.After(previousAcceptedAt)) || accepted.IngestedAt.After(store.UpdatedAt) {
			return runtimeError(CodeIntegrationStoreInvalidState, "integration accepted bundle history is duplicate or non-monotonic")
		}
		acceptedCommits[accepted.SourceCommit] = true
		acceptedHashes[accepted.BundleHash] = true
		acceptedIDs[accepted.ID] = accepted
		var ok bool
		cumulativeAdded, ok = addIntegrationRecordCounts(cumulativeAdded, accepted.AddedCounts)
		if !ok {
			return runtimeError(CodeIntegrationStoreInvalidState, "integration accepted bundle counts overflow")
		}
		previousAcceptedAt = accepted.IngestedAt
	}
	if cumulativeAdded != (EconomicsIntegrationRecordCounts{Envelopes: len(store.Envelopes), BillingLedger: len(store.BillingLedger), Explorer: len(store.Explorer), Monitor: len(store.Monitor)}) {
		return runtimeError(CodeIntegrationStoreInvalidState, "integration accepted bundle counts do not match stored records")
	}

	var previousAuditAt time.Time
	previousRevision := int64(1)
	previousStateHash := economicsIntegrationStoreInitialHash(store.CreatedAt)
	for index, event := range store.AuditEvents {
		if err := validateEconomicsIntegrationStoreAuditEvent(event); err != nil {
			return err
		}
		accepted, exists := acceptedIDs[event.AcceptedBundleID]
		if !exists || event.SourceCommit != accepted.SourceCommit || event.BundleHash != accepted.BundleHash || event.IngestedAt != accepted.IngestedAt || event.AddedCounts != accepted.AddedCounts || event.OpeningRevision != previousRevision || event.ClosingRevision != previousRevision+1 || event.PreviousStateHash != previousStateHash || (!previousAuditAt.IsZero() && !event.IngestedAt.After(previousAuditAt)) {
			return runtimeError(CodeIntegrationStoreInvalidState, "integration store audit history does not reconcile")
		}
		previousRevision = event.ClosingRevision
		previousAuditAt = event.IngestedAt
		if index+1 < len(store.AuditEvents) {
			previousStateHash = integrationStorePrefixHash(store, index+1)
		}
	}

	if err := validateStoredIntegrationRecords(store, acceptedCommits); err != nil {
		return err
	}
	if store.StateHash != economicsIntegrationStoreHash(store) {
		return runtimeError(CodeIntegrationStoreTampered, "integration store state hash mismatch")
	}
	return nil
}

func SaveEconomicsIntegrationStore(path string, store EconomicsIntegrationStore) error {
	if strings.TrimSpace(path) == "" {
		return runtimeError(CodeIntegrationStoreIO, "integration store path is required")
	}
	if err := ValidateEconomicsIntegrationStore(store); err != nil {
		return err
	}
	cleanPath := filepath.Clean(path)
	if info, err := os.Lstat(cleanPath); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return runtimeError(CodeIntegrationStoreIO, "integration store path must not be a symlink")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return runtimeError(CodeIntegrationStoreIO, err.Error())
	}
	directory := filepath.Dir(cleanPath)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return runtimeError(CodeIntegrationStoreIO, err.Error())
	}
	payload, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return runtimeError(CodeIntegrationStoreIO, err.Error())
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(directory, ".ynx-economics-integration-*.tmp")
	if err != nil {
		return runtimeError(CodeIntegrationStoreIO, err.Error())
	}
	temporaryPath := temporary.Name()
	removeTemporary := true
	defer func() {
		_ = temporary.Close()
		if removeTemporary {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		return runtimeError(CodeIntegrationStoreIO, err.Error())
	}
	if _, err := temporary.Write(payload); err != nil {
		return runtimeError(CodeIntegrationStoreIO, err.Error())
	}
	if err := temporary.Sync(); err != nil {
		return runtimeError(CodeIntegrationStoreIO, err.Error())
	}
	if err := temporary.Close(); err != nil {
		return runtimeError(CodeIntegrationStoreIO, err.Error())
	}
	if err := os.Rename(temporaryPath, cleanPath); err != nil {
		return runtimeError(CodeIntegrationStoreIO, err.Error())
	}
	removeTemporary = false
	if err := os.Chmod(cleanPath, 0o600); err != nil {
		return runtimeError(CodeIntegrationStoreIO, err.Error())
	}
	if directoryHandle, err := os.Open(directory); err == nil {
		_ = directoryHandle.Sync()
		_ = directoryHandle.Close()
	}
	return nil
}

func LoadEconomicsIntegrationStore(path string) (EconomicsIntegrationStore, error) {
	if strings.TrimSpace(path) == "" {
		return EconomicsIntegrationStore{}, runtimeError(CodeIntegrationStoreIO, "integration store path is required")
	}
	cleanPath := filepath.Clean(path)
	info, err := os.Lstat(cleanPath)
	if err != nil {
		return EconomicsIntegrationStore{}, runtimeError(CodeIntegrationStoreIO, err.Error())
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return EconomicsIntegrationStore{}, runtimeError(CodeIntegrationStoreIO, "integration store must be a regular non-symlink file")
	}
	if info.Mode().Perm()&0o077 != 0 {
		return EconomicsIntegrationStore{}, runtimeError(CodeIntegrationStoreIO, "integration store permissions must not grant group or world access")
	}
	if info.Size() <= 0 || info.Size() > EconomicsIntegrationStoreMaxBytes {
		return EconomicsIntegrationStore{}, runtimeError(CodeIntegrationStoreIO, "integration store size is invalid")
	}
	file, err := os.Open(cleanPath)
	if err != nil {
		return EconomicsIntegrationStore{}, runtimeError(CodeIntegrationStoreIO, err.Error())
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, EconomicsIntegrationStoreMaxBytes+1))
	decoder.DisallowUnknownFields()
	var store EconomicsIntegrationStore
	if err := decoder.Decode(&store); err != nil {
		return EconomicsIntegrationStore{}, runtimeError(CodeIntegrationStoreIO, "decode integration store: "+err.Error())
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return EconomicsIntegrationStore{}, runtimeError(CodeIntegrationStoreIO, "integration store must contain exactly one JSON value")
	}
	if err := ValidateEconomicsIntegrationStore(store); err != nil {
		return EconomicsIntegrationStore{}, err
	}
	return store, nil
}

func mergeEconomicsIntegrationBundle(store *EconomicsIntegrationStore, bundle EconomicsIntegrationBundle) (EconomicsIntegrationRecordCounts, error) {
	added := EconomicsIntegrationRecordCounts{}
	envelopeIndex := make(map[string]EconomicsIntegrationEnvelope, len(store.Envelopes))
	for _, record := range store.Envelopes {
		envelopeIndex[record.EventID] = record
	}
	for _, incoming := range bundle.Envelopes {
		if existing, ok := envelopeIndex[incoming.EventID]; ok {
			if !equalIntegrationEnvelopeFact(existing, incoming) {
				return EconomicsIntegrationRecordCounts{}, runtimeError(CodeIntegrationStoreConflict, "canonical event id maps to conflicting economic facts")
			}
			continue
		}
		store.Envelopes = append(store.Envelopes, incoming)
		envelopeIndex[incoming.EventID] = incoming
		added.Envelopes++
	}

	ledgerIndex := make(map[string]EconomicsBillingLedgerEntry, len(store.BillingLedger))
	for _, record := range store.BillingLedger {
		ledgerIndex[integrationLedgerSemanticKey(record)] = record
	}
	for _, incoming := range bundle.BillingLedger {
		key := integrationLedgerSemanticKey(incoming)
		if existing, ok := ledgerIndex[key]; ok {
			if !equalIntegrationLedgerFact(existing, incoming) {
				return EconomicsIntegrationRecordCounts{}, runtimeError(CodeIntegrationStoreConflict, "billing semantic key maps to conflicting economic facts")
			}
			continue
		}
		store.BillingLedger = append(store.BillingLedger, incoming)
		ledgerIndex[key] = incoming
		added.BillingLedger++
	}

	explorerIndex := make(map[string]EconomicsExplorerProjection, len(store.Explorer))
	for _, record := range store.Explorer {
		explorerIndex[record.SourceEventID] = record
	}
	for _, incoming := range bundle.Explorer {
		if existing, ok := explorerIndex[incoming.SourceEventID]; ok {
			if !equalIntegrationExplorerFact(existing, incoming) {
				return EconomicsIntegrationRecordCounts{}, runtimeError(CodeIntegrationStoreConflict, "Explorer source event maps to conflicting economic facts")
			}
			continue
		}
		store.Explorer = append(store.Explorer, incoming)
		explorerIndex[incoming.SourceEventID] = incoming
		added.Explorer++
	}

	monitorIndex := make(map[string]EconomicsMonitorCheck, len(store.Monitor))
	for _, record := range store.Monitor {
		monitorIndex[integrationMonitorSemanticKey(record)] = record
	}
	for _, incoming := range bundle.Monitor {
		key := integrationMonitorSemanticKey(incoming)
		if existing, ok := monitorIndex[key]; ok {
			if !equalIntegrationMonitorFact(existing, incoming) {
				return EconomicsIntegrationRecordCounts{}, runtimeError(CodeIntegrationStoreConflict, "Monitor semantic key maps to conflicting economic facts")
			}
			continue
		}
		store.Monitor = append(store.Monitor, incoming)
		monitorIndex[key] = incoming
		added.Monitor++
	}
	return added, nil
}

func validateStoredIntegrationRecords(store EconomicsIntegrationStore, acceptedCommits map[string]bool) error {
	envelopes := map[string]EconomicsIntegrationEnvelope{}
	var previousEnvelopeAt time.Time
	for _, record := range store.Envelopes {
		if err := ValidateEconomicsIntegrationEnvelope(record); err != nil {
			return err
		}
		if !acceptedCommits[record.SourceCommit] {
			return runtimeError(CodeIntegrationStoreInvalidState, "stored canonical event source commit was not accepted")
		}
		if _, exists := envelopes[record.EventID]; exists || (!previousEnvelopeAt.IsZero() && record.OccurredAt.Before(previousEnvelopeAt)) {
			return runtimeError(CodeIntegrationStoreInvalidState, "stored canonical events are duplicate or non-monotonic")
		}
		envelopes[record.EventID] = record
		previousEnvelopeAt = record.OccurredAt
	}

	ledgerKeys := map[string]bool{}
	ledgerByEvent := map[string][]EconomicsBillingLedgerEntry{}
	var previousLedgerAt time.Time
	for _, record := range store.BillingLedger {
		if err := ValidateEconomicsBillingLedgerEntry(record); err != nil {
			return err
		}
		if !acceptedCommits[record.SourceCommit] {
			return runtimeError(CodeIntegrationStoreInvalidState, "stored billing source commit was not accepted")
		}
		key := integrationLedgerSemanticKey(record)
		envelope, exists := envelopes[record.SourceEventID]
		if ledgerKeys[key] || !exists || envelope.EventType != "ynx.economics.epoch_settled.v1" || (!previousLedgerAt.IsZero() && record.OccurredAt.Before(previousLedgerAt)) {
			return runtimeError(CodeIntegrationStoreInvalidState, "stored billing records are duplicate, orphaned or non-monotonic")
		}
		ledgerKeys[key] = true
		ledgerByEvent[record.SourceEventID] = append(ledgerByEvent[record.SourceEventID], record)
		previousLedgerAt = record.OccurredAt
	}
	for eventID, envelope := range envelopes {
		if envelope.EventType == "ynx.economics.epoch_settled.v1" {
			entries := ledgerByEvent[eventID]
			if len(entries) != 6 || validateBillingLedgerGroup(envelope, entries) != nil {
				return runtimeError(CodeIntegrationStoreInvalidState, "stored billing records do not fully reconcile an economics event")
			}
		}
	}

	projected := map[string]bool{}
	var previousProjectionAt time.Time
	for _, record := range store.Explorer {
		if err := ValidateEconomicsExplorerProjection(record); err != nil {
			return err
		}
		if !acceptedCommits[record.SourceCommit] {
			return runtimeError(CodeIntegrationStoreInvalidState, "stored Explorer source commit was not accepted")
		}
		envelope, exists := envelopes[record.SourceEventID]
		if projected[record.SourceEventID] || !exists || record.EventType != envelope.EventType || (!previousProjectionAt.IsZero() && record.OccurredAt.Before(previousProjectionAt)) {
			return runtimeError(CodeIntegrationStoreInvalidState, "stored Explorer records are duplicate, orphaned or non-monotonic")
		}
		if err := validateProjectionAgainstEnvelope(record, envelope); err != nil {
			return err
		}
		projected[record.SourceEventID] = true
		previousProjectionAt = record.OccurredAt
	}
	if len(projected) != len(envelopes) {
		return runtimeError(CodeIntegrationStoreInvalidState, "stored Explorer records do not cover every canonical event")
	}

	monitorKeys := map[string]bool{}
	monitorCounts := map[string]int{}
	var previousMonitorAt time.Time
	for _, record := range store.Monitor {
		if err := ValidateEconomicsMonitorCheck(record); err != nil {
			return err
		}
		if !acceptedCommits[record.SourceCommit] {
			return runtimeError(CodeIntegrationStoreInvalidState, "stored Monitor source commit was not accepted")
		}
		key := integrationMonitorSemanticKey(record)
		if monitorKeys[key] || envelopes[record.SourceEventID].EventID == "" || (!previousMonitorAt.IsZero() && record.OccurredAt.Before(previousMonitorAt)) {
			return runtimeError(CodeIntegrationStoreInvalidState, "stored Monitor records are duplicate, orphaned or non-monotonic")
		}
		monitorKeys[key] = true
		monitorCounts[record.SourceEventID]++
		previousMonitorAt = record.OccurredAt
	}
	for eventID := range envelopes {
		if monitorCounts[eventID] == 0 {
			return runtimeError(CodeIntegrationStoreInvalidState, "stored Monitor records do not cover every canonical event")
		}
	}
	return nil
}

func validateEconomicsIntegrationAcceptedBundle(record EconomicsIntegrationAcceptedBundle) error {
	if record.SchemaVersion != EconomicsIntegrationStoreSchemaVersion || record.ContractID != EconomicsIntegrationContractID || record.ID != economicsIntegrationAcceptedBundleID(record) || record.AuditHash != economicsIntegrationAcceptedBundleHash(record) || !validIntegrationSourceCommit(record.SourceCommit) || !validEvidenceHash(record.BundleHash) || !validEvidenceHash(record.EconomicStateHash) || !validEvidenceHash(record.StakingStateHash) || (record.SafetyStateHash != "" && !validEvidenceHash(record.SafetyStateHash)) || record.GeneratedAt.IsZero() || record.IngestedAt.Before(record.GeneratedAt) || record.EvidenceClass != IntegrationEvidenceClass || record.SharedTestnet || record.PublicDeployment || record.Production || !validIntegrationBundleCounts(record.BundleCounts) || !validIntegrationRecordCounts(record.AddedCounts) || exceedsIntegrationCounts(record.AddedCounts, record.BundleCounts) {
		return runtimeError(CodeIntegrationStoreInvalidState, "accepted integration bundle record is invalid")
	}
	return nil
}

func validateEconomicsIntegrationStoreAuditEvent(event EconomicsIntegrationStoreAuditEvent) error {
	if event.SchemaVersion != EconomicsIntegrationStoreSchemaVersion || event.Version != 1 || event.Type != "ynx.economics.integration.bundle_ingested.v1" || event.ContractID != EconomicsIntegrationContractID || event.ID != economicsIntegrationStoreAuditEventID(event) || event.AuditHash != economicsIntegrationStoreAuditEventHash(event) || !validIntegrationSourceCommit(event.SourceCommit) || !validEvidenceHash(event.BundleHash) || strings.TrimSpace(event.AcceptedBundleID) == "" || event.IngestedAt.IsZero() || event.OpeningRevision < 1 || event.ClosingRevision != event.OpeningRevision+1 || !validEvidenceHash(event.PreviousStateHash) || !validIntegrationRecordCounts(event.AddedCounts) || event.EvidenceClass != IntegrationEvidenceClass {
		return runtimeError(CodeIntegrationStoreInvalidState, "integration store audit event is invalid")
	}
	return nil
}

func newEconomicsIntegrationIngestReceipt(store EconomicsIntegrationStore, accepted EconomicsIntegrationAcceptedBundle, applied, idempotent bool, added EconomicsIntegrationRecordCounts) EconomicsIntegrationIngestReceipt {
	receipt := EconomicsIntegrationIngestReceipt{
		SchemaVersion:    EconomicsIntegrationStoreSchemaVersion,
		ContractID:       EconomicsIntegrationContractID,
		SourceCommit:     accepted.SourceCommit,
		BundleHash:       accepted.BundleHash,
		IngestedAt:       accepted.IngestedAt,
		Applied:          applied,
		Idempotent:       idempotent,
		Revision:         store.Revision,
		AddedCounts:      added,
		StoreStateHash:   store.StateHash,
		AcceptedBundleID: accepted.ID,
	}
	receipt.AuditHash = integrationCanonicalHash("YNX_ECONOMICS_INTEGRATION_INGEST_RECEIPT_V1", receipt)
	return receipt
}

func sortEconomicsIntegrationStore(store *EconomicsIntegrationStore) {
	sort.Slice(store.AcceptedBundles, func(i, j int) bool {
		return store.AcceptedBundles[i].IngestedAt.Before(store.AcceptedBundles[j].IngestedAt)
	})
	sort.Slice(store.Envelopes, func(i, j int) bool {
		if store.Envelopes[i].OccurredAt.Equal(store.Envelopes[j].OccurredAt) {
			return store.Envelopes[i].EventID < store.Envelopes[j].EventID
		}
		return store.Envelopes[i].OccurredAt.Before(store.Envelopes[j].OccurredAt)
	})
	sort.Slice(store.BillingLedger, func(i, j int) bool {
		if store.BillingLedger[i].OccurredAt.Equal(store.BillingLedger[j].OccurredAt) {
			return integrationLedgerSemanticKey(store.BillingLedger[i]) < integrationLedgerSemanticKey(store.BillingLedger[j])
		}
		return store.BillingLedger[i].OccurredAt.Before(store.BillingLedger[j].OccurredAt)
	})
	sort.Slice(store.Explorer, func(i, j int) bool {
		if store.Explorer[i].OccurredAt.Equal(store.Explorer[j].OccurredAt) {
			return store.Explorer[i].SourceEventID < store.Explorer[j].SourceEventID
		}
		return store.Explorer[i].OccurredAt.Before(store.Explorer[j].OccurredAt)
	})
	sort.Slice(store.Monitor, func(i, j int) bool {
		if store.Monitor[i].OccurredAt.Equal(store.Monitor[j].OccurredAt) {
			return integrationMonitorSemanticKey(store.Monitor[i]) < integrationMonitorSemanticKey(store.Monitor[j])
		}
		return store.Monitor[i].OccurredAt.Before(store.Monitor[j].OccurredAt)
	})
	sort.Slice(store.AuditEvents, func(i, j int) bool { return store.AuditEvents[i].IngestedAt.Before(store.AuditEvents[j].IngestedAt) })
}

func cloneEconomicsIntegrationStore(store EconomicsIntegrationStore) EconomicsIntegrationStore {
	payload, _ := json.Marshal(store)
	var cloned EconomicsIntegrationStore
	_ = json.Unmarshal(payload, &cloned)
	return cloned
}

func equalIntegrationEnvelopeFact(left, right EconomicsIntegrationEnvelope) bool {
	left.SourceCommit, left.AuditHash = "", ""
	right.SourceCommit, right.AuditHash = "", ""
	return reflect.DeepEqual(left, right)
}

func equalIntegrationLedgerFact(left, right EconomicsBillingLedgerEntry) bool {
	left.ID, left.SourceCommit, left.AuditHash = "", "", ""
	right.ID, right.SourceCommit, right.AuditHash = "", "", ""
	return reflect.DeepEqual(left, right)
}

func equalIntegrationExplorerFact(left, right EconomicsExplorerProjection) bool {
	left.ID, left.SourceCommit, left.AuditHash = "", "", ""
	right.ID, right.SourceCommit, right.AuditHash = "", "", ""
	return reflect.DeepEqual(left, right)
}

func equalIntegrationMonitorFact(left, right EconomicsMonitorCheck) bool {
	left.ID, left.SourceCommit, left.AuditHash = "", "", ""
	right.ID, right.SourceCommit, right.AuditHash = "", "", ""
	return reflect.DeepEqual(left, right)
}

func integrationLedgerSemanticKey(entry EconomicsBillingLedgerEntry) string {
	return entry.SourceEventID + "\x00" + entry.FlowClass
}

func integrationMonitorSemanticKey(check EconomicsMonitorCheck) string {
	return check.SourceEventID + "\x00" + check.Check
}

func validIntegrationRecordCounts(counts EconomicsIntegrationRecordCounts) bool {
	return counts.Envelopes >= 0 && counts.BillingLedger >= 0 && counts.Explorer >= 0 && counts.Monitor >= 0
}

func validIntegrationBundleCounts(counts EconomicsIntegrationRecordCounts) bool {
	return validIntegrationRecordCounts(counts) && counts.Envelopes > 0 && counts.Explorer == counts.Envelopes && counts.Monitor >= counts.Envelopes && counts.BillingLedger%6 == 0
}

func addIntegrationRecordCounts(left, right EconomicsIntegrationRecordCounts) (EconomicsIntegrationRecordCounts, bool) {
	maximum := int(^uint(0) >> 1)
	if !validIntegrationRecordCounts(left) || !validIntegrationRecordCounts(right) || left.Envelopes > maximum-right.Envelopes || left.BillingLedger > maximum-right.BillingLedger || left.Explorer > maximum-right.Explorer || left.Monitor > maximum-right.Monitor {
		return EconomicsIntegrationRecordCounts{}, false
	}
	return EconomicsIntegrationRecordCounts{
		Envelopes:     left.Envelopes + right.Envelopes,
		BillingLedger: left.BillingLedger + right.BillingLedger,
		Explorer:      left.Explorer + right.Explorer,
		Monitor:       left.Monitor + right.Monitor,
	}, true
}

func exceedsIntegrationCounts(added, total EconomicsIntegrationRecordCounts) bool {
	return added.Envelopes > total.Envelopes || added.BillingLedger > total.BillingLedger || added.Explorer > total.Explorer || added.Monitor > total.Monitor
}

func economicsIntegrationAcceptedBundleID(record EconomicsIntegrationAcceptedBundle) string {
	record.ID, record.AuditHash = "", ""
	return integrationShortID("econaccept_", "YNX_ECONOMICS_INTEGRATION_ACCEPTED_BUNDLE_ID_V1", record)
}

func economicsIntegrationAcceptedBundleHash(record EconomicsIntegrationAcceptedBundle) string {
	record.AuditHash = ""
	return integrationCanonicalHash("YNX_ECONOMICS_INTEGRATION_ACCEPTED_BUNDLE_V1", record)
}

func economicsIntegrationStoreAuditEventID(event EconomicsIntegrationStoreAuditEvent) string {
	event.ID, event.AuditHash = "", ""
	return integrationShortID("econstoreevt_", "YNX_ECONOMICS_INTEGRATION_STORE_EVENT_ID_V1", event)
}

func economicsIntegrationStoreAuditEventHash(event EconomicsIntegrationStoreAuditEvent) string {
	event.AuditHash = ""
	return integrationCanonicalHash("YNX_ECONOMICS_INTEGRATION_STORE_EVENT_V1", event)
}

func economicsIntegrationStoreHash(store EconomicsIntegrationStore) string {
	store.StateHash = ""
	return integrationCanonicalHash("YNX_ECONOMICS_INTEGRATION_STORE_V1", store)
}

func economicsIntegrationStoreInitialHash(createdAt time.Time) string {
	return newEconomicsIntegrationStoreUnchecked(createdAt).StateHash
}

func newEconomicsIntegrationStoreUnchecked(createdAt time.Time) EconomicsIntegrationStore {
	store := EconomicsIntegrationStore{
		SchemaVersion:   EconomicsIntegrationStoreSchemaVersion,
		ContractID:      EconomicsIntegrationContractID,
		CreatedAt:       createdAt.UTC(),
		UpdatedAt:       createdAt.UTC(),
		Revision:        1,
		AcceptedBundles: []EconomicsIntegrationAcceptedBundle{},
		Envelopes:       []EconomicsIntegrationEnvelope{},
		BillingLedger:   []EconomicsBillingLedgerEntry{},
		Explorer:        []EconomicsExplorerProjection{},
		Monitor:         []EconomicsMonitorCheck{},
		AuditEvents:     []EconomicsIntegrationStoreAuditEvent{},
	}
	store.StateHash = economicsIntegrationStoreHash(store)
	return store
}

func integrationStorePrefixHash(store EconomicsIntegrationStore, acceptedCount int) string {
	if acceptedCount <= 0 {
		return economicsIntegrationStoreInitialHash(store.CreatedAt)
	}
	prefix := cloneEconomicsIntegrationStore(store)
	prefix.AcceptedBundles = append([]EconomicsIntegrationAcceptedBundle(nil), store.AcceptedBundles[:acceptedCount]...)
	prefix.AuditEvents = append([]EconomicsIntegrationStoreAuditEvent(nil), store.AuditEvents[:acceptedCount]...)
	acceptedAt := prefix.AcceptedBundles[acceptedCount-1].IngestedAt
	prefix.UpdatedAt = acceptedAt
	prefix.Revision = int64(1 + acceptedCount)

	acceptedCommits := map[string]bool{}
	for _, accepted := range prefix.AcceptedBundles {
		acceptedCommits[accepted.SourceCommit] = true
	}
	prefix.Envelopes = filterIntegrationEnvelopes(store.Envelopes, acceptedCommits)
	prefix.BillingLedger = filterIntegrationLedger(store.BillingLedger, acceptedCommits)
	prefix.Explorer = filterIntegrationExplorer(store.Explorer, acceptedCommits)
	prefix.Monitor = filterIntegrationMonitor(store.Monitor, acceptedCommits)
	prefix.StateHash = economicsIntegrationStoreHash(prefix)
	return prefix.StateHash
}

func filterIntegrationEnvelopes(records []EconomicsIntegrationEnvelope, commits map[string]bool) []EconomicsIntegrationEnvelope {
	result := []EconomicsIntegrationEnvelope{}
	for _, record := range records {
		if commits[record.SourceCommit] {
			result = append(result, record)
		}
	}
	return result
}

func filterIntegrationLedger(records []EconomicsBillingLedgerEntry, commits map[string]bool) []EconomicsBillingLedgerEntry {
	result := []EconomicsBillingLedgerEntry{}
	for _, record := range records {
		if commits[record.SourceCommit] {
			result = append(result, record)
		}
	}
	return result
}

func filterIntegrationExplorer(records []EconomicsExplorerProjection, commits map[string]bool) []EconomicsExplorerProjection {
	result := []EconomicsExplorerProjection{}
	for _, record := range records {
		if commits[record.SourceCommit] {
			result = append(result, record)
		}
	}
	return result
}

func filterIntegrationMonitor(records []EconomicsMonitorCheck, commits map[string]bool) []EconomicsMonitorCheck {
	result := []EconomicsMonitorCheck{}
	for _, record := range records {
		if commits[record.SourceCommit] {
			result = append(result, record)
		}
	}
	return result
}

func integrationShortID(prefix, domain string, value any) string {
	raw, _ := json.Marshal(value)
	hash := integrationPayloadHash(append([]byte(domain+"\x00"), raw...))
	decoded, _ := hex.DecodeString(strings.TrimPrefix(hash, "sha256:"))
	return prefix + hex.EncodeToString(decoded[:12])
}
