package bftgateway

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

var implementedCapabilities = []string{
	"status",
	"block-by-height",
	"account-query",
	"validator-set",
	"evm-chain-id",
	"evm-block-number",
	"native-signed-transaction-http-broadcast",
	"transaction-lookup-and-history",
}

var missingCutoverCapabilities = []string{
	"evm-transaction-receipts-and-logs",
	"faucet-state-transition",
	"ai-permission-and-action-state-transitions",
	"pay-state-transitions",
	"trust-and-chain-law-state-transitions",
	"resource-market-state-transitions",
	"ide-contract-state-transitions",
}

var transactionHashPattern = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

type Config struct {
	CometRPCURL string
	HTTPClient  *http.Client
	Build       buildinfo.Info
}

type Gateway struct {
	client *client
	build  buildinfo.Info
	mux    *http.ServeMux
}

type client struct {
	baseURL    string
	httpClient *http.Client
}

type Health struct {
	OK                 bool           `json:"ok"`
	Service            string         `json:"service"`
	Mode               string         `json:"mode"`
	ChainID            int64          `json:"chainId"`
	NativeSymbol       string         `json:"nativeSymbol"`
	CometChainID       string         `json:"cometChainId"`
	Height             uint64         `json:"height"`
	ValidatorCount     int            `json:"validatorCount"`
	PublicCutoverReady bool           `json:"publicCutoverReady"`
	Implemented        []string       `json:"implementedCapabilities"`
	Missing            []string       `json:"missingCutoverCapabilities"`
	TruthfulStatus     string         `json:"truthfulStatus"`
	Build              buildinfo.Info `json:"build"`
	LastCheckedAt      time.Time      `json:"lastCheckedAt"`
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
	ConsensusEngine      string    `json:"consensusEngine"`
	CometChainID         string    `json:"cometChainId"`
	PublicCutoverReady   bool      `json:"publicCutoverReady"`
}

type cometStatus struct {
	Result struct {
		NodeInfo struct {
			Network string `json:"network"`
		} `json:"node_info"`
		SyncInfo struct {
			LatestBlockHash   string    `json:"latest_block_hash"`
			LatestBlockHeight string    `json:"latest_block_height"`
			LatestBlockTime   time.Time `json:"latest_block_time"`
			CatchingUp        bool      `json:"catching_up"`
		} `json:"sync_info"`
	} `json:"result"`
}

type cometValidators struct {
	Result struct {
		BlockHeight string `json:"block_height"`
		Validators  []struct {
			Address          string `json:"address"`
			VotingPower      string `json:"voting_power"`
			ProposerPriority string `json:"proposer_priority"`
			PubKey           struct {
				Type  string `json:"type"`
				Value string `json:"value"`
			} `json:"pub_key"`
		} `json:"validators"`
	} `json:"result"`
}

type cometBlock struct {
	Result struct {
		BlockID struct {
			Hash string `json:"hash"`
		} `json:"block_id"`
		Block struct {
			Header struct {
				Height      string    `json:"height"`
				Time        time.Time `json:"time"`
				Proposer    string    `json:"proposer_address"`
				LastBlockID struct {
					Hash string `json:"hash"`
				} `json:"last_block_id"`
			} `json:"header"`
			Data struct {
				Txs [][]byte `json:"txs"`
			} `json:"data"`
		} `json:"block"`
	} `json:"result"`
}

type cometABCIQuery struct {
	Result struct {
		Response struct {
			Code   uint32 `json:"code"`
			Log    string `json:"log"`
			Height string `json:"height"`
			Value  string `json:"value"`
		} `json:"response"`
	} `json:"result"`
}

type cometRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    string `json:"data"`
}

type cometTxResult struct {
	Code uint32 `json:"code"`
	Log  string `json:"log"`
}

type cometBroadcast struct {
	Result struct {
		CheckTx  cometTxResult `json:"check_tx"`
		TxResult cometTxResult `json:"tx_result"`
		Hash     string        `json:"hash"`
		Height   string        `json:"height"`
	} `json:"result"`
	Error *cometRPCError `json:"error,omitempty"`
}

type cometTx struct {
	Hash     string        `json:"hash"`
	Height   string        `json:"height"`
	Index    uint32        `json:"index"`
	TxResult cometTxResult `json:"tx_result"`
	Tx       []byte        `json:"tx"`
}

type cometTxLookup struct {
	Result cometTx        `json:"result"`
	Error  *cometRPCError `json:"error,omitempty"`
}

type cometTxSearch struct {
	Result struct {
		Txs        []cometTx `json:"txs"`
		TotalCount string    `json:"total_count"`
	} `json:"result"`
	Error *cometRPCError `json:"error,omitempty"`
}

type BroadcastResponse struct {
	Transaction    chain.Transaction `json:"transaction"`
	Committed      bool              `json:"committed"`
	Height         uint64            `json:"height"`
	CometHash      string            `json:"cometHash"`
	TruthfulStatus string            `json:"truthfulStatus"`
}

type TransactionList struct {
	Transactions   []chain.Transaction `json:"transactions"`
	Page           int                 `json:"page"`
	Limit          int                 `json:"limit"`
	Total          uint64              `json:"total"`
	NextPage       *int                `json:"nextPage"`
	TruthfulStatus string              `json:"truthfulStatus"`
}

func New(cfg Config) (*Gateway, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.CometRPCURL), "/")
	if baseURL == "" {
		return nil, errors.New("CometBFT RPC URL is required")
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 8 * time.Second}
	}
	g := &Gateway{
		client: &client{baseURL: baseURL, httpClient: cfg.HTTPClient},
		build:  buildinfo.Normalize(cfg.Build),
		mux:    http.NewServeMux(),
	}
	g.routes()
	return g, nil
}

func (g *Gateway) Handler() http.Handler { return g.mux }

func (g *Gateway) routes() {
	g.mux.HandleFunc("GET /health", g.handleHealth)
	g.mux.HandleFunc("GET /status", g.handleStatus)
	g.mux.HandleFunc("GET /blocks/{height}", g.handleBlock)
	g.mux.HandleFunc("POST /transactions/broadcast", g.handleBroadcastTransaction)
	g.mux.HandleFunc("GET /txs", g.handleTransactions)
	g.mux.HandleFunc("GET /txs/{hash}", g.handleTransaction)
	g.mux.HandleFunc("GET /accounts/{address}", g.handleAccount)
	g.mux.HandleFunc("GET /validators", g.handleValidators)
	g.mux.HandleFunc("GET /node/identity", g.handleNodeIdentity)
	g.mux.HandleFunc("POST /evm", g.handleEVM)
}

func (c *client) get(ctx context.Context, path string, query url.Values, out any) error {
	endpoint := c.baseURL + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("CometBFT %s returned HTTP %d", path, resp.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 4<<20))
	if err := decoder.Decode(out); err != nil {
		return fmt.Errorf("decode CometBFT %s: %w", path, err)
	}
	return nil
}

func (g *Gateway) status(ctx context.Context) (Status, error) {
	var upstream cometStatus
	if err := g.client.get(ctx, "/status", nil, &upstream); err != nil {
		return Status{}, err
	}
	if upstream.Result.NodeInfo.Network != "ynx_6423-1" {
		return Status{}, fmt.Errorf("unexpected CometBFT chain ID %q", upstream.Result.NodeInfo.Network)
	}
	height, err := strconv.ParseUint(upstream.Result.SyncInfo.LatestBlockHeight, 10, 64)
	if err != nil || height == 0 {
		return Status{}, fmt.Errorf("invalid CometBFT height %q", upstream.Result.SyncInfo.LatestBlockHeight)
	}
	validators, err := g.validators(ctx)
	if err != nil {
		return Status{}, err
	}
	return Status{
		Network:              "YNX Testnet",
		Slug:                 "testnet",
		ChainID:              6423,
		NativeCoinName:       "YNXT",
		NativeCurrencySymbol: "YNXT",
		Decimals:             18,
		PublicNetwork:        true,
		Height:               height,
		LatestBlockHash:      strings.ToLower(upstream.Result.SyncInfo.LatestBlockHash),
		LatestBlockTime:      upstream.Result.SyncInfo.LatestBlockTime,
		ValidatorCount:       len(validators.Result.Validators),
		PendingTxCount:       0,
		TruthfulStatus:       "cometbft-rpc-and-abci-backed",
		ConsensusEngine:      "cometbft",
		CometChainID:         upstream.Result.NodeInfo.Network,
		PublicCutoverReady:   false,
	}, nil
}

func (g *Gateway) validators(ctx context.Context) (cometValidators, error) {
	var upstream cometValidators
	query := url.Values{"page": {"1"}, "per_page": {"100"}}
	if err := g.client.get(ctx, "/validators", query, &upstream); err != nil {
		return cometValidators{}, err
	}
	if len(upstream.Result.Validators) != 4 {
		return cometValidators{}, fmt.Errorf("expected 4 CometBFT validators, got %d", len(upstream.Result.Validators))
	}
	return upstream, nil
}

func (g *Gateway) handleHealth(w http.ResponseWriter, r *http.Request) {
	status, err := g.status(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "service": "ynx-bft-gatewayd", "error": err.Error(), "publicCutoverReady": false})
		return
	}
	writeJSON(w, http.StatusOK, Health{
		OK:                 true,
		Service:            "ynx-bft-gatewayd",
		Mode:               "cometbft-backed",
		ChainID:            status.ChainID,
		NativeSymbol:       status.NativeCurrencySymbol,
		CometChainID:       status.CometChainID,
		Height:             status.Height,
		ValidatorCount:     status.ValidatorCount,
		PublicCutoverReady: false,
		Implemented:        implementedCapabilities,
		Missing:            missingCutoverCapabilities,
		TruthfulStatus:     status.TruthfulStatus,
		Build:              g.build,
		LastCheckedAt:      time.Now().UTC(),
	})
}

func (g *Gateway) handleStatus(w http.ResponseWriter, r *http.Request) {
	status, err := g.status(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (g *Gateway) handleBlock(w http.ResponseWriter, r *http.Request) {
	height, err := strconv.ParseUint(r.PathValue("height"), 10, 64)
	if err != nil || height == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "positive block height is required"})
		return
	}
	block, err := g.block(r.Context(), height)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, block)
}

func (g *Gateway) block(ctx context.Context, height uint64) (chain.Block, error) {
	var upstream cometBlock
	if err := g.client.get(ctx, "/block", url.Values{"height": {strconv.FormatUint(height, 10)}}, &upstream); err != nil {
		return chain.Block{}, err
	}
	parsedHeight, err := strconv.ParseUint(upstream.Result.Block.Header.Height, 10, 64)
	if err != nil || parsedHeight != height {
		return chain.Block{}, errors.New("CometBFT block height mismatch")
	}
	transactions := make([]chain.Transaction, 0, len(upstream.Result.Block.Data.Txs))
	for _, payload := range upstream.Result.Block.Data.Txs {
		tx, err := mappedTransaction(payload, parsedHeight, upstream.Result.BlockID.Hash, upstream.Result.Block.Header.Time)
		if err != nil {
			return chain.Block{}, errors.New("block contains an unsupported transaction envelope")
		}
		transactions = append(transactions, tx)
	}
	return chain.Block{
		Height:       parsedHeight,
		Hash:         strings.ToLower(upstream.Result.BlockID.Hash),
		ParentHash:   strings.ToLower(upstream.Result.Block.Header.LastBlockID.Hash),
		Time:         upstream.Result.Block.Header.Time,
		Validator:    strings.ToLower(upstream.Result.Block.Header.Proposer),
		Transactions: transactions,
	}, nil
}

func mappedTransaction(payload []byte, height uint64, blockHash string, blockTime time.Time) (chain.Transaction, error) {
	tx, err := consensus.DecodeSignedTransaction(payload)
	if err != nil {
		return chain.Transaction{}, err
	}
	if err := tx.Verify(6423); err != nil {
		return chain.Transaction{}, err
	}
	return chain.Transaction{
		Hash:      consensus.SignedTransactionHash(payload),
		Type:      tx.Type,
		From:      tx.From,
		To:        tx.To,
		Amount:    tx.Amount,
		Fee:       tx.Fee,
		Nonce:     tx.Nonce,
		BlockHash: strings.ToLower(blockHash),
		BlockNum:  height,
		Timestamp: blockTime,
	}, nil
}

func (g *Gateway) transactionAtHeight(ctx context.Context, hash string, height uint64) (chain.Transaction, error) {
	block, err := g.block(ctx, height)
	if err != nil {
		return chain.Transaction{}, err
	}
	for _, tx := range block.Transactions {
		if tx.Hash == hash {
			return tx, nil
		}
	}
	return chain.Transaction{}, errors.New("CometBFT transaction is not present in its reported block")
}

func (g *Gateway) handleBroadcastTransaction(w http.ResponseWriter, r *http.Request) {
	if mediaType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type application/json is required"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, consensus.MaxSignedTransactionSize)
	payload, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "signed transaction exceeds maximum size"})
		return
	}
	tx, err := consensus.DecodeSignedTransaction(payload)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := tx.Verify(6423); err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	hash := consensus.SignedTransactionHash(payload)
	var upstream cometBroadcast
	if err := g.client.get(r.Context(), "/broadcast_tx_commit", url.Values{"tx": {"0x" + fmt.Sprintf("%x", payload)}}, &upstream); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	if upstream.Error != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": cometError(upstream.Error)})
		return
	}
	if upstream.Result.CheckTx.Code != 0 || upstream.Result.TxResult.Code != 0 {
		message := strings.TrimSpace(upstream.Result.CheckTx.Log + " " + upstream.Result.TxResult.Log)
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "CometBFT rejected signed transaction: " + message})
		return
	}
	if !strings.EqualFold(strings.TrimPrefix(hash, "0x"), upstream.Result.Hash) {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "CometBFT transaction hash mismatch"})
		return
	}
	height, err := strconv.ParseUint(upstream.Result.Height, 10, 64)
	if err != nil || height == 0 {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "CometBFT returned an invalid transaction height"})
		return
	}
	mapped, err := g.transactionAtHeight(r.Context(), hash, height)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, BroadcastResponse{Transaction: mapped, Committed: true, Height: height, CometHash: strings.ToLower(upstream.Result.Hash), TruthfulStatus: "cometbft-broadcast-commit"})
}

func (g *Gateway) handleTransaction(w http.ResponseWriter, r *http.Request) {
	hash := strings.TrimSpace(r.PathValue("hash"))
	if !transactionHashPattern.MatchString(hash) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical lowercase transaction hash is required"})
		return
	}
	var upstream cometTxLookup
	if err := g.client.get(r.Context(), "/tx", url.Values{"hash": {hash}, "prove": {"true"}}, &upstream); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	if upstream.Error != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": cometError(upstream.Error)})
		return
	}
	mapped, err := g.mapCometTransaction(r.Context(), upstream.Result)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	if mapped.Hash != hash {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "CometBFT transaction lookup hash mismatch"})
		return
	}
	writeJSON(w, http.StatusOK, mapped)
}

func (g *Gateway) handleTransactions(w http.ResponseWriter, r *http.Request) {
	page, ok := boundedPositiveInt(r.URL.Query().Get("page"), 1, 100000)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "page must be between 1 and 100000"})
		return
	}
	limit, ok := boundedPositiveInt(r.URL.Query().Get("limit"), 25, 100)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "limit must be between 1 and 100"})
		return
	}
	var upstream cometTxSearch
	query := url.Values{"query": {"tx.height>0"}, "prove": {"true"}, "page": {strconv.Itoa(page)}, "per_page": {strconv.Itoa(limit)}, "order_by": {"desc"}}
	if err := g.client.get(r.Context(), "/tx_search", query, &upstream); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	if upstream.Error != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": cometError(upstream.Error)})
		return
	}
	total, err := strconv.ParseUint(upstream.Result.TotalCount, 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "CometBFT returned an invalid transaction total"})
		return
	}
	sort.SliceStable(upstream.Result.Txs, func(i, j int) bool {
		iHeight, _ := strconv.ParseUint(upstream.Result.Txs[i].Height, 10, 64)
		jHeight, _ := strconv.ParseUint(upstream.Result.Txs[j].Height, 10, 64)
		return iHeight > jHeight || (iHeight == jHeight && upstream.Result.Txs[i].Index > upstream.Result.Txs[j].Index)
	})
	transactions := make([]chain.Transaction, 0, len(upstream.Result.Txs))
	for _, upstreamTx := range upstream.Result.Txs {
		mapped, err := g.mapCometTransaction(r.Context(), upstreamTx)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		transactions = append(transactions, mapped)
	}
	var nextPage *int
	if uint64(page*limit) < total {
		next := page + 1
		nextPage = &next
	}
	writeJSON(w, http.StatusOK, TransactionList{Transactions: transactions, Page: page, Limit: limit, Total: total, NextPage: nextPage, TruthfulStatus: "cometbft-tx-search-backed"})
}

func (g *Gateway) mapCometTransaction(ctx context.Context, upstream cometTx) (chain.Transaction, error) {
	if upstream.TxResult.Code != 0 {
		return chain.Transaction{}, fmt.Errorf("CometBFT transaction result code %d is not committed success", upstream.TxResult.Code)
	}
	height, err := strconv.ParseUint(upstream.Height, 10, 64)
	if err != nil || height == 0 {
		return chain.Transaction{}, errors.New("CometBFT transaction has an invalid height")
	}
	hash := consensus.SignedTransactionHash(upstream.Tx)
	if !strings.EqualFold(strings.TrimPrefix(hash, "0x"), upstream.Hash) {
		return chain.Transaction{}, errors.New("CometBFT transaction payload hash mismatch")
	}
	return g.transactionAtHeight(ctx, hash, height)
}

func boundedPositiveInt(raw string, fallback, maximum int) (int, bool) {
	if raw == "" {
		return fallback, true
	}
	value, err := strconv.Atoi(raw)
	return value, err == nil && value > 0 && value <= maximum
}

func cometError(upstream *cometRPCError) string {
	message := strings.TrimSpace(upstream.Message + " " + upstream.Data)
	if message == "" {
		message = "unspecified CometBFT RPC error"
	}
	return message
}

func (g *Gateway) handleAccount(w http.ResponseWriter, r *http.Request) {
	address := strings.ToLower(strings.TrimSpace(r.PathValue("address")))
	if !consensus.IsNativeAddress(address) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical lowercase account address is required"})
		return
	}
	var upstream cometABCIQuery
	query := url.Values{"path": {fmt.Sprintf("\"/accounts/%s\"", address)}}
	if err := g.client.get(r.Context(), "/abci_query", query, &upstream); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	if upstream.Result.Response.Code != 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": upstream.Result.Response.Log})
		return
	}
	payload, err := base64.StdEncoding.DecodeString(upstream.Result.Response.Value)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "invalid ABCI account encoding"})
		return
	}
	var account chain.ConsensusAccount
	if err := json.Unmarshal(payload, &account); err != nil || account.Address != address {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "invalid ABCI account response"})
		return
	}
	writeJSON(w, http.StatusOK, account)
}

func (g *Gateway) handleValidators(w http.ResponseWriter, r *http.Request) {
	upstream, err := g.validators(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	validators := make([]map[string]any, 0, len(upstream.Result.Validators))
	for _, validator := range upstream.Result.Validators {
		power, err := strconv.ParseInt(validator.VotingPower, 10, 64)
		if err != nil || power <= 0 {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "invalid CometBFT validator voting power"})
			return
		}
		validators = append(validators, map[string]any{
			"address":       strings.ToLower(validator.Address),
			"votingPower":   power,
			"active":        true,
			"peerReady":     true,
			"peerStatus":    "cometbft-validator",
			"latestHeight":  upstream.Result.BlockHeight,
			"publicKeyType": validator.PubKey.Type,
			"publicKey":     validator.PubKey.Value,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"expectedValidatorCount": 4, "validators": validators, "truthfulStatus": "cometbft-rpc-backed"})
}

func (g *Gateway) handleNodeIdentity(w http.ResponseWriter, r *http.Request) {
	status, err := g.status(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"service":            "ynx-bft-gatewayd",
		"chainId":            status.ChainID,
		"cometChainId":       status.CometChainID,
		"consensusEngine":    status.ConsensusEngine,
		"validatorCount":     status.ValidatorCount,
		"publicCutoverReady": false,
		"build":              g.build,
		"truthfulStatus":     status.TruthfulStatus,
	})
}

type jsonRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

func (g *Gateway) handleEVM(w http.ResponseWriter, r *http.Request) {
	var request jsonRPCRequest
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || request.JSONRPC != "2.0" || len(bytes.TrimSpace(request.ID)) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"jsonrpc": "2.0", "id": nil, "error": map[string]any{"code": -32600, "message": "invalid JSON-RPC request"}})
		return
	}
	var result string
	switch request.Method {
	case "eth_chainId":
		result = "0x1917"
	case "eth_blockNumber":
		status, err := g.status(r.Context())
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]any{"jsonrpc": "2.0", "id": request.ID, "error": map[string]any{"code": -32000, "message": err.Error()}})
			return
		}
		result = fmt.Sprintf("0x%x", status.Height)
	default:
		writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": request.ID, "error": map[string]any{"code": -32601, "message": "method not yet backed by CometBFT application state"}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": result})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
