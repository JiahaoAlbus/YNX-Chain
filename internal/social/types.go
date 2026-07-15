package social

import (
	"errors"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chat"
	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
)

var (
	ErrInvalid      = errors.New("invalid social request")
	ErrUnauthorized = errors.New("social access denied")
	ErrNotFound     = errors.New("social record not found")
	ErrConflict     = errors.New("social state conflict")
	ErrRateLimited  = errors.New("social rate limit exceeded")
)

const (
	SchemaVersion = 3
	ProductID     = "ynx-social"
	ClientID      = "com.ynx.social"
	Callback      = "ynxsocial://auth/callback"
)

type Config struct {
	StatePath       string
	TokenKey        []byte
	Now             func() time.Time
	RateLimitWindow time.Duration
	RateLimitMax    int
	AIProviders     map[string]AIProvider
	Chat            *chat.Service
	Square          *square.Service
	AI              AIStreamer
}

type AIProvider struct {
	Models       []string `json:"models"`
	Available    bool     `json:"available"`
	CostPer1KUSD float64  `json:"costPer1KUsd"`
}

type WalletAssertion struct {
	Account                     string    `json:"account"`
	PublicKey                   string    `json:"publicKey"`
	DeviceID                    string    `json:"deviceId"`
	DeviceSigningPublicKey      string    `json:"deviceSigningPublicKey"`
	DeviceEncryptionPublicKey   string    `json:"deviceEncryptionPublicKey"`
	DeviceProofSignature        string    `json:"deviceProofSignature"`
	ChatRegistrationSignature   string    `json:"chatRegistrationSignature"`
	SquareRegistrationSignature string    `json:"squareRegistrationSignature"`
	ClientID                    string    `json:"clientId"`
	Callback                    string    `json:"callback"`
	Scopes                      []string  `json:"scopes"`
	Nonce                       string    `json:"nonce"`
	IssuedAt                    time.Time `json:"issuedAt"`
	ExpiresAt                   time.Time `json:"expiresAt"`
	Signature                   string    `json:"signature"`
}

type Session struct {
	ID        string     `json:"id"`
	Account   string     `json:"account"`
	DeviceID  string     `json:"deviceId"`
	Scopes    []string   `json:"scopes"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt time.Time  `json:"expiresAt"`
	RevokedAt *time.Time `json:"revokedAt,omitempty"`
}

type LoginResult struct {
	Session Session `json:"session"`
	Token   string  `json:"token"`
}

type ContactRequestInput struct {
	IdempotencyKey string `json:"idempotencyKey"`
	TargetAccount  string `json:"-"`
	Source         string `json:"source"`
}

type ProfileSettingsInput struct {
	IdempotencyKey       string `json:"idempotencyKey"`
	DiscoverableByHandle bool   `json:"discoverableByHandle"`
	ContactsMatching     bool   `json:"contactsMatching"`
	AllowRecommendations bool   `json:"allowRecommendations"`
	AllowRequestsFrom    string `json:"allowRequestsFrom"`
	AvatarURL            string `json:"avatarUrl,omitempty"`
}

type ProfileSettings struct {
	Account              string    `json:"account"`
	DiscoverableByHandle bool      `json:"discoverableByHandle"`
	ContactsMatching     bool      `json:"contactsMatching"`
	AllowRecommendations bool      `json:"allowRecommendations"`
	AllowRequestsFrom    string    `json:"allowRequestsFrom"`
	AvatarURL            string    `json:"avatarUrl,omitempty"`
	ProfileQRPayload     string    `json:"profileQrPayload"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

type Invite struct {
	ID        string     `json:"id"`
	Owner     string     `json:"owner"`
	TokenHash string     `json:"-"`
	Link      string     `json:"link"`
	ExpiresAt time.Time  `json:"expiresAt"`
	RevokedAt *time.Time `json:"revokedAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

type ContactRequest struct {
	ID        string     `json:"id"`
	From      string     `json:"from"`
	To        string     `json:"to"`
	Source    string     `json:"source"`
	Status    string     `json:"status"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	ClosedAt  *time.Time `json:"closedAt,omitempty"`
}

type Contact struct {
	Left      string    `json:"left"`
	Right     string    `json:"right"`
	CreatedAt time.Time `json:"createdAt"`
}

type Notification struct {
	ID        string     `json:"id"`
	Account   string     `json:"account"`
	Actor     string     `json:"actor"`
	Kind      string     `json:"kind"`
	ObjectID  string     `json:"objectId"`
	CreatedAt time.Time  `json:"createdAt"`
	ReadAt    *time.Time `json:"readAt,omitempty"`
}

type AttachmentPolicy struct {
	AllowedMIMETypes []string `json:"allowedMimeTypes"`
	MaxBytes         int64    `json:"maxBytes"`
}

type ProductDevice struct {
	ID                  string    `json:"id"`
	Account             string    `json:"account"`
	SigningPublicKey    string    `json:"signingPublicKey"`
	EncryptionPublicKey string    `json:"encryptionPublicKey"`
	Status              string    `json:"status"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type GroupConversation struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Members   []string  `json:"members"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type MediaObject struct {
	ID             string    `json:"id"`
	Owner          string    `json:"owner"`
	MIMEType       string    `json:"mimeType"`
	SizeBytes      int64     `json:"sizeBytes"`
	SHA256         string    `json:"sha256"`
	Purpose        string    `json:"purpose"`
	ConversationID string    `json:"conversationId,omitempty"`
	Encrypted      bool      `json:"encrypted"`
	CreatedAt      time.Time `json:"createdAt"`
}

type Moment struct {
	ID           string     `json:"id"`
	SquarePostID string     `json:"squarePostId,omitempty"`
	Author       string     `json:"author"`
	Text         string     `json:"text"`
	MediaIDs     []string   `json:"mediaIds,omitempty"`
	Visibility   string     `json:"visibility"`
	Status       string     `json:"status"`
	DeletedAt    *time.Time `json:"deletedAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

type MomentComment struct {
	ID        string     `json:"id"`
	MomentID  string     `json:"momentId"`
	Author    string     `json:"author"`
	Text      string     `json:"text"`
	DeletedAt *time.Time `json:"deletedAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

type MomentReaction struct {
	MomentID  string    `json:"momentId"`
	Account   string    `json:"account"`
	Kind      string    `json:"kind"`
	Active    bool      `json:"active"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type SocialReport struct {
	ID             string    `json:"id"`
	Reporter       string    `json:"reporter"`
	TargetType     string    `json:"targetType"`
	TargetID       string    `json:"targetId"`
	Category       string    `json:"category"`
	Detail         string    `json:"detail"`
	EvidenceHashes []string  `json:"evidenceHashes"`
	Status         string    `json:"status"`
	Outcome        string    `json:"outcome"`
	Explanation    string    `json:"explanation"`
	Appeal         string    `json:"appeal,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type AIRequest struct {
	IdempotencyKey  string   `json:"idempotencyKey"`
	Kind            string   `json:"kind"`
	SelectionIDs    []string `json:"selectionIds"`
	ContextClasses  []string `json:"contextClasses"`
	PrivacyPreview  string   `json:"privacyPreview"`
	Provider        string   `json:"provider"`
	Model           string   `json:"model"`
	EstimatedTokens int      `json:"estimatedTokens"`
}

type AIJob struct {
	ID               string     `json:"id"`
	Account          string     `json:"account"`
	Kind             string     `json:"kind"`
	SelectionIDs     []string   `json:"selectionIds"`
	ContextClasses   []string   `json:"contextClasses"`
	PrivacyPreview   string     `json:"privacyPreview"`
	Provider         string     `json:"provider"`
	Model            string     `json:"model"`
	EstimatedTokens  int        `json:"estimatedTokens"`
	EstimatedCostUSD float64    `json:"estimatedCostUsd"`
	PermissionAt     *time.Time `json:"permissionAt,omitempty"`
	Status           string     `json:"status"`
	Output           string     `json:"output,omitempty"`
	Correction       string     `json:"correction,omitempty"`
	ContextHash      string     `json:"contextHash,omitempty"`
	ActualTokens     int        `json:"actualTokens,omitempty"`
	ActualCostUSD    float64    `json:"actualCostUsd,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

type AutomationRule struct {
	ID        string     `json:"id"`
	Account   string     `json:"account"`
	Kind      string     `json:"kind"`
	Scope     string     `json:"scope"`
	Enabled   bool       `json:"enabled"`
	ExpiresAt time.Time  `json:"expiresAt"`
	RevokedAt *time.Time `json:"revokedAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

type AuditEvent struct {
	Sequence     uint64    `json:"sequence"`
	Type         string    `json:"type"`
	ObjectType   string    `json:"objectType"`
	ObjectID     string    `json:"objectId"`
	Account      string    `json:"account"`
	At           time.Time `json:"at"`
	PayloadHash  string    `json:"payloadHash"`
	PreviousHash string    `json:"previousHash"`
	Hash         string    `json:"hash"`
}

type idempotencyRecord struct {
	Action   string `json:"action"`
	Digest   string `json:"digest"`
	ObjectID string `json:"objectId"`
}

type persistentState struct {
	SchemaVersion   int                          `json:"schemaVersion"`
	Sessions        map[string]Session           `json:"sessions"`
	UsedNonces      map[string]time.Time         `json:"usedNonces"`
	Settings        map[string]ProfileSettings   `json:"settings"`
	Invites         map[string]Invite            `json:"invites"`
	Requests        map[string]ContactRequest    `json:"requests"`
	Contacts        map[string]Contact           `json:"contacts"`
	Blocks          map[string]time.Time         `json:"blocks"`
	Mutes           map[string]time.Time         `json:"mutes"`
	Notifications   map[string]Notification      `json:"notifications"`
	AIJobs          map[string]AIJob             `json:"aiJobs"`
	Automation      map[string]AutomationRule    `json:"automation"`
	Devices         map[string]ProductDevice     `json:"devices"`
	Groups          map[string]GroupConversation `json:"groups"`
	GroupMessages   map[string][]chat.Message    `json:"groupMessages"`
	Media           map[string]MediaObject       `json:"media"`
	Moments         map[string]Moment            `json:"moments"`
	MomentComments  map[string][]MomentComment   `json:"momentComments"`
	MomentReactions map[string]MomentReaction    `json:"momentReactions"`
	Reports         map[string]SocialReport      `json:"reports"`
	Idempotency     map[string]idempotencyRecord `json:"idempotency"`
	Audit           []AuditEvent                 `json:"audit"`
	IntegrityHash   string                       `json:"integrityHash"`
}

type Export struct {
	Account       string              `json:"account"`
	Settings      *ProfileSettings    `json:"settings,omitempty"`
	Contacts      []Contact           `json:"contacts"`
	Requests      []ContactRequest    `json:"requests"`
	Notifications []Notification      `json:"notifications"`
	AIJobs        []AIJob             `json:"aiJobs"`
	Devices       []ProductDevice     `json:"devices"`
	Groups        []GroupConversation `json:"groups"`
	GroupMessages []chat.Message      `json:"groupMessages"`
	Media         []MediaObject       `json:"media"`
	Moments       []Moment            `json:"moments"`
	Comments      []MomentComment     `json:"comments"`
	Reactions     []MomentReaction    `json:"reactions"`
	Reports       []SocialReport      `json:"reports"`
	Automation    []AutomationRule    `json:"automation"`
	Audit         []AuditEvent        `json:"audit"`
}
