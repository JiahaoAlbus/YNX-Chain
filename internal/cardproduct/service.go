package cardproduct

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrInvalid      = errors.New("invalid card product request")
	ErrUnauthorized = errors.New("card product authorization failed")
	ErrConflict     = errors.New("card product state conflict")
	ErrNotFound     = errors.New("card product record not found")
	isoCountry      = regexp.MustCompile(`^[A-Z]{2}$`)
	mccPattern      = regexp.MustCompile(`^[0-9]{4}$`)
)

var providerKeyID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\z`)

const (
	DefaultProviderEventKeyID    = "default"
	MaxProviderEventVerification = 4
)

type Config struct {
	StorePath         string
	IntegrityKey      []byte
	GatewayKey        []byte
	ProviderEventKey  []byte
	ProviderEventKeys map[string][]byte
	Provider          IssuerProvider
	AI                AIProvider
	Retention         RetentionPolicy
	Now               func() time.Time
}

type Service struct {
	store             *Store
	provider          IssuerProvider
	ai                AIProvider
	gateway           *GatewayVerifier
	providerEventKeys map[string][]byte
	retention         RetentionPolicy
	now               func() time.Time
	mu                sync.Mutex
}

func New(cfg Config) (*Service, error) {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Provider == nil {
		cfg.Provider = UnavailableProvider{}
	}
	if err := ValidateProviderCapabilities(cfg.Provider); err != nil {
		return nil, fmt.Errorf("issuer provider capability contract: %w", err)
	}
	store, err := OpenStore(cfg.StorePath, cfg.IntegrityKey)
	if err != nil {
		return nil, err
	}
	verifier, err := NewGatewayVerifier(cfg.GatewayKey, store, cfg.Now)
	if err != nil {
		return nil, err
	}
	providerEventKeys, err := normalizeProviderEventKeys(cfg.ProviderEventKey, cfg.ProviderEventKeys)
	if err != nil {
		return nil, err
	}
	retention, err := normalizeRetentionPolicy(cfg.Retention)
	if err != nil {
		return nil, err
	}
	return &Service{store: store, provider: cfg.Provider, ai: cfg.AI, gateway: verifier, providerEventKeys: providerEventKeys, retention: retention, now: cfg.Now}, nil
}

func (s *Service) ProviderName() string { return s.provider.Name() }
func (s *Service) ProviderCapabilities() ProviderCapabilities {
	return s.provider.Capabilities()
}
func (s *Service) ProviderAvailable(ctx context.Context) bool { return s.provider.Health(ctx) == nil }

type ApplyInput struct {
	EligibilityReference string `json:"eligibilityReference"`
	LegalConsentVersion  string `json:"legalConsentVersion"`
	IdempotencyKey       string `json:"idempotencyKey"`
}

func (s *Service) Apply(ctx context.Context, account string, input ApplyInput) (Application, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	reference, key := strings.TrimSpace(input.EligibilityReference), strings.TrimSpace(input.IdempotencyKey)
	if len(reference) < 8 || len(reference) > 128 || input.LegalConsentVersion != "card-testnet-v1" || !validKey(key) {
		return Application{}, ErrInvalid
	}
	requestHash := hashJSON(input)
	scope := "application:" + account
	if existing, ok, err := s.idempotentApplication(scope, key, requestHash); ok || err != nil {
		return existing, err
	}
	eligibility, err := s.provider.CheckEligibility(ctx, account, reference)
	if err != nil && !errors.Is(err, ErrProviderUnavailable) {
		return Application{}, err
	}
	now := s.now().UTC()
	id := "cap_" + shortHash(account, key, reference)
	status := "provider_unavailable"
	providerReference := ""
	if err != nil {
		eligibility = Eligibility{Reference: reference, Status: "provider_unavailable", Provider: s.provider.Name(), UpdatedAt: now}
	} else if eligibility.Status == "rejected" {
		status = "rejected"
	} else if eligibility.Status == "pending_review" {
		status = "pending_review"
	} else {
		providerReference, status, err = s.provider.SubmitApplication(ctx, IssueRequest{ApplicationID: id, Account: account, EligibilityReference: reference})
		if err != nil {
			return Application{}, err
		}
	}
	application := Application{ID: id, Account: account, EligibilityReference: reference, Status: status, Provider: s.provider.Name(), ProviderReference: providerReference, LegalConsentVersion: input.LegalConsentVersion, CreatedAt: now, UpdatedAt: now}
	err = s.store.Update(func(state *Snapshot) error {
		delete(state.DeletionReceipts, accountPseudonym(account))
		state.Eligibility[account] = eligibility
		state.Applications[id] = application
		state.Idempotency[scope+":"+key] = IdempotencyRecord{Scope: scope, Key: key, RequestHash: requestHash, ObjectID: id, CreatedAt: now}
		appendAudit(ctx, state, "application_created", id, account, now)
		return nil
	})
	if err != nil {
		return Application{}, err
	}
	if status == "issued_sandbox" {
		_, _ = s.issueSandboxLocked(ctx, application)
	}
	return s.application(id)
}

func (s *Service) issueSandboxLocked(ctx context.Context, application Application) (Card, error) {
	provided, err := s.provider.IssueSandbox(ctx, IssueRequest{ApplicationID: application.ID, Account: application.Account, EligibilityReference: application.EligibilityReference})
	if err != nil {
		return Card{}, err
	}
	if provided.Status != "issued_sandbox" || provided.Network != Network || len(provided.Last4) != 4 || provided.ProviderCardID == "" {
		return Card{}, errors.New("issuer sandbox returned unsafe card reference")
	}
	now := s.now().UTC()
	id := "card_" + shortHash(application.ID, provided.ProviderCardID)
	card := Card{ID: id, Account: application.Account, ApplicationID: application.ID, ProviderCardID: provided.ProviderCardID, Provider: s.provider.Name(), Network: provided.Network, Last4: provided.Last4, ExpiryMonth: provided.ExpiryMonth, ExpiryYear: provided.ExpiryYear, Status: "issued_sandbox", Controls: defaultControls(), CreatedAt: now, UpdatedAt: now}
	err = s.store.Update(func(state *Snapshot) error {
		state.Cards[id] = card
		app := state.Applications[application.ID]
		app.Status = "issued_sandbox"
		app.UpdatedAt = now
		state.Applications[application.ID] = app
		appendAudit(ctx, state, "sandbox_card_issued", id, card.Account, now)
		return nil
	})
	return card, err
}

func (s *Service) Transition(ctx context.Context, account, cardID, action, key string) (Card, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !validKey(key) {
		return Card{}, ErrInvalid
	}
	card, err := s.ownedCard(account, cardID)
	if err != nil {
		return Card{}, err
	}
	target, ok := transition(card.Status, action)
	if !ok {
		return Card{}, ErrConflict
	}
	requestHash := hashJSON(map[string]string{"cardId": cardID, "action": action})
	scope := "transition:" + account
	if existing, ok, err := s.idempotentCard(scope, key, requestHash); ok || err != nil {
		return existing, err
	}
	if action == "replace" {
		provided, err := s.provider.Replace(ctx, card.ProviderCardID)
		if err != nil {
			return Card{}, err
		}
		now := s.now().UTC()
		replacement := Card{ID: "card_" + shortHash(card.ID, provided.ProviderCardID), Account: account, ApplicationID: card.ApplicationID, ProviderCardID: provided.ProviderCardID, Provider: s.provider.Name(), Network: provided.Network, Last4: provided.Last4, ExpiryMonth: provided.ExpiryMonth, ExpiryYear: provided.ExpiryYear, Status: "issued_sandbox", ReplacementFor: card.ID, Controls: card.Controls, CreatedAt: now, UpdatedAt: now}
		err = s.store.Update(func(state *Snapshot) error {
			old := state.Cards[card.ID]
			old.Status = "closed"
			old.UpdatedAt = now
			state.Cards[old.ID] = old
			state.Cards[replacement.ID] = replacement
			state.Idempotency[scope+":"+key] = IdempotencyRecord{Scope: scope, Key: key, RequestHash: requestHash, ObjectID: replacement.ID, CreatedAt: now}
			appendAudit(ctx, state, "card_replaced", replacement.ID, account, now)
			return nil
		})
		return replacement, err
	}
	if err := s.provider.UpdateStatus(ctx, card.ProviderCardID, target); err != nil {
		return Card{}, err
	}
	now := s.now().UTC()
	card.Status = target
	card.UpdatedAt = now
	err = s.store.Update(func(state *Snapshot) error {
		state.Cards[card.ID] = card
		state.Idempotency[scope+":"+key] = IdempotencyRecord{Scope: scope, Key: key, RequestHash: requestHash, ObjectID: card.ID, CreatedAt: now}
		appendAudit(ctx, state, "card_"+action, card.ID, account, now)
		return nil
	})
	return card, err
}

func transition(status, action string) (string, bool) {
	switch action {
	case "activate":
		return "active", status == "issued_sandbox"
	case "freeze":
		return "frozen", status == "active"
	case "unfreeze":
		return "active", status == "frozen"
	case "close":
		return "closed", status != "closed"
	case "replace":
		return "issued_sandbox", status == "active" || status == "frozen"
	default:
		return "", false
	}
}

type ControlsInput struct {
	SpendLimitMinor  int64    `json:"spendLimitMinor"`
	Currency         string   `json:"currency"`
	Online           bool     `json:"online"`
	International    bool     `json:"international"`
	ATM              bool     `json:"atm"`
	AllowedMCC       []string `json:"allowedMcc"`
	BlockedMCC       []string `json:"blockedMcc"`
	AllowedCountries []string `json:"allowedCountries"`
	IdempotencyKey   string   `json:"idempotencyKey"`
}

func (s *Service) UpdateControls(ctx context.Context, account, cardID string, input ControlsInput) (Card, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	card, err := s.ownedCard(account, cardID)
	if err != nil {
		return Card{}, err
	}
	if card.Status == "closed" {
		return Card{}, ErrConflict
	}
	controls := Controls{SpendLimitMinor: input.SpendLimitMinor, Currency: strings.ToUpper(strings.TrimSpace(input.Currency)), Online: input.Online, International: input.International, ATM: input.ATM, AllowedMCC: normalized(input.AllowedMCC), BlockedMCC: normalized(input.BlockedMCC), AllowedCountries: normalized(input.AllowedCountries)}
	if err := validateControls(controls); err != nil {
		return Card{}, err
	}
	if !validKey(input.IdempotencyKey) {
		return Card{}, ErrInvalid
	}
	requestHash := hashJSON(input)
	scope := "controls:" + account
	if existing, ok, err := s.idempotentCard(scope, input.IdempotencyKey, requestHash); ok || err != nil {
		return existing, err
	}
	if err := s.provider.UpdateControls(ctx, card.ProviderCardID, controls); err != nil {
		return Card{}, err
	}
	now := s.now().UTC()
	card.Controls = controls
	card.UpdatedAt = now
	err = s.store.Update(func(state *Snapshot) error {
		state.Cards[card.ID] = card
		state.Idempotency[scope+":"+input.IdempotencyKey] = IdempotencyRecord{Scope: scope, Key: input.IdempotencyKey, RequestHash: requestHash, ObjectID: card.ID, CreatedAt: now}
		appendAudit(ctx, state, "card_controls_updated", card.ID, account, now)
		return nil
	})
	return card, err
}

type ProviderEventInput struct {
	EventID        string    `json:"eventId"`
	ProviderCardID string    `json:"providerCardId"`
	Type           string    `json:"type"`
	AmountMinor    int64     `json:"amountMinor"`
	Currency       string    `json:"currency"`
	Merchant       string    `json:"merchant"`
	MCC            string    `json:"mcc,omitempty"`
	Country        string    `json:"country,omitempty"`
	ReasonCode     string    `json:"reasonCode,omitempty"`
	RelatedEventID string    `json:"relatedEventId,omitempty"`
	OccurredAt     time.Time `json:"occurredAt"`
}

func (s *Service) AcceptProviderEvent(input ProviderEventInput, timestamp time.Time, signature string) (CardEvent, error) {
	return s.AcceptProviderEventWithKeyIDContext(context.Background(), input, timestamp, DefaultProviderEventKeyID, signature)
}

func (s *Service) AcceptProviderEventWithKeyID(input ProviderEventInput, timestamp time.Time, keyID, signature string) (CardEvent, error) {
	return s.AcceptProviderEventWithKeyIDContext(context.Background(), input, timestamp, keyID, signature)
}

func (s *Service) AcceptProviderEventWithKeyIDContext(ctx context.Context, input ProviderEventInput, timestamp time.Time, keyID, signature string) (CardEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC()
	if now.Sub(timestamp) > 5*time.Minute || timestamp.Sub(now) > 30*time.Second {
		return CardEvent{}, ErrUnauthorized
	}
	if !contains([]string{"authorization", "reversal", "clearing", "decline", "refund"}, input.Type) || !validProviderEvent(input) {
		return CardEvent{}, ErrInvalid
	}
	raw, _ := json.Marshal(input)
	material := []byte(strings.Join([]string{ProviderDomain, timestamp.UTC().Format(time.RFC3339Nano), hashBytes(raw)}, "\n"))
	verificationKey, ok := s.providerEventKeys[strings.TrimSpace(keyID)]
	if !ok || !hmacEqual(signature, hmacHex(verificationKey, material)) {
		return CardEvent{}, ErrUnauthorized
	}
	var card Card
	found := false
	if err := s.store.View(func(state Snapshot) error {
		if _, seen := state.ProviderSeen[input.EventID]; seen {
			return ErrConflict
		}
		for _, candidate := range state.Cards {
			if candidate.ProviderCardID == input.ProviderCardID {
				card = candidate
				found = true
				break
			}
		}
		if found {
			return validateProviderEventRelation(state, input)
		}
		return nil
	}); err != nil {
		return CardEvent{}, err
	}
	if !found {
		return CardEvent{}, ErrNotFound
	}
	event := CardEvent{ID: "cev_" + shortHash(input.EventID, input.ProviderCardID), ProviderEventID: input.EventID, ProviderCardID: input.ProviderCardID, CardID: card.ID, Account: card.Account, Type: input.Type, AmountMinor: input.AmountMinor, Currency: input.Currency, Merchant: input.Merchant, MCC: input.MCC, Country: input.Country, ReasonCode: input.ReasonCode, RelatedEventID: input.RelatedEventID, OccurredAt: input.OccurredAt.UTC(), ReceivedAt: now}
	notification := Notification{ID: "ntf_" + shortHash(event.ID, event.Type), Account: event.Account, EventID: event.ID, Type: "card_" + event.Type, Title: notificationTitle(event.Type), Body: notificationBody(event), CreatedAt: now}
	err := s.store.Update(func(state *Snapshot) error {
		if _, seen := state.ProviderSeen[input.EventID]; seen {
			return ErrConflict
		}
		state.ProviderSeen[input.EventID] = now
		state.Events[event.ID] = event
		state.Notifications[notification.ID] = notification
		appendAudit(ctx, state, "provider_"+event.Type, event.ID, event.Account, now)
		return nil
	})
	return event, err
}

type DisputeInput struct {
	EventID        string `json:"eventId"`
	Reason         string `json:"reason"`
	IdempotencyKey string `json:"idempotencyKey"`
}

func (s *Service) OpenDispute(account, cardID string, input DisputeInput) (Dispute, error) {
	return s.OpenDisputeWithContext(context.Background(), account, cardID, input)
}

func (s *Service) OpenDisputeWithContext(ctx context.Context, account, cardID string, input DisputeInput) (Dispute, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(strings.TrimSpace(input.Reason)) < 8 || len(input.Reason) > 1000 || !validKey(input.IdempotencyKey) {
		return Dispute{}, ErrInvalid
	}
	if _, err := s.ownedCard(account, cardID); err != nil {
		return Dispute{}, err
	}
	var event CardEvent
	_ = s.store.View(func(state Snapshot) error { event = state.Events[input.EventID]; return nil })
	if event.ID == "" || event.Account != account || event.CardID != cardID || !contains([]string{"authorization", "clearing", "decline"}, event.Type) {
		return Dispute{}, ErrNotFound
	}
	scope := "dispute:" + account
	requestHash := hashJSON(input)
	var existing Dispute
	found := false
	var conflict bool
	_ = s.store.View(func(state Snapshot) error {
		if record, ok := state.Idempotency[scope+":"+input.IdempotencyKey]; ok {
			if record.RequestHash != requestHash {
				conflict = true
			} else {
				existing = state.Disputes[record.ObjectID]
				found = true
			}
		}
		return nil
	})
	if conflict {
		return Dispute{}, ErrConflict
	}
	if found {
		return existing, nil
	}
	now := s.now().UTC()
	d := Dispute{ID: "cdp_" + shortHash(cardID, input.EventID, input.IdempotencyKey), Account: account, CardID: cardID, EventID: input.EventID, Reason: strings.TrimSpace(input.Reason), Status: "open", CreatedAt: now, UpdatedAt: now}
	err := s.store.Update(func(state *Snapshot) error {
		state.Disputes[d.ID] = d
		state.Idempotency[scope+":"+input.IdempotencyKey] = IdempotencyRecord{Scope: scope, Key: input.IdempotencyKey, RequestHash: requestHash, ObjectID: d.ID, CreatedAt: now}
		appendAudit(ctx, state, "card_dispute_opened", d.ID, account, now)
		return nil
	})
	return d, err
}

type AIRunInput struct {
	Workflow       string `json:"workflow"`
	ContextEventID string `json:"contextEventId"`
	OutputLanguage string `json:"outputLanguage"`
	Permission     string `json:"permission"`
}

func (s *Service) RunAI(ctx context.Context, account string, input AIRunInput) (AIRun, error) {
	if !contains([]string{"card_decline_explanation", "card_fee_explanation", "card_support_draft"}, input.Workflow) || input.Permission != "allow_once" || !contains([]string{"en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"}, input.OutputLanguage) {
		return AIRun{}, ErrInvalid
	}
	var event CardEvent
	_ = s.store.View(func(state Snapshot) error { event = state.Events[input.ContextEventID]; return nil })
	if event.ID == "" || event.Account != account {
		return AIRun{}, ErrNotFound
	}
	now := s.now().UTC()
	run := AIRun{ID: "cai_" + shortHash(account, input.ContextEventID, now.String()), Account: account, Workflow: input.Workflow, ContextEventID: event.ID, OutputLanguage: input.OutputLanguage, Permission: input.Permission, Status: "running", CreatedAt: now, UpdatedAt: now}
	if err := s.store.Update(func(state *Snapshot) error {
		state.AIRuns[run.ID] = run
		appendAudit(ctx, state, "card_ai_started", run.ID, account, now)
		return nil
	}); err != nil {
		return AIRun{}, err
	}
	if s.ai == nil {
		run.Status = "provider_unavailable"
	} else {
		prompt := fmt.Sprintf("Explain card event %s type=%s amountMinor=%d currency=%s reason=%s. Draft only; never claim a financial action. Output language %s.", event.ID, event.Type, event.AmountMinor, event.Currency, event.ReasonCode, input.OutputLanguage)
		provider, model, result, units, err := s.ai.Complete(ctx, input.Workflow, prompt)
		run.Provider, run.Model, run.CostUnits = provider, model, units
		if err != nil || strings.TrimSpace(result) == "" {
			run.Status = "provider_failed"
		} else {
			run.Status = "review"
			run.Draft = strings.TrimSpace(result)
		}
	}
	run.UpdatedAt = s.now().UTC()
	if err := s.store.Update(func(state *Snapshot) error {
		state.AIRuns[run.ID] = run
		appendAudit(ctx, state, "card_ai_"+run.Status, run.ID, account, run.UpdatedAt)
		return nil
	}); err != nil {
		return AIRun{}, err
	}
	return run, nil
}

func (s *Service) ReviewAI(account, id, decision string) (AIRun, error) {
	return s.ReviewAIWithContext(context.Background(), account, id, decision)
}

func (s *Service) ReviewAIWithContext(ctx context.Context, account, id, decision string) (AIRun, error) {
	if !contains([]string{"apply", "reject"}, decision) {
		return AIRun{}, ErrInvalid
	}
	var run AIRun
	err := s.store.Update(func(state *Snapshot) error {
		run = state.AIRuns[id]
		if run.ID == "" || run.Account != account {
			return ErrNotFound
		}
		if run.Status != "review" {
			return ErrConflict
		}
		run.Decision = decision
		run.Status = "reviewed"
		run.UpdatedAt = s.now().UTC()
		state.AIRuns[id] = run
		appendAudit(ctx, state, "card_ai_"+decision, id, account, run.UpdatedAt)
		return nil
	})
	return run, err
}

func (s *Service) State(account string) (AccountState, error) {
	var out AccountState
	out.Applications = []Application{}
	out.Cards = []Card{}
	out.Events = []CardEvent{}
	out.Disputes = []Dispute{}
	out.Notifications = []Notification{}
	out.AIRuns = []AIRun{}
	out.Audit = []AuditEvent{}
	err := s.store.View(func(state Snapshot) error {
		if e, ok := state.Eligibility[account]; ok {
			out.Eligibility = &e
		}
		for _, v := range state.Applications {
			if v.Account == account {
				out.Applications = append(out.Applications, v)
			}
		}
		for _, v := range state.Cards {
			if v.Account == account {
				out.Cards = append(out.Cards, v)
			}
		}
		for _, v := range state.Events {
			if v.Account == account {
				out.Events = append(out.Events, v)
			}
		}
		for _, v := range state.Disputes {
			if v.Account == account {
				out.Disputes = append(out.Disputes, v)
			}
		}
		for _, v := range state.Notifications {
			if v.Account == account {
				out.Notifications = append(out.Notifications, v)
			}
		}
		for _, v := range state.AIRuns {
			if v.Account == account {
				out.AIRuns = append(out.AIRuns, v)
			}
		}
		for _, v := range state.Audit {
			if v.Account == account {
				out.Audit = append(out.Audit, v)
			}
		}
		return nil
	})
	sort.Slice(out.Events, func(i, j int) bool { return out.Events[i].OccurredAt.After(out.Events[j].OccurredAt) })
	sort.Slice(out.Notifications, func(i, j int) bool { return out.Notifications[i].CreatedAt.After(out.Notifications[j].CreatedAt) })
	return out, err
}

func notificationTitle(eventType string) string {
	switch eventType {
	case "decline":
		return "Card declined"
	case "authorization":
		return "Card authorization"
	case "clearing":
		return "Card payment cleared"
	case "reversal":
		return "Card authorization reversed"
	case "refund":
		return "Card refund recorded"
	default:
		return "Card activity"
	}
}
func notificationBody(event CardEvent) string {
	detail := fmt.Sprintf("%s · %d %s minor units", event.Merchant, event.AmountMinor, event.Currency)
	if event.ReasonCode != "" {
		detail += " · " + event.ReasonCode
	}
	return detail
}

func (s *Service) application(id string) (Application, error) {
	var out Application
	_ = s.store.View(func(state Snapshot) error { out = state.Applications[id]; return nil })
	if out.ID == "" {
		return Application{}, ErrNotFound
	}
	return out, nil
}
func (s *Service) ownedCard(account, id string) (Card, error) {
	var out Card
	_ = s.store.View(func(state Snapshot) error { out = state.Cards[id]; return nil })
	if out.ID == "" {
		return Card{}, ErrNotFound
	}
	if out.Account != account {
		return Card{}, ErrUnauthorized
	}
	return out, nil
}
func (s *Service) idempotentApplication(scope, key, requestHash string) (Application, bool, error) {
	var out Application
	var found, conflict bool
	_ = s.store.View(func(state Snapshot) error {
		if r, ok := state.Idempotency[scope+":"+key]; ok {
			if r.RequestHash != requestHash {
				conflict = true
			} else {
				out = state.Applications[r.ObjectID]
				found = true
			}
		}
		return nil
	})
	if conflict {
		return Application{}, true, ErrConflict
	}
	return out, found, nil
}
func (s *Service) idempotentCard(scope, key, requestHash string) (Card, bool, error) {
	var out Card
	var found, conflict bool
	_ = s.store.View(func(state Snapshot) error {
		if r, ok := state.Idempotency[scope+":"+key]; ok {
			if r.RequestHash != requestHash {
				conflict = true
			} else {
				out = state.Cards[r.ObjectID]
				found = true
			}
		}
		return nil
	})
	if conflict {
		return Card{}, true, ErrConflict
	}
	return out, found, nil
}

func defaultControls() Controls {
	return Controls{SpendLimitMinor: 50000, Currency: "USD", Online: true, International: false, ATM: false, AllowedMCC: []string{}, BlockedMCC: []string{}, AllowedCountries: []string{}}
}
func validateControls(c Controls) error {
	if c.SpendLimitMinor < 0 || c.SpendLimitMinor > 10_000_000 || len(c.Currency) != 3 || len(c.AllowedMCC) > 32 || len(c.BlockedMCC) > 32 || len(c.AllowedCountries) > 64 {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for _, v := range append(append([]string{}, c.AllowedMCC...), c.BlockedMCC...) {
		if !mccPattern.MatchString(v) || seen[v] {
			return ErrInvalid
		}
		seen[v] = true
	}
	for _, v := range c.AllowedCountries {
		if !isoCountry.MatchString(v) {
			return ErrInvalid
		}
	}
	return nil
}
func validProviderEvent(v ProviderEventInput) bool {
	return validKey(v.EventID) && v.EventID != v.RelatedEventID && strings.HasPrefix(v.ProviderCardID, "pcard_") && v.AmountMinor >= 0 && v.AmountMinor <= 100_000_000 && len(v.Currency) == 3 && v.Currency == strings.ToUpper(v.Currency) && len(strings.TrimSpace(v.Merchant)) >= 1 && len(v.Merchant) <= 160 && !v.OccurredAt.IsZero()
}

func normalizeProviderEventKeys(legacy []byte, configured map[string][]byte) (map[string][]byte, error) {
	if len(configured) > 0 && len(legacy) > 0 {
		return nil, errors.New("configure either the default provider event key or a provider event key set, not both")
	}
	if len(configured) == 0 {
		if len(legacy) < 32 {
			return nil, errors.New("provider event key must contain at least 32 bytes")
		}
		return map[string][]byte{DefaultProviderEventKeyID: append([]byte(nil), legacy...)}, nil
	}
	if len(configured) > MaxProviderEventVerification {
		return nil, fmt.Errorf("provider event key set exceeds %d verification keys", MaxProviderEventVerification)
	}
	out := make(map[string][]byte, len(configured))
	for keyID, key := range configured {
		if keyID != strings.TrimSpace(keyID) || !providerKeyID.MatchString(keyID) {
			return nil, errors.New("provider event key id is invalid")
		}
		if len(key) < 32 {
			return nil, fmt.Errorf("provider event key %q must contain at least 32 bytes", keyID)
		}
		out[keyID] = append([]byte(nil), key...)
	}
	return out, nil
}

func validateProviderEventRelation(state Snapshot, input ProviderEventInput) error {
	requiredParent := map[string]string{
		"clearing": "authorization",
		"reversal": "authorization",
		"refund":   "clearing",
	}[input.Type]
	if requiredParent == "" {
		if input.RelatedEventID != "" {
			return ErrInvalid
		}
		return nil
	}
	if !validKey(input.RelatedEventID) {
		return ErrInvalid
	}
	for _, event := range state.Events {
		if event.ProviderEventID != input.RelatedEventID {
			continue
		}
		if event.ProviderCardID != input.ProviderCardID || event.Type != requiredParent || input.OccurredAt.UTC().Before(event.OccurredAt.UTC()) {
			return ErrConflict
		}
		return nil
	}
	return ErrConflict
}

func validKey(v string) bool { return len(v) >= 8 && len(v) <= 128 && identifierPattern.MatchString(v) }
func normalized(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		v := strings.ToUpper(strings.TrimSpace(value))
		if v != "" && !seen[v] {
			out = append(out, v)
			seen[v] = true
		}
	}
	sort.Strings(out)
	return out
}
func contains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func hashJSON(v any) string             { raw, _ := json.Marshal(v); return hashBytes(raw) }
func hashBytes(raw []byte) string       { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }
func shortHash(values ...string) string { return hashBytes([]byte(strings.Join(values, "\x00")))[:20] }
func hmacEqual(a, b string) bool        { return len(a) == len(b) && hmacCompare([]byte(a), []byte(b)) }
func hmacCompare(a, b []byte) bool {
	var result byte
	for i := range a {
		result |= a[i] ^ b[i]
	}
	return result == 0
}
func auditIDFromHash(hash string) string {
	if len(hash) < 24 {
		return ""
	}
	return "audit_" + hash[:24]
}

func auditHash(entry AuditEvent) string {
	parts := []string{fmt.Sprint(entry.Sequence), entry.Type, entry.ObjectID, entry.Account, entry.At.UTC().Format(time.RFC3339Nano), entry.PreviousHash}
	if entry.RequestID != "" || entry.TraceID != "" {
		parts = append(parts, entry.RequestID, entry.TraceID)
	}
	return hashBytes([]byte(strings.Join(parts, "\n")))
}

func appendAudit(ctx context.Context, state *Snapshot, eventType, objectID, account string, at time.Time) {
	previous := ""
	sequence := uint64(1)
	if len(state.Audit) > 0 {
		last := state.Audit[len(state.Audit)-1]
		previous = last.Hash
		sequence = last.Sequence + 1
	}
	entry := AuditEvent{RequestID: RequestIDFromContext(ctx), TraceID: TraceIDFromContext(ctx), Sequence: sequence, Type: eventType, ObjectID: objectID, Account: account, At: at.UTC(), PreviousHash: previous}
	entry.Hash = auditHash(entry)
	entry.ID = auditIDFromHash(entry.Hash)
	state.Audit = append(state.Audit, entry)
	RecordAuditID(ctx, entry.ID)
	if len(state.Audit) > MaxAuditEntries {
		state.Audit = append([]AuditEvent(nil), state.Audit[len(state.Audit)-MaxAuditEntries:]...)
	}
}
