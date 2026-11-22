package consensus

import (
	"bytes"
	"encoding/hex"
	"errors"
	"strings"
)

// SyntheticCommitHeader is a local, in-memory diagnostic association. HeaderHash
// is the hash presented to this Application's FinalizeBlock, not a full Comet
// BlockID, a validator vote, a state-store completion, or finality evidence.
// It is deliberately absent from all consensus and existing observation JSON.
type SyntheticCommitHeader struct {
	Height     int64
	HeaderHash [32]byte
	AppHash    [32]byte
}

type syntheticCommitHeader = SyntheticCommitHeader

type syntheticCommitHeaderCapture struct {
	pending *syntheticCommitHeader
	latest  *syntheticCommitHeader
}

// SetSyntheticCommitHeaderCapture enables a private, latest-attempt snapshot.
// It never persists or signs anything. The normal node observer must establish
// its own source, process, clock, block and proof provenance before using it.
// A pre-existing pending block cannot be retroactively observed.
func (a *Application) SetSyntheticCommitHeaderCapture(enabled bool) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !enabled {
		a.commitHeaderCapture = nil
		return nil
	}
	if a.commitHeaderCapture != nil || a.pending != nil || a.snapshotRestore != nil {
		return errors.New("synthetic header capture requires a fresh application boundary")
	}
	if a.migration.Network.ChainID != PQLabNativeChainID || a.migration.Network.IsPublicNet || !strings.HasPrefix(a.migration.Network.Slug, "pq-lab-") || a.statePath == "" {
		return errors.New("synthetic header capture requires lab-shaped configuration and a state path")
	}
	a.commitHeaderCapture = &syntheticCommitHeaderCapture{}
	return nil
}

// LastSyntheticCommitHeader atomically returns this Application's most recent
// successful persisted association. Missing or superseded attempts remain
// unknown; no guarantee of complete capture or a monotonic time is implied.
func (a *Application) LastSyntheticCommitHeader() (SyntheticCommitHeader, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.commitHeaderCapture == nil || a.commitHeaderCapture.latest == nil || a.snapshotRestore != nil {
		return SyntheticCommitHeader{}, false
	}
	value := *a.commitHeaderCapture.latest
	if a.committed.Height != value.Height || a.committed.AppHash != hex.EncodeToString(value.AppHash[:]) {
		return SyntheticCommitHeader{}, false
	}
	return value, true
}

// Caller holds a.mu; these helpers only maintain diagnostic memory and never
// change a consensus response, persistence result, or normal error.
func (a *Application) captureSyntheticFinalizeHeader(req interface{ GetHash() []byte }, pending CommittedState) {
	if a.commitHeaderCapture == nil || a.snapshotRestore != nil || req == nil {
		return
	}
	hash := req.GetHash()
	stateHash, err := hex.DecodeString(pending.AppHash)
	if len(hash) != 32 || bytes.Equal(hash, make([]byte, 32)) || err != nil || len(stateHash) != 32 || pending.Height <= 0 {
		return
	}
	value := &syntheticCommitHeader{Height: pending.Height}
	copy(value.HeaderHash[:], hash)
	copy(value.AppHash[:], stateHash)
	a.commitHeaderCapture.pending = value
}

func (a *Application) captureSyntheticCommittedHeader(value *syntheticCommitHeader) {
	if a.commitHeaderCapture == nil || value == nil || a.statePath == "" || a.committed.Height != value.Height || a.committed.AppHash != hex.EncodeToString(value.AppHash[:]) {
		return
	}
	a.commitHeaderCapture.latest = value
}
