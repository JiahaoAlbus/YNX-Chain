package aiproduct

import "bytes"

// These are original product DATA, not an HTTP carrier/SDK wire format, Auth
// decision, Source, Native loan or completion constructor. The original Auth
// response owner/sole SDK must bind these bytes inside the signed response body.
type TaskActionOutcomeOriginalDATA struct {
	View                    TaskActionOutcomeView
	BusinessReceiptOriginal []byte
	BodyOriginal            []byte
}

// ReadOriginalOutcomeDATA copies the actual receipt JSON member and business
// body from the SAME authenticated durable payload already selected by this
// opaque owner. It never marshals a caller DTO or reconstructs a receipt from
// HTTP status. Retain this owner's Current/Close through the response sign fence.
func (receipt *TaskActionOutcomeReceipt) ReadOriginalOutcomeDATA() (TaskActionOutcomeOriginalDATA, error) {
	if err := receipt.Current(); err != nil {
		return TaskActionOutcomeOriginalDATA{}, err
	}
	if receipt.view.State != "COMMITTED" || receipt.view.Scope != "PRODUCT_LOCAL_COMMIT_ONLY" || len(receipt.receiptOriginal) == 0 || receipt.view.BodyDigest != bindTaskBytes(receipt.body) {
		return TaskActionOutcomeOriginalDATA{}, ErrTaskActionOutcomeUnknown
	}
	out := TaskActionOutcomeOriginalDATA{View: receipt.view, BusinessReceiptOriginal: bytes.Clone(receipt.receiptOriginal), BodyOriginal: bytes.Clone(receipt.body)}
	if err := receipt.Current(); err != nil {
		return TaskActionOutcomeOriginalDATA{}, err
	}
	return out, nil
}

// The original-op query exposes the SAME committed receipt/body as execution.
// A pending reservation remains queryable metadata, but cannot produce these
// COMMITTED originals. No new claim, nonce, dispatch or task mutation occurs.
func (outcome *TaskStoreActionOutcome) ReadOriginalOutcomeDATA() (TaskActionOutcomeOriginalDATA, error) {
	if err := outcome.Current(); err != nil {
		return TaskActionOutcomeOriginalDATA{}, err
	}
	if outcome.view.State != "COMMITTED" {
		return TaskActionOutcomeOriginalDATA{}, ErrTaskActionOutcomeUnknown
	}
	out, err := outcome.lease.ReadOriginalOutcomeDATA()
	if err != nil {
		return TaskActionOutcomeOriginalDATA{}, err
	}
	v := out.View
	if v.OriginalOperationID != outcome.view.OperationID || v.RequestDigest != outcome.view.RequestDigest || v.Action != outcome.view.Action || v.OriginalRef != outcome.view.OriginalRef || v.HTTPStatus != outcome.view.Status {
		return TaskActionOutcomeOriginalDATA{}, ErrTaskConflict
	}
	if err = outcome.Current(); err != nil {
		return TaskActionOutcomeOriginalDATA{}, err
	}
	return out, nil
}
