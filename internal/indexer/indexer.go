package indexer

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const syncCheckpointBlocks = 4096

type Config struct {
	RPCURL          string
	StorePath       string
	MaxBlocksPerRun uint64
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
	path            string
	walPath         string
	checkpointEvery int
	mu              sync.Mutex
	loaded          bool
	pendingBlocks   int
	db              Database
}

func NewStore(path string) *Store {
	return &Store{path: path, walPath: path + ".wal", checkpointEvery: 250}
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
	db, err := s.loadLocked()
	if err != nil {
		return Database{}, err
	}
	return cloneDatabase(db), nil
}

func (s *Store) Save(db Database) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked(cloneDatabase(db))
}

func (s *Store) UpsertBlock(sourceURL string, status Status, block chain.Block) (Database, error) {
	return s.UpsertBlocks(sourceURL, status, []chain.Block{block})
}

func (s *Store) UpsertBlocks(sourceURL string, status Status, blocks []chain.Block) (Database, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	db, err := s.loadLocked()
	if err != nil {
		return Database{}, err
	}
	next := cloneDatabase(db)
	applySourceStatus(&next, sourceURL, status)
	expectedParent := ""
	expectedHeight := uint64(0)
	requireContinuity := len(next.Blocks) > 0
	if requireContinuity {
		if next.LastIndexedHeight == ^uint64(0) {
			return Database{}, fmt.Errorf("stored index height is exhausted; indexer rebuild required")
		}
		expectedParent = next.LastBlockHash
		expectedHeight = next.LastIndexedHeight + 1
	}
	validatedTransactions := make(map[string]chain.Transaction, len(next.Transactions)+len(blocks))
	for hash, transaction := range next.Transactions {
		validatedTransactions[hash] = transaction
	}
	for position, block := range blocks {
		if block.Hash == "" {
			return Database{}, fmt.Errorf("indexer block %d has no hash", block.Height)
		}
		if requireContinuity {
			if block.Height != expectedHeight {
				return Database{}, fmt.Errorf("indexer block batch is discontinuous at height %d", block.Height)
			}
			if block.ParentHash != expectedParent {
				return Database{}, fmt.Errorf("indexer block batch parent mismatch at height %d", block.Height)
			}
		}
		if err := validateBlockTransactions(block, validatedTransactions); err != nil {
			return Database{}, err
		}
		for _, transaction := range block.Transactions {
			validatedTransactions[transaction.Hash] = transaction
		}
		if block.Height == ^uint64(0) && position+1 < len(blocks) {
			return Database{}, fmt.Errorf("indexer block height is exhausted")
		}
		expectedParent = block.Hash
		expectedHeight = block.Height + 1
		requireContinuity = true
	}
	for _, block := range blocks {
		indexedAt := time.Now().UTC()
		if err := s.appendWALLocked(walRecord{Version: 1, SourceURL: sourceURL, Status: status, Block: block, IndexedAt: indexedAt}); err != nil {
			return Database{}, err
		}
		storedBlock := cloneBlock(block)
		next.Blocks[strconv.FormatUint(storedBlock.Height, 10)] = storedBlock
		next.LastIndexedHeight = storedBlock.Height
		next.LastBlockHash = storedBlock.Hash
		next.LastSyncAt = indexedAt
		for _, tx := range storedBlock.Transactions {
			next.Transactions[tx.Hash] = cloneTransaction(tx)
		}
	}
	if len(blocks) == 0 {
		s.db = next
		s.loaded = true
		return cloneDatabase(next), nil
	}
	s.db = next
	s.loaded = true
	s.pendingBlocks += len(blocks)
	if s.pendingBlocks >= s.checkpointEvery {
		if err := s.saveLocked(next); err != nil {
			return Database{}, err
		}
		if err := os.Remove(s.walPath); err != nil && !os.IsNotExist(err) {
			return Database{}, err
		}
		if err := syncDirectory(filepath.Dir(s.walPath)); err != nil {
			return Database{}, err
		}
		s.pendingBlocks = 0
	}
	return cloneDatabase(next), nil
}

func (s *Store) RecordSourceStatus(sourceURL string, status Status) (Database, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	db, err := s.loadLocked()
	if err != nil {
		return Database{}, err
	}
	next := db
	applySourceStatus(&next, sourceURL, status)
	s.db = next
	s.loaded = true
	return cloneDatabase(next), nil
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
	if s.loaded {
		return s.db, nil
	}
	db := Database{Version: 2, Blocks: map[string]chain.Block{}, Transactions: map[string]chain.Transaction{}}
	if strings.TrimSpace(s.path) == "" {
		s.db = db
		s.loaded = true
		return db, nil
	}
	info, err := os.Lstat(s.path)
	if err == nil {
		if !info.Mode().IsRegular() {
			return Database{}, fmt.Errorf("indexer checkpoint must be a regular file")
		}
		if info.Mode().Perm()&0o077 != 0 {
			return Database{}, fmt.Errorf("indexer checkpoint permissions must be 0600")
		}
	} else if !os.IsNotExist(err) {
		return Database{}, err
	}
	payload, err := os.ReadFile(s.path)
	if err != nil && !os.IsNotExist(err) {
		return Database{}, err
	}
	if err == nil {
		decoder := json.NewDecoder(bytes.NewReader(payload))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&db); err != nil {
			return Database{}, fmt.Errorf("indexer checkpoint is invalid")
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			return Database{}, fmt.Errorf("indexer checkpoint is invalid")
		}
	}
	if db.Blocks == nil {
		db.Blocks = map[string]chain.Block{}
	}
	if db.Transactions == nil {
		db.Transactions = map[string]chain.Transaction{}
	}
	if err := validateDatabase(db); err != nil {
		return Database{}, err
	}
	pending, err := s.replayWALLocked(&db)
	if err != nil {
		return Database{}, err
	}
	s.db = db
	s.loaded = true
	s.pendingBlocks = pending
	return db, nil
}

func (s *Store) saveLocked(db Database) error {
	if err := validateDatabase(db); err != nil {
		return err
	}
	if strings.TrimSpace(s.path) == "" {
		s.db = db
		s.loaded = true
		return nil
	}
	payload, err := json.MarshalIndent(db, "", "  ")
	if err != nil {
		return err
	}
	if err := writeFileAtomic(s.path, payload); err != nil {
		return err
	}
	s.db = db
	s.loaded = true
	return nil
}

func writeFileAtomic(path string, payload []byte) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.Remove(tmp); err != nil && !os.IsNotExist(err) {
		return err
	}
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	cleanup := true
	defer func() {
		_ = file.Close()
		if cleanup {
			_ = os.Remove(tmp)
		}
	}()
	if err := file.Chmod(0o600); err != nil {
		return err
	}
	if _, err := file.Write(payload); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	cleanup = false
	return syncDirectory(directory)
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func cloneDatabase(db Database) Database {
	next := db
	next.Blocks = make(map[string]chain.Block, len(db.Blocks))
	for height, block := range db.Blocks {
		next.Blocks[height] = cloneBlock(block)
	}
	next.Transactions = make(map[string]chain.Transaction, len(db.Transactions))
	for hash, transaction := range db.Transactions {
		next.Transactions[hash] = cloneTransaction(transaction)
	}
	return next
}

func cloneBlock(block chain.Block) chain.Block {
	next := block
	if block.Transactions != nil {
		next.Transactions = make([]chain.Transaction, len(block.Transactions))
		for position, transaction := range block.Transactions {
			next.Transactions[position] = cloneTransaction(transaction)
		}
	}
	return next
}

func cloneTransaction(transaction chain.Transaction) chain.Transaction {
	next := transaction
	if transaction.LotFlows != nil {
		next.LotFlows = append([]chain.LotFlow(nil), transaction.LotFlows...)
	}
	if transaction.Logs != nil {
		next.Logs = make([]chain.EVMLog, len(transaction.Logs))
		for position, log := range transaction.Logs {
			next.Logs[position] = log
			if log.Topics != nil {
				next.Logs[position].Topics = append([]string(nil), log.Topics...)
			}
		}
	}
	return next
}

func validateDatabase(db Database) error {
	if db.Version != 2 {
		return fmt.Errorf("indexer checkpoint version %d is unsupported", db.Version)
	}
	if db.Blocks == nil || db.Transactions == nil {
		return fmt.Errorf("indexer checkpoint maps are missing")
	}
	heights := make([]uint64, 0, len(db.Blocks))
	for rawHeight, block := range db.Blocks {
		height, err := strconv.ParseUint(rawHeight, 10, 64)
		if err != nil || strconv.FormatUint(height, 10) != rawHeight || block.Height != height || block.Hash == "" {
			return fmt.Errorf("indexer checkpoint block key %q is invalid", rawHeight)
		}
		heights = append(heights, height)
	}
	sort.Slice(heights, func(a, b int) bool { return heights[a] < heights[b] })
	expectedTransactions := make(map[string]chain.Transaction, len(db.Transactions))
	var previous chain.Block
	for position, height := range heights {
		block := db.Blocks[strconv.FormatUint(height, 10)]
		if position > 0 {
			if height != previous.Height+1 || block.ParentHash != previous.Hash {
				return fmt.Errorf("indexer checkpoint chain is discontinuous at height %d", height)
			}
		}
		if err := validateBlockTransactions(block, expectedTransactions); err != nil {
			return fmt.Errorf("indexer checkpoint transaction index is invalid: %w", err)
		}
		for _, transaction := range block.Transactions {
			expectedTransactions[transaction.Hash] = transaction
		}
		previous = block
	}
	if len(heights) == 0 {
		if db.LastIndexedHeight != 0 || db.LastBlockHash != "" || len(db.Transactions) != 0 {
			return fmt.Errorf("indexer checkpoint empty-state metadata is inconsistent")
		}
		return nil
	}
	if db.LastIndexedHeight != previous.Height || db.LastBlockHash != previous.Hash {
		return fmt.Errorf("indexer checkpoint tip metadata is inconsistent")
	}
	if db.LastSourceHeight < db.LastIndexedHeight {
		return fmt.Errorf("indexer checkpoint source height is below indexed tip")
	}
	if db.ChainID != 6423 || db.NativeSymbol != "YNXT" {
		return fmt.Errorf("indexer checkpoint chain identity is invalid")
	}
	if db.SourceEarliestHash != "" {
		if block, ok := db.Blocks[strconv.FormatUint(db.SourceEarliestHeight, 10)]; ok && block.Hash != db.SourceEarliestHash {
			return fmt.Errorf("indexer checkpoint source earliest hash is inconsistent")
		}
	}
	if len(expectedTransactions) != len(db.Transactions) {
		return fmt.Errorf("indexer checkpoint transaction map is inconsistent")
	}
	for hash, expected := range expectedTransactions {
		stored, ok := db.Transactions[hash]
		if !ok || stored.Hash != hash || !reflect.DeepEqual(stored, expected) {
			return fmt.Errorf("indexer checkpoint transaction %s is inconsistent", hash)
		}
	}
	return nil
}

type walRecord struct {
	Version   int         `json:"version"`
	SourceURL string      `json:"sourceUrl"`
	Status    Status      `json:"status"`
	Block     chain.Block `json:"block"`
	IndexedAt time.Time   `json:"indexedAt"`
}

func (s *Store) appendWALLocked(record walRecord) error {
	if strings.TrimSpace(s.path) == "" {
		return nil
	}
	directory := filepath.Dir(s.walPath)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	created := false
	if info, err := os.Lstat(s.walPath); err == nil {
		if !info.Mode().IsRegular() {
			return fmt.Errorf("indexer WAL must be a regular file")
		}
		if info.Mode().Perm()&0o077 != 0 {
			return fmt.Errorf("indexer WAL permissions must be 0600")
		}
	} else if os.IsNotExist(err) {
		created = true
	} else {
		return err
	}
	payload, err := json.Marshal(record)
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	file, err := os.OpenFile(s.walPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return err
	}
	if _, err := file.Write(payload); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if created {
		return syncDirectory(directory)
	}
	return nil
}

func (s *Store) replayWALLocked(db *Database) (int, error) {
	linkInfo, err := os.Lstat(s.walPath)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if !linkInfo.Mode().IsRegular() {
		return 0, fmt.Errorf("indexer WAL must be a regular file")
	}
	file, err := os.Open(s.walPath)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return 0, err
	}
	if info.Mode().Perm()&0o077 != 0 {
		return 0, fmt.Errorf("indexer WAL permissions must be 0600")
	}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	pending := 0
	for scanner.Scan() {
		line := scanner.Bytes()
		decoder := json.NewDecoder(bytes.NewReader(line))
		decoder.DisallowUnknownFields()
		var record walRecord
		if err := decoder.Decode(&record); err != nil {
			return 0, fmt.Errorf("indexer WAL record is invalid")
		}
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			return 0, fmt.Errorf("indexer WAL record is invalid")
		}
		if record.Version != 1 || strings.TrimSpace(record.SourceURL) == "" || record.Block.Hash == "" || record.IndexedAt.IsZero() {
			return 0, fmt.Errorf("indexer WAL record schema is invalid")
		}
		key := strconv.FormatUint(record.Block.Height, 10)
		if existing, ok := db.Blocks[key]; ok {
			if !reflect.DeepEqual(existing, record.Block) {
				return 0, fmt.Errorf("indexer WAL conflicts with checkpoint at height %d", record.Block.Height)
			}
			applySourceStatus(db, record.SourceURL, record.Status)
			continue
		}
		if len(db.Blocks) > 0 {
			if record.Block.Height != db.LastIndexedHeight+1 || record.Block.ParentHash != db.LastBlockHash {
				return 0, fmt.Errorf("indexer WAL chain is discontinuous at height %d", record.Block.Height)
			}
		}
		if err := validateBlockTransactions(record.Block, db.Transactions); err != nil {
			return 0, err
		}
		applySourceStatus(db, record.SourceURL, record.Status)
		db.Blocks[key] = record.Block
		db.LastIndexedHeight = record.Block.Height
		db.LastBlockHash = record.Block.Hash
		db.LastSyncAt = record.IndexedAt
		for _, transaction := range record.Block.Transactions {
			db.Transactions[transaction.Hash] = transaction
		}
		pending++
	}
	if err := scanner.Err(); err != nil {
		return 0, err
	}
	if err := validateDatabase(*db); err != nil {
		return 0, err
	}
	return pending, nil
}

type Indexer struct {
	cfg      Config
	client   *Client
	store    *Store
	syncLock sync.Mutex
}

func New(cfg Config) (*Indexer, error) {
	if strings.TrimSpace(cfg.RPCURL) == "" {
		return nil, fmt.Errorf("indexer RPC URL is required")
	}
	if strings.TrimSpace(cfg.StorePath) == "" {
		return nil, fmt.Errorf("indexer store path is required")
	}
	if cfg.MaxBlocksPerRun == 0 {
		cfg.MaxBlocksPerRun = 250
	}
	if cfg.MaxBlocksPerRun > 10_000 {
		return nil, fmt.Errorf("indexer max blocks per run must not exceed 10000")
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
	i.syncLock.Lock()
	defer i.syncLock.Unlock()
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
	end := status.Height
	if remaining := end - start + 1; remaining > i.cfg.MaxBlocksPerRun {
		end = start + i.cfg.MaxBlocksPerRun - 1
	}
	expectedParent := ""
	if len(db.Blocks) > 0 {
		expectedParent = db.LastBlockHash
	}
	validatedTransactions := make(map[string]chain.Transaction, len(db.Transactions))
	for hash, transaction := range db.Transactions {
		validatedTransactions[hash] = transaction
	}
	blocks := make([]chain.Block, 0, end-start+1)
	for height := start; height <= end; height++ {
		block, err := i.client.Block(ctx, height)
		if err != nil {
			if result.NewBlocksThisRun > 0 {
				if checkpointErr := i.store.Save(db); checkpointErr != nil {
					return SyncResult{}, fmt.Errorf("fetch block %d: %v; persist verified index progress: %w", height, err, checkpointErr)
				}
			}
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
		if err := validateBlockTransactions(block, validatedTransactions); err != nil {
			return SyncResult{}, err
		}
		for _, transaction := range block.Transactions {
			validatedTransactions[transaction.Hash] = transaction
		}
		blocks = append(blocks, block)
		result.NewBlocksThisRun++
		expectedParent = block.Hash
		if result.NewBlocksThisRun%syncCheckpointBlocks == 0 {
			if err := i.store.Save(db); err != nil {
				return SyncResult{}, err
			}
		}
	}
	if result.NewBlocksThisRun%syncCheckpointBlocks != 0 {
		if err := i.store.Save(db); err != nil {
			return SyncResult{}, err
		}
	}
	db, err = i.store.UpsertBlocks(i.cfg.RPCURL, status, blocks)
	if err != nil {
		return SyncResult{}, err
	}
	result.LastIndexedHeight = db.LastIndexedHeight
	result.IndexedBlockCount = len(db.Blocks)
	result.IndexedTxCount = len(db.Transactions)
	return result, nil
}

func validateBlockTransactions(block chain.Block, indexed map[string]chain.Transaction) error {
	seen := make(map[string]struct{}, len(block.Transactions))
	for position, tx := range block.Transactions {
		if strings.TrimSpace(tx.Hash) == "" {
			return fmt.Errorf("source block %d contains transaction %d without a hash", block.Height, position)
		}
		if tx.BlockNum != block.Height {
			return fmt.Errorf("source transaction %s claims block %d but was returned in block %d", tx.Hash, tx.BlockNum, block.Height)
		}
		if tx.BlockHash != "" && tx.BlockHash != block.Hash {
			return fmt.Errorf("source transaction %s block hash does not match block %d", tx.Hash, block.Height)
		}
		if _, ok := seen[tx.Hash]; ok {
			return fmt.Errorf("source block %d contains duplicate transaction hash %s", block.Height, tx.Hash)
		}
		seen[tx.Hash] = struct{}{}
		if previous, ok := indexed[tx.Hash]; ok && (previous.BlockNum != block.Height || previous.BlockHash != tx.BlockHash) {
			return fmt.Errorf("source transaction hash %s conflicts with indexed block %d; indexer rebuild required", tx.Hash, previous.BlockNum)
		}
	}
	return nil
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
	// Keep allocation independent of the caller-controlled limit. The limit is
	// validated above, but a fixed cap also makes the memory bound explicit to
	// static analysis and future callers.
	blocks := make([]chain.Block, 0, 100)
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
