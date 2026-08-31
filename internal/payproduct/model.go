package payproduct

import "time"

const (
	ChainID        = "ynx_6423-1"
	EVMChainID     = 6423
	NativeAsset    = "YNXT"
	NativeFeeYNXT  = int64(1)
	InvoiceVersion = 3
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

type MerchantMember struct {
	ID         string    `json:"id"`
	MerchantID string    `json:"merchantId"`
	Account    string    `json:"account"`
	Role       string    `json:"role"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type MerchantConsoleSession struct {
	ID         string     `json:"id"`
	MerchantID string     `json:"merchantId"`
	Account    string     `json:"account"`
	Role       string     `json:"role"`
	TokenHash  string     `json:"tokenHash"`
	ExpiresAt  time.Time  `json:"expiresAt"`
	RevokedAt  *time.Time `json:"revokedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
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
	Version               int                 `json:"version"`
	ID                    string              `json:"id"`
	CentralID             string              `json:"centralInvoiceId"`
	IntentID              string              `json:"intentId"`
	MerchantID            string              `json:"merchantId"`
	MerchantName          string              `json:"merchantName"`
	PayoutAddress         string              `json:"payoutAddress"`
	CatalogItemID         string              `json:"catalogItemId,omitempty"`
	Description           string              `json:"description,omitempty"`
	BaseAmount            int64               `json:"baseAmount,omitempty"`
	TipAmount             int64               `json:"tipAmount,omitempty"`
	SplitPaymentID        string              `json:"splitPaymentId,omitempty"`
	SplitShareID          string              `json:"splitShareId,omitempty"`
	ServiceBillID         string              `json:"serviceBillId,omitempty"`
	ServiceEvidenceDigest string              `json:"serviceEvidenceDigest,omitempty"`
	ExpectedPayer         string              `json:"expectedPayer,omitempty"`
	ExpectedPayerHash     string              `json:"expectedPayerHash,omitempty"`
	Amount                int64               `json:"amount"`
	Asset                 string              `json:"asset"`
	Network               string              `json:"network"`
	Fee                   int64               `json:"fee"`
	FeeBreakdown          FeeBreakdown        `json:"feeBreakdown"`
	Status                string              `json:"status"`
	ExpiresAt             time.Time           `json:"expiresAt"`
	CreatedAt             time.Time           `json:"createdAt"`
	Signature             string              `json:"signature"`
	SignatureKeyID        string              `json:"signatureKeyId"`
	SigningPublicKey      string              `json:"signingPublicKey"`
	SignatureAlgorithm    string              `json:"signatureAlgorithm"`
	Settlement            *SettlementEvidence `json:"settlement,omitempty"`
}

type FeeBreakdown struct {
	NetworkFee   int64     `json:"networkFee"`
	ProviderCost int64     `json:"providerCost"`
	ProtocolFee  int64     `json:"protocolFee"`
	Burn         int64     `json:"burn"`
	Treasury     int64     `json:"treasury"`
	MerchantNet  int64     `json:"merchantNet"`
	SponsorCost  int64     `json:"sponsorCost"`
	UserRebate   int64     `json:"userRebate"`
	Source       string    `json:"source"`
	AsOf         time.Time `json:"asOf"`
	Version      int       `json:"version"`
}

type SettlementEvidence struct {
	ID               string    `json:"id"`
	ChainID          string    `json:"chainId"`
	TransactionHash  string    `json:"transactionHash"`
	BlockNumber      uint64    `json:"blockNumber"`
	Finality         string    `json:"finality"`
	Payer            string    `json:"payer"`
	Payee            string    `json:"payee"`
	PayoutAddress    string    `json:"payoutAddress"`
	Amount           int64     `json:"amount"`
	Asset            string    `json:"asset"`
	InvoiceID        string    `json:"invoiceId"`
	CentralInvoiceID string    `json:"centralInvoiceId"`
	IntentID         string    `json:"intentId"`
	IntentDigest     string    `json:"intentDigest,omitempty"`
	RequestNonce     string    `json:"requestNonce,omitempty"`
	IdempotencyKey   string    `json:"idempotencyKey"`
	ReceiptID        string    `json:"receiptId"`
	Status           string    `json:"status"`
	AuditHash        string    `json:"auditHash"`
	AuditID          string    `json:"auditId"`
	CommittedAt      time.Time `json:"committedAt"`
	Source           string    `json:"source"`
	SourceAsOf       time.Time `json:"sourceAsOf"`
	SourceVersion    int       `json:"sourceVersion"`
	Confidence       string    `json:"confidence"`
}

type RefundRequest struct {
	ID                    string                       `json:"id"`
	InvoiceID             string                       `json:"invoiceId"`
	MerchantID            string                       `json:"merchantId"`
	Payer                 string                       `json:"payer"`
	Amount                int64                        `json:"amount"`
	Reason                string                       `json:"reason"`
	Status                string                       `json:"status"`
	ApprovedBy            string                       `json:"approvedBy,omitempty"`
	AuthorizationDigest   string                       `json:"authorizationDigest,omitempty"`
	RefundTransactionHash string                       `json:"refundTransactionHash,omitempty"`
	CentralRefundID       string                       `json:"centralRefundId,omitempty"`
	SubmittedAt           *time.Time                   `json:"submittedAt,omitempty"`
	Evidence              *AuthoritativeRefundEvidence `json:"evidence,omitempty"`
	Failure               string                       `json:"failure,omitempty"`
	CreatedAt             time.Time                    `json:"createdAt"`
	UpdatedAt             time.Time                    `json:"updatedAt"`
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
	ID                 string     `json:"id"`
	MerchantID         string     `json:"merchantId"`
	EventType          string     `json:"eventType"`
	ObjectID           string     `json:"objectId"`
	Endpoint           string     `json:"endpoint"`
	PayloadHash        string     `json:"payloadHash"`
	Signature          string     `json:"signature"`
	SecretVersion      int        `json:"secretVersion"`
	Attempt            int        `json:"attempt"`
	Status             string     `json:"status"`
	HTTPStatus         int        `json:"httpStatus,omitempty"`
	NextAttemptAt      time.Time  `json:"nextAttemptAt,omitempty"`
	DeadLetteredAt     *time.Time `json:"deadLetteredAt,omitempty"`
	ParentDeliveryID   string     `json:"parentDeliveryId,omitempty"`
	ManualReplayReason string     `json:"manualReplayReason,omitempty"`
	ReplayedBy         string     `json:"replayedBy,omitempty"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
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
type WalletSession struct {
	ID                     string    `json:"id"`
	Account                string    `json:"account"`
	DeviceID               string    `json:"deviceId"`
	ProductClientID        string    `json:"productClientId"`
	BundleID               string    `json:"bundleId"`
	ProductDeviceAlgorithm string    `json:"productDeviceAlgorithm"`
	SessionBinding         string    `json:"sessionBinding"`
	Scopes                 []string  `json:"scopes"`
	ExpiresAt              time.Time `json:"expiresAt"`
}

type SponsorshipQuote struct {
	ID                 string                `json:"id"`
	InvoiceID          string                `json:"invoiceId"`
	MerchantID         string                `json:"merchantId"`
	Account            string                `json:"account"`
	DeviceID           string                `json:"deviceId"`
	SmartAccount       string                `json:"smartAccount"`
	Mode               string                `json:"mode"`
	Asset              string                `json:"asset"`
	Paymaster          string                `json:"paymaster"`
	CallDataHash       string                `json:"callDataHash"`
	MaximumSponsorCost int64                 `json:"maximumSponsorCost"`
	Sponsor            string                `json:"sponsor"`
	Attribution        string                `json:"attribution"`
	Status             string                `json:"status"`
	IssuedAt           time.Time             `json:"issuedAt"`
	ExpiresAt          time.Time             `json:"expiresAt"`
	Source             string                `json:"source"`
	SourceAsOf         time.Time             `json:"sourceAsOf"`
	SourceVersion      int                   `json:"sourceVersion"`
	Failure            string                `json:"failure,omitempty"`
	Receipt            *UserOperationReceipt `json:"receipt,omitempty"`
}

type UserOperationReceipt struct {
	UserOperationHash string    `json:"userOperationHash"`
	TransactionHash   string    `json:"transactionHash"`
	BlockNumber       uint64    `json:"blockNumber"`
	ChainID           string    `json:"chainId"`
	Sender            string    `json:"sender"`
	Paymaster         string    `json:"paymaster"`
	CallDataHash      string    `json:"callDataHash"`
	ActualSponsorCost int64     `json:"actualSponsorCost"`
	Success           bool      `json:"success"`
	Finality          string    `json:"finality"`
	Source            string    `json:"source"`
	SourceAsOf        time.Time `json:"sourceAsOf"`
	SourceVersion     int       `json:"sourceVersion"`
}

type SplitShare struct {
	ID           string     `json:"id"`
	Label        string     `json:"label"`
	Amount       int64      `json:"amount"`
	PayerAccount string     `json:"payerAccount,omitempty"`
	InvoiceID    string     `json:"invoiceId,omitempty"`
	Status       string     `json:"status"`
	ClaimedAt    *time.Time `json:"claimedAt,omitempty"`
}

type SplitPayment struct {
	Version            int          `json:"version"`
	ID                 string       `json:"id"`
	MerchantID         string       `json:"merchantId"`
	MerchantName       string       `json:"merchantName"`
	PayoutAddress      string       `json:"payoutAddress"`
	Description        string       `json:"description"`
	TotalAmount        int64        `json:"totalAmount"`
	Asset              string       `json:"asset"`
	Network            string       `json:"network"`
	Status             string       `json:"status"`
	Shares             []SplitShare `json:"shares"`
	ExpiresAt          time.Time    `json:"expiresAt"`
	CreatedAt          time.Time    `json:"createdAt"`
	UpdatedAt          time.Time    `json:"updatedAt"`
	Signature          string       `json:"signature"`
	SignatureKeyID     string       `json:"signatureKeyId"`
	SigningPublicKey   string       `json:"signingPublicKey"`
	SignatureAlgorithm string       `json:"signatureAlgorithm"`
}

type Snapshot struct {
	Version         int                               `json:"version"`
	Merchants       map[string]Merchant               `json:"merchants"`
	MerchantMembers map[string]MerchantMember         `json:"merchantMembers"`
	ConsoleSessions map[string]MerchantConsoleSession `json:"consoleSessions"`
	GatewaySeen     map[string]time.Time              `json:"gatewaySeen"`
	Catalog         map[string]CatalogItem            `json:"catalog"`
	Invoices        map[string]Invoice                `json:"invoices"`
	Refunds         map[string]RefundRequest          `json:"refunds"`
	Disputes        map[string]Dispute                `json:"disputes"`
	Deliveries      map[string]WebhookDelivery        `json:"deliveries"`
	AIRuns          map[string]AIRun                  `json:"aiRuns"`
	Idempotency     map[string]IdempotencyRecord      `json:"idempotency"`
	Nonces          map[string]NonceRecord            `json:"nonces"`
	Sponsorships    map[string]SponsorshipQuote       `json:"sponsorships"`
	BridgeTransfers map[string]BridgeTransfer         `json:"bridgeTransfers"`
	RouteQuotes     map[string]PaymentRouteQuote      `json:"routeQuotes"`
	RecurringDrafts map[string]RecurringDraft         `json:"recurringDrafts"`
	SplitPayments   map[string]SplitPayment           `json:"splitPayments"`
	QuantBills      map[string]QuantBill              `json:"quantBills"`
	Audit           []AuditEntry                      `json:"audit"`
}

type Analytics struct {
	MerchantID         string    `json:"merchantId"`
	InvoiceCount       int       `json:"invoiceCount"`
	CommittedCount     int       `json:"committedCount"`
	GrossYNXT          int64     `json:"grossYnxt"`
	RefundedYNXT       int64     `json:"refundedYnxt"`
	NetYNXT            int64     `json:"netYnxt"`
	RefundRequestCount int       `json:"refundRequestCount"`
	DisputeCount       int       `json:"disputeCount"`
	FailedWebhookCount int       `json:"failedWebhookCount"`
	GeneratedAt        time.Time `json:"generatedAt"`
	Source             string    `json:"source"`
	AsOf               time.Time `json:"asOf"`
	Version            int       `json:"version"`
}
