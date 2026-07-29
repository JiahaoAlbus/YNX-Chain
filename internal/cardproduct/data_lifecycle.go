package cardproduct

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"
)

const (
	DataExportSchema    = "ynx.card.account-export.v1"
	DataLifecycleSchema = "ynx.card.data-lifecycle.v1"
	DeleteConfirmation  = "DELETE YNX CARD DATA"
)

type RetentionPolicy struct {
	NotificationMaxAge time.Duration `json:"notificationMaxAge"`
	AIRunMaxAge        time.Duration `json:"aiRunMaxAge"`
	IdempotencyMaxAge  time.Duration `json:"idempotencyMaxAge"`
	ProviderReplayAge  time.Duration `json:"providerReplayAge"`
	DeletionReceiptAge time.Duration `json:"deletionReceiptAge"`
}

func DefaultRetentionPolicy() RetentionPolicy {
	return RetentionPolicy{
		NotificationMaxAge: 90 * 24 * time.Hour,
		AIRunMaxAge:        30 * 24 * time.Hour,
		IdempotencyMaxAge:  30 * 24 * time.Hour,
		ProviderReplayAge:  400 * 24 * time.Hour,
		DeletionReceiptAge: 30 * 24 * time.Hour,
	}
}

func (policy RetentionPolicy) Disclosure() map[string]string {
	return map[string]string{
		"notifications":         policy.NotificationMaxAge.String(),
		"aiRuns":                policy.AIRunMaxAge.String(),
		"idempotency":           policy.IdempotencyMaxAge.String(),
		"providerReplayRecords": policy.ProviderReplayAge.String(),
		"deletionReceipts":      policy.DeletionReceiptAge.String(),
	}
}

func normalizeRetentionPolicy(policy RetentionPolicy) (RetentionPolicy, error) {
	if policy == (RetentionPolicy{}) {
		return DefaultRetentionPolicy(), nil
	}
	for _, value := range []time.Duration{
		policy.NotificationMaxAge,
		policy.AIRunMaxAge,
		policy.IdempotencyMaxAge,
		policy.ProviderReplayAge,
		policy.DeletionReceiptAge,
	} {
		if value < time.Hour || value > 10*365*24*time.Hour {
			return RetentionPolicy{}, errors.New("card retention duration is outside policy")
		}
	}
	if policy.ProviderReplayAge < policy.IdempotencyMaxAge {
		return RetentionPolicy{}, errors.New("provider replay retention must not be shorter than idempotency retention")
	}
	return policy, nil
}

type AccountExport struct {
	SchemaVersion string            `json:"schemaVersion"`
	ProductID     string            `json:"productId"`
	Account       string            `json:"account"`
	GeneratedAt   time.Time         `json:"generatedAt"`
	Source        string            `json:"source"`
	State         AccountState      `json:"state"`
	RecordCounts  map[string]int    `json:"recordCounts"`
	Retention     map[string]string `json:"retention"`
	Redactions    []string          `json:"redactions"`
}

type RetentionResult struct {
	SchemaVersion string         `json:"schemaVersion"`
	Account       string         `json:"account"`
	EnforcedAt    time.Time      `json:"enforcedAt"`
	Deleted       map[string]int `json:"deleted"`
	AuditID       string         `json:"auditId,omitempty"`
}

type DeleteAccountInput struct {
	Confirmation   string `json:"confirmation"`
	IdempotencyKey string `json:"idempotencyKey"`
}

func (s *Service) ExportAccount(ctx context.Context, account string) (AccountExport, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.enforceAccountRetentionLocked(ctx, account); err != nil {
		return AccountExport{}, err
	}
	state, err := s.accountState(account)
	if err != nil {
		return AccountExport{}, err
	}
	state = sanitizeAccountExport(state)
	return AccountExport{
		SchemaVersion: DataExportSchema,
		ProductID:     ProductID,
		Account:       account,
		GeneratedAt:   s.now().UTC(),
		Source:        "YNX Card integrity-protected local state",
		State:         state,
		RecordCounts: map[string]int{
			"applications":  len(state.Applications),
			"cards":         len(state.Cards),
			"events":        len(state.Events),
			"disputes":      len(state.Disputes),
			"notifications": len(state.Notifications),
			"aiRuns":        len(state.AIRuns),
			"audit":         len(state.Audit),
		},
		Retention: s.retention.Disclosure(),
		Redactions: []string{
			"eligibility references",
			"provider application references",
			"provider card identifiers",
			"provider event identifiers",
			"request and trace correlation identifiers",
		},
	}, nil
}

func (s *Service) EnforceAccountRetention(ctx context.Context, account string) (RetentionResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.enforceAccountRetentionLocked(ctx, account)
}

func (s *Service) enforceAccountRetentionLocked(ctx context.Context, account string) (RetentionResult, error) {
	now := s.now().UTC()
	result := RetentionResult{
		SchemaVersion: DataLifecycleSchema,
		Account:       account,
		EnforcedAt:    now,
		Deleted:       map[string]int{},
	}
	err := s.store.Update(func(state *Snapshot) error {
		for id, value := range state.Notifications {
			if value.Account == account && value.CreatedAt.Before(now.Add(-s.retention.NotificationMaxAge)) {
				delete(state.Notifications, id)
				result.Deleted["notifications"]++
			}
		}
		for id, value := range state.AIRuns {
			if value.Account == account && value.CreatedAt.Before(now.Add(-s.retention.AIRunMaxAge)) {
				delete(state.AIRuns, id)
				result.Deleted["aiRuns"]++
			}
		}
		for id, value := range state.Idempotency {
			if strings.HasSuffix(value.Scope, ":"+account) && value.CreatedAt.Before(now.Add(-s.retention.IdempotencyMaxAge)) {
				delete(state.Idempotency, id)
				result.Deleted["idempotency"]++
			}
		}
		for nonce, expiry := range state.GatewaySeen {
			if !now.Before(expiry) {
				delete(state.GatewaySeen, nonce)
				result.Deleted["expiredGatewayNonces"]++
			}
		}

		providerEvents := make(map[string]bool, len(state.Events))
		for _, event := range state.Events {
			providerEvents[event.ProviderEventID] = true
		}
		for providerEventID, seenAt := range state.ProviderSeen {
			if !providerEvents[providerEventID] && seenAt.Before(now.Add(-s.retention.ProviderReplayAge)) {
				delete(state.ProviderSeen, providerEventID)
				result.Deleted["orphanProviderReplayRecords"]++
			}
		}

		pseudonym := accountPseudonym(account)
		if receipt, ok := state.DeletionReceipts[pseudonym]; ok && receipt.DeletedAt.Before(now.Add(-s.retention.DeletionReceiptAge)) {
			delete(state.DeletionReceipts, pseudonym)
			result.Deleted["deletionReceipts"]++
		}
		if totalDeleted(result.Deleted) > 0 {
			appendAudit(ctx, state, "account_retention_enforced", "retention_"+shortHash(account, now.Format(time.RFC3339Nano)), account, now)
			result.AuditID = state.Audit[len(state.Audit)-1].ID
		}
		return nil
	})
	return result, err
}

func (s *Service) DeleteAccount(ctx context.Context, account string, input DeleteAccountInput) (DataDeletionReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := strings.TrimSpace(input.IdempotencyKey)
	if input.Confirmation != DeleteConfirmation || !validKey(key) {
		return DataDeletionReceipt{}, ErrInvalid
	}
	pseudonym := accountPseudonym(account)
	digest := hashBytes([]byte(key))
	var existing DataDeletionReceipt
	if err := s.store.View(func(state Snapshot) error {
		existing = state.DeletionReceipts[pseudonym]
		return nil
	}); err != nil {
		return DataDeletionReceipt{}, err
	}
	if existing.ID != "" {
		if existing.IdempotencyDigest != digest {
			return DataDeletionReceipt{}, ErrConflict
		}
		return existing, nil
	}

	var cards []Card
	if err := s.store.View(func(state Snapshot) error {
		for _, card := range state.Cards {
			if card.Account == account && card.Status != "closed" {
				cards = append(cards, card)
			}
		}
		return nil
	}); err != nil {
		return DataDeletionReceipt{}, err
	}
	sort.Slice(cards, func(i, j int) bool { return cards[i].ID < cards[j].ID })
	for _, card := range cards {
		if err := s.provider.UpdateStatus(ctx, card.ProviderCardID, "closed"); err != nil {
			return DataDeletionReceipt{}, err
		}
	}

	now := s.now().UTC()
	receipt := DataDeletionReceipt{
		ID:                "delete_" + shortHash(account, key),
		AccountPseudonym:  pseudonym,
		IdempotencyDigest: digest,
		ClosedCards:       len(cards),
		DeletedRecords:    map[string]int{},
		DeletedAt:         now,
	}
	err := s.store.Update(func(state *Snapshot) error {
		if _, ok := state.Eligibility[account]; ok {
			delete(state.Eligibility, account)
			receipt.DeletedRecords["eligibility"]++
		}
		providerEventIDs := map[string]bool{}
		for id, value := range state.Applications {
			if value.Account == account {
				delete(state.Applications, id)
				receipt.DeletedRecords["applications"]++
			}
		}
		for id, value := range state.Cards {
			if value.Account == account {
				delete(state.Cards, id)
				receipt.DeletedRecords["cards"]++
			}
		}
		for id, value := range state.Events {
			if value.Account == account {
				providerEventIDs[value.ProviderEventID] = true
				delete(state.Events, id)
				receipt.DeletedRecords["events"]++
			}
		}
		for id, value := range state.Disputes {
			if value.Account == account {
				delete(state.Disputes, id)
				receipt.DeletedRecords["disputes"]++
			}
		}
		for id, value := range state.Notifications {
			if value.Account == account {
				delete(state.Notifications, id)
				receipt.DeletedRecords["notifications"]++
			}
		}
		for id, value := range state.AIRuns {
			if value.Account == account {
				delete(state.AIRuns, id)
				receipt.DeletedRecords["aiRuns"]++
			}
		}
		for id, value := range state.Idempotency {
			if strings.HasSuffix(value.Scope, ":"+account) {
				delete(state.Idempotency, id)
				receipt.DeletedRecords["idempotency"]++
			}
		}
		for providerEventID := range providerEventIDs {
			delete(state.ProviderSeen, providerEventID)
		}
		redactAndRehashAudit(state, account, pseudonym)
		appendAudit(ctx, state, "account_data_deleted", receipt.ID, pseudonym, now)
		receipt.AuditID = state.Audit[len(state.Audit)-1].ID
		state.DeletionReceipts[pseudonym] = receipt
		return nil
	})
	return receipt, err
}

func (s *Service) accountState(account string) (AccountState, error) {
	var out AccountState
	out.Applications = []Application{}
	out.Cards = []Card{}
	out.Events = []CardEvent{}
	out.Disputes = []Dispute{}
	out.Notifications = []Notification{}
	out.AIRuns = []AIRun{}
	out.Audit = []AuditEvent{}
	err := s.store.View(func(state Snapshot) error {
		if eligibility, ok := state.Eligibility[account]; ok {
			out.Eligibility = &eligibility
		}
		for _, value := range state.Applications {
			if value.Account == account {
				out.Applications = append(out.Applications, value)
			}
		}
		for _, value := range state.Cards {
			if value.Account == account {
				out.Cards = append(out.Cards, value)
			}
		}
		for _, value := range state.Events {
			if value.Account == account {
				out.Events = append(out.Events, value)
			}
		}
		for _, value := range state.Disputes {
			if value.Account == account {
				out.Disputes = append(out.Disputes, value)
			}
		}
		for _, value := range state.Notifications {
			if value.Account == account {
				out.Notifications = append(out.Notifications, value)
			}
		}
		for _, value := range state.AIRuns {
			if value.Account == account {
				out.AIRuns = append(out.AIRuns, value)
			}
		}
		for _, value := range state.Audit {
			if value.Account == account {
				out.Audit = append(out.Audit, value)
			}
		}
		return nil
	})
	sort.Slice(out.Events, func(i, j int) bool { return out.Events[i].OccurredAt.After(out.Events[j].OccurredAt) })
	sort.Slice(out.Notifications, func(i, j int) bool { return out.Notifications[i].CreatedAt.After(out.Notifications[j].CreatedAt) })
	return out, err
}

func sanitizeAccountExport(state AccountState) AccountState {
	if state.Eligibility != nil {
		copy := *state.Eligibility
		copy.Reference = ""
		state.Eligibility = &copy
	}
	for index := range state.Applications {
		state.Applications[index].EligibilityReference = ""
		state.Applications[index].ProviderReference = ""
	}
	for index := range state.Cards {
		state.Cards[index].ProviderCardID = ""
	}
	for index := range state.Events {
		state.Events[index].ProviderEventID = ""
		state.Events[index].ProviderCardID = ""
		state.Events[index].RelatedEventID = ""
	}
	previous := ""
	for index := range state.Audit {
		state.Audit[index].RequestID = ""
		state.Audit[index].TraceID = ""
		state.Audit[index].PreviousHash = previous
		state.Audit[index].Hash = auditHash(state.Audit[index])
		state.Audit[index].ID = auditIDFromHash(state.Audit[index].Hash)
		previous = state.Audit[index].Hash
	}
	return state
}

func redactAndRehashAudit(state *Snapshot, account, pseudonym string) {
	previous := ""
	for index := range state.Audit {
		entry := state.Audit[index]
		if entry.Account == account {
			entry.Account = pseudonym
			entry.ObjectID = "deleted_" + shortHash(entry.ObjectID)
			entry.RequestID = ""
			entry.TraceID = ""
		}
		entry.PreviousHash = previous
		entry.Hash = auditHash(entry)
		entry.ID = auditIDFromHash(entry.Hash)
		state.Audit[index] = entry
		previous = entry.Hash
	}
}

func accountPseudonym(account string) string {
	return "account_" + hashBytes([]byte(account))[:24]
}

func totalDeleted(values map[string]int) int {
	total := 0
	for _, value := range values {
		total += value
	}
	return total
}
