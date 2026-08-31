package explorer

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type Config struct {
	RPCURL              string
	IndexerURL          string
	PublicRPCURL        string
	PublicExplorerURL   string
	ResourceUpstreamKey string
}

type Service struct {
	cfg            Config
	rpcClient      *client
	indexerClient  *client
	accountReadSem chan struct{}
}

func New(cfg Config) (*Service, error) {
	if strings.TrimSpace(cfg.RPCURL) == "" {
		return nil, fmt.Errorf("explorer RPC URL is required")
	}
	if strings.TrimSpace(cfg.IndexerURL) == "" {
		return nil, fmt.Errorf("explorer indexer URL is required")
	}
	if cfg.PublicRPCURL == "" {
		cfg.PublicRPCURL = cfg.RPCURL
	}
	if cfg.PublicExplorerURL == "" {
		cfg.PublicExplorerURL = "http://127.0.0.1:6427"
	}
	return &Service{cfg: cfg, rpcClient: newClient(cfg.RPCURL), indexerClient: newClient(cfg.IndexerURL), accountReadSem: make(chan struct{}, 8)}, nil
}

type client struct {
	baseURL    string
	httpClient *http.Client
}

func newClient(baseURL string) *client {
	return &client{baseURL: strings.TrimRight(baseURL, "/"), httpClient: &http.Client{Timeout: 10 * time.Second}}
}

func (c *client) getJSON(ctx context.Context, path string, out any) error {
	return c.getJSONWithHeaders(ctx, path, nil, out)
}

func (c *client) getJSONWithHeaders(ctx context.Context, path string, headers map[string]string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	for key, value := range headers {
		if strings.TrimSpace(value) != "" {
			req.Header.Set(key, value)
		}
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("GET %s returned %d", path, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

type Status struct {
	Network              string    `json:"network"`
	Slug                 string    `json:"slug"`
	ChainID              int64     `json:"chainId"`
	NativeCoinName       string    `json:"nativeCoinName"`
	NativeCurrencySymbol string    `json:"nativeCurrencySymbol"`
	Decimals             int       `json:"decimals"`
	PublicNetwork        bool      `json:"publicNetwork"`
	Height               uint64    `json:"height"`
	LatestBlockHash      string    `json:"latestBlockHash"`
	LatestBlockTime      time.Time `json:"latestBlockTime"`
	ValidatorCount       int       `json:"validatorCount"`
	PendingTxCount       int       `json:"pendingTxCount"`
	TruthfulStatus       string    `json:"truthfulStatus"`
	ChainIDConflictCheck string    `json:"chainIdConflictCheck"`
}

type IndexerHealth struct {
	OK                bool   `json:"ok"`
	Service           string `json:"service"`
	Network           string `json:"network"`
	ChainID           int64  `json:"chainId"`
	NativeSymbol      string `json:"nativeSymbol"`
	LastIndexedHeight uint64 `json:"lastIndexedHeight"`
	LastSourceHeight  uint64 `json:"lastSourceHeight"`
	IndexedBlockCount int    `json:"indexedBlockCount"`
	IndexedTxCount    int    `json:"indexedTxCount"`
	LastError         string `json:"lastError"`
	SyncErrorCount    int64  `json:"syncErrorCount"`
	TruthfulStatus    string `json:"truthfulStatus"`
}

type Summary struct {
	OK                bool                `json:"ok"`
	Service           string              `json:"service"`
	Network           chain.NetworkConfig `json:"network"`
	RPCHeight         uint64              `json:"rpcHeight"`
	IndexedHeight     uint64              `json:"indexedHeight"`
	IndexedBlockCount int                 `json:"indexedBlockCount"`
	IndexedTxCount    int                 `json:"indexedTxCount"`
	SyncLagBlocks     uint64              `json:"syncLagBlocks"`
	LatestBlockHash   string              `json:"latestBlockHash"`
	LatestBlockTime   time.Time           `json:"latestBlockTime"`
	ValidatorCount    int                 `json:"validatorCount"`
	PendingTxCount    int                 `json:"pendingTxCount"`
	NativeSymbol      string              `json:"nativeSymbol"`
	IndexerOK         bool                `json:"indexerOk"`
	IndexerError      string              `json:"indexerError,omitempty"`
	Wallet            WalletConfig        `json:"wallet"`
	Build             buildinfo.Info      `json:"build"`
	StartedAt         time.Time           `json:"startedAt"`
	ResourceStatus    string              `json:"resourceStatus"`
	FeeStatus         string              `json:"feeStatus"`
	TruthfulStatus    string              `json:"truthfulStatus"`
	LastCheckedAt     time.Time           `json:"lastCheckedAt"`
}

type WalletConfig struct {
	ChainIDHex         string   `json:"chainIdHex"`
	ChainName          string   `json:"chainName"`
	NativeCurrencyName string   `json:"nativeCurrencyName"`
	NativeSymbol       string   `json:"nativeSymbol"`
	Decimals           int      `json:"decimals"`
	RPCURLs            []string `json:"rpcUrls"`
	BlockExplorerURLs  []string `json:"blockExplorerUrls"`
}

func (s *Service) Summary(ctx context.Context) (Summary, error) {
	status, err := s.Status(ctx)
	if err != nil {
		return Summary{}, err
	}
	health, err := s.IndexerHealth(ctx)
	if err != nil {
		return Summary{}, err
	}
	if status.ChainID != 6423 || health.ChainID != status.ChainID || health.Network != status.Network {
		return Summary{}, fmt.Errorf("chain identity mismatch: rpc=%s/%d indexer=%s/%d", status.Network, status.ChainID, health.Network, health.ChainID)
	}
	if health.Service != "ynx-indexerd" {
		return Summary{}, fmt.Errorf("indexer dependency identity mismatch: got %q", health.Service)
	}
	if status.NativeCurrencySymbol != "YNXT" || health.NativeSymbol != "YNXT" {
		return Summary{}, fmt.Errorf("native symbol mismatch: rpc=%s indexer=%s", status.NativeCurrencySymbol, health.NativeSymbol)
	}
	lag := uint64(0)
	if status.Height > health.LastIndexedHeight {
		lag = status.Height - health.LastIndexedHeight
	}
	network := chain.NetworkConfig{
		Name:                 status.Network,
		Slug:                 status.Slug,
		ChainID:              status.ChainID,
		NativeCoinName:       status.NativeCoinName,
		NativeCurrencySymbol: status.NativeCurrencySymbol,
		Decimals:             status.Decimals,
		IsPublicNet:          status.PublicNetwork,
		ChainIDConflictCheck: status.ChainIDConflictCheck,
	}
	return Summary{
		OK:                health.OK && health.LastError == "",
		Service:           "ynx-explorerd",
		Network:           network,
		RPCHeight:         status.Height,
		IndexedHeight:     health.LastIndexedHeight,
		IndexedBlockCount: health.IndexedBlockCount,
		IndexedTxCount:    health.IndexedTxCount,
		SyncLagBlocks:     lag,
		LatestBlockHash:   status.LatestBlockHash,
		LatestBlockTime:   status.LatestBlockTime,
		ValidatorCount:    status.ValidatorCount,
		PendingTxCount:    status.PendingTxCount,
		NativeSymbol:      status.NativeCurrencySymbol,
		IndexerOK:         health.OK,
		IndexerError:      health.LastError,
		Wallet: WalletConfig{
			ChainIDHex:         fmt.Sprintf("0x%x", status.ChainID),
			ChainName:          status.Network,
			NativeCurrencyName: status.NativeCoinName,
			NativeSymbol:       status.NativeCurrencySymbol,
			Decimals:           status.Decimals,
			RPCURLs:            []string{s.cfg.PublicRPCURL},
			BlockExplorerURLs:  []string{s.cfg.PublicExplorerURL},
		},
		ResourceStatus: "available-through-resource-endpoints",
		FeeStatus:      "available-per-transaction",
		TruthfulStatus: "rpc-and-indexer-backed",
		LastCheckedAt:  time.Now().UTC(),
	}, nil
}

func (s *Service) Status(ctx context.Context) (Status, error) {
	var status Status
	if err := s.rpcClient.getJSON(ctx, "/status", &status); err != nil {
		return Status{}, err
	}
	return status, nil
}

func (s *Service) IndexerHealth(ctx context.Context) (IndexerHealth, error) {
	var health IndexerHealth
	if err := s.indexerClient.getJSON(ctx, "/health", &health); err != nil {
		return IndexerHealth{}, err
	}
	return health, nil
}

func (s *Service) LatestBlocks(ctx context.Context, limit int) ([]chain.Block, error) {
	var out struct {
		Blocks []chain.Block `json:"blocks"`
	}
	if err := s.indexerClient.getJSON(ctx, "/blocks/latest?limit="+strconv.Itoa(limit), &out); err != nil {
		return nil, err
	}
	return out.Blocks, nil
}

func (s *Service) Block(ctx context.Context, height string) (chain.Block, error) {
	var block chain.Block
	if err := s.indexerClient.getJSON(ctx, "/blocks/"+url.PathEscape(height), &block); err != nil {
		return chain.Block{}, err
	}
	return block, nil
}

func (s *Service) Transactions(ctx context.Context, limit int) ([]chain.Transaction, error) {
	var out struct {
		Transactions []chain.Transaction `json:"transactions"`
	}
	if err := s.indexerClient.getJSON(ctx, "/txs?limit="+strconv.Itoa(limit), &out); err != nil {
		return nil, err
	}
	return out.Transactions, nil
}

func (s *Service) Transaction(ctx context.Context, hash string) (chain.Transaction, error) {
	var tx chain.Transaction
	if err := s.indexerClient.getJSON(ctx, "/txs/"+url.PathEscape(hash), &tx); err != nil {
		return chain.Transaction{}, err
	}
	return tx, nil
}

type AccountDetail struct {
	Account        chain.Account         `json:"account"`
	AddressFormats *AddressFormats       `json:"addressFormats,omitempty"`
	Resources      chain.ResourceBalance `json:"resources"`
	Trace          chain.TrustTrace      `json:"trace"`
	Activity       *AccountActivity      `json:"activity,omitempty"`
}

type AddressFormats struct {
	EVM string `json:"evmAddress"`
	YNX string `json:"ynxAddress"`
}

type IndexedAccountParticipant struct {
	Address          string `json:"address"`
	TransactionCount int    `json:"transactionCount"`
	InboundYNXT      int64  `json:"inboundYnxt"`
	OutboundYNXT     int64  `json:"outboundYnxt"`
	LatestBlock      uint64 `json:"latestBlock"`
}

type IndexedParticipants struct {
	Accounts       []IndexedAccountParticipant `json:"accounts"`
	Total          int                         `json:"total"`
	NextCursor     string                      `json:"nextCursor,omitempty"`
	TruthfulStatus string                      `json:"truthfulStatus"`
	Coverage       string                      `json:"coverage"`
	CheckedAt      time.Time                   `json:"checkedAt"`
}

type AccountActivity struct {
	Address               string              `json:"address"`
	Transactions          []chain.Transaction `json:"transactions"`
	NextCursor            string              `json:"nextCursor,omitempty"`
	LastIndexedHeight     uint64              `json:"lastIndexedHeight"`
	ContractActivityCount int                 `json:"contractActivityCount"`
	FundsFlow             FundsFlow           `json:"fundsFlow"`
	TruthfulStatus        string              `json:"truthfulStatus"`
	Coverage              string              `json:"coverage"`
	CheckedAt             time.Time           `json:"checkedAt"`
}

type FundsFlow struct {
	InboundYNXT  int64 `json:"inboundYnxt"`
	OutboundYNXT int64 `json:"outboundYnxt"`
}

type LeaderboardAccount struct {
	Address          string `json:"address"`
	Balance          int64  `json:"balance"`
	Staked           int64  `json:"staked"`
	Nonce            uint64 `json:"nonce"`
	TransactionCount int    `json:"transactionCount"`
}

type AccountLeaderboard struct {
	Accounts          []LeaderboardAccount `json:"accounts"`
	Total             int                  `json:"total"`
	CandidateCount    int                  `json:"candidateCount"`
	UnresolvedCount   int                  `json:"unresolvedCount"`
	LastIndexedHeight uint64               `json:"lastIndexedHeight"`
	Coverage          string               `json:"coverage"`
	CheckedAt         time.Time            `json:"checkedAt"`
	TruthfulStatus    string               `json:"truthfulStatus"`
	Degraded          bool                 `json:"degraded"`
	Failed            bool                 `json:"failed"`
}

func (s *Service) Account(ctx context.Context, address string) (AccountDetail, error) {
	address, err := normalizeExplorerAddress(address)
	if err != nil {
		return AccountDetail{}, err
	}
	var account AccountDetail
	if err := s.rpcClient.getJSON(ctx, "/accounts/"+url.PathEscape(address), &account); err != nil {
		return AccountDetail{}, err
	}
	if accountaddress.IsCanonical(account.Account.Address) {
		alias, err := accountaddress.Encode(account.Account.Address)
		if err != nil {
			return AccountDetail{}, err
		}
		account.AddressFormats = &AddressFormats{EVM: account.Account.Address, YNX: alias}
	}
	return account, nil
}

func (s *Service) IndexedParticipants(ctx context.Context, limit int, cursor string) (IndexedParticipants, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	path := "/accounts?limit=" + strconv.Itoa(limit)
	if strings.TrimSpace(cursor) != "" {
		path += "&cursor=" + url.QueryEscape(cursor)
	}
	var participants IndexedParticipants
	if err := s.indexerClient.getJSON(ctx, path, &participants); err != nil {
		return IndexedParticipants{}, err
	}
	if participants.TruthfulStatus != "observed-indexed-participants" {
		return IndexedParticipants{}, fmt.Errorf("unexpected indexed participant status %q", participants.TruthfulStatus)
	}
	return participants, nil
}

func (s *Service) AccountActivity(ctx context.Context, address string, limit int, cursor string) (AccountActivity, error) {
	address, err := normalizeExplorerAddress(address)
	if err != nil {
		return AccountActivity{}, err
	}
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	path := "/accounts/" + url.PathEscape(address) + "/activity?limit=" + strconv.Itoa(limit)
	if strings.TrimSpace(cursor) != "" {
		path += "&cursor=" + url.QueryEscape(cursor)
	}
	var activity AccountActivity
	if err := s.indexerClient.getJSON(ctx, path, &activity); err != nil {
		return AccountActivity{}, err
	}
	if activity.TruthfulStatus != "retained-indexed-account-activity" {
		return AccountActivity{}, fmt.Errorf("unexpected indexed account activity status %q", activity.TruthfulStatus)
	}
	health, err := s.IndexerHealth(ctx)
	if err != nil {
		return AccountActivity{}, err
	}
	activity.LastIndexedHeight = health.LastIndexedHeight
	flow := FundsFlow{}
	for _, tx := range activity.Transactions {
		if strings.EqualFold(address, tx.To) {
			flow.InboundYNXT += tx.Amount
		}
		if strings.EqualFold(address, tx.From) {
			flow.OutboundYNXT += tx.Amount + tx.Fee
		}
		if tx.Type == "contract" || len(tx.Logs) > 0 {
			activity.ContractActivityCount++
		}
	}
	activity.FundsFlow = flow
	return activity, nil
}

func (s *Service) AccountWithActivity(ctx context.Context, address string) (AccountDetail, error) {
	account, err := s.Account(ctx, address)
	if err != nil {
		return AccountDetail{}, err
	}
	activity, err := s.AccountActivity(ctx, account.Account.Address, 25, "")
	if err != nil {
		return AccountDetail{}, err
	}
	account.Activity = &activity
	return account, nil
}

func (s *Service) Leaderboard(ctx context.Context, limit int) (AccountLeaderboard, error) {
	if limit <= 0 || limit > 100 {
		limit = 10
	}
	participants, err := s.IndexedParticipants(ctx, 100, "")
	if err != nil {
		return AccountLeaderboard{}, err
	}
	health, err := s.IndexerHealth(ctx)
	if err != nil {
		return AccountLeaderboard{}, err
	}
	result := AccountLeaderboard{
		CandidateCount:    participants.Total,
		LastIndexedHeight: health.LastIndexedHeight,
		Coverage:          fmt.Sprintf("current live RPC balances for %d of %d participants observed in retained Indexer transactions; this is not a full-ledger census", len(participants.Accounts), participants.Total),
		CheckedAt:         time.Now().UTC(),
		TruthfulStatus:    "observed-indexed-participant-account-ranking",
	}
	lookupCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	type lookupResult struct {
		participant IndexedAccountParticipant
		account     AccountDetail
		err         error
	}
	jobs := make(chan IndexedAccountParticipant)
	results := make(chan lookupResult, len(participants.Accounts))
	workerCount := min(4, len(participants.Accounts))
	var workers sync.WaitGroup
	for range workerCount {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for participant := range jobs {
				select {
				case s.accountReadSem <- struct{}{}:
				case <-lookupCtx.Done():
					results <- lookupResult{participant: participant, err: lookupCtx.Err()}
					continue
				}
				account, accountErr := s.Account(lookupCtx, participant.Address)
				<-s.accountReadSem
				results <- lookupResult{participant: participant, account: account, err: accountErr}
			}
		}()
	}
	go func() {
		for _, participant := range participants.Accounts {
			select {
			case jobs <- participant:
			case <-lookupCtx.Done():
				results <- lookupResult{participant: participant, err: lookupCtx.Err()}
			}
		}
		close(jobs)
		workers.Wait()
		close(results)
	}()
	for lookup := range results {
		if lookup.err != nil {
			result.UnresolvedCount++
			continue
		}
		result.Accounts = append(result.Accounts, LeaderboardAccount{Address: lookup.account.Account.Address, Balance: lookup.account.Account.Balance, Staked: lookup.account.Account.Staked, Nonce: lookup.account.Account.Nonce, TransactionCount: lookup.participant.TransactionCount})
	}
	result.Degraded = result.UnresolvedCount > 0
	if len(result.Accounts) == 0 && participants.Total > 0 {
		result.Failed = true
		return result, nil
	}
	sort.Slice(result.Accounts, func(a, b int) bool {
		if result.Accounts[a].Balance == result.Accounts[b].Balance {
			return result.Accounts[a].Address < result.Accounts[b].Address
		}
		return result.Accounts[a].Balance > result.Accounts[b].Balance
	})
	if len(result.Accounts) > limit {
		result.Accounts = result.Accounts[:limit]
	}
	result.Total = len(result.Accounts)
	return result, nil
}

func (s *Service) Validators(ctx context.Context) (map[string]any, error) {
	var validators map[string]any
	if err := s.rpcClient.getJSON(ctx, "/validators", &validators); err != nil {
		return nil, err
	}
	return validators, nil
}

func (s *Service) Resources(ctx context.Context, address string) (chain.ResourceBalance, error) {
	address, err := normalizeExplorerAddress(address)
	if err != nil {
		return chain.ResourceBalance{}, err
	}
	var resources chain.ResourceBalance
	if err := s.rpcClient.getJSON(ctx, "/resources/"+url.PathEscape(address), &resources); err != nil {
		return chain.ResourceBalance{}, err
	}
	return resources, nil
}

func (s *Service) ResourceAnalytics(ctx context.Context) (map[string]any, error) {
	var analytics map[string]any
	headers := map[string]string{"X-YNX-Resource-Gateway-Upstream-Key": s.cfg.ResourceUpstreamKey}
	if err := s.rpcClient.getJSONWithHeaders(ctx, "/resource-market/analytics", headers, &analytics); err != nil {
		return nil, err
	}
	return analytics, nil
}

type TokenDetail struct {
	Symbol         string              `json:"symbol"`
	Name           string              `json:"name"`
	Type           string              `json:"type"`
	Decimals       int                 `json:"decimals"`
	Network        chain.NetworkConfig `json:"network"`
	Usage          []string            `json:"usage"`
	TruthfulStatus string              `json:"truthfulStatus"`
}

func (s *Service) Token(ctx context.Context, symbol string) (TokenDetail, error) {
	status, err := s.Status(ctx)
	if err != nil {
		return TokenDetail{}, err
	}
	if !strings.EqualFold(symbol, "YNXT") {
		return TokenDetail{}, fmt.Errorf("token %s is not indexed by this explorer", symbol)
	}
	return TokenDetail{
		Symbol:   "YNXT",
		Name:     status.NativeCoinName,
		Type:     "native-gas-resource-pay-trust-ai-token",
		Decimals: status.Decimals,
		Network: chain.NetworkConfig{
			Name:                 status.Network,
			Slug:                 status.Slug,
			ChainID:              status.ChainID,
			NativeCoinName:       status.NativeCoinName,
			NativeCurrencySymbol: status.NativeCurrencySymbol,
			Decimals:             status.Decimals,
			IsPublicNet:          status.PublicNetwork,
			ChainIDConflictCheck: status.ChainIDConflictCheck,
		},
		Usage: []string{
			"gas",
			"staking",
			"resource collateral",
			"resource rental settlement",
			"Pay settlement",
			"AI Credits base",
			"Trust Credits base",
		},
		TruthfulStatus: "native-token-from-rpc-status",
	}, nil
}

// Contract reads the canonical chain RPC contract record. The Explorer does
// not synthesize contract metadata from source files or transaction guesses.
func (s *Service) Contract(ctx context.Context, address string) (chain.ContractArtifact, error) {
	address, err := normalizeExplorerAddress(address)
	if err != nil {
		return chain.ContractArtifact{}, err
	}
	var contract chain.ContractArtifact
	if err := s.rpcClient.getJSON(ctx, "/contracts/"+url.PathEscape(address), &contract); err != nil {
		return chain.ContractArtifact{}, err
	}
	if strings.TrimSpace(contract.Address) == "" || !strings.EqualFold(contract.Address, address) {
		return chain.ContractArtifact{}, fmt.Errorf("contract RPC returned an invalid identity")
	}
	return contract, nil
}

type FeeDetail struct {
	Hash             string           `json:"hash"`
	Type             string           `json:"type"`
	FeeYNXT          int64            `json:"feeYnxt"`
	Payer            string           `json:"payer"`
	Sponsor          string           `json:"sponsor,omitempty"`
	SponsorPoolID    string           `json:"sponsorPoolId,omitempty"`
	ResourceSource   string           `json:"resourceSource"`
	ResourceType     string           `json:"resourceType,omitempty"`
	ResourceConsumed int64            `json:"resourceConsumed,omitempty"`
	ActionReference  string           `json:"actionReference,omitempty"`
	ResourceSignals  []chain.LotFlow  `json:"resourceSignals,omitempty"`
	Distribution     map[string]int64 `json:"distribution"`
	TruthfulStatus   string           `json:"truthfulStatus"`
}

func FeeDetailFromTx(tx chain.Transaction) FeeDetail {
	distribution := map[string]int64{"validator_or_protocol_fee": tx.Fee}
	resourceSource := tx.ResourceSource
	if resourceSource == "" {
		resourceSource = "direct-ynxt-fee-or-resource-endpoint"
	}
	return FeeDetail{
		Hash:             tx.Hash,
		Type:             tx.Type,
		FeeYNXT:          tx.Fee,
		Payer:            tx.From,
		Sponsor:          tx.Sponsor,
		SponsorPoolID:    tx.SponsorPoolID,
		ResourceSource:   resourceSource,
		ResourceType:     tx.ResourceType,
		ResourceConsumed: tx.ResourceConsumed,
		ActionReference:  tx.ActionReference,
		ResourceSignals:  tx.LotFlows,
		Distribution:     distribution,
		TruthfulStatus:   "derived-from-indexed-transaction",
	}
}

type SearchResult struct {
	Query             string `json:"query"`
	Type              string `json:"type"`
	Path              string `json:"path"`
	NormalizedAddress string `json:"normalizedAddress,omitempty"`
	TruthfulStatus    string `json:"truthfulStatus"`
}

func (s *Service) Search(ctx context.Context, query string) (SearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return SearchResult{}, fmt.Errorf("query is required")
	}
	if strings.EqualFold(query, "YNXT") {
		if _, err := s.Token(ctx, query); err != nil {
			return SearchResult{}, err
		}
		return SearchResult{Query: "YNXT", Type: "token", Path: "/api/tokens/YNXT", TruthfulStatus: "resolved-from-rpc-status"}, nil
	}
	if _, err := strconv.ParseUint(query, 10, 64); err == nil {
		if _, err := s.Block(ctx, query); err != nil {
			return SearchResult{}, err
		}
		return SearchResult{Query: query, Type: "block", Path: "/api/blocks/" + query, TruthfulStatus: "resolved-from-indexer"}, nil
	}
	if transactionHash, ok := normalizeCanonicalTransactionHash(query); ok {
		if _, err := s.Transaction(ctx, transactionHash); err == nil {
			return SearchResult{Query: transactionHash, Type: "transaction", Path: "/api/txs/" + transactionHash, TruthfulStatus: "resolved-from-indexer"}, nil
		}
	}
	normalized, err := normalizeExplorerAddress(query)
	if err != nil {
		return SearchResult{}, err
	}
	if contract, err := s.Contract(ctx, normalized); err == nil {
		return SearchResult{Query: query, Type: "contract", Path: "/api/contracts/" + url.PathEscape(contract.Address), NormalizedAddress: contract.Address, TruthfulStatus: "resolved-from-rpc-contract-record"}, nil
	}
	if _, err := s.Account(ctx, normalized); err == nil {
		return SearchResult{Query: query, Type: "account", Path: "/api/accounts/" + url.PathEscape(normalized), NormalizedAddress: normalized, TruthfulStatus: "resolved-from-rpc"}, nil
	}
	return SearchResult{}, fmt.Errorf("query not found")
}

func normalizeExplorerAddress(value string) (string, error) {
	value = strings.TrimSpace(value)
	lower := strings.ToLower(value)
	if strings.HasPrefix(lower, accountaddress.HRP+"1") || strings.HasPrefix(lower, "0x") {
		return accountaddress.Normalize(value)
	}
	return value, nil
}
