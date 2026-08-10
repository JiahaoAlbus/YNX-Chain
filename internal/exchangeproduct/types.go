package exchangeproduct

import (
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrInvalid      = errors.New("invalid request")
	ErrUnauthorized = errors.New("unauthorized")
	ErrForbidden    = errors.New("forbidden")
	ErrNotFound     = errors.New("not found")
	ErrConflict     = errors.New("conflict")
	ErrInsufficient = errors.New("insufficient available balance")
	ErrUnavailable  = errors.New("unavailable")
)

const (
	ProductID     = "ynx-exchange"
	Version       = "0.1.0-testnet"
	ChainID       = "ynx_6423-1"
	EVMChainID    = 6423
	NativeAsset   = "YNXT"
	QuoteAsset    = "YUSD_TEST"
	DefaultMarket = "YNXT-YUSD_TEST"
	AmountScale   = int64(1_000_000)
)

// BuildCommit is overridden by release builds with -ldflags -X.
var BuildCommit = "development"

type Config struct {
	StatePath              string
	APIKey                 string
	WalletCallback         string
	RequiredConfirmations  int64
	MakerFeeBPS            int64
	TakerFeeBPS            int64
	WithdrawalFeeMicroYNXT int64
	Now                    func() time.Time
	Chain                  ChainReader
	CustodyAddress         string
	GatewayURL             string
	GatewayClientID        string
	Gateway                GatewayAuthorizer
	IndexerURL             string
	MaxOrderNotionalMicro  int64
	MaxWithdrawalMicro     int64
	DeployedPublic         bool
}

type GatewayAuthorizer interface {
	Authorize(token, scope, clientID string) (WalletSession, error)
}

type IntegrationStatus struct {
	Gateway        string `json:"gateway"`
	GatewayReason  string `json:"gatewayReason,omitempty"`
	WalletRegistry string `json:"walletRegistry"`
	Custody        string `json:"custody"`
	Indexer        string `json:"indexer"`
	CrossChain     string `json:"crossChain"`
}

type ChainTransfer struct {
	Hash          string `json:"hash"`
	From          string `json:"from"`
	To            string `json:"to"`
	AmountMicro   int64  `json:"amountMicro"`
	Confirmations int64  `json:"confirmations"`
	Committed     bool   `json:"committed"`
}

type ChainReader interface {
	Transfer(hash string) (ChainTransfer, error)
}

// ChainBalanceReader is an optional extension implemented by chain readers
// that can prove the committed native balance of the configured custody
// account. Solvency reporting fails closed when this capability is absent.
type ChainBalanceReader interface {
	AccountBalance(address string) (ChainBalance, error)
}

type ChainBalance struct {
	Address         string `json:"address"`
	Asset           string `json:"asset"`
	AmountMicro     int64  `json:"amountMicro"`
	CommittedHeight uint64 `json:"committedHeight"`
	Source          string `json:"source"`
}

type Market struct {
	Symbol        string `json:"symbol"`
	BaseAsset     string `json:"baseAsset"`
	QuoteAsset    string `json:"quoteAsset"`
	Venue         string `json:"venue"`
	Engine        string `json:"engine"`
	ExternalPrice bool   `json:"externalPrice"`
	PublicVolume  bool   `json:"publicVolume"`
	PriceScale    int64  `json:"priceScale"`
	AmountScale   int64  `json:"amountScale"`
	Status        string `json:"status"`
}

type AssetNetwork struct {
	Asset                      string `json:"asset"`
	Network                    string `json:"network"`
	ChainID                    string `json:"chainId"`
	EVMChainID                 int64  `json:"evmChainId"`
	DepositEnabled             bool   `json:"depositEnabled"`
	WithdrawalEnabled          bool   `json:"withdrawalEnabled"`
	WithdrawalReviewEnabled    bool   `json:"withdrawalReviewEnabled"`
	WithdrawalBroadcastEnabled bool   `json:"withdrawalBroadcastEnabled"`
	CrossChain                 bool   `json:"crossChain"`
	UnavailableReason          string `json:"unavailableReason,omitempty"`
	Confirmations              int64  `json:"confirmations"`
	WithdrawalFeeMicro         int64  `json:"withdrawalFeeMicro,omitempty"`
}

type WalletChallenge struct {
	ID        string    `json:"id"`
	Nonce     string    `json:"nonce"`
	Account   string    `json:"account"`
	DeviceID  string    `json:"deviceId"`
	ClientID  string    `json:"clientId"`
	Callback  string    `json:"callback"`
	Scopes    []string  `json:"scopes"`
	ChainID   string    `json:"chainId"`
	Purpose   string    `json:"purpose"`
	IssuedAt  time.Time `json:"issuedAt"`
	ExpiresAt time.Time `json:"expiresAt"`
	UsedAt    time.Time `json:"usedAt,omitempty"`
}

type WalletSession struct {
	TokenHash       string    `json:"tokenHash"`
	Account         string    `json:"account"`
	DeviceID        string    `json:"deviceId"`
	WalletPublicKey string    `json:"walletPublicKey"`
	Scopes          []string  `json:"scopes"`
	CreatedAt       time.Time `json:"createdAt"`
	ExpiresAt       time.Time `json:"expiresAt"`
	RevokedAt       time.Time `json:"revokedAt,omitempty"`
}

type Balance struct {
	Account        string `json:"account"`
	Asset          string `json:"asset"`
	AvailableMicro int64  `json:"availableMicro"`
	ReservedMicro  int64  `json:"reservedMicro"`
}

type LedgerEntry struct {
	ID             string    `json:"id"`
	Account        string    `json:"account"`
	Asset          string    `json:"asset"`
	AvailableDelta int64     `json:"availableDelta"`
	ReservedDelta  int64     `json:"reservedDelta"`
	SourceType     string    `json:"sourceType"`
	SourceID       string    `json:"sourceId"`
	SourceDigest   string    `json:"sourceDigest"`
	CreatedAt      time.Time `json:"createdAt"`
}

type DepositIntent struct {
	ID            string    `json:"id"`
	Account       string    `json:"account"`
	Asset         string    `json:"asset"`
	Network       string    `json:"network"`
	Address       string    `json:"address"`
	Status        string    `json:"status"`
	IndexerSource string    `json:"indexerSource"`
	CreatedAt     time.Time `json:"createdAt"`
	ExpiresAt     time.Time `json:"expiresAt"`
}

type Deposit struct {
	ID            string    `json:"id"`
	Account       string    `json:"account"`
	Asset         string    `json:"asset"`
	Network       string    `json:"network"`
	TxHash        string    `json:"txHash"`
	AmountMicro   int64     `json:"amountMicro"`
	Confirmations int64     `json:"confirmations"`
	Required      int64     `json:"required"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
	IntentID      string    `json:"intentId"`
	SourceType    string    `json:"sourceType"`
	SourceDigest  string    `json:"sourceDigest"`
}

type Withdrawal struct {
	ID               string    `json:"id"`
	Account          string    `json:"account"`
	Asset            string    `json:"asset"`
	Network          string    `json:"network"`
	Destination      string    `json:"destination"`
	AmountMicro      int64     `json:"amountMicro"`
	FeeMicro         int64     `json:"feeMicro"`
	ReceiveMicro     int64     `json:"receiveMicro"`
	Status           string    `json:"status"`
	WalletAuthorized bool      `json:"walletAuthorized"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
	SourceType       string    `json:"sourceType"`
	SourceDigest     string    `json:"sourceDigest"`
}

type Order struct {
	ID                  string    `json:"id"`
	ParentOrderID       string    `json:"parentOrderId,omitempty"`
	Account             string    `json:"account"`
	QuantNonceDomain    string    `json:"quantNonceDomain,omitempty"`
	Market              string    `json:"market"`
	Side                string    `json:"side"`
	Type                string    `json:"type"`
	TimeInForce         string    `json:"timeInForce"`
	PostOnly            bool      `json:"postOnly"`
	PriceMicro          int64     `json:"priceMicro"`
	AmountMicro         int64     `json:"amountMicro"`
	FilledMicro         int64     `json:"filledMicro"`
	DisplayAmountMicro  int64     `json:"displayAmountMicro,omitempty"`
	VisibleUntilMicro   int64     `json:"visibleUntilMicro,omitempty"`
	PrioritySequence    int64     `json:"prioritySequence,omitempty"`
	ReservedMicro       int64     `json:"reservedMicro"`
	Status              string    `json:"status"`
	RejectReason        string    `json:"rejectReason,omitempty"`
	WalletAuthorized    bool      `json:"walletAuthorized"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
	AuthorizationDigest string    `json:"authorizationDigest"`
}

type OCOGroup struct {
	ID                      string    `json:"id"`
	Account                 string    `json:"account"`
	QuantNonceDomain        string    `json:"quantNonceDomain,omitempty"`
	Market                  string    `json:"market"`
	Side                    string    `json:"side"`
	AmountMicro             int64     `json:"amountMicro"`
	ReservedMicro           int64     `json:"reservedMicro"`
	StopConditionalID       string    `json:"stopConditionalId"`
	TakeProfitConditionalID string    `json:"takeProfitConditionalId"`
	TriggeredConditionalID  string    `json:"triggeredConditionalId,omitempty"`
	ActivatedOrderID        string    `json:"activatedOrderId,omitempty"`
	Status                  string    `json:"status"`
	RejectReason            string    `json:"rejectReason,omitempty"`
	AuthorizationDigest     string    `json:"authorizationDigest"`
	CreatedAt               time.Time `json:"createdAt"`
	UpdatedAt               time.Time `json:"updatedAt"`
}

type TWAPOrder struct {
	ID                  string    `json:"id"`
	Account             string    `json:"account"`
	QuantNonceDomain    string    `json:"quantNonceDomain,omitempty"`
	Market              string    `json:"market"`
	Side                string    `json:"side"`
	LimitPriceMicro     int64     `json:"limitPriceMicro"`
	TotalAmountMicro    int64     `json:"totalAmountMicro"`
	ScheduledMicro      int64     `json:"scheduledMicro"`
	ReservedMicro       int64     `json:"reservedMicro"`
	Slices              int       `json:"slices"`
	SlicesExecuted      int       `json:"slicesExecuted"`
	IntervalSeconds     int64     `json:"intervalSeconds"`
	NextRunAt           time.Time `json:"nextRunAt"`
	Status              string    `json:"status"`
	ChildOrderIDs       []string  `json:"childOrderIds"`
	RejectReason        string    `json:"rejectReason,omitempty"`
	AuthorizationDigest string    `json:"authorizationDigest"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type ScaleOrder struct {
	ID                  string    `json:"id"`
	Account             string    `json:"account"`
	QuantNonceDomain    string    `json:"quantNonceDomain,omitempty"`
	Market              string    `json:"market"`
	Side                string    `json:"side"`
	StartPriceMicro     int64     `json:"startPriceMicro"`
	EndPriceMicro       int64     `json:"endPriceMicro"`
	TotalAmountMicro    int64     `json:"totalAmountMicro"`
	FilledMicro         int64     `json:"filledMicro"`
	ReservedMicro       int64     `json:"reservedMicro"`
	Levels              int       `json:"levels"`
	PostOnly            bool      `json:"postOnly"`
	ChildOrderIDs       []string  `json:"childOrderIds"`
	Status              string    `json:"status"`
	RejectReason        string    `json:"rejectReason,omitempty"`
	AuthorizationDigest string    `json:"authorizationDigest"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type ConditionalOrder struct {
	ID                  string    `json:"id"`
	GroupID             string    `json:"groupId,omitempty"`
	Account             string    `json:"account"`
	QuantNonceDomain    string    `json:"quantNonceDomain,omitempty"`
	Market              string    `json:"market"`
	Side                string    `json:"side"`
	Kind                string    `json:"kind"`
	TriggerPriceMicro   int64     `json:"triggerPriceMicro"`
	TrailOffsetMicro    int64     `json:"trailOffsetMicro,omitempty"`
	WatermarkMicro      int64     `json:"watermarkMicro,omitempty"`
	LimitPriceMicro     int64     `json:"limitPriceMicro"`
	AmountMicro         int64     `json:"amountMicro"`
	ReservedMicro       int64     `json:"reservedMicro"`
	Status              string    `json:"status"`
	TriggeredByTradeID  string    `json:"triggeredByTradeId,omitempty"`
	ActivatedOrderID    string    `json:"activatedOrderId,omitempty"`
	RejectReason        string    `json:"rejectReason,omitempty"`
	WalletAuthorized    bool      `json:"walletAuthorized"`
	AuthorizationDigest string    `json:"authorizationDigest"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type CancelResult struct {
	Orders            []Order            `json:"orders"`
	ConditionalOrders []ConditionalOrder `json:"conditionalOrders"`
	OCOGroups         []OCOGroup         `json:"ocoGroups"`
	TWAPOrders        []TWAPOrder        `json:"twapOrders"`
	ScaleOrders       []ScaleOrder       `json:"scaleOrders"`
	Count             int                `json:"count"`
}

type DeadManSwitch struct {
	Account        string    `json:"account"`
	Market         string    `json:"market"`
	TimeoutSeconds int64     `json:"timeoutSeconds"`
	NonceDomain    string    `json:"nonceDomain"`
	Status         string    `json:"status"`
	ExpiresAt      time.Time `json:"expiresAt,omitempty"`
	LastHeartbeat  time.Time `json:"lastHeartbeat,omitempty"`
	UpdatedAt      time.Time `json:"updatedAt"`
	Cancelled      int       `json:"cancelled"`
}

type ExecutionEvent struct {
	Sequence      int64           `json:"sequence"`
	Stream        string          `json:"stream"`
	Type          string          `json:"type"`
	Account       string          `json:"account,omitempty"`
	Market        string          `json:"market"`
	ObjectType    string          `json:"objectType"`
	ObjectID      string          `json:"objectId"`
	PayloadDigest string          `json:"payloadDigest"`
	Payload       json.RawMessage `json:"payload"`
	AsOf          time.Time       `json:"asOf"`
	Source        string          `json:"source"`
	Version       string          `json:"version"`
	PreviousHash  string          `json:"previousHash,omitempty"`
	Hash          string          `json:"hash"`
}

type StreamSnapshot struct {
	Sequence int64            `json:"sequence"`
	Market   string           `json:"market"`
	Book     OrderBook        `json:"book"`
	Events   []ExecutionEvent `json:"events"`
	Source   QuantSource      `json:"source"`
}

type Trade struct {
	ID             string    `json:"id"`
	Market         string    `json:"market"`
	PriceMicro     int64     `json:"priceMicro"`
	AmountMicro    int64     `json:"amountMicro"`
	BuyOrderID     string    `json:"buyOrderId"`
	SellOrderID    string    `json:"sellOrderId"`
	Buyer          string    `json:"buyer"`
	Seller         string    `json:"seller"`
	BuyerFeeMicro  int64     `json:"buyerFeeMicro"`
	SellerFeeMicro int64     `json:"sellerFeeMicro"`
	CreatedAt      time.Time `json:"createdAt"`
	SourceType     string    `json:"sourceType"`
	SourceDigest   string    `json:"sourceDigest"`
}

type FeeRecord struct {
	ID          string    `json:"id"`
	Account     string    `json:"account"`
	Asset       string    `json:"asset"`
	AmountMicro int64     `json:"amountMicro"`
	Kind        string    `json:"kind"`
	Reference   string    `json:"reference"`
	CreatedAt   time.Time `json:"createdAt"`
}

type SecuritySettings struct {
	Account           string    `json:"account"`
	WithdrawalLock    bool      `json:"withdrawalLock"`
	OrderConfirmation bool      `json:"orderConfirmation"`
	SessionTTLMinutes int       `json:"sessionTtlMinutes"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type SupportCase struct {
	ID        string    `json:"id"`
	Account   string    `json:"account"`
	Category  string    `json:"category"`
	Message   string    `json:"message"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

type AIRecord struct {
	ID              string    `json:"id"`
	Account         string    `json:"account"`
	Kind            string    `json:"kind"`
	ContextClasses  []string  `json:"contextClasses"`
	Permission      bool      `json:"permission"`
	ProviderStatus  string    `json:"providerStatus"`
	Provider        string    `json:"provider"`
	Model           string    `json:"model"`
	EstimateCredits int64     `json:"estimateCredits"`
	Prompt          string    `json:"prompt"`
	Result          string    `json:"result,omitempty"`
	Status          string    `json:"status"`
	ReviewedAction  string    `json:"reviewedAction,omitempty"`
	ApprovalDigest  string    `json:"approvalDigest,omitempty"`
	UpdatedAt       time.Time `json:"updatedAt"`
	CreatedAt       time.Time `json:"createdAt"`
}

type AuditEvent struct {
	ID           string    `json:"id"`
	Account      string    `json:"account"`
	Action       string    `json:"action"`
	ObjectType   string    `json:"objectType"`
	ObjectID     string    `json:"objectId"`
	Digest       string    `json:"digest"`
	CreatedAt    time.Time `json:"createdAt"`
	PreviousHash string    `json:"previousHash,omitempty"`
	Hash         string    `json:"hash"`
}

type OrderBook struct {
	Market string  `json:"market"`
	Bids   []Order `json:"bids"`
	Asks   []Order `json:"asks"`
}

type SolvencyAsset struct {
	Asset                     string `json:"asset"`
	LiabilitiesMicro          int64  `json:"liabilitiesMicro"`
	AvailableLiabilitiesMicro int64  `json:"availableLiabilitiesMicro"`
	ReservedLiabilitiesMicro  int64  `json:"reservedLiabilitiesMicro"`
	AssetsMicro               *int64 `json:"assetsMicro,omitempty"`
	EncumberedAssetsMicro     *int64 `json:"encumberedAssetsMicro,omitempty"`
	ReserveRatioBPS           *int64 `json:"reserveRatioBps,omitempty"`
	WithdrawalCapacityMicro   *int64 `json:"withdrawalCapacityMicro,omitempty"`
	AssetProofStatus          string `json:"assetProofStatus"`
	AssetProofSource          string `json:"assetProofSource,omitempty"`
	UnavailableReason         string `json:"unavailableReason,omitempty"`
}

type SolvencySnapshot struct {
	Version             string          `json:"version"`
	AsOf                time.Time       `json:"asOf"`
	StateSchemaVersion  int             `json:"stateSchemaVersion"`
	StateIntegrityHash  string          `json:"stateIntegrityHash"`
	LiabilityMerkleRoot string          `json:"liabilityMerkleRoot"`
	LiabilityLeafCount  int             `json:"liabilityLeafCount"`
	CustodyAddress      string          `json:"custodyAddress,omitempty"`
	CommittedHeight     uint64          `json:"committedHeight,omitempty"`
	Assets              []SolvencyAsset `json:"assets"`
	InsuranceFundStatus string          `json:"insuranceFundStatus"`
	Status              string          `json:"status"`
	Disclosure          string          `json:"disclosure"`
}

type MerkleStep struct {
	Hash     string `json:"hash"`
	Position string `json:"position"`
}

type LiabilityProof struct {
	Version      string       `json:"version"`
	Account      string       `json:"account"`
	Balance      Balance      `json:"balance"`
	LeafHash     string       `json:"leafHash"`
	LeafIndex    int          `json:"leafIndex"`
	LeafCount    int          `json:"leafCount"`
	MerkleRoot   string       `json:"merkleRoot"`
	Proof        []MerkleStep `json:"proof"`
	Verified     bool         `json:"verified"`
	SnapshotAsOf time.Time    `json:"snapshotAsOf"`
}
