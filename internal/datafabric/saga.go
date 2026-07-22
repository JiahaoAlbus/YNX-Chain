package datafabric

import (
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
	SagaID            string     `json:"sagaId"`
	Kind              SagaKind   `json:"kind"`
	Product           string     `json:"product"`
	AggregateID       string     `json:"aggregateId"`
	CorrelationID     string     `json:"correlationId"`
	Status            SagaStatus `json:"status"`
	UserVisibleStatus string     `json:"userVisibleStatus"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
	Deadline          time.Time  `json:"deadline"`
	AuditID           string     `json:"auditId"`
	Failure           string     `json:"failure,omitempty"`
	Steps             []SagaStep `json:"steps"`
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
			step.CompensatedAt, step.CompensationID, s.UpdatedAt = at.UTC(), eventID, at.UTC()
			for j := i - 1; j >= 0; j-- {
				if !s.Steps[j].CompletedAt.IsZero() && s.Steps[j].CompensatedAt.IsZero() {
					return nil
				}
			}
			s.Status, s.UserVisibleStatus = SagaCompensated, "recovered"
			return nil
		}
	}
	s.Status, s.UserVisibleStatus, s.UpdatedAt = SagaCompensated, "recovered", at.UTC()
	return nil
}

func (s *SagaInstance) RequireManualRecovery(reason string, at time.Time) error {
	if s.Status != SagaCompensating || reason == "" {
		return errors.New("manual recovery requires a compensating saga and reason")
	}
	s.Status, s.UserVisibleStatus, s.Failure, s.UpdatedAt = SagaManualRecovery, "action-required", reason, at.UTC()
	return nil
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
