package indexer

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type Config struct {
	RPCURL    string
	StorePath string
}

type Client struct {
	baseURL    string
	httpClient *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), httpClient: &http.Client{Timeout: 10 * time.Second}}
}

func (c *Client) Status(ctx context.Context) (Status, error) {
	var status Status
	if err := c.getJSON(ctx, "/status", &status); err != nil {
		return Status{}, err
	}
	return status, nil
}

func (c *Client) Block(ctx context.Context, height uint64) (chain.Block, error) {
	var block chain.Block
	if err := c.getJSON(ctx, "/blocks/"+strconv.FormatUint(height, 10), &block); err != nil {
		return chain.Block{}, err
	}
	return block, nil
}

func (c *Client) getJSON(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
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
	EarliestBlockHeight  uint64    `json:"earliestBlockHeight"`
	EarliestBlockHash    string    `json:"earliestBlockHash"`
	EarliestBlockTime    time.Time `json:"earliestBlockTime"`
	ValidatorCount       int       `json:"validatorCount"`
	PendingTxCount       int       `json:"pendingTxCount"`
	TruthfulStatus       string    `json:"truthfulStatus"`
}

type Store struct {
	path string
	mu   sync.Mutex
}

func NewStore(path string) *Store {
	return &Store{path: path}
}

type Database struct {
	Version              int                          `json:"version"`
	SourceRPCURL         string                       `json:"sourceRpcUrl"`
	Network              string                       `json:"network"`
	ChainID              int64                        `json:"chainId"`
	NativeSymbol         string                       `json:"nativeSymbol"`
	LastIndexedHeight    uint64                       `json:"lastIndexedHeight"`
	LastSourceHeight     uint64                       `json:"lastSourceHeight"`
	SourceEarliestHeight uint64                       `json:"sourceEarliestHeight"`
	SourceEarliestHash   string                       `json:"sourceEarliestHash,omitempty"`
	SourceEarliestTime   time.Time                    `json:"sourceEarliestTime,omitempty"`
	LastBlockHash        string                       `json:"lastBlockHash"`
	LastSyncAt           time.Time                    `json:"lastSyncAt"`
	Blocks               map[string]chain.Block       `json:"blocks"`
	Transactions         map[string]chain.Transaction `json:"transactions"`
}

func (s *Store) Load() (Database, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

func (s *Store) Save(db Database) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked(db)
}

func (s *Store) UpsertBlock(sourceURL string, status Status, block chain.Block) (Database, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	db, err := s.loadLocked()
	if err != nil {
		return Database{}, err
	}
	if db.Blocks == nil {
		db.Blocks = map[string]chain.Block{}
	}
	if db.Transactions == nil {
		db.Transactions = map[string]chain.Transaction{}
	}
	applySourceStatus(&db, sourceURL, status)
	db.Blocks[strconv.FormatUint(block.Height, 10)] = block
	db.LastIndexedHeight = block.Height
	db.LastBlockHash = block.Hash
	db.LastSyncAt = time.Now().UTC()
	for _, tx := range block.Transactions {
		db.Transactions[tx.Hash] = tx
	}
	if err := s.saveLocked(db); err != nil {
		return Database{}, err
	}
	return db, nil
}

func (s *Store) RecordSourceStatus(sourceURL string, status Status) (Database, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	db, err := s.loadLocked()
	if err != nil {
		return Database{}, err
	}
	applySourceStatus(&db, sourceURL, status)
	if err := s.saveLocked(db); err != nil {
		return Database{}, err
	}
	return db, nil
}

func applySourceStatus(db *Database, sourceURL string, status Status) {
	db.Version = 2
	db.SourceRPCURL = sourceURL
	db.Network = status.Network
	db.ChainID = status.ChainID
	db.NativeSymbol = status.NativeCurrencySymbol
	db.LastSourceHeight = status.Height
	db.SourceEarliestHeight = status.EarliestBlockHeight
	db.SourceEarliestHash = status.EarliestBlockHash
	db.SourceEarliestTime = status.EarliestBlockTime
}

func (s *Store) loadLocked() (Database, error) {
	db := Database{Version: 2, Blocks: map[string]chain.Block{}, Transactions: map[string]chain.Transaction{}}
	if strings.TrimSpace(s.path) == "" {
		return db, nil
	}
	payload, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return db, nil
	}
	if err != nil {
		return Database{}, err
	}
	if err := json.Unmarshal(payload, &db); err != nil {
		return Database{}, err
	}
	if db.Blocks == nil {
		db.Blocks = map[string]chain.Block{}
	}
	if db.Transactions == nil {
		db.Transactions = map[string]chain.Transaction{}
	}
	return db, nil
}

func (s *Store) saveLocked(db Database) error {
	if strings.TrimSpace(s.path) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(db, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

type Indexer struct {
	cfg    Config
	client *Client
	store  *Store
}

func New(cfg Config) (*Indexer, error) {
	if strings.TrimSpace(cfg.RPCURL) == "" {
		return nil, fmt.Errorf("indexer RPC URL is required")
	}
	if strings.TrimSpace(cfg.StorePath) == "" {
		return nil, fmt.Errorf("indexer store path is required")
	}
	return &Indexer{cfg: cfg, client: NewClient(cfg.RPCURL), store: NewStore(cfg.StorePath)}, nil
}

func (i *Indexer) Store() *Store {
	return i.store
}

type SyncResult struct {
	SourceHeight         uint64 `json:"sourceHeight"`
	SourceEarliestHeight uint64 `json:"sourceEarliestHeight"`
	LastIndexedHeight    uint64 `json:"lastIndexedHeight"`
	IndexedBlockCount    int    `json:"indexedBlockCount"`
	IndexedTxCount       int    `json:"indexedTxCount"`
	NewBlocksThisRun     int    `json:"newBlocksThisRun"`
	ResumeFromHeight     uint64 `json:"resumeFromHeight"`
	NativeSymbol         string `json:"nativeSymbol"`
	TruthfulStatus       string `json:"truthfulStatus"`
}

func (i *Indexer) SyncOnce(ctx context.Context) (SyncResult, error) {
	status, err := i.client.Status(ctx)
	if err != nil {
		return SyncResult{}, err
	}
	if status.NativeCurrencySymbol != "YNXT" {
		return SyncResult{}, fmt.Errorf("source native symbol must be YNXT, got %s", status.NativeCurrencySymbol)
	}
	db, err := i.store.Load()
	if err != nil {
		return SyncResult{}, err
	}
	if status.EarliestBlockHeight > status.Height {
		return SyncResult{}, fmt.Errorf("source earliest retained height %d exceeds latest height %d", status.EarliestBlockHeight, status.Height)
	}
	if db.ChainID != 0 && db.ChainID != status.ChainID {
		return SyncResult{}, fmt.Errorf("source chain identity changed from %d to %d; indexer rebuild required", db.ChainID, status.ChainID)
	}
	start := status.EarliestBlockHeight
	if len(db.Blocks) > 0 {
		lastBlock, ok := db.Blocks[strconv.FormatUint(db.LastIndexedHeight, 10)]
		if !ok || lastBlock.Hash == "" || lastBlock.Hash != db.LastBlockHash {
			return SyncResult{}, fmt.Errorf("stored index tip is inconsistent; indexer rebuild required")
		}
		if db.LastIndexedHeight == ^uint64(0) {
			return SyncResult{}, fmt.Errorf("stored index height is exhausted; indexer rebuild required")
		}
		start = db.LastIndexedHeight + 1
	}
	if db.LastIndexedHeight > status.Height && len(db.Blocks) > 0 {
		return SyncResult{}, fmt.Errorf("source height %d is below indexed tip %d; indexer rebuild required", status.Height, db.LastIndexedHeight)
	}
	db, err = i.store.RecordSourceStatus(i.cfg.RPCURL, status)
	if err != nil {
		return SyncResult{}, err
	}
	if status.EarliestBlockHeight > 0 && start < status.EarliestBlockHeight {
		return SyncResult{}, fmt.Errorf("resume height %d is below source earliest retained height %d; indexer rebuild required", start, status.EarliestBlockHeight)
	}
	result := SyncResult{SourceHeight: status.Height, SourceEarliestHeight: status.EarliestBlockHeight, ResumeFromHeight: start, NativeSymbol: status.NativeCurrencySymbol, TruthfulStatus: "local-indexer"}
	if start > status.Height {
		result.LastIndexedHeight = db.LastIndexedHeight
		result.IndexedBlockCount = len(db.Blocks)
		result.IndexedTxCount = len(db.Transactions)
		return result, nil
	}
	expectedParent := ""
	if len(db.Blocks) > 0 {
		expectedParent = db.LastBlockHash
	}
	for height := start; height <= status.Height; height++ {
		block, err := i.client.Block(ctx, height)
		if err != nil {
			return SyncResult{}, err
		}
		if block.Height != height || block.Hash == "" {
			return SyncResult{}, fmt.Errorf("source returned invalid block for requested height %d", height)
		}
		if height == status.EarliestBlockHeight && status.EarliestBlockHash != "" && block.Hash != status.EarliestBlockHash {
			return SyncResult{}, fmt.Errorf("source earliest block hash mismatch at height %d; indexer rebuild required", height)
		}
		if height == status.Height && status.LatestBlockHash != "" && block.Hash != status.LatestBlockHash {
			return SyncResult{}, fmt.Errorf("source latest block hash mismatch at height %d; indexer rebuild required", height)
		}
		if expectedParent != "" && block.ParentHash != expectedParent {
			return SyncResult{}, fmt.Errorf("source chain divergence at height %d: parent %s does not match indexed hash %s; indexer rebuild required", height, block.ParentHash, expectedParent)
		}
		db, err = i.store.UpsertBlock(i.cfg.RPCURL, status, block)
		if err != nil {
			return SyncResult{}, err
		}
		result.NewBlocksThisRun++
		expectedParent = block.Hash
	}
	result.LastIndexedHeight = db.LastIndexedHeight
	result.IndexedBlockCount = len(db.Blocks)
	result.IndexedTxCount = len(db.Transactions)
	return result, nil
}

func LatestBlocks(db Database, limit int) []chain.Block {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	heights := make([]int, 0, len(db.Blocks))
	for raw := range db.Blocks {
		height, err := strconv.Atoi(raw)
		if err == nil {
			heights = append(heights, height)
		}
	}
	sort.Sort(sort.Reverse(sort.IntSlice(heights)))
	blocks := make([]chain.Block, 0, min(limit, len(heights)))
	for _, height := range heights {
		if len(blocks) >= limit {
			break
		}
		blocks = append(blocks, db.Blocks[strconv.Itoa(height)])
	}
	return blocks
}

func LatestTransactions(db Database, limit int) []chain.Transaction {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	txs := make([]chain.Transaction, 0, len(db.Transactions))
	for _, tx := range db.Transactions {
		txs = append(txs, tx)
	}
	sort.Slice(txs, func(a, b int) bool { return txs[a].Timestamp.After(txs[b].Timestamp) })
	if len(txs) > limit {
		txs = txs[:limit]
	}
	return txs
}
