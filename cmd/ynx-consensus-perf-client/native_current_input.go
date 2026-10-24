package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"time"
)

type currentInputReuseStats struct {
	Attempts           uint64 `json:"attempts"`
	Errors             uint64 `json:"errors"`
	Enabled            bool   `json:"enabled"`
	Hits               uint64 `json:"hits"`
	Misses             uint64 `json:"misses"`
	ComparedBytes      uint64 `json:"comparedBytes"`
	LookupNs           int64  `json:"lookupNs"`
	RetainedInputBytes int64  `json:"retainedInputBytes"`
}

// In addition to the original read lock, full hash and second captured-byte hash,
// reject rename/permission/size/mtime changes during the observation. A fresh
// inode present before observation is still allowed and must validate normally.
func (r *durableReader) checkCurrentInputFile(ctx context.Context, path string, f *os.File, before os.FileInfo) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if r.migration.Network.ChainID != r.currentInputScopeChainID {
		return errors.New("current input reuse migration chain scope changed")
	}
	named, err := os.Lstat(path)
	if err != nil {
		return err
	}
	after, err := f.Stat()
	if err != nil {
		return err
	}
	if !named.Mode().IsRegular() || named.Mode().Perm() != 0600 || !os.SameFile(before, named) || !os.SameFile(before, after) || before.Size() != after.Size() || before.Size() != named.Size() || !before.ModTime().Equal(after.ModTime()) || !before.ModTime().Equal(named.ModTime()) {
		return errors.New("current durable input identity changed during observation")
	}
	return nil
}

// Call only while the original profile mutex and target slot mutex are held.
// Every source is a current slot of this private migration-bound reader. No
// cross-reader/global cache and no additional retained generations exist.
// Captured input/state/fee/nonce indexes are immutable after publication; the
// normal per-transaction signature/math facts, fee/nonce and published Info
// checks still run. Decode/replay and full validation remain on every miss.
func (r *durableReader) reuseCapturedInput(ctx context.Context, target *durableSnapshotSlot, data []byte, digest [sha256.Size]byte) (reused bool, resultErr error) {
	if !r.nativeCurrentInputReuse {
		return false, nil
	}
	began := time.Now()
	r.currentInputReuseStats.Attempts++
	defer func() {
		r.currentInputReuseStats.LookupNs += time.Since(began).Nanoseconds()
		if resultErr != nil {
			r.currentInputReuseStats.Errors++
		}
	}()
	if r.profileMu == nil || r.prefixDecoder == nil || !r.observerNativeFacts || r.migration.Network.ChainID != r.currentInputScopeChainID {
		return false, errors.New("current input reuse backend/scope differs")
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	for _, source := range r.slots {
		if source == target || source.state == nil || source.format != "block-journal" || source.digest != digest || len(source.capturedInput) != len(data) || len(data) == 0 {
			continue
		}
		r.currentInputReuseStats.ComparedBytes += uint64(len(data))
		if !bytes.Equal(source.capturedInput, data) {
			continue
		}
		if err := ctx.Err(); err != nil {
			return false, err
		}
		target.state, target.fees, target.nonces = source.state, source.fees, source.nonces
		target.snapshotDigest, target.digest = source.snapshotDigest, digest
		target.format, target.journalCompleteBytes, target.journalIncompleteTail = source.format, source.journalCompleteBytes, source.journalIncompleteTail
		target.storeInputBytes = int64(len(data))
		target.capturedInput = source.capturedInput
		r.currentInputReuseStats.Hits++
		return true, nil
	}
	r.currentInputReuseStats.Misses++
	return false, nil
}
