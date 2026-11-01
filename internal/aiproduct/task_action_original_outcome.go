package aiproduct

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
)

// Narrow original Auth lookup ABI. These are locators, not a row setter or
// proof of authority. Auth must bind RequestDigest to the sole SDK E5 digest.
type TaskStoreActionOriginalLookup struct {
	Principal                          TaskStorePrincipal
	OperationID, RequestDigest, Action string
}
type TaskStoreActionOutcomeView struct {
	OperationID, RequestDigest, Action, OriginalRef, State string
	Status                                                 int
	BodyDigest                                             string // SHA256 of the exact production-writer business body
	BodyBytes                                              uint64
}
type TaskStoreActionOutcome struct {
	lease *TaskActionOutcomeReceipt
	view  TaskStoreActionOutcomeView
}

func (outcome *TaskStoreActionOutcome) Current() error {
	if outcome == nil || outcome.lease == nil {
		return ErrTaskActionOutcomeUnknown
	}
	return outcome.lease.Current()
}
func (outcome *TaskStoreActionOutcome) View() (TaskStoreActionOutcomeView, error) {
	if err := outcome.Current(); err != nil {
		return TaskStoreActionOutcomeView{}, err
	}
	return outcome.view, nil
}
func (outcome *TaskStoreActionOutcome) Release() error {
	if outcome != nil && outcome.lease != nil {
		return outcome.lease.Close()
	}
	return nil
}
func (outcome *TaskStoreActionOutcome) Close() error { return outcome.Release() }

// Only actual stored original outcomes are read. COMMITTED requires the product
// CAS and authenticated exact serialized body to be in the same durable image.
// PENDING (including crash, lost ACK or save uncertainty) is UNKNOWN; no replay.
// The receipt is PRODUCT-local evidence, never Auth nonce/Grant/tool finality.
func (source *TaskStoreSource) CaptureOriginalActionOutcome(ctx context.Context, lookup TaskStoreActionOriginalLookup) (*TaskStoreActionOutcome, error) {
	if err := source.begin(ctx, lookup.Principal); err != nil {
		return nil, err
	}
	if !boundedTaskActionOperand(lookup.OperationID) || !boundedTaskActionOperand(lookup.RequestDigest) || !boundedTaskActionOperand(lookup.Action) {
		return nil, errToolInvalid
	}
	s := source.store
	s.mu.Lock()
	defer s.mu.Unlock()
	key := taskActionKey(lookup.Principal, lookup.OperationID)
	record, exists := s.state.TaskActionOutcomes[key]
	if !exists {
		return nil, ErrTaskActionOutcomeUnknown
	}
	v := record.View
	if v.Principal != lookup.Principal || v.OriginalOperationID != lookup.OperationID || v.RequestDigest != lookup.RequestDigest || v.Action != lookup.Action || v.OriginalRef != key {
		return nil, ErrTaskConflict
	}
	view := TaskStoreActionOutcomeView{OperationID: v.OriginalOperationID, RequestDigest: v.RequestDigest, Action: v.Action, OriginalRef: v.OriginalRef, State: "UNKNOWN"}
	lease := &TaskActionOutcomeReceipt{source: source, ctx: ctx, key: key, fingerprint: taskOutcomeFingerprint(record)}
	outcome := &TaskStoreActionOutcome{lease: lease, view: view}
	if v.State == "COMMITTED" {
		actual, err := source.taskActionReceiptLocked(ctx, lookup.Principal, key, record)
		if err != nil {
			return outcome, err
		}
		sum := sha256.Sum256(actual.body)
		outcome.lease = actual
		outcome.view.State = "COMMITTED"
		outcome.view.Status = v.HTTPStatus
		outcome.view.BodyDigest = hex.EncodeToString(sum[:])
		outcome.view.BodyBytes = uint64(len(actual.body))
	}
	if err := outcome.Current(); err != nil {
		return outcome, err
	}
	return outcome, nil
}
