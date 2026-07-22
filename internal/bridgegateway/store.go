package bridgegateway

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type idempotencyRecord struct {
	Digest     string `json:"digest"`
	TransferID string `json:"transferId"`
}

type persistentState struct {
	SchemaVersion                   int                          `json:"schemaVersion"`
	Transfers                       map[string]Transfer          `json:"transfers"`
	SourceEvents                    map[string]string            `json:"sourceEvents"`
	CreateIdempotency               map[string]idempotencyRecord `json:"createIdempotency"`
	FinalizeIdempotency             map[string]idempotencyRecord `json:"finalizeIdempotency"`
	MutationIdempotency             map[string]idempotencyRecord `json:"mutationIdempotency"`
	Safety                          SafetyState                  `json:"safety"`
	Reconciliations                 map[string]Reconciliation    `json:"reconciliations,omitempty"`
	ReconciliationResults           map[string]Reconciliation    `json:"reconciliationResults,omitempty"`
	ReconciliationReplayUnavailable map[string]bool              `json:"reconciliationReplayUnavailable,omitempty"`
	DataRequests                    map[string]DataRequest       `json:"dataRequests,omitempty"`
	Audit                           []AuditEvent                 `json:"audit"`
	Integrity                       string                       `json:"integrity"`
}

type legacyTransferV1 struct {
	ID                        string                 `json:"id"`
	Status                    string                 `json:"status"`
	IntentDigest              string                 `json:"intentDigest"`
	SourceChain               string                 `json:"sourceChain"`
	SourceTxHash              string                 `json:"sourceTxHash"`
	SourceEventIndex          uint64                 `json:"sourceEventIndex"`
	SourceAsset               string                 `json:"sourceAsset"`
	DestinationChain          string                 `json:"destinationChain"`
	DestinationAsset          string                 `json:"destinationAsset"`
	Amount                    string                 `json:"amount"`
	Sender                    string                 `json:"sender"`
	Recipient                 string                 `json:"recipient"`
	AssetBoundary             string                 `json:"assetBoundary"`
	RequiredConfirmations     uint64                 `json:"requiredConfirmations"`
	RequiredAttestations      int                    `json:"requiredAttestations"`
	SourceBlockHash           string                 `json:"sourceBlockHash,omitempty"`
	Attestations              map[string]Attestation `json:"attestations"`
	CreatedAt                 string                 `json:"createdAt"`
	UpdatedAt                 string                 `json:"updatedAt"`
	FinalizationID            string                 `json:"finalizationId,omitempty"`
	FinalizedAt               string                 `json:"finalizedAt,omitempty"`
	ExternalSubmissionEnabled bool                   `json:"externalSubmissionEnabled"`
}

type legacyStateV1 struct {
	SchemaVersion       int                          `json:"schemaVersion"`
	Transfers           map[string]legacyTransferV1  `json:"transfers"`
	SourceEvents        map[string]string            `json:"sourceEvents"`
	CreateIdempotency   map[string]idempotencyRecord `json:"createIdempotency"`
	FinalizeIdempotency map[string]idempotencyRecord `json:"finalizeIdempotency"`
	Audit               []AuditEvent                 `json:"audit"`
	Integrity           string                       `json:"integrity"`
}

func newPersistentState() persistentState {
	return persistentState{
		SchemaVersion: SchemaVersion, Transfers: map[string]Transfer{}, SourceEvents: map[string]string{},
		CreateIdempotency: map[string]idempotencyRecord{}, FinalizeIdempotency: map[string]idempotencyRecord{}, MutationIdempotency: map[string]idempotencyRecord{}, Reconciliations: map[string]Reconciliation{}, ReconciliationResults: map[string]Reconciliation{}, ReconciliationReplayUnavailable: map[string]bool{}, DataRequests: map[string]DataRequest{}, Audit: []AuditEvent{},
	}
}

func loadState(path string) (persistentState, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return newPersistentState(), nil
	}
	if err != nil {
		return persistentState{}, fmt.Errorf("read bridge state: %w", err)
	}
	var state persistentState
	if err := json.Unmarshal(raw, &state); err != nil {
		return persistentState{}, fmt.Errorf("decode bridge state: %w", err)
	}
	if state.SchemaVersion == 1 {
		return loadLegacyStateV1(raw)
	}
	if state.SchemaVersion == 2 {
		return loadLegacyStateV2(state)
	}
	if state.SchemaVersion == 3 {
		return loadLegacyStateV3(state)
	}
	if state.SchemaVersion == 4 {
		return loadLegacyStateV4(state)
	}
	if state.SchemaVersion == 5 {
		return loadLegacyStateV5(state)
	}
	if state.SchemaVersion != SchemaVersion || state.Transfers == nil || state.SourceEvents == nil || state.CreateIdempotency == nil || state.FinalizeIdempotency == nil || state.MutationIdempotency == nil || state.Audit == nil {
		return persistentState{}, errors.New("bridge state schema is invalid")
	}
	got := state.Integrity
	state.Integrity = ""
	expected, err := stateDigest(state)
	if err != nil || got != expected {
		return persistentState{}, errors.New("bridge state integrity mismatch")
	}
	state.Integrity = got
	if state.Reconciliations == nil {
		state.Reconciliations = map[string]Reconciliation{}
	}
	if state.ReconciliationResults == nil {
		state.ReconciliationResults = map[string]Reconciliation{}
	}
	if state.ReconciliationReplayUnavailable == nil {
		state.ReconciliationReplayUnavailable = map[string]bool{}
	}
	if state.DataRequests == nil {
		state.DataRequests = map[string]DataRequest{}
	}
	if err := validateAuditChain(state.Audit); err != nil {
		return persistentState{}, err
	}
	return state, nil
}

func loadLegacyStateV2(state persistentState) (persistentState, error) {
	if state.SchemaVersion != 2 {
		return persistentState{}, errors.New("bridge v2 state schema is invalid")
	}
	return migrateLegacyState(state, false)
}

func loadLegacyStateV3(state persistentState) (persistentState, error) {
	if state.SchemaVersion != 3 {
		return persistentState{}, errors.New("bridge v3 state schema is invalid")
	}
	return migrateLegacyState(state, true)
}

func loadLegacyStateV4(state persistentState) (persistentState, error) {
	if state.SchemaVersion != 4 {
		return persistentState{}, errors.New("bridge v4 state schema is invalid")
	}
	got := state.Integrity
	state.Integrity = ""
	expected, err := stateDigest(state)
	if err != nil || got != expected {
		return persistentState{}, errors.New("bridge state integrity mismatch")
	}
	if state.Transfers == nil || state.SourceEvents == nil || state.CreateIdempotency == nil || state.FinalizeIdempotency == nil || state.MutationIdempotency == nil || state.Audit == nil {
		return persistentState{}, errors.New("bridge v4 state schema is invalid")
	}
	if err := validateAuditChain(state.Audit); err != nil {
		return persistentState{}, err
	}
	state.SchemaVersion = SchemaVersion
	if state.Reconciliations == nil {
		state.Reconciliations = map[string]Reconciliation{}
	}
	state.ReconciliationResults = map[string]Reconciliation{}
	state.ReconciliationReplayUnavailable = legacyReconciliationReplayKeys(state)
	if state.DataRequests == nil {
		state.DataRequests = map[string]DataRequest{}
	}
	for id, transfer := range state.Transfers {
		if len(transfer.Lifecycle) == 0 {
			return persistentState{}, errors.New("bridge v4 transfer lifecycle is missing")
		}
		migrateExposureStatus(&transfer)
		state.Transfers[id] = transfer
	}
	state.Integrity = ""
	return state, nil
}

func loadLegacyStateV5(state persistentState) (persistentState, error) {
	if state.SchemaVersion != 5 {
		return persistentState{}, errors.New("bridge v5 state schema is invalid")
	}
	got := state.Integrity
	state.Integrity = ""
	expected, err := stateDigest(state)
	if err != nil || got != expected {
		return persistentState{}, errors.New("bridge state integrity mismatch")
	}
	if state.Transfers == nil || state.SourceEvents == nil || state.CreateIdempotency == nil || state.FinalizeIdempotency == nil || state.MutationIdempotency == nil || state.Audit == nil {
		return persistentState{}, errors.New("bridge v5 state schema is invalid")
	}
	if err := validateAuditChain(state.Audit); err != nil {
		return persistentState{}, err
	}
	state.SchemaVersion = SchemaVersion
	if state.Reconciliations == nil {
		state.Reconciliations = map[string]Reconciliation{}
	}
	state.ReconciliationResults = map[string]Reconciliation{}
	state.ReconciliationReplayUnavailable = legacyReconciliationReplayKeys(state)
	if state.DataRequests == nil {
		state.DataRequests = map[string]DataRequest{}
	}
	state.Integrity = ""
	return state, nil
}

func migrateLegacyState(state persistentState, preserveDataRequests bool) (persistentState, error) {
	got := state.Integrity
	state.Integrity = ""
	expected, err := stateDigest(state)
	if err != nil || got != expected {
		return persistentState{}, errors.New("bridge state integrity mismatch")
	}
	if state.Transfers == nil || state.SourceEvents == nil || state.CreateIdempotency == nil || state.FinalizeIdempotency == nil || state.MutationIdempotency == nil || state.Audit == nil {
		return persistentState{}, errors.New("bridge v2 state schema is invalid")
	}
	if err := validateAuditChain(state.Audit); err != nil {
		return persistentState{}, err
	}
	for _, transfer := range state.Transfers {
		if len(transfer.Lifecycle) != 0 {
			return persistentState{}, errors.New("bridge legacy state contains unsupported lifecycle data")
		}
	}
	state.SchemaVersion = SchemaVersion
	if state.Reconciliations == nil {
		state.Reconciliations = map[string]Reconciliation{}
	}
	state.ReconciliationResults = map[string]Reconciliation{}
	state.ReconciliationReplayUnavailable = legacyReconciliationReplayKeys(state)
	if !preserveDataRequests {
		state.DataRequests = map[string]DataRequest{}
	} else if state.DataRequests == nil {
		state.DataRequests = map[string]DataRequest{}
	}
	for id, transfer := range state.Transfers {
		migrateLifecycle(&transfer)
		migrateExposureStatus(&transfer)
		state.Transfers[id] = transfer
	}
	state.Integrity = ""
	return state, nil
}

func legacyReconciliationReplayKeys(state persistentState) map[string]bool {
	result := map[string]bool{}
	for idempotencyKey, record := range state.MutationIdempotency {
		if _, ok := state.Reconciliations[record.TransferID]; ok {
			result[idempotencyKey] = true
		}
	}
	return result
}

func migrateExposureStatus(transfer *Transfer) {
	transfer.ExposureStatus = "open"
	for _, event := range transfer.Lifecycle {
		switch event.Phase {
		case "destination_confirmed":
			transfer.ExposureStatus = "destination-confirmed"
		case "refund_recovery":
			transfer.ExposureStatus = "refund-recovered"
		}
	}
}

func migrateLifecycle(transfer *Transfer) {
	if len(transfer.Lifecycle) != 0 || transfer.Phase == "" {
		return
	}
	at := transfer.UpdatedAt
	if at == "" {
		at = transfer.CreatedAt
	}
	transfer.Lifecycle = []LifecycleEvent{{Sequence: 1, Phase: transfer.Phase, At: at, EvidenceRef: transfer.OutcomeEvidenceRef, ReasonCode: transfer.FailureReasonCode, Source: "schema-migration", Coverage: "migration-current-phase-only"}}
}

func loadLegacyStateV1(raw []byte) (persistentState, error) {
	var legacy legacyStateV1
	if err := json.Unmarshal(raw, &legacy); err != nil {
		return persistentState{}, fmt.Errorf("decode bridge v1 state: %w", err)
	}
	if legacy.SchemaVersion != 1 || legacy.Transfers == nil || legacy.SourceEvents == nil || legacy.CreateIdempotency == nil || legacy.FinalizeIdempotency == nil || legacy.Audit == nil {
		return persistentState{}, errors.New("bridge v1 state schema is invalid")
	}
	got := legacy.Integrity
	legacy.Integrity = ""
	encoded, err := json.Marshal(legacy)
	if err != nil || got != "sha256:"+hashBytes(encoded) {
		return persistentState{}, errors.New("bridge state integrity mismatch")
	}
	if err := validateAuditChain(legacy.Audit); err != nil {
		return persistentState{}, err
	}
	state := newPersistentState()
	state.SourceEvents, state.CreateIdempotency, state.FinalizeIdempotency, state.Audit = legacy.SourceEvents, legacy.CreateIdempotency, legacy.FinalizeIdempotency, legacy.Audit
	for id, old := range legacy.Transfers {
		encoded, _ := json.Marshal(old)
		var transfer Transfer
		if err := json.Unmarshal(encoded, &transfer); err != nil {
			return persistentState{}, fmt.Errorf("migrate bridge transfer %s: %w", id, err)
		}
		state.Transfers[id] = transfer
	}
	state.Integrity = ""
	return state, nil
}

func saveState(path string, state *persistentState) error {
	state.Integrity = ""
	digest, err := stateDigest(*state)
	if err != nil {
		return err
	}
	state.Integrity = digest
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode bridge state: %w", err)
	}
	raw = append(raw, '\n')
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create bridge state directory: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return fmt.Errorf("restrict bridge state directory: %w", err)
	}
	temp, err := os.OpenFile(path+".tmp", os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("create bridge state temp file: %w", err)
	}
	ok := false
	defer func() {
		_ = temp.Close()
		if !ok {
			_ = os.Remove(temp.Name())
		}
	}()
	if _, err := temp.Write(raw); err != nil {
		return fmt.Errorf("write bridge state: %w", err)
	}
	if err := temp.Sync(); err != nil {
		return fmt.Errorf("sync bridge state: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close bridge state: %w", err)
	}
	if err := os.Rename(temp.Name(), path); err != nil {
		return fmt.Errorf("replace bridge state: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return fmt.Errorf("restrict bridge state: %w", err)
	}
	ok = true
	return nil
}

func cloneState(state persistentState) persistentState {
	raw, _ := json.Marshal(state)
	var clone persistentState
	_ = json.Unmarshal(raw, &clone)
	return clone
}

func stateDigest(state persistentState) (string, error) {
	state.Integrity = ""
	raw, err := json.Marshal(state)
	if err != nil {
		return "", err
	}
	return "sha256:" + hashBytes(raw), nil
}

func appendAudit(state *persistentState, at, action, transferID, detailHash string) {
	previous := "genesis"
	if len(state.Audit) > 0 {
		previous = state.Audit[len(state.Audit)-1].Hash
	}
	event := AuditEvent{Sequence: uint64(len(state.Audit) + 1), At: at, Action: action, TransferID: transferID, DetailHash: detailHash, Previous: previous}
	event.Hash = auditHash(event)
	state.Audit = append(state.Audit, event)
}

func validateAuditChain(events []AuditEvent) error {
	previous := "genesis"
	for i, event := range events {
		if event.Sequence != uint64(i+1) || event.Previous != previous || event.Hash != auditHash(event) {
			return errors.New("bridge audit hash chain is invalid")
		}
		previous = event.Hash
	}
	return nil
}

func auditHash(event AuditEvent) string {
	event.Hash = ""
	raw, _ := json.Marshal(event)
	return "sha256:" + hashBytes(raw)
}

func hashBytes(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}
