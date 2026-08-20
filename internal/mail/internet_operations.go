package mail

import (
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxDeadLetters = 1000

type Suppression struct {
	RecipientHash string    `json:"recipient_hash"`
	Provider      string    `json:"provider"`
	Reason        string    `json:"reason"`
	SourceEventID string    `json:"source_event_id,omitempty"`
	Active        bool      `json:"active"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type DeadLetter struct {
	ID            string        `json:"id"`
	MessageID     string        `json:"message_id"`
	SenderID      string        `json:"sender_id,omitempty"`
	RecipientHash string        `json:"recipient_hash"`
	Provider      string        `json:"provider"`
	Attempt       int           `json:"attempt"`
	State         string        `json:"state"`
	DeliveryState DeliveryState `json:"delivery_state"`
	Reason        string        `json:"reason"`
	CreatedAt     time.Time     `json:"created_at"`
	UpdatedAt     time.Time     `json:"updated_at"`
	ResolvedAt    time.Time     `json:"resolved_at,omitempty"`
}

type ProviderHealth struct {
	Provider                      string    `json:"provider"`
	State                         string    `json:"state"`
	SubmissionConfigured          bool      `json:"submission_configured"`
	WebhookVerificationConfigured bool      `json:"webhook_verification_configured"`
	SenderIdentityConfigured      bool      `json:"sender_identity_configured"`
	LastSubmissionSuccessAt       time.Time `json:"last_submission_success_at,omitempty"`
	LastSubmissionFailureAt       time.Time `json:"last_submission_failure_at,omitempty"`
	LastVerifiedWebhookAt         time.Time `json:"last_verified_webhook_at,omitempty"`
	LastFailureReason             string    `json:"last_failure_reason,omitempty"`
	ConsecutiveFailures           int       `json:"consecutive_failures"`
	ActiveSuppressions            int       `json:"active_suppressions"`
	OpenDeadLetters               int       `json:"open_dead_letters"`
}

func suppressionKey(recipient string) string {
	return digest(strings.ToLower(strings.TrimSpace(recipient)))
}

func activeSuppression(st *State, recipient string) (Suppression, bool) {
	suppression, ok := st.Suppressions[suppressionKey(recipient)]
	return suppression, ok && suppression.Active
}

func addSuppression(st *State, recipient, provider, reason, eventID string, now time.Time) {
	key := suppressionKey(recipient)
	suppression, exists := st.Suppressions[key]
	if !exists {
		suppression = Suppression{RecipientHash: key, CreatedAt: now}
	}
	suppression.Provider = provider
	suppression.Reason = reason
	suppression.SourceEventID = eventID
	suppression.Active = true
	suppression.UpdatedAt = now
	st.Suppressions[key] = suppression
}

func deadLetterID(messageID, recipient string, attempt int) string {
	return "dead_" + digest(messageID + "\x00" + strings.ToLower(strings.TrimSpace(recipient)) + "\x00" + strconv.Itoa(attempt))[:32]
}

func upsertDeadLetter(st *State, message Message, delivery Delivery, state string, now time.Time) {
	id := deadLetterID(message.ID, delivery.Recipient, delivery.Attempt)
	letter, exists := st.DeadLetters[id]
	if !exists {
		letter = DeadLetter{
			ID:            id,
			MessageID:     message.ID,
			SenderID:      message.SenderID,
			RecipientHash: suppressionKey(delivery.Recipient),
			Provider:      delivery.Provider,
			Attempt:       delivery.Attempt,
			CreatedAt:     now,
		}
	}
	letter.State = state
	letter.DeliveryState = delivery.State
	letter.Reason = delivery.Reason
	letter.UpdatedAt = now
	if state == "resolved" {
		letter.ResolvedAt = now
	}
	st.DeadLetters[id] = letter
	pruneDeadLetters(st)
}

func resolveDeadLetters(st *State, messageID, recipient string, now time.Time) {
	recipientHash := suppressionKey(recipient)
	for id, letter := range st.DeadLetters {
		if letter.MessageID != messageID || letter.RecipientHash != recipientHash || letter.State == "resolved" {
			continue
		}
		letter.State = "resolved"
		letter.UpdatedAt = now
		letter.ResolvedAt = now
		st.DeadLetters[id] = letter
	}
}

func pruneDeadLetters(st *State) {
	if len(st.DeadLetters) <= maxDeadLetters {
		return
	}
	letters := make([]DeadLetter, 0, len(st.DeadLetters))
	for _, letter := range st.DeadLetters {
		letters = append(letters, letter)
	}
	sort.Slice(letters, func(i, j int) bool {
		if letters[i].State == "resolved" && letters[j].State != "resolved" {
			return true
		}
		if letters[i].State != "resolved" && letters[j].State == "resolved" {
			return false
		}
		return letters[i].UpdatedAt.Before(letters[j].UpdatedAt)
	})
	for len(st.DeadLetters) > maxDeadLetters && len(letters) > 0 {
		delete(st.DeadLetters, letters[0].ID)
		letters = letters[1:]
	}
}

func (s *Service) DeadLetters(token string) ([]DeadLetter, error) {
	out := []DeadLetter{}
	err := s.store.view(func(st State) error {
		sess, err := s.session(&st, token)
		if err != nil {
			return err
		}
		for _, letter := range st.DeadLetters {
			if letter.SenderID == sess.UserID {
				letter.SenderID = ""
				out = append(out, letter)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
		return nil
	})
	return out, err
}

func (s *Service) InternetBridgeHealth() ProviderHealth {
	status := s.InternetBridgeStatus()
	health := ProviderHealth{
		Provider:                      status.Provider,
		State:                         "unconfigured",
		SubmissionConfigured:          status.SubmissionConfigured,
		WebhookVerificationConfigured: status.WebhookVerificationConfigured,
		SenderIdentityConfigured:      status.SenderIdentityConfigured,
	}
	if status.SubmissionConfigured {
		health.State = "configured_unverified"
	}
	_ = s.store.view(func(st State) error {
		if stored, ok := st.ProviderHealth[status.Provider]; ok {
			health.LastSubmissionSuccessAt = stored.LastSubmissionSuccessAt
			health.LastSubmissionFailureAt = stored.LastSubmissionFailureAt
			health.LastVerifiedWebhookAt = stored.LastVerifiedWebhookAt
			health.LastFailureReason = stored.LastFailureReason
			health.ConsecutiveFailures = stored.ConsecutiveFailures
			if !stored.LastSubmissionSuccessAt.IsZero() && stored.ConsecutiveFailures == 0 {
				health.State = "submission_accepted_local_evidence"
			}
			if stored.ConsecutiveFailures > 0 {
				health.State = "degraded"
			}
			if stored.LastFailureReason == "provider_rate_limited" {
				health.State = "rate_limited"
			}
		}
		for _, suppression := range st.Suppressions {
			if suppression.Active && suppression.Provider == status.Provider {
				health.ActiveSuppressions++
			}
		}
		for _, letter := range st.DeadLetters {
			if letter.State != "resolved" && letter.Provider == status.Provider {
				health.OpenDeadLetters++
			}
		}
		return nil
	})
	return health
}

func recordProviderSubmission(st *State, provider, reason string, success bool, now time.Time) {
	health := st.ProviderHealth[provider]
	health.Provider = provider
	if success {
		health.LastSubmissionSuccessAt = now
		health.LastFailureReason = ""
		health.ConsecutiveFailures = 0
	} else {
		health.LastSubmissionFailureAt = now
		health.LastFailureReason = reason
		health.ConsecutiveFailures++
	}
	st.ProviderHealth[provider] = health
}

func recordVerifiedWebhook(st *State, provider string, now time.Time) {
	health := st.ProviderHealth[provider]
	health.Provider = provider
	health.LastVerifiedWebhookAt = now
	st.ProviderHealth[provider] = health
}
