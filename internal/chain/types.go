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
	Logs      []EVMLog  `json:"logs,omitempty"`
	Memo      string    `json:"memo,omitempty"`
}

type EVMLog struct {
	Address          string   `json:"address"`
	Topics           []string `json:"topics"`
	Data             string   `json:"data"`
	BlockHash        string   `json:"blockHash"`
	BlockNumber      uint64   `json:"blockNumber"`
	TransactionHash  string   `json:"transactionHash"`
	TransactionIndex uint64   `json:"transactionIndex"`
	LogIndex         uint64   `json:"logIndex"`
	Removed          bool     `json:"removed"`
}

type EVMLogFilter struct {
	FromBlock *uint64
	ToBlock   *uint64
	Addresses []string
	Topics    [][]string
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
	ID             string    `json:"id"`
	Merchant       string    `json:"merchant"`
	Amount         int64     `json:"amount"`
	Currency       string    `json:"currency"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"createdAt"`
	CallbackURL    string    `json:"callbackUrl,omitempty"`
	IdempotencyKey string    `json:"idempotencyKey,omitempty"`
}

type Invoice struct {
	ID             string    `json:"id"`
	IntentID       string    `json:"intentId"`
	Merchant       string    `json:"merchant"`
	Amount         int64     `json:"amount"`
	Currency       string    `json:"currency"`
	Status         string    `json:"status"`
	DueAt          time.Time `json:"dueAt"`
	CreatedAt      time.Time `json:"createdAt"`
	PaymentLink    string    `json:"paymentLink,omitempty"`
	IdempotencyKey string    `json:"idempotencyKey,omitempty"`
}

type RefundRecord struct {
	ID             string    `json:"id"`
	IntentID       string    `json:"intentId"`
	Amount         int64     `json:"amount"`
	Currency       string    `json:"currency"`
	Reason         string    `json:"reason,omitempty"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"createdAt"`
	IdempotencyKey string    `json:"idempotencyKey,omitempty"`
}

type WebhookSignature struct {
	EventID        string    `json:"eventId"`
	IntentID       string    `json:"intentId"`
	EventType      string    `json:"eventType"`
	Signature      string    `json:"signature"`
	PayloadHash    string    `json:"payloadHash"`
	SignedAt       time.Time `json:"signedAt"`
	Algorithm      string    `json:"algorithm"`
	IdempotencyKey string    `json:"idempotencyKey,omitempty"`
	ReplaySafe     bool      `json:"replaySafe"`
}

type PayEvent struct {
	ID             string    `json:"id"`
	Type           string    `json:"type"`
	IntentID       string    `json:"intentId,omitempty"`
	ObjectID       string    `json:"objectId,omitempty"`
	Merchant       string    `json:"merchant,omitempty"`
	Amount         int64     `json:"amount,omitempty"`
	Currency       string    `json:"currency,omitempty"`
	IdempotencyKey string    `json:"idempotencyKey,omitempty"`
	AuditHash      string    `json:"auditHash"`
	CreatedAt      time.Time `json:"createdAt"`
}

type RiskLabel struct {
	ID                               string     `json:"labelId"`
	Subject                          string     `json:"subject"`
	Address                          string     `json:"address"`
	Label                            string     `json:"label"`
	LabelType                        string     `json:"labelType"`
	Severity                         string     `json:"severity"`
	RiskWeightBps                    int64      `json:"riskWeightBps"`
	ConfidenceBps                    int64      `json:"confidenceBps"`
	Source                           string     `json:"source"`
	EvidenceHash                     string     `json:"evidenceHash"`
	CreatedAt                        time.Time  `json:"createdAt"`
	UpdatedAt                        time.Time  `json:"updatedAt"`
	ExpiresAt                        *time.Time `json:"expiresAt,omitempty"`
	ReviewRequired                   bool       `json:"reviewRequired"`
	AppealAvailable                  bool       `json:"appealAvailable"`
	DisputeStatus                    string     `json:"disputeStatus"`
	LegalStatusUnderYNXChainLaw      string     `json:"legalStatusUnderYnxChainLaw"`
	RejectedExternalRequestReference string     `json:"rejectedExternalRequestReference,omitempty"`
	AssetEffect                      string     `json:"assetEffect"`
}

type RiskLabelInput struct {
	Subject                          string `json:"subject"`
	Address                          string `json:"address"`
	Label                            string `json:"label"`
	LabelType                        string `json:"labelType"`
	Severity                         string `json:"severity"`
	RiskWeightBps                    int64  `json:"riskWeightBps"`
	ConfidenceBps                    int64  `json:"confidenceBps"`
	Source                           string `json:"source"`
	EvidenceHash                     string `json:"evidenceHash"`
	ExpiryHours                      int64  `json:"expiryHours"`
	ReviewRequired                   bool   `json:"reviewRequired"`
	AppealAvailable                  *bool  `json:"appealAvailable"`
	DisputeStatus                    string `json:"disputeStatus"`
	LegalStatusUnderYNXChainLaw      string `json:"legalStatusUnderYnxChainLaw"`
	RejectedExternalRequestReference string `json:"rejectedExternalRequestReference"`
	AssetEffect                      string `json:"assetEffect"`
}

type EvidencePacket struct {
	ID          string           `json:"id"`
	Subject     string           `json:"subject"`
	Trace       TrustTrace       `json:"trace"`
	Labels      []RiskLabel      `json:"riskLabels"`
	RiskSummary TrustRiskSummary `json:"riskSummary"`
	RelatedTxs  []Transaction    `json:"relatedTransactions"`
	JSONHash    string           `json:"jsonHash"`
	GeneratedAt time.Time        `json:"generatedAt"`
	ExportNotes []string         `json:"exportNotes"`
}

type TrustRiskSummary struct {
	Subject                   string    `json:"subject"`
	EffectiveRiskWeightBps    int64     `json:"effectiveRiskWeightBps"`
	HighestLabelRiskWeightBps int64     `json:"highestLabelRiskWeightBps"`
	HighestConfidenceBps      int64     `json:"highestConfidenceBps"`
	ActiveLabelCount          int       `json:"activeLabelCount"`
	ExpiredLabelCount         int       `json:"expiredLabelCount"`
	LowConfidenceLabelCount   int       `json:"lowConfidenceLabelCount"`
	CorrectionLabelCount      int       `json:"correctionLabelCount"`
	HasOpenReview             bool      `json:"hasOpenReview"`
	AppealPath                string    `json:"appealPath"`
	AssetEffect               string    `json:"assetEffect"`
	Conclusion                string    `json:"conclusion"`
	GeneratedAt               time.Time `json:"generatedAt"`
	ReviewerNotes             []string  `json:"reviewerNotes"`
	NonConclusiveLabelIDs     []string  `json:"nonConclusiveLabelIds,omitempty"`
	ExpiredLabelIDs           []string  `json:"expiredLabelIds,omitempty"`
	ActiveEvidenceHashes      []string  `json:"activeEvidenceHashes,omitempty"`
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

type RequestValidityRule struct {
	ID                 string                `json:"id"`
	Name               string                `json:"name"`
	Classification     RequestValidityStatus `json:"classification"`
	Description        string                `json:"description"`
	RequiresEvidence   bool                  `json:"requiresEvidence"`
	RequiresUserNotice bool                  `json:"requiresUserNotice"`
	Keywords           []string              `json:"keywords,omitempty"`
}

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
	RuleIDs             []string              `json:"ruleIds"`
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
	LabelID             string    `json:"labelId,omitempty"`
	Subject             string    `json:"subject"`
	Appellant           string    `json:"appellant"`
	Claimant            string    `json:"claimant"`
	Reason              string    `json:"reason"`
	Evidence            []string  `json:"evidence"`
	Status              string    `json:"status"`
	Reviewer            string    `json:"reviewer,omitempty"`
	Decision            string    `json:"decision,omitempty"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
	ResolutionReason    string    `json:"resolutionReason,omitempty"`
	TransparencyEntryID string    `json:"transparencyEntryId"`
}

type TrustAppealInput struct {
	RequestID string   `json:"requestId"`
	LabelID   string   `json:"labelId"`
	Subject   string   `json:"subject"`
	Appellant string   `json:"appellant"`
	Claimant  string   `json:"claimant"`
	Reason    string   `json:"reason"`
	Evidence  []string `json:"evidence"`
}

type TrustAppealDecisionInput struct {
	Reviewer         string `json:"reviewer"`
	Decision         string `json:"decision"`
	ResolutionReason string `json:"resolutionReason"`
}

type TrackingPolicyReview struct {
	ID                  string                `json:"id"`
	Requester           string                `json:"requester"`
	Subject             string                `json:"subject"`
	Purpose             string                `json:"purpose"`
	QueryType           string                `json:"queryType"`
	Scope               string                `json:"scope"`
	Description         string                `json:"description"`
	Evidence            []string              `json:"evidence"`
	Institutional       bool                  `json:"institutional"`
	Sensitive           bool                  `json:"sensitive"`
	MinimumNecessary    bool                  `json:"minimumNecessary"`
	Classification      RequestValidityStatus `json:"classification"`
	Status              string                `json:"status"`
	Reasons             []string              `json:"reasons"`
	RuleIDs             []string              `json:"ruleIds"`
	ConfidenceBps       int64                 `json:"confidenceBps"`
	LabelExpiresAt      *time.Time            `json:"labelExpiresAt,omitempty"`
	AppealPath          string                `json:"appealPath"`
	CreatedAt           time.Time             `json:"createdAt"`
	TransparencyEntryID string                `json:"transparencyEntryId"`
}

type TrackingPolicyReviewInput struct {
	Requester        string   `json:"requester"`
	Subject          string   `json:"subject"`
	Purpose          string   `json:"purpose"`
	QueryType        string   `json:"queryType"`
	Scope            string   `json:"scope"`
	Description      string   `json:"description"`
	Evidence         []string `json:"evidence"`
	Institutional    bool     `json:"institutional"`
	Sensitive        bool     `json:"sensitive"`
	MinimumNecessary bool     `json:"minimumNecessary"`
	ConfidenceBps    int64    `json:"confidenceBps"`
	ExpiryHours      int64    `json:"expiryHours"`
}

type AIPermissionGrant struct {
	ID        string    `json:"id"`
	SessionID string    `json:"sessionId"`
	Requester string    `json:"requester"`
	Scope     string    `json:"scope"`
	Purpose   string    `json:"purpose"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
	AuditHash string    `json:"auditHash"`
}

type AIPermissionInput struct {
	SessionID   string `json:"sessionId"`
	Requester   string `json:"requester"`
	Scope       string `json:"scope"`
	Purpose     string `json:"purpose"`
	ExpiryHours int64  `json:"expiryHours"`
}

type AIActionProposal struct {
	ID                  string     `json:"id"`
	SessionID           string     `json:"sessionId"`
	Requester           string     `json:"requester"`
	Scope               string     `json:"scope"`
	ActionType          string     `json:"actionType"`
	Description         string     `json:"description"`
	PermissionID        string     `json:"permissionId,omitempty"`
	Status              string     `json:"status"`
	Executable          bool       `json:"executable"`
	Sensitive           bool       `json:"sensitive"`
	RequiresApproval    bool       `json:"requiresApproval"`
	Reasons             []string   `json:"reasons"`
	CreatedAt           time.Time  `json:"createdAt"`
	ExpiresAt           time.Time  `json:"expiresAt"`
	ApprovedAt          *time.Time `json:"approvedAt,omitempty"`
	ApprovedBy          string     `json:"approvedBy,omitempty"`
	RejectedAt          *time.Time `json:"rejectedAt,omitempty"`
	RejectedBy          string     `json:"rejectedBy,omitempty"`
	AuditHash           string     `json:"auditHash"`
	TransparencyEntryID string     `json:"transparencyEntryId,omitempty"`
}

type AIActionProposalInput struct {
	SessionID   string `json:"sessionId"`
	Requester   string `json:"requester"`
	Scope       string `json:"scope"`
	ActionType  string `json:"actionType"`
	Description string `json:"description"`
	ExpiryHours int64  `json:"expiryHours"`
}

type AIActionApprovalInput struct {
	Approver     string `json:"approver"`
	PermissionID string `json:"permissionId"`
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
	Address                          string                    `json:"address"`
	Name                             string                    `json:"name"`
	Deployer                         string                    `json:"deployer"`
	SourceHash                       string                    `json:"sourceHash"`
	BytecodeHash                     string                    `json:"bytecodeHash"`
	DeployedBytecodeHash             string                    `json:"deployedBytecodeHash"`
	ArtifactHash                     string                    `json:"artifactHash"`
	ArtifactKind                     string                    `json:"artifactKind"`
	CompilerMode                     string                    `json:"compilerMode"`
	CompilerConfigHash               string                    `json:"compilerConfigHash"`
	Compiler                         ContractCompilerConfig    `json:"compiler"`
	CompilerArtifact                 *ContractCompilerArtifact `json:"compilerArtifact,omitempty"`
	CompilerExecutionStatus          string                    `json:"compilerExecutionStatus"`
	RuntimeMode                      string                    `json:"runtimeMode"`
	VerifierMode                     string                    `json:"verifierMode"`
	ReproducibleBuild                bool                      `json:"reproducibleBuild"`
	ReproducibilityStatus            string                    `json:"reproducibilityStatus"`
	DeployedBytecodeComparisonStatus string                    `json:"deployedBytecodeComparisonStatus"`
	ABI                              []ContractABIEntry        `json:"abi,omitempty"`
	Events                           []ContractEventABI        `json:"events,omitempty"`
	Functions                        []ContractFunctionABI     `json:"functions,omitempty"`
	Limitations                      []string                  `json:"limitations,omitempty"`
	Verified                         bool                      `json:"verified"`
	VerifierStatus                   string                    `json:"verifierStatus"`
	DeployedAt                       time.Time                 `json:"deployedAt"`
	VerifiedAt                       *time.Time                `json:"verifiedAt,omitempty"`
}

type ContractCompilerConfig struct {
	ID                        string   `json:"id"`
	Language                  string   `json:"language"`
	Version                   string   `json:"version"`
	Package                   string   `json:"package"`
	ConfigPath                string   `json:"configPath"`
	Source                    string   `json:"source"`
	PreferWasm                bool     `json:"preferWasm"`
	OptimizerEnabled          bool     `json:"optimizerEnabled"`
	OptimizerRuns             int      `json:"optimizerRuns"`
	Pinned                    bool     `json:"pinned"`
	ConfigHash                string   `json:"configHash"`
	ArtifactKind              string   `json:"artifactKind"`
	CompilerMode              string   `json:"compilerMode"`
	VerifierMode              string   `json:"verifierMode"`
	ProductionCompilerEnabled bool     `json:"productionCompilerEnabled"`
	ReproducibilityStatus     string   `json:"reproducibilityStatus"`
	Limitations               []string `json:"limitations,omitempty"`
}

type ContractCompilerArtifact struct {
	SourceName           string `json:"sourceName"`
	ContractName         string `json:"contractName"`
	BuildInfoID          string `json:"buildInfoId"`
	ArtifactPath         string `json:"artifactPath"`
	BytecodeHash         string `json:"bytecodeHash"`
	DeployedBytecodeHash string `json:"deployedBytecodeHash"`
	ABIHash              string `json:"abiHash"`
	CompilerExecuted     bool   `json:"compilerExecuted"`
	Status               string `json:"status"`
}

type ContractABIEntry struct {
	Type            string               `json:"type"`
	Name            string               `json:"name"`
	Signature       string               `json:"signature"`
	Topic           string               `json:"topic,omitempty"`
	Selector        string               `json:"selector,omitempty"`
	Inputs          []ContractEventInput `json:"inputs,omitempty"`
	Outputs         []string             `json:"outputs,omitempty"`
	StateMutability string               `json:"stateMutability,omitempty"`
}

type ContractEventABI struct {
	Name      string               `json:"name"`
	Signature string               `json:"signature"`
	Topic     string               `json:"topic"`
	Inputs    []ContractEventInput `json:"inputs"`
	Source    string               `json:"source"`
}

type ContractEventInput struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Indexed bool   `json:"indexed"`
}

type ContractFunctionABI struct {
	Name            string               `json:"name"`
	Signature       string               `json:"signature"`
	Selector        string               `json:"selector"`
	Inputs          []ContractEventInput `json:"inputs,omitempty"`
	Outputs         []string             `json:"outputs,omitempty"`
	StateMutability string               `json:"stateMutability"`
	ReturnValue     string               `json:"returnValue,omitempty"`
}

type ContractCallResult struct {
	Address       string   `json:"address"`
	Function      string   `json:"function"`
	Signature     string   `json:"signature"`
	Selector      string   `json:"selector"`
	ReturnValue   string   `json:"returnValue"`
	EncodedResult string   `json:"encodedResult"`
	RuntimeMode   string   `json:"runtimeMode"`
	Limitations   []string `json:"limitations,omitempty"`
}
