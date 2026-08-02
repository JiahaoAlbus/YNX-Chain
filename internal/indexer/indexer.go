package indexer

import (
	"bufio"
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

const defaultMaxReorgDepth uint64 = 128

type Config struct {
	RPCURL          string
	StorePath       string
	MaxReorgDepth   uint64
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
	path           string
	journalPath    string
	mu             sync.RWMutex
	loaded         bool
	db             Database
	journalRecords uint64
}

func NewStore(path string) *Store {
	return &Store{path: path, journalPath: path + ".journal"}
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
	JournalSequence      uint64                       `json:"journalSequence,omitempty"`
	Blocks               map[string]chain.Block       `json:"blocks"`
	Transactions         map[string]chain.Transaction `json:"transactions"`
}

func (s *Store) Load() (Database, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoadedLocked(); err != nil {
		return Database{}, err
	}
	return s.db, nil
}

func (s *Store) View(fn func(Database) error) error {
	s.mu.RLock()
	if s.loaded {
		defer s.mu.RUnlock()
		return fn(s.db)
	}
	s.mu.RUnlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoadedLocked(); err != nil {
		return err
	}
	return fn(s.db)
}

// TryView serves lock-independent readiness checks without queueing behind the
// initial checkpoint load or a long snapshot compaction. A false return means
// the store is warming or momentarily busy; callers must not present it as
// healthy.
func (s *Store) TryView(fn func(Database) error) (bool, error) {
	if !s.mu.TryRLock() {
		return false, nil
	}
	defer s.mu.RUnlock()
	if !s.loaded {
		return false, nil
	}
	return true, fn(s.db)
}

func (s *Store) Save(db Database) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	normalizeDatabase(&db)
	if s.loaded && db.JournalSequence < s.db.JournalSequence {
		db.JournalSequence = s.db.JournalSequence
	}
	if err := s.saveSnapshotLocked(db); err != nil {
		return err
	}
	s.db = db
	s.loaded = true
	return s.resetJournalLocked()
}

func (s *Store) UpsertBlock(sourceURL string, status Status, block chain.Block) (Database, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoadedLocked(); err != nil {
		return Database{}, err
	}
	recordedAt := time.Now().UTC()
	record := storeJournalRecord{
		Version:    storeJournalVersion,
		Sequence:   s.db.JournalSequence + 1,
		Operation:  "upsert-block",
		SourceURL:  sourceURL,
		Status:     &status,
		Block:      &block,
		RecordedAt: recordedAt,
	}
	if err := s.appendJournalLocked(record); err != nil {
		return Database{}, err
	}
	applyUpsertRecord(&s.db, record)
	if err := s.compactJournalIfNeededLocked(); err != nil {
		return Database{}, err
	}
	return s.db, nil
}

func (s *Store) RollbackTo(height uint64) (Database, int, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoadedLocked(); err != nil {
		return Database{}, 0, 0, err
	}
	ancestor, ok := s.db.Blocks[strconv.FormatUint(height, 10)]
	if !ok || ancestor.Hash == "" {
		return Database{}, 0, 0, fmt.Errorf("stored common ancestor at height %d is unavailable; indexer rebuild required", height)
	}
	removedBlocks := 0
	for rawHeight := range s.db.Blocks {
		blockHeight, err := strconv.ParseUint(rawHeight, 10, 64)
		if err != nil {
			return Database{}, 0, 0, fmt.Errorf("stored block height %q is invalid; indexer rebuild required", rawHeight)
		}
		if blockHeight > height {
			delete(s.db.Blocks, rawHeight)
			removedBlocks++
		}
	}
	previousTxCount := len(s.db.Transactions)
	s.db.Transactions = make(map[string]chain.Transaction)
	for _, block := range s.db.Blocks {
		for _, tx := range block.Transactions {
			s.db.Transactions[tx.Hash] = tx
		}
	}
	removedTransactions := previousTxCount - len(s.db.Transactions)
	if removedTransactions < 0 {
		removedTransactions = 0
	}
	s.db.LastIndexedHeight = height
	s.db.LastBlockHash = ancestor.Hash
	s.db.LastSyncAt = time.Now().UTC()
	s.db.JournalSequence++
	if err := s.saveSnapshotLocked(s.db); err != nil {
		return Database{}, 0, 0, err
	}
	if err := s.resetJournalLocked(); err != nil {
		return Database{}, 0, 0, err
	}
	return s.db, removedBlocks, removedTransactions, nil
}

func (s *Store) RecordSourceStatus(sourceURL string, status Status) (Database, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoadedLocked(); err != nil {
		return Database{}, err
	}
	applySourceStatus(&s.db, sourceURL, status)
	return s.db, nil
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

const (
	storeJournalVersion       = 1
	storeJournalCompactBytes  = 64 << 20
	storeJournalCompactEvents = 100_000
)

type storeJournalRecord struct {
	Version    int          `json:"version"`
	Sequence   uint64       `json:"sequence"`
	Operation  string       `json:"operation"`
	SourceURL  string       `json:"sourceUrl"`
	Status     *Status      `json:"status,omitempty"`
	Block      *chain.Block `json:"block,omitempty"`
	RecordedAt time.Time    `json:"recordedAt"`
}

func (s *Store) ensureLoadedLocked() error {
	if s.loaded {
		return nil
	}
	db, err := s.loadSnapshotLocked()
	if err != nil {
		return err
	}
	records, err := s.replayJournalLocked(&db)
	if err != nil {
		return err
	}
	s.db = db
	s.loaded = true
	s.journalRecords = records
	return nil
}

func (s *Store) loadSnapshotLocked() (Database, error) {
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
	normalizeDatabase(&db)
	return db, nil
}

func normalizeDatabase(db *Database) {
	if db.Version == 0 {
		db.Version = 2
	}
	if db.Blocks == nil {
		db.Blocks = map[string]chain.Block{}
	}
	if db.Transactions == nil {
		db.Transactions = map[string]chain.Transaction{}
	}
}

func (s *Store) saveSnapshotLocked(db Database) error {
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

func (s *Store) appendJournalLocked(record storeJournalRecord) error {
	if strings.TrimSpace(s.path) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	payload, err := json.Marshal(record)
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	journal, err := os.OpenFile(s.journalPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	n, writeErr := journal.Write(payload)
	if writeErr == nil && n != len(payload) {
		writeErr = fmt.Errorf("short index journal write: wrote %d of %d bytes", n, len(payload))
	}
	if writeErr == nil {
		writeErr = journal.Sync()
	}
	closeErr := journal.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	s.journalRecords++
	return nil
}

func (s *Store) replayJournalLocked(db *Database) (uint64, error) {
	journal, err := os.Open(s.journalPath)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	defer journal.Close()
	scanner := bufio.NewScanner(journal)
	scanner.Buffer(make([]byte, 64*1024), 8<<20)
	var records uint64
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(strings.TrimSpace(string(line))) == 0 {
			continue
		}
		var record storeJournalRecord
		if err := json.Unmarshal(line, &record); err != nil {
			return records, fmt.Errorf("decode index journal record %d: %w", records+1, err)
		}
		if record.Version != storeJournalVersion || record.Sequence == 0 {
			return records, fmt.Errorf("invalid index journal record %d", records+1)
		}
		records++
		if record.Sequence <= db.JournalSequence {
			continue
		}
		if record.Sequence != db.JournalSequence+1 {
			return records, fmt.Errorf("index journal sequence gap: snapshot=%d record=%d", db.JournalSequence, record.Sequence)
		}
		switch record.Operation {
		case "upsert-block":
			if record.Status == nil || record.Block == nil {
				return records, fmt.Errorf("index journal upsert record %d is incomplete", record.Sequence)
			}
			applyUpsertRecord(db, record)
		default:
			return records, fmt.Errorf("unsupported index journal operation %q", record.Operation)
		}
	}
	if err := scanner.Err(); err != nil {
		return records, err
	}
	return records, nil
}

func applyUpsertRecord(db *Database, record storeJournalRecord) {
	normalizeDatabase(db)
	applySourceStatus(db, record.SourceURL, *record.Status)
	block := *record.Block
	db.Blocks[strconv.FormatUint(block.Height, 10)] = block
	db.LastIndexedHeight = block.Height
	db.LastBlockHash = block.Hash
	db.LastSyncAt = record.RecordedAt
	db.JournalSequence = record.Sequence
	for _, tx := range block.Transactions {
		db.Transactions[tx.Hash] = tx
	}
}

func (s *Store) compactJournalIfNeededLocked() error {
	if s.journalRecords < storeJournalCompactEvents {
		if info, err := os.Stat(s.journalPath); err == nil && info.Size() < storeJournalCompactBytes {
			return nil
		} else if os.IsNotExist(err) {
			return nil
		} else if err != nil {
			return err
		}
	}
	if err := s.saveSnapshotLocked(s.db); err != nil {
		return err
	}
	return s.resetJournalLocked()
}

func (s *Store) resetJournalLocked() error {
	s.journalRecords = 0
	if strings.TrimSpace(s.path) == "" {
		return nil
	}
	tmp := s.journalPath + ".tmp"
	if err := os.WriteFile(tmp, nil, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.journalPath)
}

type Indexer struct {
	cfg    Config
	client *Client
	store  *Store
	syncMu sync.Mutex
}

func New(cfg Config) (*Indexer, error) {
	if strings.TrimSpace(cfg.RPCURL) == "" {
		return nil, fmt.Errorf("indexer RPC URL is required")
	}
	if strings.TrimSpace(cfg.StorePath) == "" {
		return nil, fmt.Errorf("indexer store path is required")
	}
	if cfg.MaxReorgDepth == 0 {
		cfg.MaxReorgDepth = defaultMaxReorgDepth
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
	ReorgDetected        bool   `json:"reorgDetected"`
	RecoveryMode         string `json:"recoveryMode"`
	CommonAncestorHeight uint64 `json:"commonAncestorHeight,omitempty"`
	RollbackFromHeight   uint64 `json:"rollbackFromHeight,omitempty"`
	RolledBackBlockCount int    `json:"rolledBackBlockCount"`
	RolledBackTxCount    int    `json:"rolledBackTxCount"`
	MaxReorgDepth        uint64 `json:"maxReorgDepth"`
}

type canonicalRecovery struct {
	detected         bool
	mode             string
	commonAncestor   uint64
	rollbackFrom     uint64
	rolledBackBlocks int
	rolledBackTxs    int
}

func (i *Indexer) SyncOnce(ctx context.Context) (SyncResult, error) {
	i.syncMu.Lock()
	defer i.syncMu.Unlock()

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
	if len(db.Blocks) > 0 {
		lastBlock, ok := db.Blocks[strconv.FormatUint(db.LastIndexedHeight, 10)]
		if !ok || lastBlock.Hash == "" || lastBlock.Hash != db.LastBlockHash {
			return SyncResult{}, fmt.Errorf("stored index tip is inconsistent; indexer rebuild required")
		}
		if db.LastIndexedHeight == ^uint64(0) {
			return SyncResult{}, fmt.Errorf("stored index height is exhausted; indexer rebuild required")
		}
	}
	db, err = i.store.RecordSourceStatus(i.cfg.RPCURL, status)
	if err != nil {
		return SyncResult{}, err
	}
	if len(db.Blocks) > 0 && db.LastIndexedHeight+1 < status.EarliestBlockHeight {
		return SyncResult{}, fmt.Errorf("resume height %d is below source earliest retained height %d; indexer rebuild required", db.LastIndexedHeight+1, status.EarliestBlockHeight)
	}
	recovery := canonicalRecovery{mode: "none"}
	if len(db.Blocks) > 0 {
		db, recovery, err = i.reconcileCanonical(ctx, db, status)
		if err != nil {
			return SyncResult{}, err
		}
	}
	start := status.EarliestBlockHeight
	if len(db.Blocks) > 0 {
		start = db.LastIndexedHeight + 1
	}
	if start < status.EarliestBlockHeight {
		return SyncResult{}, fmt.Errorf("resume height %d is below source earliest retained height %d; indexer rebuild required", start, status.EarliestBlockHeight)
	}
	result := SyncResult{
		SourceHeight:         status.Height,
		SourceEarliestHeight: status.EarliestBlockHeight,
		ResumeFromHeight:     start,
		NativeSymbol:         status.NativeCurrencySymbol,
		TruthfulStatus:       "local-indexer",
		ReorgDetected:        recovery.detected,
		RecoveryMode:         recovery.mode,
		CommonAncestorHeight: recovery.commonAncestor,
		RollbackFromHeight:   recovery.rollbackFrom,
		RolledBackBlockCount: recovery.rolledBackBlocks,
		RolledBackTxCount:    recovery.rolledBackTxs,
		MaxReorgDepth:        i.cfg.MaxReorgDepth,
	}
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
	end := status.Height
	if remaining := end - start + 1; remaining > i.cfg.MaxBlocksPerRun {
		end = start + i.cfg.MaxBlocksPerRun - 1
	}
	for height := start; height <= end; height++ {
		block, err := i.client.Block(ctx, height)
		if err != nil {
			return SyncResult{}, err
		}
		if err := validateSourceBlock(status, height, block); err != nil {
			return SyncResult{}, err
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

func (i *Indexer) reconcileCanonical(ctx context.Context, db Database, status Status) (Database, canonicalRecovery, error) {
	recovery := canonicalRecovery{mode: "none"}
	overlapTip := db.LastIndexedHeight
	if status.Height < overlapTip {
		overlapTip = status.Height
	}
	if overlapTip < status.EarliestBlockHeight {
		return Database{}, recovery, fmt.Errorf("canonical overlap tip %d is below source earliest retained height %d; indexer rebuild required", overlapTip, status.EarliestBlockHeight)
	}
	localTip, ok := db.Blocks[strconv.FormatUint(overlapTip, 10)]
	if !ok || localTip.Hash == "" {
		return Database{}, recovery, fmt.Errorf("stored overlap block at height %d is unavailable; indexer rebuild required", overlapTip)
	}
	sourceTip, err := i.client.Block(ctx, overlapTip)
	if err != nil {
		return Database{}, recovery, err
	}
	if err := validateSourceBlock(status, overlapTip, sourceTip); err != nil {
		return Database{}, recovery, err
	}
	if localTip.Hash == sourceTip.Hash {
		if db.LastIndexedHeight == overlapTip {
			return db, recovery, nil
		}
		recovery.detected = true
		recovery.mode = "source-height-rollback"
		recovery.commonAncestor = overlapTip
		recovery.rollbackFrom = overlapTip + 1
		db, recovery.rolledBackBlocks, recovery.rolledBackTxs, err = i.store.RollbackTo(overlapTip)
		return db, recovery, err
	}

	lowerBound := status.EarliestBlockHeight
	if overlapTip > i.cfg.MaxReorgDepth {
		depthBound := overlapTip - i.cfg.MaxReorgDepth
		if depthBound > lowerBound {
			lowerBound = depthBound
		}
	}
	for height := overlapTip; ; height-- {
		localBlock, ok := db.Blocks[strconv.FormatUint(height, 10)]
		if !ok || localBlock.Hash == "" {
			return Database{}, recovery, fmt.Errorf("stored block at height %d is unavailable during reorg recovery; indexer rebuild required", height)
		}
		sourceBlock, err := i.client.Block(ctx, height)
		if err != nil {
			return Database{}, recovery, err
		}
		if err := validateSourceBlock(status, height, sourceBlock); err != nil {
			return Database{}, recovery, err
		}
		if localBlock.Hash == sourceBlock.Hash {
			recovery.detected = true
			recovery.mode = "fork-rollback-and-reindex"
			recovery.commonAncestor = height
			recovery.rollbackFrom = height + 1
			db, recovery.rolledBackBlocks, recovery.rolledBackTxs, err = i.store.RollbackTo(height)
			return db, recovery, err
		}
		if height == lowerBound {
			break
		}
	}
	return Database{}, recovery, fmt.Errorf("source fork has no common ancestor within retained range and max reorg depth %d; indexer rebuild required", i.cfg.MaxReorgDepth)
}

func validateSourceBlock(status Status, height uint64, block chain.Block) error {
	if block.Height != height || block.Hash == "" {
		return fmt.Errorf("source returned invalid block for requested height %d", height)
	}
	if height == status.EarliestBlockHeight && status.EarliestBlockHash != "" && block.Hash != status.EarliestBlockHash {
		return fmt.Errorf("source earliest block hash mismatch at height %d; indexer rebuild required", height)
	}
	if height == status.Height && status.LatestBlockHash != "" && block.Hash != status.LatestBlockHash {
		return fmt.Errorf("source latest block hash mismatch at height %d; indexer rebuild required", height)
	}
	return nil
}

func LatestBlocks(db Database, limit int) []chain.Block {
	blocks, _, _ := LatestBlocksPage(db, limit, "")
	return blocks
}

func LatestBlocksPage(db Database, limit int, after string) ([]chain.Block, string, error) {
	limit = normalizePageLimit(limit)
	if len(db.Blocks) == 0 {
		return []chain.Block{}, "", nil
	}

	startHeight := db.LastIndexedHeight
	if _, found := db.Blocks[strconv.FormatUint(startHeight, 10)]; !found {
		// Older fixtures and imported snapshots may omit LastIndexedHeight. A
		// one-pass maximum lookup keeps those databases readable without putting
		// the production hot path back on a full sort.
		for rawHeight := range db.Blocks {
			height, err := strconv.ParseUint(rawHeight, 10, 64)
			if err == nil && height > startHeight {
				startHeight = height
			}
		}
	}
	if after != "" {
		position, err := strconv.ParseUint(after, 10, 64)
		if err != nil {
			return nil, "", fmt.Errorf("block cursor position is invalid")
		}
		if _, found := db.Blocks[strconv.FormatUint(position, 10)]; !found {
			return nil, "", fmt.Errorf("block cursor position is no longer retained")
		}
		if position == 0 {
			return []chain.Block{}, "", nil
		}
		startHeight = position - 1
	}

	// Indexed block heights are canonical and monotonically increasing. Walk the
	// height-keyed map directly instead of allocating and sorting every retained
	// height for each request. The old O(total blocks log total blocks) query held
	// the store read lock long enough to starve sync writes and, through RWMutex
	// writer preference, health checks as well.
	blocks := make([]chain.Block, 0, limit+1)
	for height := startHeight; ; height-- {
		if block, found := db.Blocks[strconv.FormatUint(height, 10)]; found {
			blocks = append(blocks, block)
			if len(blocks) > limit {
				break
			}
		}
		if height == 0 {
			break
		}
	}

	nextAfter := ""
	if len(blocks) > limit {
		blocks = blocks[:limit]
		nextAfter = strconv.FormatUint(blocks[len(blocks)-1].Height, 10)
	}
	return blocks, nextAfter, nil
}

func LatestTransactions(db Database, limit int) []chain.Transaction {
	txs, _, _ := LatestTransactionsPage(db, limit, "")
	return txs
}

func LatestTransactionsPage(db Database, limit int, after string) ([]chain.Transaction, string, error) {
	limit = normalizePageLimit(limit)
	txs := make([]chain.Transaction, 0, len(db.Transactions))
	for _, tx := range db.Transactions {
		txs = append(txs, tx)
	}
	sort.Slice(txs, func(a, b int) bool {
		if txs[a].Timestamp.Equal(txs[b].Timestamp) {
			return txs[a].Hash < txs[b].Hash
		}
		return txs[a].Timestamp.After(txs[b].Timestamp)
	})
	start := 0
	if after != "" {
		found := false
		for index, tx := range txs {
			if tx.Hash == after {
				start = index + 1
				found = true
				break
			}
		}
		if !found {
			return nil, "", fmt.Errorf("transaction cursor position is no longer retained")
		}
	}
	end := min(start+limit, len(txs))
	page := append([]chain.Transaction(nil), txs[start:end]...)
	nextAfter := ""
	if end < len(txs) && len(page) > 0 {
		nextAfter = page[len(page)-1].Hash
	}
	return page, nextAfter, nil
}

func normalizePageLimit(limit int) int {
	if limit <= 0 || limit > 100 {
		return 25
	}
	return limit
}
