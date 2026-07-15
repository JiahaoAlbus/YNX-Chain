package exchangeproduct

import (
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
	ChainID       = "ynx_6423-1"
	EVMChainID    = 6423
	NativeAsset   = "YNXT"
	QuoteAsset    = "YUSD_TEST"
	DefaultMarket = "YNXT-YUSD_TEST"
	AmountScale   = int64(1_000_000)
)

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
}

type Order struct {
	ID               string    `json:"id"`
	Account          string    `json:"account"`
	Market           string    `json:"market"`
	Side             string    `json:"side"`
	Type             string    `json:"type"`
	PriceMicro       int64     `json:"priceMicro"`
	AmountMicro      int64     `json:"amountMicro"`
	FilledMicro      int64     `json:"filledMicro"`
	ReservedMicro    int64     `json:"reservedMicro"`
	Status           string    `json:"status"`
	RejectReason     string    `json:"rejectReason,omitempty"`
	WalletAuthorized bool      `json:"walletAuthorized"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
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
	UpdatedAt       time.Time `json:"updatedAt"`
	CreatedAt       time.Time `json:"createdAt"`
}

type AuditEvent struct {
	ID         string    `json:"id"`
	Account    string    `json:"account"`
	Action     string    `json:"action"`
	ObjectType string    `json:"objectType"`
	ObjectID   string    `json:"objectId"`
	Digest     string    `json:"digest"`
	CreatedAt  time.Time `json:"createdAt"`
}

type OrderBook struct {
	Market string  `json:"market"`
	Bids   []Order `json:"bids"`
	Asks   []Order `json:"asks"`
}
