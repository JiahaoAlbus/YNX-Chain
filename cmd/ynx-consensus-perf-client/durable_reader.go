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

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmttypes "github.com/cometbft/cometbft/types"
)

const durableSnapshotLimit = 16 << 20

type durableEvidence struct {
	Height           int64
	AppHash          string
	SnapshotSHA256   string
	SnapshotCacheHit bool
}

type durableReaderStats struct {
	Attempts                 uint64 `json:"attempts"`
	BytesHashed              uint64 `json:"bytesHashed"`
	SnapshotValidations      uint64 `json:"snapshotValidations"`
	SnapshotCacheHits        uint64 `json:"snapshotCacheHits"`
	TransactionVerifications uint64 `json:"transactionVerifications"`
}

type durableFeeKey struct {
	hash, payer, kind string
	height, fee       int64
}

type durableSnapshotSlot struct {
	mu     sync.Mutex
	buffer [32 << 10]byte
	digest [sha256.Size]byte
	state  *consensus.CommittedState
	fees   map[durableFeeKey]struct{}
	nonces map[string]uint64
	stats  durableReaderStats
}

// Slots are bound to at most four manifest paths and a privately cloned
// migration. No parsed state, index or mutable slice escapes to an observer.
type durableReader struct {
	migration chain.ConsensusMigrationState
	slots     map[string]*durableSnapshotSlot
}

func newDurableReader(migration chain.ConsensusMigrationState, paths []string) (*durableReader, error) {
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
	r := &durableReader{slots: make(map[string]*durableSnapshotSlot)}
	if err := json.Unmarshal(data, &r.migration); err != nil {
		return nil, err
	}
	for _, path := range paths {
		if path == "" || r.slots[path] != nil {
			return nil, errors.New("durable paths must be nonempty and unique")
		}
		r.slots[path] = &durableSnapshotSlot{}
	}
	return r, nil
}

func (r *durableReader) stats() durableReaderStats {
	var total durableReaderStats
	for _, slot := range r.slots {
		slot.mu.Lock()
		s := slot.stats
		slot.mu.Unlock()
		total.Attempts += s.Attempts
		total.BytesHashed += s.BytesHashed
		total.SnapshotValidations += s.SnapshotValidations
		total.SnapshotCacheHits += s.SnapshotCacheHits
		total.TransactionVerifications += s.TransactionVerifications
	}
	return total
}

func (r *durableReader) verify(ctx context.Context, path string, raw cmttypes.Tx, height int64) (durableEvidence, error) {
	var evidence durableEvidence
	slot := r.slots[path]
	if slot == nil {
		return evidence, errors.New("durable path outside the fixed manifest set")
	}
	slot.mu.Lock()
	defer slot.mu.Unlock()
	slot.stats.Attempts++
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
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return evidence, err
	}
	if !info.Mode().IsRegular() || info.Size() > durableSnapshotLimit {
		return evidence, errors.New("durable input must be a regular file within the size limit")
	}
	hasher := sha256.New()
	var size int64
	for {
		if err := ctx.Err(); err != nil {
			return evidence, err
		}
		n, readErr := f.Read(slot.buffer[:])
		size += int64(n)
		slot.stats.BytesHashed += uint64(n)
		if size > durableSnapshotLimit {
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
	hit := slot.state != nil && slot.digest == digest
	if !hit {
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			return evidence, err
		}
		data, err := io.ReadAll(io.LimitReader(f, durableSnapshotLimit+1))
		if err != nil {
			return evidence, err
		}
		if len(data) > durableSnapshotLimit || sha256.Sum256(data) != digest {
			return evidence, errors.New("durable state changed during readback")
		}
		var state consensus.CommittedState
		if err := strictJSON(data, &state); err != nil {
			return evidence, err
		}
		slot.stats.SnapshotValidations++
		if err := state.Validate(r.migration); err != nil {
			return evidence, fmt.Errorf("durable state validation: %w", err)
		}
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
		slot.state, slot.digest, slot.fees, slot.nonces = &state, digest, fees, nonces
	} else {
		slot.stats.SnapshotCacheHits++
	}
	state := slot.state
	if !state.Initialized || state.Height < height {
		return evidence, errDurableNotReady
	}
	tx, err := consensus.DecodeSignedTransaction(raw)
	if err != nil {
		return evidence, fmt.Errorf("bounded fixture must use native signed transfers: %w", err)
	}
	if err := tx.Verify(r.migration.Network.ChainID); err != nil {
		return evidence, err
	}
	slot.stats.TransactionVerifications++
	key := durableFeeKey{hash: consensus.SignedTransactionHash(raw), payer: tx.From, kind: consensus.SignedTransactionType, height: height, fee: tx.Fee}
	if _, ok := slot.fees[key]; !ok || slot.nonces[tx.From] < tx.Nonce {
		return evidence, errors.New("transaction fee/nonce absent from validated local durable state")
	}
	if err := ctx.Err(); err != nil {
		return evidence, err
	}
	return durableEvidence{Height: state.Height, AppHash: state.AppHash, SnapshotSHA256: hex.EncodeToString(digest[:]), SnapshotCacheHit: hit}, nil
}
