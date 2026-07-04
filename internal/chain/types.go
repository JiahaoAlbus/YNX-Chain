package chain

import "time"

type NetworkConfig struct {
	Name                 string `json:"name"`
	Slug                 string `json:"slug"`
	ChainID              int64  `json:"chainId"`
	NativeCoinName       string `json:"nativeCoinName"`
	NativeCurrencySymbol string `json:"nativeCurrencySymbol"`
	Decimals             int    `json:"decimals"`
	IsPublicNet          bool   `json:"isPublicNet"`
	ChainIDConflictCheck string `json:"chainIdConflictCheck"`
}

type Account struct {
	Address       string           `json:"address"`
	Balance       int64            `json:"balance"`
	Staked        int64            `json:"staked"`
	Nonce         uint64           `json:"nonce"`
	ResourceUsage ResourceUsage    `json:"resourceUsage"`
	Lots          map[string]int64 `json:"lots"`
}

type ExplorerSummary struct {
	Network            NetworkConfig `json:"network"`
	Height             uint64        `json:"height"`
	LatestBlockHash    string        `json:"latestBlockHash"`
	LatestBlockTime    time.Time     `json:"latestBlockTime"`
	TotalBlocks        int           `json:"totalBlocks"`
	TotalTransactions  int           `json:"totalTransactions"`
	KnownAccounts      int           `json:"knownAccounts"`
	ValidatorCount     int           `json:"validatorCount"`
	PendingTxCount     int           `json:"pendingTxCount"`
	PayIntentCount     int           `json:"payIntentCount"`
	InvoiceCount       int           `json:"invoiceCount"`
	TrustEvidenceCount int           `json:"trustEvidenceCount"`
	GovernanceRequests int           `json:"governanceRequestCount"`
	AppealCount        int           `json:"appealCount"`
	TransparencyCount  int           `json:"transparencyReportCount"`
	ContractCount      int           `json:"contractCount"`
	PersistenceEnabled bool          `json:"persistenceEnabled"`
	PersistenceError   string        `json:"persistenceError,omitempty"`
	TruthfulStatus     string        `json:"truthfulStatus"`
}

type ResourceUsage struct {
	BandwidthUsed int64 `json:"bandwidthUsed"`
	ComputeUsed   int64 `json:"computeUsed"`
	AICreditsUsed int64 `json:"aiCreditsUsed"`
	TrustUsed     int64 `json:"trustUsed"`
}

type ResourceBalance struct {
	Address        string `json:"address"`
	BandwidthLimit int64  `json:"bandwidthLimit"`
	BandwidthUsed  int64  `json:"bandwidthUsed"`
	BandwidthLeft  int64  `json:"bandwidthLeft"`
	ComputeLimit   int64  `json:"computeLimit"`
	ComputeUsed    int64  `json:"computeUsed"`
	ComputeLeft    int64  `json:"computeLeft"`
	AICreditsLimit int64  `json:"aiCreditsLimit"`
	AICreditsUsed  int64  `json:"aiCreditsUsed"`
	AICreditsLeft  int64  `json:"aiCreditsLeft"`
	TrustLimit     int64  `json:"trustLimit"`
	TrustUsed      int64  `json:"trustUsed"`
	TrustLeft      int64  `json:"trustLeft"`
	Staked         int64  `json:"staked"`
}

type ResourceDelegation struct {
	ID           string    `json:"id"`
	Provider     string    `json:"provider"`
	Beneficiary  string    `json:"beneficiary"`
	AmountYNXT   int64     `json:"amountYnxt"`
	Bandwidth    int64     `json:"bandwidth"`
	Compute      int64     `json:"compute"`
	AICredits    int64     `json:"aiCredits"`
	TrustCredits int64     `json:"trustCredits"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
}

type Block struct {
	Height       uint64        `json:"height"`
	Hash         string        `json:"hash"`
	ParentHash   string        `json:"parentHash"`
	Time         time.Time     `json:"time"`
	Validator    string        `json:"validator"`
	Transactions []Transaction `json:"transactions"`
}

type Transaction struct {
	Hash      string    `json:"hash"`
	Type      string    `json:"type"`
	From      string    `json:"from,omitempty"`
	To        string    `json:"to,omitempty"`
	Amount    int64     `json:"amount,omitempty"`
	Fee       int64     `json:"fee"`
	Nonce     uint64    `json:"nonce"`
	BlockHash string    `json:"blockHash,omitempty"`
	BlockNum  uint64    `json:"blockNumber,omitempty"`
	Timestamp time.Time `json:"timestamp"`
	LotFlows  []LotFlow `json:"lotFlows,omitempty"`
	Memo      string    `json:"memo,omitempty"`
}

type LotFlow struct {
	LotID  string `json:"lotId"`
	Amount int64  `json:"amount"`
	From   string `json:"from"`
	To     string `json:"to"`
}

type Validator struct {
	Address     string `json:"address"`
	Moniker     string `json:"moniker"`
	Host        string `json:"host,omitempty"`
	Role        string `json:"role,omitempty"`
	PeerID      string `json:"peerId,omitempty"`
	VotingPower int64  `json:"votingPower"`
	Active      bool   `json:"active"`
}

type TrustTrace struct {
	Address string          `json:"address"`
	Lots    []TrustTraceLot `json:"lots"`
	Labels  []string        `json:"labels"`
	Summary string          `json:"summary"`
}

type TrustTraceLot struct {
	LotID       string `json:"lotId"`
	Amount      int64  `json:"amount"`
	Origin      string `json:"origin"`
	RiskWeight  int64  `json:"riskWeightBps"`
	LastInbound string `json:"lastInboundTx,omitempty"`
}

type PayIntent struct {
	ID          string    `json:"id"`
	Merchant    string    `json:"merchant"`
	Amount      int64     `json:"amount"`
	Currency    string    `json:"currency"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	CallbackURL string    `json:"callbackUrl,omitempty"`
}

type Invoice struct {
	ID          string    `json:"id"`
	IntentID    string    `json:"intentId"`
	Merchant    string    `json:"merchant"`
	Amount      int64     `json:"amount"`
	Currency    string    `json:"currency"`
	Status      string    `json:"status"`
	DueAt       time.Time `json:"dueAt"`
	CreatedAt   time.Time `json:"createdAt"`
	PaymentLink string    `json:"paymentLink,omitempty"`
}

type RefundRecord struct {
	ID        string    `json:"id"`
	IntentID  string    `json:"intentId"`
	Amount    int64     `json:"amount"`
	Currency  string    `json:"currency"`
	Reason    string    `json:"reason,omitempty"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

type WebhookSignature struct {
	EventID   string    `json:"eventId"`
	IntentID  string    `json:"intentId"`
	Signature string    `json:"signature"`
	SignedAt  time.Time `json:"signedAt"`
	Algorithm string    `json:"algorithm"`
}

type RiskLabel struct {
	Subject       string    `json:"subject"`
	Label         string    `json:"label"`
	RiskWeightBps int64     `json:"riskWeightBps"`
	Source        string    `json:"source"`
	CreatedAt     time.Time `json:"createdAt"`
}

type EvidencePacket struct {
	ID          string        `json:"id"`
	Subject     string        `json:"subject"`
	Trace       TrustTrace    `json:"trace"`
	Labels      []RiskLabel   `json:"riskLabels"`
	RelatedTxs  []Transaction `json:"relatedTransactions"`
	JSONHash    string        `json:"jsonHash"`
	GeneratedAt time.Time     `json:"generatedAt"`
	ExportNotes []string      `json:"exportNotes"`
}

type RequestValidityStatus string

const (
	RequestValidUnderYNXChainLaw RequestValidityStatus = "VALID_UNDER_YNX_CHAIN_LAW"
	RequestInsufficientEvidence  RequestValidityStatus = "INSUFFICIENT_EVIDENCE"
	RequestOutOfScope            RequestValidityStatus = "OUT_OF_SCOPE"
	RequestOverbroad             RequestValidityStatus = "OVERBROAD"
	RequestIllegalOrAbusive      RequestValidityStatus = "ILLEGAL_OR_ABUSIVE"
	RequestRequiresReview        RequestValidityStatus = "REQUIRES_GOVERNANCE_REVIEW"
	RequestRequiresUserNotice    RequestValidityStatus = "REQUIRES_USER_NOTICE"
	RequestRejected              RequestValidityStatus = "REJECTED"
)

type GovernanceRequest struct {
	ID                  string                `json:"id"`
	Requester           string                `json:"requester"`
	Subject             string                `json:"subject"`
	Action              string                `json:"action"`
	AssetType           string                `json:"assetType"`
	Scope               string                `json:"scope"`
	Description         string                `json:"description"`
	Evidence            []string              `json:"evidence"`
	Classification      RequestValidityStatus `json:"classification"`
	Status              string                `json:"status"`
	Reasons             []string              `json:"reasons"`
	RequiresAppeal      bool                  `json:"requiresAppeal"`
	RequiresUserNotice  bool                  `json:"requiresUserNotice"`
	NativeYNXTProtected bool                  `json:"nativeYnxtProtected"`
	CreatedAt           time.Time             `json:"createdAt"`
	ReviewedAt          *time.Time            `json:"reviewedAt,omitempty"`
	RejectedAt          *time.Time            `json:"rejectedAt,omitempty"`
	TransparencyEntryID string                `json:"transparencyEntryId,omitempty"`
}

type GovernanceRequestInput struct {
	Requester   string   `json:"requester"`
	Subject     string   `json:"subject"`
	Action      string   `json:"action"`
	AssetType   string   `json:"assetType"`
	Scope       string   `json:"scope"`
	Description string   `json:"description"`
	Evidence    []string `json:"evidence"`
}

type TrustAppeal struct {
	ID                  string    `json:"id"`
	RequestID           string    `json:"requestId,omitempty"`
	Subject             string    `json:"subject"`
	Appellant           string    `json:"appellant"`
	Reason              string    `json:"reason"`
	Evidence            []string  `json:"evidence"`
	Status              string    `json:"status"`
	CreatedAt           time.Time `json:"createdAt"`
	TransparencyEntryID string    `json:"transparencyEntryId"`
}

type TrustAppealInput struct {
	RequestID string   `json:"requestId"`
	Subject   string   `json:"subject"`
	Appellant string   `json:"appellant"`
	Reason    string   `json:"reason"`
	Evidence  []string `json:"evidence"`
}

type TransparencyEntry struct {
	ID             string                `json:"id"`
	Type           string                `json:"type"`
	RequestID      string                `json:"requestId,omitempty"`
	AppealID       string                `json:"appealId,omitempty"`
	Subject        string                `json:"subject,omitempty"`
	Action         string                `json:"action,omitempty"`
	Classification RequestValidityStatus `json:"classification,omitempty"`
	Status         string                `json:"status"`
	Reasons        []string              `json:"reasons"`
	CreatedAt      time.Time             `json:"createdAt"`
}

type TransparencyReport struct {
	Network        NetworkConfig       `json:"network"`
	GeneratedAt    time.Time           `json:"generatedAt"`
	EntryCount     int                 `json:"entryCount"`
	RejectedCount  int                 `json:"rejectedCount"`
	AppealCount    int                 `json:"appealCount"`
	ReviewCount    int                 `json:"reviewCount"`
	TruthfulStatus string              `json:"truthfulStatus"`
	Entries        []TransparencyEntry `json:"entries"`
}

type ResourceQuote struct {
	ID            string    `json:"id"`
	Address       string    `json:"address"`
	Bandwidth     int64     `json:"bandwidth"`
	Compute       int64     `json:"compute"`
	AICredits     int64     `json:"aiCredits"`
	TrustCredits  int64     `json:"trustCredits"`
	PriceYNXT     int64     `json:"priceYnxt"`
	ExpiresAt     time.Time `json:"expiresAt"`
	TruthfulNotes []string  `json:"truthfulNotes"`
}

type ResourceRental struct {
	ID                 string    `json:"id"`
	QuoteID            string    `json:"quoteId"`
	Address            string    `json:"address"`
	Provider           string    `json:"provider"`
	PriceYNXT          int64     `json:"priceYnxt"`
	ProviderIncomeYNXT int64     `json:"providerIncomeYnxt"`
	ProtocolFeeYNXT    int64     `json:"protocolFeeYnxt"`
	Status             string    `json:"status"`
	CreatedAt          time.Time `json:"createdAt"`
	Bandwidth          int64     `json:"bandwidth"`
	Compute            int64     `json:"compute"`
	AICredits          int64     `json:"aiCredits"`
	TrustCredits       int64     `json:"trustCredits"`
}

type ResourceIncomeRecord struct {
	ID        string    `json:"id"`
	Provider  string    `json:"provider"`
	RentalID  string    `json:"rentalId"`
	Source    string    `json:"source"`
	Amount    int64     `json:"amount"`
	Currency  string    `json:"currency"`
	CreatedAt time.Time `json:"createdAt"`
}

type ResourceAnalytics struct {
	Network                   NetworkConfig `json:"network"`
	ActiveDelegationCount     int           `json:"activeDelegationCount"`
	ResourceRentalCount       int           `json:"resourceRentalCount"`
	ResourceIncomeRecordCount int           `json:"resourceIncomeRecordCount"`
	DelegatedYNXT             int64         `json:"delegatedYnxt"`
	RentalVolumeYNXT          int64         `json:"rentalVolumeYnxt"`
	ProviderIncomeYNXT        int64         `json:"providerIncomeYnxt"`
	ProtocolFeeYNXT           int64         `json:"protocolFeeYnxt"`
	TruthfulStatus            string        `json:"truthfulStatus"`
}

type ContractArtifact struct {
	Address      string     `json:"address"`
	Name         string     `json:"name"`
	Deployer     string     `json:"deployer"`
	SourceHash   string     `json:"sourceHash"`
	BytecodeHash string     `json:"bytecodeHash"`
	Verified     bool       `json:"verified"`
	DeployedAt   time.Time  `json:"deployedAt"`
	VerifiedAt   *time.Time `json:"verifiedAt,omitempty"`
}
