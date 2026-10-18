package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmttypes "github.com/cometbft/cometbft/types"
)

const durableSnapshotLimit = 16 << 20

type durableEvidence struct {
	Height                int64
	AppHash               string
	SnapshotSHA256        string
	SnapshotCacheHit      bool
	StoreSHA256           string
	StoreFormat           string
	JournalCompleteBytes  int
	JournalIncompleteTail bool
}

type durableReadbackPhases struct {
	LoadNs              int64 `json:"loadNs"`
	HashNs              int64 `json:"hashNs"`
	CaptureNs           int64 `json:"captureNs"`
	DecodeNs            int64 `json:"decodeNs"`
	IndexPublishNs      int64 `json:"indexPublishNs"`
	TransactionVerifyNs int64 `json:"transactionVerifyNs"`
}

type durableReaderStats struct {
	SharedReplay             *sharedReplayStats                      `json:"sharedReplay,omitempty"`
	SignatureFacts           *durableSignatureStats                  `json:"signatureFacts,omitempty"`
	PhaseTotalsNs            *durableReadbackPhases                  `json:"phaseTotalsNs,omitempty"`
	Attempts                 uint64                                  `json:"attempts"`
	BytesHashed              uint64                                  `json:"bytesHashed"`
	SnapshotValidations      uint64                                  `json:"snapshotValidations"`
	SnapshotCacheHits        uint64                                  `json:"snapshotCacheHits"`
	TransactionVerifications uint64                                  `json:"transactionVerifications"`
	BlockReplayBlocks        uint64                                  `json:"blockJournalReplayedBlocks"`
	BlockReplayTxInputs      uint64                                  `json:"blockJournalReplayedTransactionInputs"`
	ReaderBudget             *durableReaderBudgetStats               `json:"readerBudget,omitempty"`
	ReplayNativeFacts        consensus.BlockJournalVerificationStats `json:"blockJournalNativeVerificationFacts"`
}

type durableFeeKey struct {
	hash, payer, kind string
	height, fee       int64
}

type durableSnapshotSlot struct {
	mu                    sync.Mutex
	storeInputBytes       int64
	lastUse               uint64
	buffer                [32 << 10]byte
	digest                [sha256.Size]byte
	snapshotDigest        [sha256.Size]byte
	format                string
	journalCompleteBytes  int
	journalIncompleteTail bool
	state                 *consensus.CommittedState
	fees                  map[durableFeeKey]struct{}
	nonces                map[string]uint64
	phases                durableReadbackPhases
	stats                 durableReaderStats
}

// Slots are bound to at most four manifest paths and a privately cloned
// migration. No parsed state, index or mutable slice escapes to an observer.
type durableReader struct {
	migration       chain.ConsensusMigrationState
	slots           map[string]*durableSnapshotSlot
	blockDecoder    *consensus.BlockJournalDecoder
	storeByteLimit  int64
	cacheByteBudget int64
	profileMu       *sync.Mutex
	cacheTick       uint64
	cacheEvictions  uint64
	signatureFacts  *durableSignatureFacts
	measurePhases   bool               // Set only during construction, before any observer starts.
	sharedReplay    *sharedReplayCache // Explicit candidate only; never enabled by timing.
}

func newDurableReader(migration chain.ConsensusMigrationState, paths []string) (*durableReader, error) {
	return newDurableReaderWithLimits(migration, paths, durableSnapshotLimit, 0)
}

func newDurableReaderWithLimits(migration chain.ConsensusMigrationState, paths []string, storeLimit, cacheBudget int64) (*durableReader, error) {
	if storeLimit < durableSnapshotLimit || storeLimit > 512<<20 || cacheBudget < 0 || cacheBudget > 2<<30 || (storeLimit > durableSnapshotLimit && cacheBudget == 0) || (cacheBudget > 0 && cacheBudget < storeLimit) {
		return nil, errors.New("durable reader explicit store/cache bounds")
	}
	if len(paths) < 1 || len(paths) > 4 {
		return nil, errors.New("durable reader requires 1..4 isolated node paths")
	}
	if err := migration.Validate(); err != nil {
		return nil, err
	}
	data, err := migration.CanonicalJSON()
	if err != nil {
		return nil, err
	}
	r := &durableReader{slots: make(map[string]*durableSnapshotSlot), storeByteLimit: storeLimit, cacheByteBudget: cacheBudget}
	if cacheBudget > 0 {
		r.profileMu = &sync.Mutex{}
		r.signatureFacts = &durableSignatureFacts{}
	}
	if err := json.Unmarshal(data, &r.migration); err != nil {
		return nil, err
	}
	decoder, err := consensus.NewBlockJournalDecoder(r.migration)
	if err != nil {
		return nil, err
	}
	r.blockDecoder = decoder
	for _, path := range paths {
		if path == "" || r.slots[path] != nil {
			return nil, errors.New("durable paths must be nonempty and unique")
		}
		r.slots[path] = &durableSnapshotSlot{}
	}
	return r, nil
}

func (r *durableReader) stats() durableReaderStats {
	if r.profileMu != nil {
		r.profileMu.Lock()
		defer r.profileMu.Unlock()
	}
	var total durableReaderStats
	if r.sharedReplay != nil {
		s := r.sharedReplay.snapshot()
		total.SharedReplay = &s
	}
	if r.profileMu != nil || r.measurePhases {
		total.PhaseTotalsNs = &durableReadbackPhases{}
		if r.signatureFacts != nil {
			facts := r.signatureFacts.stats()
			total.SignatureFacts = &facts
		}
	}
	for _, slot := range r.slots {
		slot.mu.Lock()
		s := slot.stats
		if total.PhaseTotalsNs != nil {
			total.PhaseTotalsNs.LoadNs += slot.phases.LoadNs
			total.PhaseTotalsNs.HashNs += slot.phases.HashNs
			total.PhaseTotalsNs.CaptureNs += slot.phases.CaptureNs
			total.PhaseTotalsNs.DecodeNs += slot.phases.DecodeNs
			total.PhaseTotalsNs.IndexPublishNs += slot.phases.IndexPublishNs
			total.PhaseTotalsNs.TransactionVerifyNs += slot.phases.TransactionVerifyNs
		}
		slot.mu.Unlock()
		total.Attempts += s.Attempts
		total.BytesHashed += s.BytesHashed
		total.SnapshotValidations += s.SnapshotValidations
		total.SnapshotCacheHits += s.SnapshotCacheHits
		total.TransactionVerifications += s.TransactionVerifications
		total.BlockReplayBlocks += s.BlockReplayBlocks
		total.BlockReplayTxInputs += s.BlockReplayTxInputs
	}
	if r.profileMu != nil {
		total.ReaderBudget = &durableReaderBudgetStats{StoreByteLimit: r.storeByteLimit, CacheInputByteBudget: r.cacheByteBudget, CachedInputBytes: r.cachedStoreInputBytes(), Evictions: r.cacheEvictions}
	}
	total.ReplayNativeFacts = r.blockDecoder.VerificationStats()
	return total
}

type durableBatchEvidence struct {
	Evidence     durableEvidence
	Transactions int
	ObservedAt   time.Time
}

func (r *durableReader) verify(ctx context.Context, path string, raw cmttypes.Tx, height int64) (durableEvidence, error) {
	batch, err := r.verifyBlockBatch(ctx, path, []cmttypes.Tx{raw}, height)
	if err != nil {
		return durableEvidence{}, err
	}
	return batch.Evidence, nil
}

// One fresh current-file observation for one node/block. No evidence escapes
// until every unique native transaction passes signature and fee/nonce checks.
func (r *durableReader) verifyBlockBatch(ctx context.Context, path string, raws []cmttypes.Tx, height int64) (durableBatchEvidence, error) {
	var batch durableBatchEvidence
	if err := ctx.Err(); err != nil {
		return batch, err
	}
	if height <= 0 || len(raws) == 0 || len(raws) > maxTransactions {
		return batch, errors.New("invalid bounded block readback batch")
	}
	seen := make(map[[sha256.Size]byte]struct{}, len(raws))
	totalBytes := 0
	for _, raw := range raws {
		totalBytes += len(raw)
		if totalBytes > 8<<20 {
			return batch, errors.New("block readback batch exceeds byte bound")
		}
		hash := sha256.Sum256(raw)
		if _, ok := seen[hash]; ok {
			return batch, errors.New("duplicate transaction in readback batch")
		}
		seen[hash] = struct{}{}
	}
	slot := r.slots[path]
	if slot == nil {
		return batch, errors.New("durable path outside the fixed manifest set")
	}
	if r.profileMu != nil {
		r.profileMu.Lock()
		defer r.profileMu.Unlock()
		if err := ctx.Err(); err != nil {
			return batch, err
		}
	}
	slot.mu.Lock()
	defer slot.mu.Unlock()
	slot.stats.Attempts++
	evidence, err := r.loadSnapshotLocked(ctx, path, slot)
	if err != nil {
		return batch, err
	}
	for i, raw := range raws {
		if err := r.verifyTransactionLocked(ctx, slot, raw, height); err != nil {
			return batch, fmt.Errorf("block readback transaction %d: %w", i, err)
		}
	}
	if err := ctx.Err(); err != nil {
		return batch, err
	}
	observed := time.Now()
	if deadline, ok := ctx.Deadline(); ok && !observed.Before(deadline) {
		return batch, context.DeadlineExceeded
	}
	return durableBatchEvidence{Evidence: evidence, Transactions: len(raws), ObservedAt: observed}, nil
}

func (r *durableReader) loadSnapshotLocked(ctx context.Context, path string, slot *durableSnapshotSlot) (durableEvidence, error) {
	var evidence durableEvidence
	loadTimer := readbackPhaseTimer{enabled: r.profileMu != nil || r.measurePhases}
	loadTimer.begin(&slot.phases.LoadNs)
	defer loadTimer.end()
	phaseTimer := readbackPhaseTimer{enabled: r.profileMu != nil || r.measurePhases}
	defer phaseTimer.end()
	if err := ctx.Err(); err != nil {
		return evidence, err
	}
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return evidence, errDurableNotReady
	}
	if err != nil {
		return evidence, err
	}
	var release func()
	defer func() {
		if release != nil {
			release()
		}
		if f != nil {
			_ = f.Close()
		}
	}()
	var prefix [64]byte
	n, _ := f.ReadAt(prefix[:], 0)
	journal := (consensus.IsSnapshotJournal(prefix[:n]) || consensus.IsBlockJournal(prefix[:n]))
	if journal {
		release, err = consensus.LockSnapshotJournalRead(path)
		if errors.Is(err, consensus.ErrSnapshotJournalBusy) {
			return evidence, errDurableNotReady
		}
		if err != nil {
			return evidence, err
		}
		_ = f.Close()
		f, err = os.Open(path)
		if err != nil {
			return evidence, err
		}
	}
	info, err := f.Stat()
	if err != nil {
		return evidence, err
	}
	if journal {
		entry, err := os.Lstat(path)
		if err != nil {
			return evidence, err
		}
		if !entry.Mode().IsRegular() || !os.SameFile(entry, info) || info.Mode().Perm() != 0o600 {
			return evidence, errors.New("journal path must be a regular 0600 file")
		}
	}
	if !info.Mode().IsRegular() || info.Size() > r.storeByteLimit {
		return evidence, errors.New("durable input must be a regular file within the size limit")
	}
	phaseTimer.begin(&slot.phases.HashNs)
	hasher := sha256.New()
	var size int64
	for {
		if err := ctx.Err(); err != nil {
			return evidence, err
		}
		n, readErr := f.Read(slot.buffer[:])
		size += int64(n)
		slot.stats.BytesHashed += uint64(n)
		if size > r.storeByteLimit {
			return evidence, errors.New("durable input exceeds size limit")
		}
		if n > 0 {
			_, _ = hasher.Write(slot.buffer[:n])
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return evidence, readErr
		}
	}
	var digest [sha256.Size]byte
	copy(digest[:], hasher.Sum(nil))
	phaseTimer.end()
	hit := slot.state != nil && slot.digest == digest
	if !hit {
		phaseTimer.begin(&slot.phases.CaptureNs)
		if r.profileMu != nil {
			if err := r.reserveStoreCache(slot, size); err != nil {
				return evidence, err
			}
		}
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			return evidence, err
		}
		data, err := io.ReadAll(io.LimitReader(f, r.storeByteLimit+1))
		if err != nil {
			return evidence, err
		}
		if int64(len(data)) > r.storeByteLimit || int64(len(data)) != size || sha256.Sum256(data) != digest {
			return evidence, errors.New("durable state changed during readback")
		}
		if journal && !(consensus.IsSnapshotJournal(data) || consensus.IsBlockJournal(data)) {
			return evidence, errors.New("journal layout changed during readback")
		}
		if !journal && (consensus.IsSnapshotJournal(data) || consensus.IsBlockJournal(data)) {
			return evidence, errors.New("journal readback requires writer synchronization")
		}
		if release != nil {
			release()
			release = nil
		}
		phaseTimer.begin(&slot.phases.DecodeNs)
		slot.stats.SnapshotValidations++
		decoded, err := r.decodeCurrentSnapshot(ctx, data, digest)
		if err != nil {
			return evidence, err
		}
		phaseTimer.begin(&slot.phases.IndexPublishNs)
		slot.stats.BlockReplayBlocks += uint64(decoded.replayedBlocks)
		slot.stats.BlockReplayTxInputs += uint64(decoded.replayedTxInputs)
		state := decoded.state

		if err := ctx.Err(); err != nil {
			return evidence, err
		}
		fees := make(map[durableFeeKey]struct{}, len(state.FeeEvents))
		for _, fee := range state.FeeEvents {
			fees[durableFeeKey{hash: fee.TxHash, payer: fee.Payer, kind: fee.TransactionType, height: fee.BlockHeight, fee: fee.GrossFeeYNXT}] = struct{}{}
		}
		nonces := make(map[string]uint64, len(state.Accounts))
		for _, account := range state.Accounts {
			nonces[account.Address] = account.Nonce
		}
		if err := ctx.Err(); err != nil {
			return evidence, err
		}
		slot.snapshotDigest = sha256.Sum256(decoded.payload)
		slot.format = decoded.format
		slot.journalCompleteBytes, slot.journalIncompleteTail = decoded.completeBytes, decoded.incompleteTail
		slot.state, slot.digest, slot.fees, slot.nonces = &state, digest, fees, nonces
		slot.storeInputBytes = size
		phaseTimer.end()
	} else {
		slot.stats.SnapshotCacheHits++
	}
	if release != nil {
		release()
		release = nil
	}
	if r.profileMu != nil {
		r.cacheTick++
		slot.lastUse = r.cacheTick
	}
	state := slot.state
	if !state.Initialized {
		return evidence, errDurableNotReady
	}
	return durableEvidence{Height: state.Height, AppHash: state.AppHash, SnapshotSHA256: hex.EncodeToString(slot.snapshotDigest[:]), SnapshotCacheHit: hit, StoreSHA256: hex.EncodeToString(digest[:]), StoreFormat: slot.format, JournalCompleteBytes: slot.journalCompleteBytes, JournalIncompleteTail: slot.journalIncompleteTail}, nil
}

// Sharing is restricted to identical, freshly captured block-journal content
// within one migration-bound reader. A hit reconstructs its own mutable state,
// runs full state validation and still undergoes original per-transaction and
// published-Info verification. No path, height or mtime substitutes for bytes.
func (r *durableReader) decodeCurrentSnapshot(ctx context.Context, data []byte, digest [sha256.Size]byte) (decodedDurableSnapshot, error) {
	if r.sharedReplay == nil || !consensus.IsBlockJournal(data) {
		return decodeDurableSnapshotWithFacts(ctx, data, r.migration, r.blockDecoder)
	}
	var decoded decodedDurableSnapshot
	v, err := r.sharedReplay.get(ctx, digest, func() (sharedReplayValue, error) {
		var err error
		decoded, err = decodeDurableSnapshotWithFacts(ctx, data, r.migration, r.blockDecoder)
		return sharedReplayValue{payload: decoded.payload, format: decoded.format, completeBytes: decoded.completeBytes, incompleteTail: decoded.incompleteTail}, err
	})
	if err != nil {
		return decodedDurableSnapshot{}, err
	}
	if !v.reused {
		return decoded, nil
	}
	var state consensus.CommittedState
	started := time.Now()
	err = strictJSON(v.payload, &state)
	r.sharedReplay.recordPrivateWork(true, started, err)
	if err != nil {
		return decodedDurableSnapshot{}, err
	}
	started = time.Now()
	err = state.Validate(r.migration)
	r.sharedReplay.recordPrivateWork(false, started, err)
	if err != nil {
		return decodedDurableSnapshot{}, err
	}
	if err := ctx.Err(); err != nil {
		return decodedDurableSnapshot{}, err
	}
	// Replay counters count work actually performed, never cached logical work.
	return decodedDurableSnapshot{state: state, payload: v.payload, format: v.format, completeBytes: v.completeBytes, incompleteTail: v.incompleteTail}, nil
}

func (r *durableReader) verifyTransactionLocked(ctx context.Context, slot *durableSnapshotSlot, raw cmttypes.Tx, height int64) error {
	phaseTimer := readbackPhaseTimer{enabled: r.profileMu != nil || r.measurePhases}
	phaseTimer.begin(&slot.phases.TransactionVerifyNs)
	defer phaseTimer.end()
	state := slot.state

	if !state.Initialized || state.Height < height {
		return errDurableNotReady
	}
	var tx consensus.SignedTransaction
	var err error
	if r.signatureFacts != nil {
		tx, err = r.signatureFacts.decode(raw, r.migration.Network.ChainID)
		if err != nil {
			return fmt.Errorf("bounded fixture native signature: %w", err)
		}
	} else {
		tx, err = consensus.DecodeSignedTransaction(raw)
		if err != nil {
			return fmt.Errorf("bounded fixture must use native signed transfers: %w", err)
		}
		if err := tx.Verify(r.migration.Network.ChainID); err != nil {
			return err
		}
	}
	slot.stats.TransactionVerifications++
	key := durableFeeKey{hash: consensus.SignedTransactionHash(raw), payer: tx.From, kind: consensus.SignedTransactionType, height: height, fee: tx.Fee}
	if _, ok := slot.fees[key]; !ok || slot.nonces[tx.From] < tx.Nonce {
		return errors.New("transaction fee/nonce absent from validated local durable state")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return nil
}

type decodedDurableSnapshot struct {
	state            consensus.CommittedState
	payload          []byte
	format           string
	completeBytes    int
	incompleteTail   bool
	replayedBlocks   int
	replayedTxInputs int
}

func decodeDurableSnapshot(ctx context.Context, data []byte, migration chain.ConsensusMigrationState) (decodedDurableSnapshot, error) {
	return decodeDurableSnapshotWithFacts(ctx, data, migration, nil)
}

func decodeDurableSnapshotWithFacts(ctx context.Context, data []byte, migration chain.ConsensusMigrationState, decoder *consensus.BlockJournalDecoder) (decodedDurableSnapshot, error) {
	var decoded decodedDurableSnapshot
	if consensus.IsBlockJournal(data) {
		var journal consensus.BlockJournalReadback
		var err error
		if decoder == nil {
			journal, err = consensus.DecodeBlockJournal(ctx, data, migration)
		} else {
			journal, err = decoder.Decode(ctx, data)
		}
		if err != nil {
			return decoded, err
		}
		decoded = decodedDurableSnapshot{state: journal.State, payload: journal.SnapshotJSON, format: "block-journal", completeBytes: journal.CompleteBytes, incompleteTail: journal.IncompleteTail, replayedBlocks: journal.ReplayedBlocks, replayedTxInputs: journal.ReplayedTransactionInputs}
	} else if consensus.IsSnapshotJournal(data) {
		journal, err := consensus.DecodeSnapshotJournal(ctx, data, migration)
		if errors.Is(err, consensus.ErrSnapshotJournalEmpty) {
			return decoded, errDurableNotReady
		}
		if err != nil {
			return decoded, err
		}
		decoded = decodedDurableSnapshot{state: journal.State, payload: journal.SnapshotJSON, format: "snapshot-journal", completeBytes: journal.CompleteBytes, incompleteTail: journal.IncompleteTail}
	} else {
		if err := strictJSON(data, &decoded.state); err != nil {
			return decoded, err
		}
		if err := decoded.state.Validate(migration); err != nil {
			return decoded, fmt.Errorf("durable state validation: %w", err)
		}
		decoded.payload, decoded.format = data, "atomic-json"
	}
	if err := ctx.Err(); err != nil {
		return decodedDurableSnapshot{}, err
	}
	return decoded, nil
}

// Timings are opt-in with the bounded reader profile or explicit observer flag.
// The observer-only flag does not add a global reader lock or change caching.
// Load includes file/lease
// checks and its child phases; children are disjoint. Failed attempts retain
// time spent in their active phase and never produce successful evidence.
type readbackPhaseTimer struct {
	enabled bool
	started time.Time
	target  *int64
}

func (p *readbackPhaseTimer) begin(target *int64) {
	p.end()
	if p.enabled {
		p.started, p.target = time.Now(), target
	}
}
func (p *readbackPhaseTimer) end() {
	if p.target != nil {
		*p.target += time.Since(p.started).Nanoseconds()
		p.target = nil
	}
}
