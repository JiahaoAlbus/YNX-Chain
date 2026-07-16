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
	DeliveryQueued    DeliveryState = "queued"
	DeliveryDelivered DeliveryState = "delivered"
	DeliveryFailed    DeliveryState = "failed"
)

type Delivery struct {
	Recipient string        `json:"recipient"`
	State     DeliveryState `json:"state"`
	Reason    string        `json:"reason,omitempty"`
	UpdatedAt time.Time     `json:"updated_at"`
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

type State struct {
	Users          map[string]User            `json:"users"`
	Challenges     map[string]Challenge       `json:"challenges"`
	Sessions       map[string]Session         `json:"sessions"`
	WalletRequests map[string]bool            `json:"wallet_requests"`
	Drafts         map[string]Draft           `json:"drafts"`
	Messages       map[string]Message         `json:"messages"`
	Mailboxes      []MailboxItem              `json:"mailboxes"`
	Blocks         map[string]map[string]bool `json:"blocks"`
	Reports        map[string]AbuseReport     `json:"reports"`
	AIJobs         map[string]AIJob           `json:"ai_jobs"`
	Rate           map[string][]time.Time     `json:"rate"`
	Audit          []AuditEntry               `json:"audit"`
}
