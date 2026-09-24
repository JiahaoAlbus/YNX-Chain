package finance

import (
	"encoding/json"
	"time"
)

const (
	FinanceOrderApprovalVersion = "1"
	FinanceOrderProductID       = "finance"
	FinanceOrderApplicationID   = "com.ynxweb4.finance.web"
	FinanceOrderOrigin          = "https://finance.ynxweb4.com"
	FinanceOrderPlatform        = "web"
	FinanceOrderChainID         = "0x1917"
	FinanceOrderChainEnv        = "testnet"
	FinanceOrderTradingEnv      = "sandbox"
	FinanceOrderProvider        = "alpaca_broker"
	FinanceProductClientID      = "ynx-finance-v1"

	FinanceSubjectDomain       = "YNX_FINANCE_SUBJECT_V1"
	FinanceOrderDomain         = "YNX_FINANCE_ORDER_V1"
	FinanceOrderApprovalDomain = "YNX_FINANCE_ORDER_APPROVAL_V1"
	FinanceOrderRevokeDomain   = "YNX_FINANCE_ORDER_APPROVAL_REVOKE_V1"
)

type FinanceOrderV1 struct {
	AssetClass     string `json:"assetClass"`
	AssetID        string `json:"assetId"`
	Currency       string `json:"currency"`
	ExtendedHours  bool   `json:"extendedHours"`
	FeeBoundSource string `json:"feeBoundSource"`
	LimitPrice     string `json:"limitPrice"`
	MaxCost        string `json:"maxCost"`
	MaxFee         string `json:"maxFee"`
	OrderID        string `json:"orderId"`
	OrderType      string `json:"orderType"`
	Qty            string `json:"qty"`
	Side           string `json:"side"`
	Symbol         string `json:"symbol"`
	TimeInForce    string `json:"timeInForce"`
}

type BrokerOrderDraftInput struct {
	AssetID    string `json:"assetId"`
	Symbol     string `json:"symbol"`
	Side       string `json:"side"`
	Qty        string `json:"qty"`
	LimitPrice string `json:"limitPrice"`
}

type FinanceOrderApprovalUnsignedV1 struct {
	Account            string         `json:"account"`
	AccountPublicKey   string         `json:"accountPublicKey"`
	ApplicationID      string         `json:"applicationId"`
	BrokerAccountID    string         `json:"brokerAccountId"`
	CallbackStateHash  string         `json:"callbackStateHash"`
	ChainEnvironment   string         `json:"chainEnvironment"`
	ChainID            string         `json:"chainId"`
	ChallengeID        string         `json:"challengeId"`
	ExpiresAt          string         `json:"expiresAt"`
	IssuedAt           string         `json:"issuedAt"`
	Nonce              string         `json:"nonce"`
	Order              FinanceOrderV1 `json:"order"`
	OrderHash          string         `json:"orderHash"`
	Origin             string         `json:"origin"`
	Platform           string         `json:"platform"`
	ProductID          string         `json:"productId"`
	Provider           string         `json:"provider"`
	RequestID          string         `json:"requestId"`
	SubjectID          string         `json:"subjectId"`
	TradingEnvironment string         `json:"tradingEnvironment"`
	Version            string         `json:"version"`
}

type FinanceOrderApprovalV1 struct {
	FinanceOrderApprovalUnsignedV1
	Signature string `json:"signature"`
}

type FinanceOrderRevocationV1 struct {
	Account          string `json:"account"`
	AccountPublicKey string `json:"accountPublicKey"`
	ApprovalDigest   string `json:"approvalDigest"`
	Reason           string `json:"reason"`
	RequestID        string `json:"requestId"`
	RevokedAt        string `json:"revokedAt"`
	Signature        string `json:"signature"`
	Version          string `json:"version"`
}

type FinanceOrderApprovalCallbackV1 struct {
	Status            string
	RequestID         string
	CallbackStateHash string
	Approval          *FinanceOrderApprovalV1
	Revocation        *FinanceOrderRevocationV1
}

type BrokerAccountMapping struct {
	SubjectID          string    `json:"subjectId"`
	Account            string    `json:"account"`
	Provider           string    `json:"provider"`
	TradingEnvironment string    `json:"tradingEnvironment"`
	BrokerAccountID    string    `json:"brokerAccountId"`
	WalletPublicKey    string    `json:"walletPublicKey,omitempty"`
	Status             string    `json:"status"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type BrokerWatchlistItem struct {
	AssetID string    `json:"assetId"`
	Symbol  string    `json:"symbol"`
	Name    string    `json:"name"`
	AddedAt time.Time `json:"addedAt"`
}

type BrokerApprovalChallenge struct {
	Unsigned       FinanceOrderApprovalUnsignedV1 `json:"unsigned"`
	ServerTime     string                         `json:"serverTime"`
	ApprovalState  string                         `json:"approvalState"`
	ApprovalDigest string                         `json:"approvalDigest,omitempty"`
	Signature      string                         `json:"signature,omitempty"`
	ApprovedAt     time.Time                      `json:"approvedAt,omitempty"`
	Revocation     *FinanceOrderRevocationV1      `json:"revocation,omitempty"`
	UpdatedAt      time.Time                      `json:"updatedAt"`
}

// BrokerOrderHandoffRecord stays in persistedState, never AccountState: the
// profile endpoint serializes AccountState and must not expose a callback
// state, proof, or one-time code verifier. Ticket and code plaintext are never
// persisted. The raw-v1 mode is reserved for a separately reviewed legacy
// recovery route; fresh tickets must use sha256-v2. Fresh tickets bind the
// issuing Product Session by hash. A raw-v1 recovered ticket has no original
// session binding in its historical challenge: its separate owner-key recovery
// proof plus the current same-account Product Session at exchange is an
// explicit reauthentication exception, never an original-session claim.
type BrokerOrderHandoffRecord struct {
	TicketHash           string               `json:"ticketHash"`
	Account              string               `json:"account"`
	SessionBindingHash   string               `json:"sessionBindingHash"`
	RequestID            string               `json:"requestId"`
	CallbackState        string               `json:"callbackState"`
	CallbackStateBinding string               `json:"callbackStateBinding"`
	ClaimNonces          map[string]time.Time `json:"claimNonces,omitempty"`
	DecisionStatus       string               `json:"decisionStatus,omitempty"`
	DecisionProof        json.RawMessage      `json:"decisionProof,omitempty"`
	DecisionProofHash    string               `json:"decisionProofHash,omitempty"`
	CodeHash             string               `json:"codeHash,omitempty"`
	CodeExpiresAt        time.Time            `json:"codeExpiresAt,omitempty"`
	CodeConsumedAt       *time.Time           `json:"codeConsumedAt,omitempty"`
	IssuedAt             time.Time            `json:"issuedAt"`
	ExpiresAt            time.Time            `json:"expiresAt"`
}

type BrokerOrderRecord struct {
	Order                 FinanceOrderV1 `json:"order"`
	RequestID             string         `json:"requestId"`
	ChallengeID           string         `json:"challengeId"`
	SubjectID             string         `json:"subjectId"`
	BrokerAccountID       string         `json:"brokerAccountId"`
	OrderHash             string         `json:"orderHash"`
	ApprovalDigest        string         `json:"approvalDigest,omitempty"`
	ApprovalState         string         `json:"approvalState"`
	State                 string         `json:"state"`
	ProviderClientOrderID string         `json:"providerClientOrderId,omitempty"`
	ProviderOrderID       string         `json:"providerOrderId,omitempty"`
	ProviderRawStatus     string         `json:"providerRawStatus,omitempty"`
	ProviderHTTPRequestID string         `json:"providerHttpRequestId,omitempty"`
	ProviderEventCursor   string         `json:"providerEventCursor,omitempty"`
	ProviderEventAt       time.Time      `json:"providerEventAt,omitempty"`
	CreatedAt             time.Time      `json:"createdAt"`
	UpdatedAt             time.Time      `json:"updatedAt"`
}

type BrokerOrderOutbox struct {
	OrderID               string    `json:"orderId"`
	RequestID             string    `json:"requestId"`
	ProviderClientOrderID string    `json:"providerClientOrderId"`
	Provider              string    `json:"provider"`
	TradingEnvironment    string    `json:"tradingEnvironment"`
	Status                string    `json:"status"`
	ProviderOrderID       string    `json:"providerOrderId,omitempty"`
	ProviderRawStatus     string    `json:"providerRawStatus,omitempty"`
	ProviderHTTPRequestID string    `json:"providerHttpRequestId,omitempty"`
	LastErrorCode         string    `json:"lastErrorCode,omitempty"`
	ExecutionRequestKey   string    `json:"executionRequestKey,omitempty"`
	ExecutionRequestedAt  time.Time `json:"executionRequestedAt,omitempty"`
	Attempts              int       `json:"attempts"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type BrokerJournalEvent struct {
	ID                    string    `json:"id"`
	OrderID               string    `json:"orderId"`
	RequestID             string    `json:"requestId"`
	Action                string    `json:"action"`
	ApprovalState         string    `json:"approvalState"`
	OrderState            string    `json:"orderState"`
	ProviderRawStatus     string    `json:"providerRawStatus,omitempty"`
	ProviderHTTPRequestID string    `json:"providerHttpRequestId,omitempty"`
	ProviderEventCursor   string    `json:"providerEventCursor,omitempty"`
	CreatedAt             time.Time `json:"createdAt"`
}

type BrokerProviderAudit struct {
	RawStatus     string
	HTTPRequestID string
	EventCursor   string
}

type BrokerageAccountState struct {
	Mappings    map[string]BrokerAccountMapping    `json:"mappings"`
	Challenges  map[string]BrokerApprovalChallenge `json:"challenges"`
	Orders      map[string]BrokerOrderRecord       `json:"orders"`
	Outbox      map[string]BrokerOrderOutbox       `json:"outbox"`
	Journal     []BrokerJournalEvent               `json:"journal"`
	Watchlist   map[string]BrokerWatchlistItem     `json:"watchlist"`
	EventCursor string                             `json:"eventCursor,omitempty"`
	// ReconcileCheckpoint identifies the last bounded polling snapshot. It is
	// deliberately independent from EventCursor: polling must never advance or
	// replace the provider SSE resume cursor.
	ReconcileCheckpoint string    `json:"reconcileCheckpoint,omitempty"`
	TradeEventAt        time.Time `json:"tradeEventAt,omitempty"`
	ReconciledAt        time.Time `json:"reconciledAt,omitempty"`
}

type BrokerWorkspace struct {
	MappingActive bool                  `json:"mappingActive"`
	Orders        []BrokerOrderRecord   `json:"orders"`
	Outbox        []BrokerOrderOutbox   `json:"outbox"`
	Journal       []BrokerJournalEvent  `json:"journal"`
	Watchlist     []BrokerWatchlistItem `json:"watchlist"`
	ServerTime    string                `json:"serverTime"`
}
