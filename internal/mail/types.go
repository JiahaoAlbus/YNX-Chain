package mail

import (
	"encoding/json"
	"time"
)

const (
	ProductID          = "com.ynx.mail"
	ProductClientID    = "ynx-mail-v1"
	BundleID           = "com.ynxweb4.mail"
	CallbackURL        = "ynxmail://wallet-auth/callback"
	RequiredScope      = "mail:account"
	RecoveryScope      = "mail:recover"
	MaxAttachmentBytes = 10 << 20
	MaxMessageBytes    = 256 << 10
)

type WalletProof struct {
	Account   string              `json:"account"`
	Handle    string              `json:"handle"`
	Product   string              `json:"product"`
	Scopes    []string            `json:"scopes"`
	Challenge string              `json:"challenge"`
	DeviceKey string              `json:"device_key"`
	PublicKey string              `json:"public_key"`
	ExpiresAt int64               `json:"expires_at"`
	Signature string              `json:"signature"`
	Central   *CentralWalletProof `json:"central,omitempty"`
}

// CentralWalletProof is the exact Wallet Auth v1 verifier input. The product
// service never verifies wallet signatures itself and never accepts a session
// assembled by the client.
type CentralWalletProof struct {
	RegistryEntry        json.RawMessage `json:"registryEntry"`
	AuthorizationRequest json.RawMessage `json:"authorizationRequest"`
	WalletApproval       json.RawMessage `json:"walletApproval"`
	GatewayCompletion    json.RawMessage `json:"gatewayCompletion"`
}

type VerifiedWalletSession struct {
	VerifierVersion string   `json:"verifierVersion"`
	SessionBinding  string   `json:"sessionBinding"`
	ProductClientID string   `json:"productClientId"`
	BundleID        string   `json:"bundleId"`
	RequestDigest   string   `json:"requestDigest"`
	Account         string   `json:"account"`
	Scopes          []string `json:"scopes"`
	IssuedAt        string   `json:"issuedAt"`
	ExpiresAt       string   `json:"expiresAt"`
}

type User struct {
	ID          string    `json:"id"`
	Handle      string    `json:"handle"`
	AccountHash string    `json:"account_hash"`
	CreatedAt   time.Time `json:"created_at"`
	RecoveredAt time.Time `json:"recovered_at,omitempty"`
}

type Challenge struct {
	ID        string    `json:"id"`
	ExpiresAt time.Time `json:"expires_at"`
	Used      bool      `json:"used"`
}

type Session struct {
	TokenHash string    `json:"token_hash"`
	UserID    string    `json:"user_id"`
	DeviceKey string    `json:"device_key"`
	ExpiresAt time.Time `json:"expires_at"`
	RevokedAt time.Time `json:"revoked_at,omitempty"`
}

type Attachment struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	MediaType     string `json:"media_type"`
	Size          int    `json:"size"`
	SHA256        string `json:"sha256"`
	ContentBase64 string `json:"content_base64,omitempty"`
}

type Draft struct {
	ID          string       `json:"id"`
	OwnerID     string       `json:"owner_id"`
	ThreadID    string       `json:"thread_id,omitempty"`
	To          []string     `json:"to"`
	Subject     string       `json:"subject"`
	Body        string       `json:"body"`
	Attachments []Attachment `json:"attachments,omitempty"`
	UpdatedAt   time.Time    `json:"updated_at"`
}

type DeliveryState string

const (
	DeliveryQueued           DeliveryState = "queued"
	DeliveryProviderAccepted DeliveryState = "provider_accepted"
	DeliveryProviderDelayed  DeliveryState = "provider_delayed"
	DeliveryDelivered        DeliveryState = "delivered"
	DeliveryBounced          DeliveryState = "bounced"
	DeliveryComplained       DeliveryState = "complained"
	DeliveryFailed           DeliveryState = "failed"
)

type Delivery struct {
	Recipient         string        `json:"recipient"`
	Channel           string        `json:"channel"`
	State             DeliveryState `json:"state"`
	Reason            string        `json:"reason,omitempty"`
	Provider          string        `json:"provider,omitempty"`
	ProviderMessageID string        `json:"provider_message_id,omitempty"`
	ProviderEventAt   time.Time     `json:"provider_event_at,omitempty"`
	LastProviderEvent string        `json:"last_provider_event,omitempty"`
	Attempt           int           `json:"attempt,omitempty"`
	UpdatedAt         time.Time     `json:"updated_at"`
}

type Message struct {
	ID              string       `json:"id"`
	ThreadID        string       `json:"thread_id"`
	SenderID        string       `json:"sender_id"`
	SenderHandle    string       `json:"sender_handle"`
	To              []string     `json:"to"`
	Subject         string       `json:"subject"`
	Body            string       `json:"body"`
	Attachments     []Attachment `json:"attachments,omitempty"`
	Deliveries      []Delivery   `json:"deliveries"`
	SenderSignature string       `json:"sender_signature"`
	CreatedAt       time.Time    `json:"created_at"`
}

type MailboxItem struct {
	MessageID string    `json:"message_id"`
	OwnerID   string    `json:"owner_id"`
	Folder    string    `json:"folder"`
	Read      bool      `json:"read"`
	CreatedAt time.Time `json:"created_at"`
}

type AbuseReport struct {
	ID         string    `json:"id"`
	ReporterID string    `json:"reporter_id"`
	MessageID  string    `json:"message_id"`
	Reason     string    `json:"reason"`
	State      string    `json:"state"`
	Appeal     string    `json:"appeal,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type AIJob struct {
	ID             string    `json:"id"`
	OwnerID        string    `json:"owner_id"`
	Kind           string    `json:"kind"`
	ContextIDs     []string  `json:"context_ids"`
	ContextPreview string    `json:"context_preview"`
	Provider       string    `json:"provider"`
	Model          string    `json:"model"`
	CostEstimate   string    `json:"cost_estimate"`
	State          string    `json:"state"`
	Result         string    `json:"result,omitempty"`
	Error          string    `json:"error,omitempty"`
	ApprovedAt     time.Time `json:"approved_at,omitempty"`
	ReviewedAt     time.Time `json:"reviewed_at,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type AuditEntry struct {
	ID        string         `json:"id"`
	ActorID   string         `json:"actor_id"`
	Action    string         `json:"action"`
	TargetID  string         `json:"target_id,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}

type AccountExport struct {
	SchemaVersion int           `json:"schema_version"`
	ExportedAt    time.Time     `json:"exported_at"`
	User          User          `json:"user"`
	Drafts        []Draft       `json:"drafts"`
	Messages      []Message     `json:"messages"`
	Reports       []AbuseReport `json:"reports"`
	Audit         []AuditEntry  `json:"audit"`
}

// CanonicalMailEvent is the private-minimized, source-bound envelope exported
// through the Mail-owned Data Fabric outbox. It deliberately excludes message
// bodies, subjects, attachment content, mailbox addresses, credentials and raw
// provider webhook payloads.
type CanonicalMailEvent struct {
	ID                     string        `json:"id"`
	SchemaVersion          string        `json:"schema_version"`
	Type                   string        `json:"type"`
	Product                string        `json:"product"`
	Owner                  string        `json:"owner"`
	SourceCommit           string        `json:"source_commit"`
	Sequence               uint64        `json:"sequence"`
	MessageID              string        `json:"message_id,omitempty"`
	ThreadIDHash           string        `json:"thread_id_hash,omitempty"`
	ActorIDHash            string        `json:"actor_id_hash,omitempty"`
	RecipientHash          string        `json:"recipient_hash,omitempty"`
	RecipientCount         int           `json:"recipient_count,omitempty"`
	NativeRecipientCount   int           `json:"native_recipient_count,omitempty"`
	InternetRecipientCount int           `json:"internet_recipient_count,omitempty"`
	Channel                string        `json:"channel,omitempty"`
	State                  DeliveryState `json:"state,omitempty"`
	ReasonCode             string        `json:"reason_code,omitempty"`
	Provider               string        `json:"provider,omitempty"`
	ProviderMessageID      string        `json:"provider_message_id,omitempty"`
	ProviderEventIDHash    string        `json:"provider_event_id_hash,omitempty"`
	ProviderEventType      string        `json:"provider_event_type,omitempty"`
	Attempt                int           `json:"attempt,omitempty"`
	Authority              string        `json:"authority"`
	Source                 string        `json:"source"`
	Coverage               string        `json:"coverage"`
	PrivacyClass           string        `json:"privacy_class"`
	Applied                bool          `json:"applied"`
	MailServerDelivered    bool          `json:"mail_server_delivered"`
	UserReadClaimed        bool          `json:"user_read_claimed"`
	OccurredAt             time.Time     `json:"occurred_at"`
	AsOf                   time.Time     `json:"as_of"`
	RecordedAt             time.Time     `json:"recorded_at"`
}

type CanonicalMailEventBatch struct {
	SchemaVersion string               `json:"schema_version"`
	Product       string               `json:"product"`
	Acknowledged  uint64               `json:"acknowledged_sequence"`
	Through       uint64               `json:"through_sequence"`
	PendingAfter  int                  `json:"pending_after_batch"`
	Events        []CanonicalMailEvent `json:"events"`
}

type State struct {
	Users                  map[string]User            `json:"users"`
	Challenges             map[string]Challenge       `json:"challenges"`
	Sessions               map[string]Session         `json:"sessions"`
	WalletRequests         map[string]bool            `json:"wallet_requests"`
	Drafts                 map[string]Draft           `json:"drafts"`
	Messages               map[string]Message         `json:"messages"`
	Mailboxes              []MailboxItem              `json:"mailboxes"`
	Blocks                 map[string]map[string]bool `json:"blocks"`
	Reports                map[string]AbuseReport     `json:"reports"`
	AIJobs                 map[string]AIJob           `json:"ai_jobs"`
	ProviderEvents         map[string]ProviderEvent   `json:"provider_events"`
	Suppressions           map[string]Suppression     `json:"suppressions"`
	DeadLetters            map[string]DeadLetter      `json:"dead_letters"`
	ProviderHealth         map[string]ProviderHealth  `json:"provider_health"`
	Rate                   map[string][]time.Time     `json:"rate"`
	Audit                  []AuditEntry               `json:"audit"`
	DataFabricEvents       []CanonicalMailEvent       `json:"data_fabric_events"`
	DataFabricAck          uint64                     `json:"data_fabric_ack"`
	NextDataFabricSequence uint64                     `json:"next_data_fabric_sequence"`
}
