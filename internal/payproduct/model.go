package payproduct

import "time"

const (
	ChainID        = "ynx_6423-1"
	EVMChainID     = 6423
	NativeAsset    = "YNXT"
	NativeFeeYNXT  = int64(1)
	InvoiceVersion = 1
)

type Merchant struct {
	ID                          string    `json:"id"`
	CentralMerchantID           string    `json:"centralMerchantId"`
	DisplayName                 string    `json:"displayName"`
	PayoutAddress               string    `json:"payoutAddress"`
	Status                      string    `json:"status"`
	WebhookURL                  string    `json:"webhookUrl,omitempty"`
	SecretVersion               int       `json:"secretVersion"`
	SecretHash                  string    `json:"secretHash"`
	CredentialCipher            string    `json:"credentialCipher"`
	WebhookSecretCipher         string    `json:"webhookSecretCipher"`
	InvoiceSigningPublicKey     string    `json:"invoiceSigningPublicKey"`
	InvoiceSigningPrivateCipher string    `json:"invoiceSigningPrivateCipher"`
	CreatedAt                   time.Time `json:"createdAt"`
	UpdatedAt                   time.Time `json:"updatedAt"`
}

type CatalogItem struct {
	ID          string    `json:"id"`
	MerchantID  string    `json:"merchantId"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	Amount      int64     `json:"amount"`
	Asset       string    `json:"asset"`
	Active      bool      `json:"active"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Invoice struct {
	Version            int                 `json:"version"`
	ID                 string              `json:"id"`
	CentralID          string              `json:"centralInvoiceId"`
	IntentID           string              `json:"intentId"`
	MerchantID         string              `json:"merchantId"`
	MerchantName       string              `json:"merchantName"`
	PayoutAddress      string              `json:"payoutAddress"`
	CatalogItemID      string              `json:"catalogItemId,omitempty"`
	Description        string              `json:"description,omitempty"`
	Amount             int64               `json:"amount"`
	Asset              string              `json:"asset"`
	Network            string              `json:"network"`
	Fee                int64               `json:"fee"`
	Status             string              `json:"status"`
	ExpiresAt          time.Time           `json:"expiresAt"`
	CreatedAt          time.Time           `json:"createdAt"`
	Signature          string              `json:"signature"`
	SignatureKeyID     string              `json:"signatureKeyId"`
	SigningPublicKey   string              `json:"signingPublicKey"`
	SignatureAlgorithm string              `json:"signatureAlgorithm"`
	Settlement         *SettlementEvidence `json:"settlement,omitempty"`
}

type SettlementEvidence struct {
	ID              string    `json:"id"`
	TransactionHash string    `json:"transactionHash"`
	BlockNumber     uint64    `json:"blockNumber"`
	Payer           string    `json:"payer"`
	PayoutAddress   string    `json:"payoutAddress"`
	Amount          int64     `json:"amount"`
	Asset           string    `json:"asset"`
	Status          string    `json:"status"`
	AuditHash       string    `json:"auditHash"`
	CommittedAt     time.Time `json:"committedAt"`
	Source          string    `json:"source"`
}

type RefundRequest struct {
	ID         string    `json:"id"`
	InvoiceID  string    `json:"invoiceId"`
	MerchantID string    `json:"merchantId"`
	Payer      string    `json:"payer"`
	Amount     int64     `json:"amount"`
	Reason     string    `json:"reason"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}
type Dispute struct {
	ID            string    `json:"id"`
	InvoiceID     string    `json:"invoiceId"`
	MerchantID    string    `json:"merchantId"`
	Payer         string    `json:"payer"`
	Reason        string    `json:"reason"`
	TrustEvidence []string  `json:"trustEvidence"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}
type WebhookDelivery struct {
	ID            string    `json:"id"`
	MerchantID    string    `json:"merchantId"`
	EventType     string    `json:"eventType"`
	ObjectID      string    `json:"objectId"`
	Endpoint      string    `json:"endpoint"`
	PayloadHash   string    `json:"payloadHash"`
	Signature     string    `json:"signature"`
	SecretVersion int       `json:"secretVersion"`
	Attempt       int       `json:"attempt"`
	Status        string    `json:"status"`
	HTTPStatus    int       `json:"httpStatus,omitempty"`
	NextAttemptAt time.Time `json:"nextAttemptAt,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}
type AuditEntry struct {
	ID         string    `json:"id"`
	MerchantID string    `json:"merchantId,omitempty"`
	Actor      string    `json:"actor"`
	Action     string    `json:"action"`
	ObjectID   string    `json:"objectId,omitempty"`
	Outcome    string    `json:"outcome"`
	Detail     string    `json:"detail,omitempty"`
	At         time.Time `json:"at"`
}
type AIRun struct {
	ID             string    `json:"id"`
	MerchantID     string    `json:"merchantId"`
	Workflow       string    `json:"workflow"`
	ContextIDs     []string  `json:"contextIds"`
	ContextClasses []string  `json:"contextClasses"`
	Provider       string    `json:"provider"`
	Model          string    `json:"model"`
	Status         string    `json:"status"`
	Permission     string    `json:"permission"`
	EstimatedUnits int64     `json:"estimatedUnits"`
	OutputLanguage string    `json:"outputLanguage"`
	Result         string    `json:"result,omitempty"`
	Decision       string    `json:"decision,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}
type IdempotencyRecord struct {
	Scope       string    `json:"scope"`
	Key         string    `json:"key"`
	RequestHash string    `json:"requestHash"`
	ObjectID    string    `json:"objectId"`
	CreatedAt   time.Time `json:"createdAt"`
}
type NonceRecord struct {
	MerchantID string    `json:"merchantId"`
	Nonce      string    `json:"nonce"`
	SeenAt     time.Time `json:"seenAt"`
}
type WalletChallenge struct {
	Nonce         string     `json:"nonce"`
	RequestDigest string     `json:"requestDigest"`
	ExpiresAt     time.Time  `json:"expiresAt"`
	UsedAt        *time.Time `json:"usedAt,omitempty"`
}
type WalletSession struct {
	ID                     string     `json:"id"`
	Account                string     `json:"account"`
	ProductClientID        string     `json:"productClientId"`
	BundleID               string     `json:"bundleId"`
	ProductDeviceAlgorithm string     `json:"productDeviceAlgorithm"`
	ProductDeviceKey       string     `json:"productDeviceKey"`
	SessionBinding         string     `json:"sessionBinding"`
	TokenHash              string     `json:"tokenHash"`
	Scopes                 []string   `json:"scopes"`
	ExpiresAt              time.Time  `json:"expiresAt"`
	RevokedAt              *time.Time `json:"revokedAt,omitempty"`
}

type Snapshot struct {
	Version          int                          `json:"version"`
	Merchants        map[string]Merchant          `json:"merchants"`
	Catalog          map[string]CatalogItem       `json:"catalog"`
	Invoices         map[string]Invoice           `json:"invoices"`
	Refunds          map[string]RefundRequest     `json:"refunds"`
	Disputes         map[string]Dispute           `json:"disputes"`
	Deliveries       map[string]WebhookDelivery   `json:"deliveries"`
	AIRuns           map[string]AIRun             `json:"aiRuns"`
	WalletChallenges map[string]WalletChallenge   `json:"walletChallenges"`
	WalletSessions   map[string]WalletSession     `json:"walletSessions"`
	Idempotency      map[string]IdempotencyRecord `json:"idempotency"`
	Nonces           map[string]NonceRecord       `json:"nonces"`
	Audit            []AuditEntry                 `json:"audit"`
}

type Analytics struct {
	MerchantID         string    `json:"merchantId"`
	InvoiceCount       int       `json:"invoiceCount"`
	CommittedCount     int       `json:"committedCount"`
	GrossYNXT          int64     `json:"grossYnxt"`
	RefundRequestCount int       `json:"refundRequestCount"`
	DisputeCount       int       `json:"disputeCount"`
	FailedWebhookCount int       `json:"failedWebhookCount"`
	GeneratedAt        time.Time `json:"generatedAt"`
	Source             string    `json:"source"`
}
