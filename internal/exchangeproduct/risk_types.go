package exchangeproduct

import "time"

const DefaultPerpetualMarket = "YNXT-YUSD_TEST-PERP"

type RiskOracle interface {
	Snapshot(market string) (RiskOracleSnapshot, error)
}

type RiskOracleSnapshot struct {
	Market          string    `json:"market"`
	IndexPriceMicro int64     `json:"indexPriceMicro"`
	MarkPriceMicro  int64     `json:"markPriceMicro"`
	FundingRateBPS  int64     `json:"fundingRateBps"`
	ConfidenceBPS   int64     `json:"confidenceBps"`
	Source          string    `json:"source"`
	SourceVersion   string    `json:"sourceVersion"`
	SourceDigest    string    `json:"sourceDigest"`
	Sequence        int64     `json:"sequence"`
	ObservedAt      time.Time `json:"observedAt"`
	ExpiresAt       time.Time `json:"expiresAt"`
}

type RiskTier struct {
	MaxNotionalMicro     int64 `json:"maxNotionalMicro"`
	MaxLeverage          int64 `json:"maxLeverage"`
	InitialMarginBPS     int64 `json:"initialMarginBps"`
	MaintenanceMarginBPS int64 `json:"maintenanceMarginBps"`
}

type PerpetualMarketPolicy struct {
	Market                      string     `json:"market"`
	SettlementAsset             string     `json:"settlementAsset"`
	OracleRequired              bool       `json:"oracleRequired"`
	OracleMinConfidenceBPS      int64      `json:"oracleMinConfidenceBps"`
	OracleMaxAgeSeconds         int64      `json:"oracleMaxAgeSeconds"`
	MaxFundingRateBPS           int64      `json:"maxFundingRateBps"`
	PriceBandBPS                int64      `json:"priceBandBps"`
	CircuitBreakerBPS           int64      `json:"circuitBreakerBps"`
	OpenInterestCapMicro        int64      `json:"openInterestCapMicro"`
	LiquidationFeeBPS           int64      `json:"liquidationFeeBps"`
	PartialLiquidationTargetBPS int64      `json:"partialLiquidationTargetBps"`
	InsuranceFundShareBPS       int64      `json:"insuranceFundShareBps"`
	Tiers                       []RiskTier `json:"tiers"`
}

type MarginAccount struct {
	Account              string    `json:"account"`
	Mode                 string    `json:"mode"`
	CollateralMicro      int64     `json:"collateralMicro"`
	OrderMarginMicro     int64     `json:"orderMarginMicro"`
	PositionMarginMicro  int64     `json:"positionMarginMicro"`
	RealizedPnLMicro     int64     `json:"realizedPnlMicro"`
	FundingPaidMicro     int64     `json:"fundingPaidMicro"`
	LiquidationFeesMicro int64     `json:"liquidationFeesMicro"`
	Status               string    `json:"status"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

type PerpetualPosition struct {
	Account                string    `json:"account"`
	Market                 string    `json:"market"`
	SizeMicro              int64     `json:"sizeMicro"`
	EntryPriceMicro        int64     `json:"entryPriceMicro"`
	MarkPriceMicro         int64     `json:"markPriceMicro"`
	NotionalMicro          int64     `json:"notionalMicro"`
	UnrealizedPnLMicro     int64     `json:"unrealizedPnlMicro"`
	RealizedPnLMicro       int64     `json:"realizedPnlMicro"`
	FundingAccruedMicro    int64     `json:"fundingAccruedMicro"`
	InitialMarginMicro     int64     `json:"initialMarginMicro"`
	MaintenanceMarginMicro int64     `json:"maintenanceMarginMicro"`
	LiquidationPriceMicro  int64     `json:"liquidationPriceMicro"`
	Leverage               int64     `json:"leverage"`
	Status                 string    `json:"status"`
	UpdatedAt              time.Time `json:"updatedAt"`
}

type PerpetualOrder struct {
	ID                  string    `json:"id"`
	Account             string    `json:"account"`
	Market              string    `json:"market"`
	Side                string    `json:"side"`
	Type                string    `json:"type"`
	TimeInForce         string    `json:"timeInForce"`
	PriceMicro          int64     `json:"priceMicro"`
	AmountMicro         int64     `json:"amountMicro"`
	FilledMicro         int64     `json:"filledMicro"`
	Leverage            int64     `json:"leverage"`
	ReduceOnly          bool      `json:"reduceOnly"`
	ReservedMarginMicro int64     `json:"reservedMarginMicro"`
	Status              string    `json:"status"`
	RejectReason        string    `json:"rejectReason,omitempty"`
	PrioritySequence    int64     `json:"prioritySequence"`
	AuthorizationDigest string    `json:"authorizationDigest"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type PerpetualTrade struct {
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
	OracleDigest   string    `json:"oracleDigest"`
	CreatedAt      time.Time `json:"createdAt"`
}

type FundingSettlement struct {
	ID                string    `json:"id"`
	Account           string    `json:"account"`
	Market            string    `json:"market"`
	PositionSizeMicro int64     `json:"positionSizeMicro"`
	RateBPS           int64     `json:"rateBps"`
	PaymentMicro      int64     `json:"paymentMicro"`
	OracleDigest      string    `json:"oracleDigest"`
	SettledAt         time.Time `json:"settledAt"`
}

type LiquidationEvent struct {
	ID                     string    `json:"id"`
	Account                string    `json:"account"`
	Market                 string    `json:"market"`
	Kind                   string    `json:"kind"`
	SizeBeforeMicro        int64     `json:"sizeBeforeMicro"`
	SizeClosedMicro        int64     `json:"sizeClosedMicro"`
	ExecutionPriceMicro    int64     `json:"executionPriceMicro"`
	EquityBeforeMicro      int64     `json:"equityBeforeMicro"`
	MaintenanceMarginMicro int64     `json:"maintenanceMarginMicro"`
	LiquidationFeeMicro    int64     `json:"liquidationFeeMicro"`
	InsuranceDeltaMicro    int64     `json:"insuranceDeltaMicro"`
	DeficitMicro           int64     `json:"deficitMicro"`
	DefaultWaterfallStage  string    `json:"defaultWaterfallStage"`
	OracleDigest           string    `json:"oracleDigest"`
	CreatedAt              time.Time `json:"createdAt"`
}

type InsuranceFund struct {
	Asset         string    `json:"asset"`
	BalanceMicro  int64     `json:"balanceMicro"`
	ReservedMicro int64     `json:"reservedMicro"`
	Status        string    `json:"status"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type RiskMarketState struct {
	Market               string    `json:"market"`
	Status               string    `json:"status"`
	ReduceOnly           bool      `json:"reduceOnly"`
	CircuitBreakerReason string    `json:"circuitBreakerReason,omitempty"`
	OpenInterestMicro    int64     `json:"openInterestMicro"`
	LastOracleDigest     string    `json:"lastOracleDigest,omitempty"`
	LastFundingAt        time.Time `json:"lastFundingAt,omitempty"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

type RiskPublicSnapshot struct {
	Version           string                `json:"version"`
	Policy            PerpetualMarketPolicy `json:"policy"`
	Oracle            *RiskOracleSnapshot   `json:"oracle,omitempty"`
	Market            RiskMarketState       `json:"market"`
	InsuranceFund     InsuranceFund         `json:"insuranceFund"`
	Status            string                `json:"status"`
	UnavailableReason string                `json:"unavailableReason,omitempty"`
	AsOf              time.Time             `json:"asOf"`
}
