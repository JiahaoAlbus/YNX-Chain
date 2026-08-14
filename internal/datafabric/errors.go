package datafabric

import (
	"errors"
	"fmt"
)

// ErrorCode is a stable, versioned rejection identifier. Messages may become
// more precise over time; callers must branch on the code instead of text.
type ErrorCode string

const (
	CodeUnknownField                  ErrorCode = "DF_EVENT_UNKNOWN_FIELD_V1"
	CodeMissingRequiredField          ErrorCode = "DF_EVENT_MISSING_REQUIRED_FIELD_V1"
	CodeInvalidVersion                ErrorCode = "DF_EVENT_INVALID_VERSION_V1"
	CodeUnsupportedVersion            ErrorCode = "DF_EVENT_UNSUPPORTED_VERSION_V1"
	CodeDuplicate                     ErrorCode = "DF_EVENT_DUPLICATE_V1"
	CodeOutOfOrder                    ErrorCode = "DF_EVENT_OUT_OF_ORDER_V1"
	CodeSequenceGap                   ErrorCode = "DF_EVENT_SEQUENCE_GAP_V1"
	CodeFutureTimestamp               ErrorCode = "DF_EVENT_FUTURE_TIMESTAMP_V1"
	CodeExpiredEvent                  ErrorCode = "DF_EVENT_EXPIRED_V1"
	CodeTampered                      ErrorCode = "DF_EVENT_TAMPERED_V1"
	CodeWrongProduct                  ErrorCode = "DF_EVENT_WRONG_PRODUCT_V1"
	CodeWrongAggregate                ErrorCode = "DF_EVENT_WRONG_AGGREGATE_V1"
	CodeWrongPartition                ErrorCode = "DF_EVENT_WRONG_PARTITION_V1"
	CodeWrongSignature                ErrorCode = "DF_EVENT_WRONG_SIGNATURE_V1"
	CodeReplay                        ErrorCode = "DF_EVENT_REPLAY_V1"
	CodeOversizedPayload              ErrorCode = "DF_EVENT_OVERSIZED_PAYLOAD_V1"
	CodeInvalidPrivacyClassification  ErrorCode = "DF_EVENT_INVALID_PRIVACY_CLASSIFICATION_V1"
	CodeUnknownEventType              ErrorCode = "DF_SCHEMA_EVENT_TYPE_UNKNOWN_V1"
	CodeSchemaVersionUnsupported      ErrorCode = "DF_SCHEMA_VERSION_UNSUPPORTED_V1"
	CodeSchemaNotEffective            ErrorCode = "DF_SCHEMA_NOT_EFFECTIVE_V1"
	CodeSchemaRetired                 ErrorCode = "DF_SCHEMA_RETIRED_V1"
	CodeSchemaProductMismatch         ErrorCode = "DF_SCHEMA_PRODUCT_MISMATCH_V1"
	CodeSchemaCompatibilityViolation  ErrorCode = "DF_SCHEMA_COMPATIBILITY_VIOLATION_V1"
	CodeRedeliveryPreviewStale        ErrorCode = "DF_REDELIVERY_PREVIEW_STALE_V1"
	CodeRedeliveryIdempotencyConflict ErrorCode = "DF_REDELIVERY_IDEMPOTENCY_CONFLICT_V1"
	CodeRedeliveryNoCandidates        ErrorCode = "DF_REDELIVERY_NO_CANDIDATES_V1"
	CodeLedgerUnbalanced              ErrorCode = "DF_LEDGER_UNBALANCED_V1"
	CodeLedgerCorrectionRouteRequired ErrorCode = "DF_LEDGER_CORRECTION_ROUTE_REQUIRED_V1"
	CodeLedgerCorrectionInvalid       ErrorCode = "DF_LEDGER_CORRECTION_INVALID_V1"
	CodeLedgerCorrectionTargetMissing ErrorCode = "DF_LEDGER_CORRECTION_TARGET_MISSING_V1"
	CodeLedgerReversalMismatch        ErrorCode = "DF_LEDGER_REVERSAL_MISMATCH_V1"
	CodeLedgerDuplicateReversal       ErrorCode = "DF_LEDGER_DUPLICATE_REVERSAL_V1"
	CodeSagaRecoveryLeaseConflict     ErrorCode = "DF_SAGA_RECOVERY_LEASE_CONFLICT_V1"
	CodeSagaRecoveryTaskMismatch      ErrorCode = "DF_SAGA_RECOVERY_TASK_MISMATCH_V1"
	CodeSagaRecoveryLeaseExpired      ErrorCode = "DF_SAGA_RECOVERY_LEASE_EXPIRED_V1"
	CodeSagaEventAuthorityMismatch    ErrorCode = "DF_SAGA_EVENT_AUTHORITY_MISMATCH_V1"
	CodeSagaRecoveryRouteRequired     ErrorCode = "DF_SAGA_RECOVERY_ROUTE_REQUIRED_V1"
	CodeBillingRatePlanInvalid        ErrorCode = "DF_BILLING_RATE_PLAN_INVALID_V1"
	CodeBillingRatePlanNotFound       ErrorCode = "DF_BILLING_RATE_PLAN_NOT_FOUND_V1"
	CodeBillingRatePlanDuplicate      ErrorCode = "DF_BILLING_RATE_PLAN_DUPLICATE_V1"
	CodeBillingUsageInvalid           ErrorCode = "DF_BILLING_USAGE_INVALID_V1"
	CodeBillingAlreadySettled         ErrorCode = "DF_BILLING_ALREADY_SETTLED_V1"
	CodeBillingRatingOverflow         ErrorCode = "DF_BILLING_RATING_OVERFLOW_V1"
	CodeBillingAuthorityMismatch      ErrorCode = "DF_BILLING_AUTHORITY_MISMATCH_V1"
	CodeChainCommitmentUnavailable    ErrorCode = "DF_CHAIN_COMMITMENT_UNAVAILABLE_V1"
	CodeChainCommitmentRejected       ErrorCode = "DF_CHAIN_COMMITMENT_REJECTED_V1"
)

// RejectionError carries the stable code plus bounded evidence suitable for an
// audit record. Evidence values must never contain payloads, credentials, or
// secrets.
type RejectionError struct {
	Code     ErrorCode         `json:"code"`
	Message  string            `json:"message"`
	Evidence map[string]string `json:"evidence,omitempty"`
	cause    error
}

func (e *RejectionError) Error() string {
	if e == nil {
		return ""
	}
	if e.cause != nil {
		return fmt.Sprintf("%s: %s: %v", e.Code, e.Message, e.cause)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *RejectionError) Unwrap() error { return e.cause }

func Reject(code ErrorCode, message string, evidence map[string]string) error {
	return &RejectionError{Code: code, Message: message, Evidence: cloneEvidence(evidence)}
}

func WrapReject(code ErrorCode, message string, cause error, evidence map[string]string) error {
	return &RejectionError{Code: code, Message: message, Evidence: cloneEvidence(evidence), cause: cause}
}

func ErrorCodeOf(err error) ErrorCode {
	var rejection *RejectionError
	if errors.As(err, &rejection) {
		return rejection.Code
	}
	switch {
	case errors.Is(err, ErrDuplicate):
		return CodeDuplicate
	case errors.Is(err, ErrOutOfOrder):
		return CodeOutOfOrder
	case errors.Is(err, ErrTampered):
		return CodeTampered
	default:
		return ""
	}
}

func ErrorEvidenceOf(err error) map[string]string {
	var rejection *RejectionError
	if errors.As(err, &rejection) {
		return cloneEvidence(rejection.Evidence)
	}
	return nil
}

func cloneEvidence(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]string, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}
