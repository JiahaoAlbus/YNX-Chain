package aiproduct

import "time"

const (
	ProductID    = "ynx-ai"
	ChainID      = int64(6423)
	ChainNetwork = "ynx_6423-1"
	NativeAsset  = "YNXT"
)

type Conversation struct {
	ID            string    `json:"id"`
	Account       string    `json:"account"`
	Title         string    `json:"title"`
	Archived      bool      `json:"archived"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
	MessageCount  int       `json:"messageCount"`
	LastPreview   string    `json:"lastPreview,omitempty"`
	RetentionDays int       `json:"retentionDays"`
}

type Message struct {
	ID              string    `json:"id"`
	ConversationID  string    `json:"conversationId"`
	Role            string    `json:"role"`
	Content         string    `json:"content"`
	Status          string    `json:"status"`
	Provider        string    `json:"provider,omitempty"`
	Model           string    `json:"model,omitempty"`
	RequestID       string    `json:"requestId,omitempty"`
	RetryOf         string    `json:"retryOf,omitempty"`
	IncludedContext []string  `json:"includedContext,omitempty"`
	ExcludedContext []string  `json:"excludedContext,omitempty"`
	Cost            Cost      `json:"cost"`
	CreatedAt       time.Time `json:"createdAt"`
}

type Cost struct {
	InputTokensEstimate  int64   `json:"inputTokensEstimate"`
	OutputTokensEstimate int64   `json:"outputTokensEstimate"`
	ResourceUnits        int64   `json:"resourceUnitsEstimate"`
	MoneyUSD             float64 `json:"moneyUsdEstimate"`
	MoneyKnown           bool    `json:"moneyKnown"`
	ActualUsageReported  bool    `json:"actualUsageReported"`
	Basis                string  `json:"basis"`
}

type DataPolicy struct {
	RetentionDays       int       `json:"retentionDays"`
	SaveEncryptedBody   bool      `json:"saveEncryptedBody"`
	AllowedContextTypes []string  `json:"allowedContextTypes"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type PermissionRecord struct {
	ID        string    `json:"id"`
	Account   string    `json:"account"`
	SessionID string    `json:"sessionId"`
	Scope     string    `json:"scope"`
	Purpose   string    `json:"purpose"`
	Status    string    `json:"status"`
	GatewayID string    `json:"gatewayId,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
	RevokedAt time.Time `json:"revokedAt,omitempty"`
}

type ActionRecord struct {
	ID                string    `json:"id"`
	Account           string    `json:"account"`
	ConversationID    string    `json:"conversationId"`
	Kind              string    `json:"kind"`
	Scope             string    `json:"scope"`
	Description       string    `json:"description"`
	PayloadPreview    string    `json:"payloadPreview"`
	Status            string    `json:"status"`
	GatewayID         string    `json:"gatewayId,omitempty"`
	PermissionID      string    `json:"permissionId,omitempty"`
	WalletStillNeeded bool      `json:"walletStillNeeded"`
	CreatedAt         time.Time `json:"createdAt"`
	ReviewedAt        time.Time `json:"reviewedAt,omitempty"`
}

type Appeal struct {
	ID             string    `json:"id"`
	Account        string    `json:"account"`
	ConversationID string    `json:"conversationId,omitempty"`
	ActionID       string    `json:"actionId,omitempty"`
	Reason         string    `json:"reason"`
	Status         string    `json:"status"`
	TrustURL       string    `json:"trustUrl"`
	CreatedAt      time.Time `json:"createdAt"`
}

type AuditRecord struct {
	Sequence     uint64    `json:"sequence"`
	Account      string    `json:"account"`
	Type         string    `json:"type"`
	ObjectID     string    `json:"objectId,omitempty"`
	Detail       string    `json:"detail"`
	At           time.Time `json:"at"`
	PreviousHash string    `json:"previousHash"`
	Hash         string    `json:"hash"`
}

type Usage struct {
	Generations          int64   `json:"generations"`
	InputTokensEstimate  int64   `json:"inputTokensEstimate"`
	OutputTokensEstimate int64   `json:"outputTokensEstimate"`
	ResourceUnits        int64   `json:"resourceUnitsEstimate"`
	MoneyUSD             float64 `json:"moneyUsdEstimate"`
	MoneyKnown           bool    `json:"moneyKnown"`
	ActualUsageReported  bool    `json:"actualUsageReported"`
}

type WalletChallenge struct {
	ID                     string    `json:"id"`
	Nonce                  string    `json:"nonce"`
	Account                string    `json:"account"`
	DeviceID               string    `json:"deviceId"`
	DeviceSigningPublicKey string    `json:"deviceSigningPublicKey"`
	Callback               string    `json:"callback"`
	Scopes                 []string  `json:"scopes"`
	IssuedAt               time.Time `json:"issuedAt"`
	ExpiresAt              time.Time `json:"expiresAt"`
	Status                 string    `json:"status"`
}

type WalletSignDocument struct {
	Domain                 string   `json:"domain"`
	Version                int      `json:"version"`
	Product                string   `json:"product"`
	ChainID                int64    `json:"chainId"`
	Network                string   `json:"network"`
	ChallengeID            string   `json:"challengeId"`
	Nonce                  string   `json:"nonce"`
	Account                string   `json:"account"`
	DeviceID               string   `json:"deviceId"`
	DeviceSigningPublicKey string   `json:"deviceSigningPublicKey"`
	Callback               string   `json:"callback"`
	Scopes                 []string `json:"scopes"`
	Purpose                string   `json:"purpose"`
	IssuedAt               string   `json:"issuedAt"`
	ExpiresAt              string   `json:"expiresAt"`
}

type ProductSession struct {
	ID        string    `json:"id"`
	TokenHash string    `json:"tokenHash"`
	Account   string    `json:"account"`
	DeviceID  string    `json:"deviceId"`
	Scopes    []string  `json:"scopes"`
	IssuedAt  time.Time `json:"issuedAt"`
	ExpiresAt time.Time `json:"expiresAt"`
	Status    string    `json:"status"`
	RevokedAt time.Time `json:"revokedAt,omitempty"`
}
