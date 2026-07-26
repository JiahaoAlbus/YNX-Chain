package datafabric

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"time"
)

type SagaKind string

const (
	SagaWalletSession  SagaKind = "wallet-session-revoke"
	SagaPay            SagaKind = "pay-invoice-receipt-refund"
	SagaShop           SagaKind = "shop-order-inventory-payment-fulfillment"
	SagaMerchant       SagaKind = "merchant-webhook-reconciliation-settlement"
	SagaExchange       SagaKind = "exchange-order-fill-funding-fee"
	SagaDEX            SagaKind = "dex-swap-lp-vault"
	SagaQuant          SagaKind = "quant-mandate-pnl-fee-kill-switch"
	SagaTrust          SagaKind = "trust-case-appeal-correction"
	SagaResource       SagaKind = "resource-usage-settlement"
	SagaCloud          SagaKind = "cloud-usage-billing"
	SagaAI             SagaKind = "ai-usage-cost"
	SagaMail           SagaKind = "mail-delivery"
	SagaCreatorRevenue SagaKind = "creator-revenue"
)

var sagaDefinitions = map[SagaKind][]SagaStepDefinition{
	SagaWalletSession:  {{"open-session", "revoke-session"}, {"propagate-session", "propagate-revoke"}},
	SagaPay:            {{"authorize-invoice", "void-authorization"}, {"settle-payment", "refund-payment"}, {"issue-receipt", "void-receipt"}},
	SagaShop:           {{"reserve-inventory", "release-inventory"}, {"capture-payment", "refund-payment"}, {"request-fulfillment", "cancel-fulfillment"}},
	SagaMerchant:       {{"accept-webhook", "invalidate-webhook"}, {"reconcile-payment", "open-reconciliation-case"}, {"settle-merchant", "reverse-settlement"}},
	SagaExchange:       {{"accept-order", "cancel-order"}, {"record-fill", "correct-fill"}, {"apply-funding", "reverse-funding"}, {"post-fee", "reverse-fee"}},
	SagaDEX:            {{"authorize-vault", "revoke-vault"}, {"submit-operation", "submit-compensating-operation"}, {"reconcile-chain", "open-reconciliation-case"}},
	SagaQuant:          {{"activate-mandate", "kill-mandate"}, {"record-pnl", "correct-pnl"}, {"post-fee", "reverse-fee"}},
	SagaTrust:          {{"open-case", "close-case"}, {"apply-decision", "suspend-decision"}, {"publish-correction", "publish-correction-reversal"}},
	SagaResource:       {{"authorize-usage", "stop-usage"}, {"record-usage", "correct-usage"}, {"settle-provider", "reverse-provider-settlement"}},
	SagaCloud:          {{"meter-usage", "correct-meter"}, {"post-billing", "reverse-billing"}},
	SagaAI:             {{"authorize-inference", "revoke-inference"}, {"record-cost", "correct-cost"}},
	SagaMail:           {{"accept-delivery", "cancel-delivery"}, {"deliver-message", "record-delivery-failure"}},
	SagaCreatorRevenue: {{"recognize-revenue", "reverse-recognition"}, {"settle-creator", "reverse-creator-settlement"}},
}

var sagaProducts = map[SagaKind]string{
	SagaWalletSession: "wallet", SagaPay: "pay", SagaShop: "shop", SagaMerchant: "merchant",
	SagaExchange: "exchange", SagaDEX: "dex", SagaQuant: "quant", SagaTrust: "trust",
	SagaResource: "resource", SagaCloud: "cloud", SagaAI: "ai", SagaMail: "mail", SagaCreatorRevenue: "creator",
}

type SagaStepDefinition struct {
	Action       string `json:"action"`
	Compensation string `json:"compensation"`
}

type SagaStatus string

const (
	SagaRunning        SagaStatus = "running"
	SagaCompensating   SagaStatus = "compensating"
	SagaCompensated    SagaStatus = "compensated"
	SagaCompleted      SagaStatus = "completed"
	SagaManualRecovery SagaStatus = "manual-recovery"
)

type SagaStep struct {
	Action         string    `json:"action"`
	Compensation   string    `json:"compensation"`
	CompletedAt    time.Time `json:"completedAt,omitempty"`
	CompensatedAt  time.Time `json:"compensatedAt,omitempty"`
	Failure        string    `json:"failure,omitempty"`
	EventID        string    `json:"eventId,omitempty"`
	CompensationID string    `json:"compensationEventId,omitempty"`
}

type SagaInstance struct {
	SagaID            string             `json:"sagaId"`
	Kind              SagaKind           `json:"kind"`
	Product           string             `json:"product"`
	AggregateID       string             `json:"aggregateId"`
	CorrelationID     string             `json:"correlationId"`
	Status            SagaStatus         `json:"status"`
	UserVisibleStatus string             `json:"userVisibleStatus"`
	CreatedAt         time.Time          `json:"createdAt"`
	UpdatedAt         time.Time          `json:"updatedAt"`
	Deadline          time.Time          `json:"deadline"`
	AuditID           string             `json:"auditId"`
	Failure           string             `json:"failure,omitempty"`
	Steps             []SagaStep         `json:"steps"`
	RecoveryLease     *SagaRecoveryLease `json:"recoveryLease,omitempty"`
	RecoveryAttempt   uint32             `json:"recoveryAttempt,omitempty"`
}

type SagaRecoveryLease struct {
	TaskID     string    `json:"taskId"`
	Owner      string    `json:"owner"`
	AcquiredAt time.Time `json:"acquiredAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

type SagaRecoveryTask struct {
	TaskID        string    `json:"taskId"`
	SagaID        string    `json:"sagaId"`
	Product       string    `json:"product"`
	AggregateID   string    `json:"aggregateId"`
	CorrelationID string    `json:"correlationId"`
	StepIndex     int       `json:"stepIndex"`
	Compensation  string    `json:"compensation"`
	Failure       string    `json:"failure"`
	AuditID       string    `json:"auditId"`
	LeaseOwner    string    `json:"leaseOwner"`
	LeaseUntil    time.Time `json:"leaseUntil"`
	Attempt       uint32    `json:"attempt"`
}

func NewSaga(id string, kind SagaKind, aggregateID, correlationID, auditID string, now, deadline time.Time) (SagaInstance, error) {
	definition, exists := sagaDefinitions[kind]
	if !exists {
		return SagaInstance{}, fmt.Errorf("unsupported saga kind %q", kind)
	}
	if !idPattern.MatchString(id) || !idPattern.MatchString(aggregateID) || !idPattern.MatchString(correlationID) || !idPattern.MatchString(auditID) {
		return SagaInstance{}, errors.New("saga identifiers are invalid")
	}
	if now.IsZero() || deadline.IsZero() || now.Location() != time.UTC || deadline.Location() != time.UTC || !deadline.After(now) {
		return SagaInstance{}, errors.New("saga requires a future UTC deadline")
	}
	steps := make([]SagaStep, len(definition))
	for i, step := range definition {
		steps[i] = SagaStep{Action: step.Action, Compensation: step.Compensation}
	}
	return SagaInstance{SagaID: id, Kind: kind, Product: sagaProducts[kind], AggregateID: aggregateID, CorrelationID: correlationID, AuditID: auditID, Status: SagaRunning, UserVisibleStatus: "processing", CreatedAt: now, UpdatedAt: now, Deadline: deadline, Steps: steps}, nil
}

func ValidateInitialSaga(instance SagaInstance) error {
	expected, err := NewSaga(instance.SagaID, instance.Kind, instance.AggregateID, instance.CorrelationID, instance.AuditID, instance.CreatedAt, instance.Deadline)
	if err != nil {
		return err
	}
	if instance.Product != expected.Product || instance.Status != expected.Status || instance.UserVisibleStatus != expected.UserVisibleStatus || !instance.UpdatedAt.Equal(instance.CreatedAt) || instance.Failure != "" || instance.RecoveryLease != nil || instance.RecoveryAttempt != 0 || len(instance.Steps) != len(expected.Steps) {
		return errors.New("Saga initial state is not canonical")
	}
	for index := range expected.Steps {
		if instance.Steps[index] != expected.Steps[index] {
			return errors.New("Saga steps do not match the canonical definition")
		}
	}
	return nil
}

func (s *SagaInstance) CompleteStep(eventID string, at time.Time) error {
	if s.Status != SagaRunning {
		return fmt.Errorf("saga is %s", s.Status)
	}
	if at.After(s.Deadline) {
		return s.Fail("saga deadline exceeded", at)
	}
	for i := range s.Steps {
		if s.Steps[i].CompletedAt.IsZero() {
			if !idPattern.MatchString(eventID) {
				return errors.New("step eventId is invalid")
			}
			s.Steps[i].CompletedAt, s.Steps[i].EventID, s.UpdatedAt = at.UTC(), eventID, at.UTC()
			if i == len(s.Steps)-1 {
				s.Status, s.UserVisibleStatus = SagaCompleted, "completed"
			}
			return nil
		}
	}
	return errors.New("saga has no incomplete step")
}

func (s *SagaInstance) Fail(reason string, at time.Time) error {
	if s.Status != SagaRunning || reason == "" {
		return errors.New("only a running saga can fail with a reason")
	}
	s.Status, s.UserVisibleStatus, s.Failure, s.UpdatedAt = SagaCompensating, "recovery-in-progress", reason, at.UTC()
	return nil
}

func (s *SagaInstance) CompleteCompensation(eventID string, at time.Time) error {
	if s.Status != SagaCompensating {
		return errors.New("saga is not compensating")
	}
	for i := len(s.Steps) - 1; i >= 0; i-- {
		step := &s.Steps[i]
		if !step.CompletedAt.IsZero() && step.CompensatedAt.IsZero() {
			if !idPattern.MatchString(eventID) {
				return errors.New("compensation eventId is invalid")
			}
			step.CompensatedAt, step.CompensationID, s.UpdatedAt, s.RecoveryLease = at.UTC(), eventID, at.UTC(), nil
			for j := i - 1; j >= 0; j-- {
				if !s.Steps[j].CompletedAt.IsZero() && s.Steps[j].CompensatedAt.IsZero() {
					return nil
				}
			}
			s.Status, s.UserVisibleStatus = SagaCompensated, "recovered"
			return nil
		}
	}
	s.Status, s.UserVisibleStatus, s.UpdatedAt, s.RecoveryLease = SagaCompensated, "recovered", at.UTC(), nil
	return nil
}

func (s *SagaInstance) RequireManualRecovery(reason string, at time.Time) error {
	if s.Status != SagaCompensating || reason == "" {
		return errors.New("manual recovery requires a compensating saga and reason")
	}
	s.Status, s.UserVisibleStatus, s.Failure, s.UpdatedAt, s.RecoveryLease = SagaManualRecovery, "action-required", reason, at.UTC(), nil
	return nil
}

func (s *SagaInstance) ClaimRecovery(owner string, at, leaseUntil time.Time) (SagaRecoveryTask, bool, error) {
	if s.Status != SagaCompensating {
		return SagaRecoveryTask{}, false, errors.New("saga is not compensating")
	}
	if !idPattern.MatchString(owner) || at.IsZero() || at.Location() != time.UTC || at.Before(s.UpdatedAt) || leaseUntil.IsZero() || leaseUntil.Location() != time.UTC || !leaseUntil.After(at) {
		return SagaRecoveryTask{}, false, errors.New("Saga recovery lease is invalid")
	}
	if s.RecoveryLease != nil && s.RecoveryLease.ExpiresAt.After(at) {
		return SagaRecoveryTask{}, false, Reject(CodeSagaRecoveryLeaseConflict, "Saga recovery task is already leased", map[string]string{"sagaId": s.SagaID, "taskId": s.RecoveryLease.TaskID})
	}
	stepIndex, exists := s.nextCompensationStep()
	if !exists {
		s.RecoveryLease = nil
		if err := s.CompleteCompensation("", at); err != nil {
			return SagaRecoveryTask{}, false, err
		}
		return SagaRecoveryTask{}, false, nil
	}
	taskID := sagaRecoveryTaskID(s.SagaID, stepIndex)
	if !idPattern.MatchString(taskID) {
		return SagaRecoveryTask{}, false, errors.New("Saga recovery task identifier is invalid")
	}
	if s.RecoveryAttempt >= 2147483647 {
		return SagaRecoveryTask{}, false, errors.New("Saga recovery attempt limit is exhausted")
	}
	s.RecoveryAttempt++
	s.RecoveryLease = &SagaRecoveryLease{TaskID: taskID, Owner: owner, AcquiredAt: at, ExpiresAt: leaseUntil}
	s.UpdatedAt = at
	step := s.Steps[stepIndex]
	return SagaRecoveryTask{
		TaskID: taskID, SagaID: s.SagaID, Product: s.Product, AggregateID: s.AggregateID,
		CorrelationID: s.CorrelationID, StepIndex: stepIndex, Compensation: step.Compensation,
		Failure: s.Failure, AuditID: s.AuditID, LeaseOwner: owner, LeaseUntil: leaseUntil,
		Attempt: s.RecoveryAttempt,
	}, true, nil
}

func (s *SagaInstance) CompleteClaimedRecovery(taskID, owner, eventID string, at time.Time) error {
	if s.Status != SagaCompensating || s.RecoveryLease == nil || s.RecoveryLease.TaskID != taskID || s.RecoveryLease.Owner != owner {
		return Reject(CodeSagaRecoveryTaskMismatch, "Saga recovery completion does not match the active lease", map[string]string{"sagaId": s.SagaID, "taskId": taskID})
	}
	if at.IsZero() || at.Location() != time.UTC || at.Before(s.RecoveryLease.AcquiredAt) || at.After(s.RecoveryLease.ExpiresAt) {
		return Reject(CodeSagaRecoveryLeaseExpired, "Saga recovery lease expired before completion", map[string]string{"sagaId": s.SagaID, "taskId": taskID, "leaseUntil": s.RecoveryLease.ExpiresAt.Format(time.RFC3339Nano)})
	}
	expectedIndex, exists := s.nextCompensationStep()
	if !exists || taskID != sagaRecoveryTaskID(s.SagaID, expectedIndex) {
		return Reject(CodeSagaRecoveryTaskMismatch, "Saga recovery task no longer matches the next compensation", map[string]string{"sagaId": s.SagaID, "taskId": taskID})
	}
	s.RecoveryLease = nil
	return s.CompleteCompensation(eventID, at)
}

func sagaRecoveryTaskID(sagaID string, stepIndex int) string {
	digest := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%d", sagaID, stepIndex)))
	return fmt.Sprintf("saga-recovery.%x", digest[:16])
}

func (s *SagaInstance) nextCompensationStep() (int, bool) {
	for index := len(s.Steps) - 1; index >= 0; index-- {
		if !s.Steps[index].CompletedAt.IsZero() && s.Steps[index].CompensatedAt.IsZero() {
			return index, true
		}
	}
	return 0, false
}

func SupportedSagaKinds() []SagaKind {
	result := make([]SagaKind, 0, len(sagaDefinitions))
	for kind := range sagaDefinitions {
		result = append(result, kind)
	}
	return result
}

func SagaProduct(kind SagaKind) (string, bool) {
	product, exists := sagaProducts[kind]
	return product, exists
}
