package finance

import "time"

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
	Status             string    `json:"status"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
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
	Attempts              int       `json:"attempts"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type BrokerJournalEvent struct {
	ID            string    `json:"id"`
	OrderID       string    `json:"orderId"`
	RequestID     string    `json:"requestId"`
	Action        string    `json:"action"`
	ApprovalState string    `json:"approvalState"`
	OrderState    string    `json:"orderState"`
	CreatedAt     time.Time `json:"createdAt"`
}

type BrokerageAccountState struct {
	Mappings   map[string]BrokerAccountMapping    `json:"mappings"`
	Challenges map[string]BrokerApprovalChallenge `json:"challenges"`
	Orders     map[string]BrokerOrderRecord       `json:"orders"`
	Outbox     map[string]BrokerOrderOutbox       `json:"outbox"`
	Journal    []BrokerJournalEvent               `json:"journal"`
}
