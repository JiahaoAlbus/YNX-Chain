package datafabric

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

type RedeliveryMode string

const (
	RedeliveryReplay   RedeliveryMode = "replay"
	RedeliveryBackfill RedeliveryMode = "backfill"
)

type RedeliveryScope struct {
	Product       string     `json:"product"`
	EventType     string     `json:"eventType,omitempty"`
	AggregateType string     `json:"aggregateType,omitempty"`
	AggregateID   string     `json:"aggregateId,omitempty"`
	FromSequence  uint64     `json:"fromSequence,omitempty"`
	ToSequence    uint64     `json:"toSequence,omitempty"`
	OccurredFrom  *time.Time `json:"occurredFrom,omitempty"`
	OccurredTo    *time.Time `json:"occurredTo,omitempty"`
	Limit         int        `json:"limit"`
}

type RedeliveryCandidate struct {
	EventID        string    `json:"eventId"`
	EventType      string    `json:"eventType"`
	SchemaVersion  string    `json:"schemaVersion"`
	AggregateType  string    `json:"aggregateType,omitempty"`
	AggregateID    string    `json:"aggregateId"`
	Sequence       uint64    `json:"sequence"`
	OccurredAt     time.Time `json:"occurredAt"`
	IntegrityHash  string    `json:"integrityHash"`
	DeliveryStatus string    `json:"deliveryStatus"`
}

type RedeliveryPreview struct {
	Mode           RedeliveryMode        `json:"mode"`
	Scope          RedeliveryScope       `json:"scope"`
	ScopeHash      string                `json:"scopeHash"`
	CandidateCount int                   `json:"candidateCount"`
	Truncated      bool                  `json:"truncated"`
	Candidates     []RedeliveryCandidate `json:"candidates"`
	GeneratedAt    time.Time             `json:"generatedAt"`
}

type RedeliveryCommand struct {
	RequestID      string          `json:"requestId"`
	IdempotencyKey string          `json:"idempotencyKey"`
	Mode           RedeliveryMode  `json:"mode"`
	Scope          RedeliveryScope `json:"scope"`
	PreviewHash    string          `json:"previewHash"`
	Reason         string          `json:"reason"`
	ApprovalID     string          `json:"approvalId"`
	ApprovalStatus string          `json:"approvalStatus"`
	Confirmed      bool            `json:"confirmed"`
	AuditID        string          `json:"auditId"`
	RequestedBy    string          `json:"requestedBy"`
	RequestedAt    time.Time       `json:"requestedAt"`
	ControlVersion string          `json:"controlVersion"`
	SourceCommit   string          `json:"sourceCommit"`
	SourceRelease  string          `json:"sourceRelease"`
}

type RedeliveryRun struct {
	RunID          string          `json:"runId"`
	RequestID      string          `json:"requestId"`
	IdempotencyKey string          `json:"idempotencyKey"`
	RequestHash    string          `json:"requestHash"`
	Mode           RedeliveryMode  `json:"mode"`
	Scope          RedeliveryScope `json:"scope"`
	PreviewHash    string          `json:"previewHash"`
	Reason         string          `json:"reason"`
	ApprovalID     string          `json:"approvalId"`
	ApprovalStatus string          `json:"approvalStatus"`
	AuditID        string          `json:"auditId"`
	RequestedBy    string          `json:"requestedBy"`
	ControlVersion string          `json:"controlVersion"`
	SourceCommit   string          `json:"sourceCommit"`
	SourceRelease  string          `json:"sourceRelease"`
	Status         string          `json:"status"`
	CandidateCount int             `json:"candidateCount"`
	EnqueuedCount  int             `json:"enqueuedCount"`
	SkippedPending int             `json:"skippedPending"`
	EventIDs       []string        `json:"eventIds"`
	StartedAt      time.Time       `json:"startedAt"`
	CompletedAt    time.Time       `json:"completedAt"`
}

func (s RedeliveryScope) Validate() error {
	if !slugPattern.MatchString(s.Product) {
		return errors.New("redelivery product is required")
	}
	if s.EventType != "" && !typePattern.MatchString(s.EventType) {
		return errors.New("redelivery eventType is invalid")
	}
	if s.AggregateType != "" && !slugPattern.MatchString(s.AggregateType) && !idPattern.MatchString(s.AggregateType) {
		return errors.New("redelivery aggregateType is invalid")
	}
	if s.AggregateID != "" && !idPattern.MatchString(s.AggregateID) {
		return errors.New("redelivery aggregateId is invalid")
	}
	if s.Limit < 1 || s.Limit > 500 {
		return errors.New("redelivery limit must be between 1 and 500")
	}
	if s.FromSequence > 0 && s.ToSequence > 0 && s.FromSequence > s.ToSequence {
		return errors.New("redelivery sequence range is invalid")
	}
	const maxPostgresSequence = uint64(1<<63 - 1)
	if s.FromSequence > maxPostgresSequence || s.ToSequence > maxPostgresSequence {
		return errors.New("redelivery sequence exceeds the authoritative database range")
	}
	if err := validateOptionalUTCTime(s.OccurredFrom, "occurredFrom"); err != nil {
		return err
	}
	if err := validateOptionalUTCTime(s.OccurredTo, "occurredTo"); err != nil {
		return err
	}
	if s.OccurredFrom != nil && s.OccurredTo != nil && s.OccurredFrom.After(*s.OccurredTo) {
		return errors.New("redelivery time range is invalid")
	}
	if s.EventType == "" && s.AggregateID == "" && s.FromSequence == 0 && s.ToSequence == 0 && s.OccurredFrom == nil && s.OccurredTo == nil {
		return errors.New("redelivery requires a bounded event, aggregate, sequence, or time selector")
	}
	return nil
}

func (c RedeliveryCommand) Validate() error {
	if c.Mode != RedeliveryReplay && c.Mode != RedeliveryBackfill {
		return errors.New("redelivery mode is invalid")
	}
	if err := c.Scope.Validate(); err != nil {
		return err
	}
	for name, value := range map[string]string{
		"requestId": c.RequestID, "idempotencyKey": c.IdempotencyKey, "approvalId": c.ApprovalID,
		"auditId": c.AuditID, "requestedBy": c.RequestedBy,
	} {
		if !idPattern.MatchString(value) {
			return fmt.Errorf("redelivery %s is required and must be canonical", name)
		}
	}
	if len(c.PreviewHash) != 64 || !isLowerHex(c.PreviewHash) {
		return errors.New("redelivery previewHash must be a lowercase SHA-256 digest")
	}
	if strings.TrimSpace(c.Reason) == "" || len(c.Reason) > 512 {
		return errors.New("redelivery reason is required and must not exceed 512 bytes")
	}
	if c.ApprovalStatus != "approved" || !c.Confirmed {
		return errors.New("redelivery requires explicit approved status and confirmation")
	}
	if c.RequestedAt.IsZero() || c.RequestedAt.Location() != time.UTC {
		return errors.New("redelivery requestedAt must be UTC")
	}
	if c.ControlVersion != "1.0" || !commitPattern.MatchString(c.SourceCommit) || strings.TrimSpace(c.SourceRelease) == "" {
		return errors.New("redelivery control version and source provenance are required")
	}
	return nil
}

func FinalizeRedeliveryPreview(mode RedeliveryMode, scope RedeliveryScope, candidates []RedeliveryCandidate, truncated bool, generatedAt time.Time) (RedeliveryPreview, error) {
	if mode != RedeliveryReplay && mode != RedeliveryBackfill {
		return RedeliveryPreview{}, errors.New("redelivery mode is invalid")
	}
	if err := scope.Validate(); err != nil {
		return RedeliveryPreview{}, err
	}
	if generatedAt.IsZero() || generatedAt.Location() != time.UTC {
		return RedeliveryPreview{}, errors.New("redelivery preview time must be UTC")
	}
	copyCandidates := append([]RedeliveryCandidate(nil), candidates...)
	sort.Slice(copyCandidates, func(i, j int) bool {
		if copyCandidates[i].OccurredAt.Equal(copyCandidates[j].OccurredAt) {
			return copyCandidates[i].EventID < copyCandidates[j].EventID
		}
		return copyCandidates[i].OccurredAt.Before(copyCandidates[j].OccurredAt)
	})
	material := struct {
		Mode       RedeliveryMode        `json:"mode"`
		Scope      RedeliveryScope       `json:"scope"`
		Candidates []RedeliveryCandidate `json:"candidates"`
		Truncated  bool                  `json:"truncated"`
	}{Mode: mode, Scope: scope, Candidates: copyCandidates, Truncated: truncated}
	encoded, err := json.Marshal(material)
	if err != nil {
		return RedeliveryPreview{}, err
	}
	digest := sha256.Sum256(encoded)
	return RedeliveryPreview{
		Mode: mode, Scope: scope, ScopeHash: hex.EncodeToString(digest[:]), CandidateCount: len(copyCandidates),
		Truncated: truncated, Candidates: copyCandidates, GeneratedAt: generatedAt,
	}, nil
}

func RedeliveryRequestHash(command RedeliveryCommand) (string, error) {
	material := struct {
		IdempotencyKey string          `json:"idempotencyKey"`
		Mode           RedeliveryMode  `json:"mode"`
		Scope          RedeliveryScope `json:"scope"`
		PreviewHash    string          `json:"previewHash"`
		Reason         string          `json:"reason"`
		ApprovalID     string          `json:"approvalId"`
		ApprovalStatus string          `json:"approvalStatus"`
		AuditID        string          `json:"auditId"`
		RequestedBy    string          `json:"requestedBy"`
		ControlVersion string          `json:"controlVersion"`
		SourceCommit   string          `json:"sourceCommit"`
		SourceRelease  string          `json:"sourceRelease"`
	}{
		IdempotencyKey: command.IdempotencyKey, Mode: command.Mode, Scope: command.Scope,
		PreviewHash: command.PreviewHash, Reason: command.Reason, ApprovalID: command.ApprovalID,
		ApprovalStatus: command.ApprovalStatus, AuditID: command.AuditID, RequestedBy: command.RequestedBy,
		ControlVersion: command.ControlVersion, SourceCommit: command.SourceCommit, SourceRelease: command.SourceRelease,
	}
	encoded, err := json.Marshal(material)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

func RedeliveryRunID(idempotencyKey string) string {
	digest := sha256.Sum256([]byte("ynx-data-fabric-redelivery-v1:" + idempotencyKey))
	return "redelivery." + hex.EncodeToString(digest[:12])
}

func MatchRedeliveryScope(event EventEnvelope, scope RedeliveryScope) bool {
	if event.Product != scope.Product || scope.EventType != "" && event.EventType != scope.EventType || scope.AggregateID != "" && event.AggregateID != scope.AggregateID {
		return false
	}
	if scope.AggregateType != "" && event.AggregateType != scope.AggregateType {
		return false
	}
	if scope.FromSequence > 0 && event.Sequence < scope.FromSequence || scope.ToSequence > 0 && event.Sequence > scope.ToSequence {
		return false
	}
	occurredAt := event.Timestamp
	if !event.OccurredAt.IsZero() {
		occurredAt = event.OccurredAt
	}
	if scope.OccurredFrom != nil && occurredAt.Before(*scope.OccurredFrom) || scope.OccurredTo != nil && occurredAt.After(*scope.OccurredTo) {
		return false
	}
	return true
}

func validateOptionalUTCTime(value *time.Time, name string) error {
	if value != nil && (value.IsZero() || value.Location() != time.UTC) {
		return fmt.Errorf("redelivery %s must be UTC", name)
	}
	return nil
}

func isLowerHex(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && hex.EncodeToString(decoded) == value
}
