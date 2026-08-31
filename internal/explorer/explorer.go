package explorer

import (
	"context"
	"encoding/json"
	"errors"
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
	cfg           Config
	rpcClient     *client
	indexerClient *client

	leaderboardMu       sync.Mutex
	leaderboardCache    AccountLeaderboard
	leaderboardCacheAt  time.Time
	leaderboardCacheCap int
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
	return &Service{cfg: cfg, rpcClient: newClient(cfg.RPCURL), indexerClient: newClient(cfg.IndexerURL)}, nil
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
	page, err := s.LatestBlocksPage(ctx, limit, 0)
	if err != nil {
		return nil, err
	}
	return page.Blocks, nil
}

type BlockPage struct {
	Blocks  []chain.Block `json:"blocks"`
	Total   int           `json:"total"`
	Limit   int           `json:"limit"`
	Offset  int           `json:"offset"`
	HasMore bool          `json:"hasMore"`
}

func (s *Service) LatestBlocksPage(ctx context.Context, limit, offset int) (BlockPage, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	if offset < 0 {
		offset = 0
	}
	var page BlockPage
	path := "/blocks/latest?limit=" + strconv.Itoa(limit) + "&offset=" + strconv.Itoa(offset)
	if err := s.indexerClient.getJSON(ctx, path, &page); err != nil {
		return BlockPage{}, err
	}
	return page, nil
}

func (s *Service) Block(ctx context.Context, height string) (chain.Block, error) {
	var block chain.Block
	if err := s.indexerClient.getJSON(ctx, "/blocks/"+url.PathEscape(height), &block); err != nil {
		return chain.Block{}, err
	}
	return block, nil
}

func (s *Service) Transactions(ctx context.Context, limit int) ([]chain.Transaction, error) {
	page, err := s.TransactionsPage(ctx, limit, 0)
	if err != nil {
		return nil, err
	}
	return page.Transactions, nil
}

type TransactionPage struct {
	Transactions []chain.Transaction `json:"transactions"`
	Total        int                 `json:"total"`
	Limit        int                 `json:"limit"`
	Offset       int                 `json:"offset"`
	HasMore      bool                `json:"hasMore"`
}

func (s *Service) TransactionsPage(ctx context.Context, limit, offset int) (TransactionPage, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	if offset < 0 {
		offset = 0
	}
	var page TransactionPage
	path := "/txs?limit=" + strconv.Itoa(limit) + "&offset=" + strconv.Itoa(offset)
	if err := s.indexerClient.getJSON(ctx, path, &page); err != nil {
		return TransactionPage{}, err
	}
	return page, nil
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
}

type AccountLeaderboard struct {
	Accounts       []chain.Account `json:"accounts"`
	Total          int             `json:"total"`
	Ranking        string          `json:"ranking"`
	TruthfulStatus string          `json:"truthfulStatus"`
}

func (s *Service) AccountLeaderboard(ctx context.Context, limit int) (AccountLeaderboard, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	s.leaderboardMu.Lock()
	defer s.leaderboardMu.Unlock()
	if !s.leaderboardCacheAt.IsZero() && time.Since(s.leaderboardCacheAt) < 15*time.Second && limit <= s.leaderboardCacheCap {
		return leaderboardPage(s.leaderboardCache, limit), nil
	}
	var leaderboard AccountLeaderboard
	if err := s.rpcClient.getJSON(ctx, "/accounts?limit="+strconv.Itoa(limit), &leaderboard); err == nil {
		if leaderboard.Ranking != "liquid-ynxt-balance-descending" || leaderboard.TruthfulStatus != "authoritative-public-ledger-account-ranking" {
			return AccountLeaderboard{}, errors.New("RPC returned an unverifiable account ranking")
		}
		s.cacheLeaderboard(leaderboard, limit)
		return leaderboardPage(leaderboard, limit), nil
	}

	transactions, err := s.Transactions(ctx, 500)
	if err != nil {
		return AccountLeaderboard{}, fmt.Errorf("load indexed participants for leaderboard fallback: %w", err)
	}
	addressSet := make(map[string]struct{})
	for _, tx := range transactions {
		for _, address := range []string{tx.From, tx.To, tx.Sponsor} {
			address = strings.TrimSpace(address)
			if address != "" {
				addressSet[address] = struct{}{}
			}
		}
	}
	addresses := make([]string, 0, len(addressSet))
	for address := range addressSet {
		addresses = append(addresses, address)
	}
	sort.Strings(addresses)

	accounts := make([]chain.Account, 0, len(addresses))
	var accountsMu sync.Mutex
	var workers sync.WaitGroup
	workerSlots := make(chan struct{}, 8)
	for _, address := range addresses {
		address := address
		workers.Add(1)
		go func() {
			defer workers.Done()
			select {
			case workerSlots <- struct{}{}:
				defer func() { <-workerSlots }()
			case <-ctx.Done():
				return
			}
			var detail AccountDetail
			if err := s.rpcClient.getJSON(ctx, "/accounts/"+url.PathEscape(address), &detail); err != nil || strings.TrimSpace(detail.Account.Address) == "" {
				return
			}
			accountsMu.Lock()
			accounts = append(accounts, detail.Account)
			accountsMu.Unlock()
		}()
	}
	workers.Wait()
	if err := ctx.Err(); err != nil {
		return AccountLeaderboard{}, err
	}
	sort.Slice(accounts, func(i, j int) bool {
		if accounts[i].Balance == accounts[j].Balance {
			return accounts[i].Address < accounts[j].Address
		}
		return accounts[i].Balance > accounts[j].Balance
	})
	total := len(accounts)
	if len(accounts) > limit {
		accounts = accounts[:limit]
	}
	leaderboard = AccountLeaderboard{
		Accounts:       accounts,
		Total:          total,
		Ranking:        "indexed-participant-liquid-ynxt-balance-descending",
		TruthfulStatus: "observed-indexed-participant-account-ranking",
	}
	s.cacheLeaderboard(leaderboard, limit)
	return leaderboardPage(leaderboard, limit), nil
}

func (s *Service) cacheLeaderboard(leaderboard AccountLeaderboard, limit int) {
	s.leaderboardCache = leaderboardPage(leaderboard, len(leaderboard.Accounts))
	s.leaderboardCacheAt = time.Now()
	s.leaderboardCacheCap = limit
}

func leaderboardPage(leaderboard AccountLeaderboard, limit int) AccountLeaderboard {
	page := leaderboard
	if limit < 0 {
		limit = 0
	}
	if limit > len(leaderboard.Accounts) {
		limit = len(leaderboard.Accounts)
	}
	page.Accounts = append([]chain.Account(nil), leaderboard.Accounts[:limit]...)
	return page
}

type AddressFormats struct {
	EVM string `json:"evmAddress"`
	YNX string `json:"ynxAddress"`
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
		if _, err := s.Token(ctx, "YNXT"); err != nil {
			return SearchResult{}, err
		}
		return SearchResult{Query: "YNXT", Type: "token", Path: "/api/tokens/YNXT", TruthfulStatus: "native-token-from-rpc-status"}, nil
	}
	if _, err := strconv.ParseUint(query, 10, 64); err == nil {
		if _, err := s.Block(ctx, query); err != nil {
			return SearchResult{}, err
		}
		return SearchResult{Query: query, Type: "block", Path: "/api/blocks/" + query, TruthfulStatus: "resolved-from-indexer"}, nil
	}
	if strings.HasPrefix(query, "0x") {
		if _, err := s.Transaction(ctx, query); err == nil {
			return SearchResult{Query: query, Type: "transaction", Path: "/api/txs/" + query, TruthfulStatus: "resolved-from-indexer"}, nil
		}
	}
	validators, err := s.Validators(ctx)
	if err == nil {
		encoded, _ := json.Marshal(validators)
		var payload struct {
			Validators []struct {
				Address string `json:"address"`
				Moniker string `json:"moniker"`
			} `json:"validators"`
		}
		if json.Unmarshal(encoded, &payload) == nil {
			for _, validator := range payload.Validators {
				if strings.EqualFold(query, validator.Address) || strings.EqualFold(query, validator.Moniker) {
					return SearchResult{Query: query, Type: "validator", Path: "/api/validators", TruthfulStatus: "resolved-from-rpc-validator-set"}, nil
				}
			}
		}
	}
	normalized, err := normalizeExplorerAddress(query)
	if err != nil {
		return SearchResult{}, err
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
