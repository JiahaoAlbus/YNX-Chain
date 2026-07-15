package finance

import "time"

const (
	ChainID = "ynx_6423-1"
	Product = "finance"
)

type Category struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Color     string    `json:"color"`
	CreatedAt time.Time `json:"createdAt"`
}

type Budget struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	CategoryID string    `json:"categoryId"`
	LimitYNXT  int64     `json:"limitYnxt"`
	Period     string    `json:"period"`
	StartsAt   time.Time `json:"startsAt"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type Reminder struct {
	ID         string    `json:"id"`
	Title      string    `json:"title"`
	AmountYNXT *int64    `json:"amountYnxt,omitempty"`
	Schedule   string    `json:"schedule"`
	NextDueAt  time.Time `json:"nextDueAt"`
	SourceRef  string    `json:"sourceRef,omitempty"`
	Enabled    bool      `json:"enabled"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type Privacy struct {
	IncludePayInStatements bool      `json:"includePayInStatements"`
	AllowAIActivityContext bool      `json:"allowAiActivityContext"`
	AlertsEnabled          bool      `json:"alertsEnabled"`
	UpdatedAt              time.Time `json:"updatedAt"`
}

type Classification struct {
	RecordID   string    `json:"recordId"`
	CategoryID string    `json:"categoryId"`
	Source     string    `json:"source"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type AuditEvent struct {
	ID        string         `json:"id"`
	Account   string         `json:"account"`
	Action    string         `json:"action"`
	ObjectID  string         `json:"objectId,omitempty"`
	Details   map[string]any `json:"details,omitempty"`
	CreatedAt time.Time      `json:"createdAt"`
}

type AIJob struct {
	ID             string         `json:"id"`
	Account        string         `json:"account"`
	Kind           string         `json:"kind"`
	RecordIDs      []string       `json:"recordIds"`
	ContextClasses []string       `json:"contextClasses"`
	Provider       string         `json:"provider"`
	Model          string         `json:"model"`
	EstimatedCost  string         `json:"estimatedCost"`
	Status         string         `json:"status"`
	Progress       string         `json:"progress,omitempty"`
	Result         map[string]any `json:"result,omitempty"`
	Error          string         `json:"error,omitempty"`
	Decision       string         `json:"decision,omitempty"`
	CreatedAt      time.Time      `json:"createdAt"`
	UpdatedAt      time.Time      `json:"updatedAt"`
}

type AccountState struct {
	Categories      []Category                `json:"categories"`
	Budgets         []Budget                  `json:"budgets"`
	Reminders       []Reminder                `json:"reminders"`
	Privacy         Privacy                   `json:"privacy"`
	Classifications map[string]Classification `json:"classifications"`
	AIJobs          []AIJob                   `json:"aiJobs"`
	Idempotency     map[string]string         `json:"idempotency,omitempty"`
}

type persistedState struct {
	Version  int                     `json:"version"`
	Accounts map[string]AccountState `json:"accounts"`
	Audit    []AuditEvent            `json:"audit"`
	Nonces   map[string]time.Time    `json:"usedWalletNonces"`
}

type Activity struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"`
	Direction string    `json:"direction"`
	From      string    `json:"from,omitempty"`
	To        string    `json:"to,omitempty"`
	Amount    int64     `json:"amountYnxt"`
	Fee       int64     `json:"feeYnxt"`
	Timestamp time.Time `json:"timestamp"`
	Block     uint64    `json:"blockNumber"`
	Category  string    `json:"categoryId,omitempty"`
	Source    string    `json:"source"`
}

type PayReceipt struct {
	ID              string    `json:"id"`
	Status          string    `json:"status"`
	Payer           string    `json:"payer,omitempty"`
	Merchant        string    `json:"merchant,omitempty"`
	AmountYNXT      int64     `json:"amountYnxt"`
	TransactionHash string    `json:"transactionHash,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	DisputeURL      string    `json:"disputeUrl,omitempty"`
	TruthfulStatus  string    `json:"truthfulStatus"`
}

type Portfolio struct {
	Account        string       `json:"account"`
	Network        string       `json:"network"`
	Symbol         string       `json:"symbol"`
	BalanceYNXT    int64        `json:"balanceYnxt"`
	StakedYNXT     int64        `json:"stakedYnxt"`
	Activity       []Activity   `json:"activity"`
	PayReceipts    []PayReceipt `json:"payReceipts"`
	ExplorerStatus SourceStatus `json:"explorerStatus"`
	PayStatus      SourceStatus `json:"payStatus"`
	ReadOnly       bool         `json:"readOnly"`
	AsOf           time.Time    `json:"asOf"`
}

type SourceStatus struct {
	Available bool   `json:"available"`
	Source    string `json:"source"`
	Coverage  string `json:"coverage,omitempty"`
	Error     string `json:"error,omitempty"`
}
