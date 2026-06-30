package chain

import "time"

type NetworkConfig struct {
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	ChainID     int64  `json:"chainId"`
	Currency    string `json:"currency"`
	IsPublicNet bool   `json:"isPublicNet"`
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
