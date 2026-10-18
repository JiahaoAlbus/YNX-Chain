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
	"sync/atomic"
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
	path            string
	journalPath     string
	walPath         string
	journalMode     bool
	checkpointEvery int
	pendingBlocks   int
	mu              sync.RWMutex
	loaded          bool
	ready           atomic.Bool
	db              Database
	journalRecords  uint64
}

func NewStore(path string) *Store {
	return &Store{path: path, journalPath: path + ".journal", walPath: path + ".wal", checkpointEvery: 250}
}

func (s *Store) Ready() bool { return s.ready.Load() }

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
	return cloneDatabase(s.db), nil
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
	db = cloneDatabase(db)
	normalizeDatabase(&db)
	if s.loaded && db.JournalSequence < s.db.JournalSequence {
		db.JournalSequence = s.db.JournalSequence
	}
	// Save is the original explicit snapshot/journal API. Crossing from a
	// pending Perf WAL gives the checkpoint a sequence marker before tail cleanup;
	// that durable marker prevents a stale WAL from resurrecting rolled-back data.
	if s.pendingBlocks > 0 && db.JournalSequence == 0 {
		db.JournalSequence = 1
	}
	if err := s.saveSnapshotLocked(db); err != nil {
		s.loaded = false
		s.ready.Store(false)
		return err
	}
	s.db, s.loaded, s.journalMode = db, true, true
	if err := s.resetJournalLocked(); err != nil {
		return err
	}
	if err := s.resetWALLocked(); err != nil {
		return err
	}
	s.ready.Store(true)
	return nil
}

func (s *Store) UpsertBlock(sourceURL string, status Status, block chain.Block) (Database, error) {
	return s.UpsertBlocks(sourceURL, status, []chain.Block{block})
}

func (s *Store) UpsertBlocks(sourceURL string, status Status, blocks []chain.Block) (Database, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoadedLocked(); err != nil {
		return Database{}, err
	}
	next := cloneDatabase(s.db)
	if s.journalMode && uint64(len(blocks)) > ^uint64(0)-next.JournalSequence {
		return Database{}, fmt.Errorf("index journal sequence exhausted")
	}
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
	recordedAt := make([]time.Time, len(blocks))
	for position, block := range blocks {
		// Bound the exact format and timestamp that will be appended, before
		// any disk write, including all journal framing and sequence bytes.
		recordedAt[position] = time.Now().UTC()
		var record any = walRecord{Version: 1, SourceURL: sourceURL, Status: status, Block: block, IndexedAt: recordedAt[position]}
		if s.journalMode {
			record = storeJournalRecord{Version: storeJournalVersion, Sequence: next.JournalSequence + uint64(position) + 1, Operation: "upsert-block", SourceURL: sourceURL, Status: &status, Block: &block, RecordedAt: recordedAt[position]}
		}
		payload, err := json.Marshal(record)
		if err != nil {
			return Database{}, err
		}
		if len(payload)+1 > storeJournalRecordBytes {
			return Database{}, fmt.Errorf("index record exceeds the %d byte replay limit", storeJournalRecordBytes)
		}
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
	if s.journalMode {
		if err := s.resetWALLocked(); err != nil {
			return Database{}, err
		}
	}
	for position, block := range blocks {
		indexedAt := recordedAt[position]
		var err error
		if s.journalMode {
			if next.JournalSequence == ^uint64(0) {
				return Database{}, fmt.Errorf("index journal sequence exhausted")
			}
			record := storeJournalRecord{Version: storeJournalVersion, Sequence: next.JournalSequence + 1, Operation: "upsert-block", SourceURL: sourceURL, Status: &status, Block: &block, RecordedAt: indexedAt}
			err = s.appendJournalLocked(record)
			if err == nil {
				next.JournalSequence = record.Sequence
			}
		} else {
			err = s.appendWALLocked(walRecord{Version: 1, SourceURL: sourceURL, Status: status, Block: block, IndexedAt: indexedAt})
		}
		if err != nil {
			// A prefix may already be durable. Reconcile it on the next read;
			// never keep an older in-memory tip available for blind resubmission.
			s.loaded = false
			s.ready.Store(false)
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
	s.ready.Store(true)
	if s.journalMode {
		if err := s.compactJournalIfNeededLocked(); err != nil {
			s.loaded = false
			s.ready.Store(false)
			return Database{}, err
		}
	} else {
		s.pendingBlocks += len(blocks)
		if s.pendingBlocks >= s.checkpointEvery {
			if err := s.saveLocked(next); err != nil {
				s.loaded = false
				s.ready.Store(false)
				return Database{}, err
			}
			if err := s.resetWALLocked(); err != nil {
				s.loaded = false
				s.ready.Store(false)
				return Database{}, err
			}
		}
	}
	return cloneDatabase(next), nil
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
	candidate := s.db
	candidate.Blocks = make(map[string]chain.Block, len(s.db.Blocks))
	for rawHeight, block := range s.db.Blocks {
		candidate.Blocks[rawHeight] = block
	}
	removedBlocks := 0
	for rawHeight := range candidate.Blocks {
		blockHeight, err := strconv.ParseUint(rawHeight, 10, 64)
		if err != nil {
			return Database{}, 0, 0, fmt.Errorf("stored block height %q is invalid; indexer rebuild required", rawHeight)
		}
		if blockHeight > height {
			delete(candidate.Blocks, rawHeight)
			removedBlocks++
		}
	}
	previousTxCount := len(s.db.Transactions)
	candidate.Transactions = make(map[string]chain.Transaction)
	for _, block := range candidate.Blocks {
		for _, tx := range block.Transactions {
			candidate.Transactions[tx.Hash] = tx
		}
	}
	removedTransactions := previousTxCount - len(candidate.Transactions)
	if removedTransactions < 0 {
		removedTransactions = 0
	}
	candidate.LastIndexedHeight = height
	candidate.LastBlockHash = ancestor.Hash
	candidate.LastSyncAt = time.Now().UTC()
	if candidate.JournalSequence == ^uint64(0) {
		return Database{}, 0, 0, fmt.Errorf("index journal sequence exhausted")
	}
	candidate.JournalSequence++
	if err := s.saveSnapshotLocked(candidate); err != nil {
		return Database{}, 0, 0, err
	}
	// The canonical candidate is now durable. Publish it before journal cleanup so
	// memory and the restart snapshot cannot diverge if cleanup itself fails.
	s.db, s.journalMode = candidate, true
	if err := s.resetWALLocked(); err != nil {
		return Database{}, 0, 0, err
	}
	if err := s.resetJournalLocked(); err != nil {
		return Database{}, 0, 0, err
	}
	return cloneDatabase(s.db), removedBlocks, removedTransactions, nil
}

func (s *Store) RecordSourceStatus(sourceURL string, status Status) (Database, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoadedLocked(); err != nil {
		return Database{}, err
	}
	applySourceStatus(&s.db, sourceURL, status)
	return cloneDatabase(s.db), nil
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
	storeJournalRecordBytes   = 8 << 20
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
	if strings.TrimSpace(s.path) == "" {
		s.db = Database{Version: 2, Blocks: map[string]chain.Block{}, Transactions: map[string]chain.Transaction{}}
		s.loaded = true
		s.ready.Store(true)
		return nil
	}
	// The two established formats never form a dual-written ledger. A positive
	// sequence in the checkpoint is the durable Protocol journal authority.
	journalInfo, journalErr := os.Lstat(s.journalPath)
	if journalErr != nil && !os.IsNotExist(journalErr) {
		return journalErr
	}
	if journalErr == nil && (!journalInfo.Mode().IsRegular() || journalInfo.Mode().Perm()&0o077 != 0) {
		return fmt.Errorf("index journal must be a private regular file")
	}
	s.journalMode = journalErr == nil
	db, err := s.loadSnapshotLocked()
	if err != nil {
		return err
	}
	if db.JournalSequence > 0 {
		s.journalMode = true
	}
	walInfo, walErr := os.Lstat(s.walPath)
	if walErr != nil && !os.IsNotExist(walErr) {
		return walErr
	}
	if journalErr == nil && walErr == nil && walInfo.Size() > 0 && db.JournalSequence == 0 {
		return fmt.Errorf("ambiguous index journal and WAL tails; preserve both and reconcile their original checkpoint")
	}
	if !s.journalMode {
		pending, err := s.replayWALLocked(&db)
		if err != nil {
			return err
		}
		s.pendingBlocks = pending
	} else {
		records, err := s.replayJournalLocked(&db)
		if err != nil {
			return err
		}
		s.journalRecords = records
		// An explicit sequenced checkpoint supersedes its pre-switch WAL. Keep
		// that file until the next durable mutation cleans it; never replay it.
	}
	s.db, s.loaded = db, true
	s.ready.Store(true)
	return nil
}

func (s *Store) loadSnapshotLocked() (Database, error) {
	db := Database{Version: 2, Blocks: map[string]chain.Block{}, Transactions: map[string]chain.Transaction{}}
	if strings.TrimSpace(s.path) == "" {
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
		// Keep strict JSON syntax in both known dialects. Legacy journal
		// snapshots retain their original metadata compatibility below.
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
	if db.JournalSequence > 0 {
		// Original compacted journal checkpoints can outlive a removed tail.
		s.journalMode = true
	}
	if !s.journalMode {
		if err := validateDatabase(db); err != nil {
			return Database{}, err
		}
	}

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
	payload, err := json.MarshalIndent(db, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(s.path, payload)
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
	if len(payload) > storeJournalRecordBytes {
		return fmt.Errorf("index journal record exceeds the %d byte replay limit", storeJournalRecordBytes)
	}
	created := false
	if info, err := os.Lstat(s.journalPath); err == nil {
		if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
			return fmt.Errorf("index journal must be a private regular file")
		}
	} else if os.IsNotExist(err) {
		created = true
	} else {
		return err
	}
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
	if created {
		if err := syncDirectory(filepath.Dir(s.journalPath)); err != nil {
			return err
		}
	}
	s.journalRecords++
	return nil
}

func (s *Store) replayJournalLocked(db *Database) (uint64, error) {
	journal, err := os.OpenFile(s.journalPath, os.O_RDWR, 0o600)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	defer journal.Close()
	reader := bufio.NewReaderSize(journal, 64*1024)
	var records uint64
	var completeBytes int64
	for {
		line := make([]byte, 0, 64*1024)
		var readErr error
		for {
			fragment, fragmentErr := reader.ReadSlice('\n')
			if len(line)+len(fragment) > storeJournalRecordBytes {
				return records, fmt.Errorf("index journal record %d exceeds size limit", records+1)
			}
			line = append(line, fragment...)
			if fragmentErr == bufio.ErrBufferFull {
				continue
			}
			readErr = fragmentErr
			break
		}
		if readErr == io.EOF {
			if len(line) > 0 {
				// appendJournalLocked always terminates and fsyncs complete frames.
				// An unterminated EOF fragment is therefore a torn final write, not
				// a record that is safe to replay.
				if err := journal.Truncate(completeBytes); err != nil {
					return records, fmt.Errorf("truncate incomplete index journal tail: %w", err)
				}
				if err := journal.Sync(); err != nil {
					return records, fmt.Errorf("sync repaired index journal: %w", err)
				}
			}
			break
		}
		if readErr != nil {
			return records, readErr
		}
		completeBytes += int64(len(line))
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
	if strings.TrimSpace(s.path) == "" {
		return nil
	}
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
	if strings.TrimSpace(s.path) != "" {
		if err := writeFileAtomic(s.journalPath, nil); err != nil {
			return err
		}
	}
	s.journalRecords = 0
	return nil
}

func (s *Store) resetWALLocked() error {
	if strings.TrimSpace(s.path) != "" {
		if err := os.Remove(s.walPath); err != nil {
			if !os.IsNotExist(err) {
				return err
			}
		} else if err := syncDirectory(filepath.Dir(s.walPath)); err != nil {
			return err
		}
	}
	s.pendingBlocks = 0
	return nil
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
	validatedTransactions := make(map[string]chain.Transaction, len(db.Transactions))
	for hash, tx := range db.Transactions {
		validatedTransactions[hash] = tx
	}
	blocks := make([]chain.Block, 0, end-start+1)
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
		if err := validateBlockTransactions(block, validatedTransactions); err != nil {
			return SyncResult{}, err
		}
		for _, tx := range block.Transactions {
			validatedTransactions[tx.Hash] = tx
		}
		blocks = append(blocks, block)
		result.NewBlocksThisRun++
		expectedParent = block.Hash
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
	lowerBound := db.SourceEarliestHeight
	if lowerBound > startHeight {
		return []chain.Block{}, "", nil
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
		if height == lowerBound || height == 0 {
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
	return filteredTransactionsPage(db, limit, after, func(chain.Transaction) bool { return true })
}

func AccountTransactionsPage(db Database, address string, limit int, after string) ([]chain.Transaction, string, error) {
	address = strings.TrimSpace(address)
	if address == "" {
		return nil, "", fmt.Errorf("account address is required")
	}
	return filteredTransactionsPage(db, limit, after, func(tx chain.Transaction) bool {
		return strings.EqualFold(strings.TrimSpace(tx.From), address) ||
			strings.EqualFold(strings.TrimSpace(tx.To), address) ||
			strings.EqualFold(strings.TrimSpace(tx.Sponsor), address)
	})
}

func filteredTransactionsPage(db Database, limit int, after string, include func(chain.Transaction) bool) ([]chain.Transaction, string, error) {
	limit = normalizePageLimit(limit)
	txs := make([]chain.Transaction, 0, len(db.Transactions))
	for _, tx := range db.Transactions {
		if include(tx) {
			txs = append(txs, tx)
		}
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
	if n, err := file.Write(payload); err != nil {
		return err
	} else if n != len(payload) {
		return io.ErrShortWrite
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
	if len(payload) > storeJournalRecordBytes {
		return fmt.Errorf("index WAL record exceeds the %d byte replay limit", storeJournalRecordBytes)
	}
	file, err := os.OpenFile(s.walPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return err
	}
	if n, err := file.Write(payload); err != nil {
		_ = file.Close()
		return err
	} else if n != len(payload) {
		_ = file.Close()
		return io.ErrShortWrite
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
