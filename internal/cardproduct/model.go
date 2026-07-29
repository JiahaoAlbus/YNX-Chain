package cardproduct

import "time"

const (
	ProductID       = "ynx-card"
	ClientID        = "ynx-card-v1"
	BundleID        = "com.ynxweb4.card"
	Callback        = "ynxcard://wallet-auth/callback"
	Network         = "YNX Testnet Sandbox"
	GatewayDomain   = "YNX_PRODUCT_GATEWAY_ASSERTION_V1"
	ProviderDomain  = "YNX_CARD_PROVIDER_EVENT_V1"
	StateVersion    = 1
	MaxBodyBytes    = 1 << 20
	MaxAuditEntries = 8192
)

var (
	CardScopes       = []string{"account:read", "card:application:write", "card:controls:write", "card:dispute:write"}
	CardDeleteScopes = []string{"account:read", "card:application:write", "card:controls:write", "card:data:delete", "card:dispute:write"}
)

type Eligibility struct {
	Reference string    `json:"reference,omitempty"`
	Status    string    `json:"status"`
	Provider  string    `json:"provider"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Application struct {
	ID                   string    `json:"id"`
	Account              string    `json:"account"`
	EligibilityReference string    `json:"eligibilityReference,omitempty"`
	Status               string    `json:"status"`
	Provider             string    `json:"provider"`
	ProviderReference    string    `json:"providerReference,omitempty"`
	LegalConsentVersion  string    `json:"legalConsentVersion"`
	CreatedAt            time.Time `json:"createdAt"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

type Controls struct {
	SpendLimitMinor  int64    `json:"spendLimitMinor"`
	Currency         string   `json:"currency"`
	Online           bool     `json:"online"`
	International    bool     `json:"international"`
	ATM              bool     `json:"atm"`
	AllowedMCC       []string `json:"allowedMcc"`
	BlockedMCC       []string `json:"blockedMcc"`
	AllowedCountries []string `json:"allowedCountries"`
}

type Card struct {
	ID             string    `json:"id"`
	Account        string    `json:"account"`
	ApplicationID  string    `json:"applicationId"`
	ProviderCardID string    `json:"providerCardId,omitempty"`
	Provider       string    `json:"provider"`
	Network        string    `json:"network"`
	Last4          string    `json:"last4"`
	ExpiryMonth    int       `json:"expiryMonth"`
	ExpiryYear     int       `json:"expiryYear"`
	Status         string    `json:"status"`
	ReplacementFor string    `json:"replacementFor,omitempty"`
	Controls       Controls  `json:"controls"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type CardEvent struct {
	ID              string    `json:"id"`
	ProviderEventID string    `json:"providerEventId,omitempty"`
	ProviderCardID  string    `json:"providerCardId,omitempty"`
	CardID          string    `json:"cardId"`
	Account         string    `json:"account"`
	Type            string    `json:"type"`
	AmountMinor     int64     `json:"amountMinor"`
	Currency        string    `json:"currency"`
	Merchant        string    `json:"merchant"`
	MCC             string    `json:"mcc,omitempty"`
	Country         string    `json:"country,omitempty"`
	ReasonCode      string    `json:"reasonCode,omitempty"`
	RelatedEventID  string    `json:"relatedEventId,omitempty"`
	OccurredAt      time.Time `json:"occurredAt"`
	ReceivedAt      time.Time `json:"receivedAt"`
}

type Dispute struct {
	ID        string    `json:"id"`
	Account   string    `json:"account"`
	CardID    string    `json:"cardId"`
	EventID   string    `json:"eventId"`
	Reason    string    `json:"reason"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Notification struct {
	ID        string    `json:"id"`
	Account   string    `json:"account"`
	EventID   string    `json:"eventId"`
	Type      string    `json:"type"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
}

type AIRun struct {
	ID             string    `json:"id"`
	Account        string    `json:"account"`
	Workflow       string    `json:"workflow"`
	ContextEventID string    `json:"contextEventId"`
	OutputLanguage string    `json:"outputLanguage"`
	Permission     string    `json:"permission"`
	Provider       string    `json:"provider,omitempty"`
	Model          string    `json:"model,omitempty"`
	Status         string    `json:"status"`
	Draft          string    `json:"draft,omitempty"`
	Decision       string    `json:"decision,omitempty"`
	CostUnits      int64     `json:"costUnits,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type AuditEvent struct {
	ID           string    `json:"auditId"`
	RequestID    string    `json:"requestId,omitempty"`
	TraceID      string    `json:"traceId,omitempty"`
	Sequence     uint64    `json:"sequence"`
	Type         string    `json:"type"`
	ObjectID     string    `json:"objectId"`
	Account      string    `json:"account"`
	At           time.Time `json:"at"`
	PreviousHash string    `json:"previousHash"`
	Hash         string    `json:"hash"`
}

type IdempotencyRecord struct {
	Scope       string    `json:"scope"`
	Key         string    `json:"key"`
	RequestHash string    `json:"requestHash"`
	ObjectID    string    `json:"objectId"`
	CreatedAt   time.Time `json:"createdAt"`
}

type DataDeletionReceipt struct {
	ID                string         `json:"id"`
	AccountPseudonym  string         `json:"accountPseudonym"`
	IdempotencyDigest string         `json:"idempotencyDigest,omitempty"`
	ClosedCards       int            `json:"closedCards"`
	DeletedRecords    map[string]int `json:"deletedRecords"`
	AuditID           string         `json:"auditId"`
	DeletedAt         time.Time      `json:"deletedAt"`
}

type Snapshot struct {
	Version          int                            `json:"version"`
	Eligibility      map[string]Eligibility         `json:"eligibility"`
	Applications     map[string]Application         `json:"applications"`
	Cards            map[string]Card                `json:"cards"`
	Events           map[string]CardEvent           `json:"events"`
	Disputes         map[string]Dispute             `json:"disputes"`
	Notifications    map[string]Notification        `json:"notifications"`
	AIRuns           map[string]AIRun               `json:"aiRuns"`
	Idempotency      map[string]IdempotencyRecord   `json:"idempotency"`
	ProviderSeen     map[string]time.Time           `json:"providerSeen"`
	GatewaySeen      map[string]time.Time           `json:"gatewaySeen"`
	DeletionReceipts map[string]DataDeletionReceipt `json:"deletionReceipts"`
	Audit            []AuditEvent                   `json:"audit"`
}

func emptySnapshot() Snapshot {
	return Snapshot{Version: StateVersion, Eligibility: map[string]Eligibility{}, Applications: map[string]Application{}, Cards: map[string]Card{}, Events: map[string]CardEvent{}, Disputes: map[string]Dispute{}, Notifications: map[string]Notification{}, AIRuns: map[string]AIRun{}, Idempotency: map[string]IdempotencyRecord{}, ProviderSeen: map[string]time.Time{}, GatewaySeen: map[string]time.Time{}, DeletionReceipts: map[string]DataDeletionReceipt{}, Audit: []AuditEvent{}}
}

type AccountState struct {
	Eligibility   *Eligibility   `json:"eligibility,omitempty"`
	Applications  []Application  `json:"applications"`
	Cards         []Card         `json:"cards"`
	Events        []CardEvent    `json:"events"`
	Disputes      []Dispute      `json:"disputes"`
	Notifications []Notification `json:"notifications"`
	AIRuns        []AIRun        `json:"aiRuns"`
	Audit         []AuditEvent   `json:"audit"`
}
