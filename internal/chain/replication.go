package chain

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// MaxReplicationSnapshotBytes bounds the authenticated, decompressed state
// snapshot. Public testnet history is append-only and has crossed 128 MiB;
// 256 MiB preserves a finite allocation ceiling while allowing followers to
// rebase from the current authoritative state.
const MaxReplicationSnapshotBytes = 256 << 20
const MaxReplicationBatchBlocks = 4096

// ReplicationDurableCheckpointBlocks bounds the amount of empty-block history
// a follower may replay after a cold restart. Application-state changes still
// force an immediate durable checkpoint; only block-only suffixes are deferred.
const ReplicationDurableCheckpointBlocks = 256

// MaxReplicationBatchPayloadBytes bounds intermediate catch-up responses.
// The final batch may use the existing 256 MiB snapshot ceiling because it
// carries the separately authenticated authoritative state.
const MaxReplicationBatchPayloadBytes = 64 << 20

const (
	legacyDevnetSnapshotVersion = 1
	devnetSnapshotVersion       = 2
	devnetSnapshotHashDomain    = "YNX_CHAIN_DEVNET_SNAPSHOT_V2"
	replicationBatchVersion     = 1
	replicationBatchHashDomain  = "YNX_CHAIN_REPLICATION_BATCH_V1"
	replicationStateHashDomain  = "YNX_CHAIN_REPLICATION_STATE_V1"
)

type ReplicationApplyResult struct {
	Applied    bool      `json:"applied"`
	Complete   bool      `json:"complete"`
	Height     uint64    `json:"height"`
	BlockHash  string    `json:"blockHash"`
	SnapshotAt time.Time `json:"snapshotAt"`
}

type replicationBatch struct {
	Version         int             `json:"version"`
	SavedAt         time.Time       `json:"savedAt"`
	BaseHeight      uint64          `json:"baseHeight"`
	BaseBlockHash   string          `json:"baseBlockHash"`
	EndHeight       uint64          `json:"endHeight"`
	EndBlockHash    string          `json:"endBlockHash"`
	SourceHeight    uint64          `json:"sourceHeight"`
	SourceBlockHash string          `json:"sourceBlockHash"`
	Complete        bool            `json:"complete"`
	Blocks          []Block         `json:"blocks"`
	State           *devnetSnapshot `json:"state,omitempty"`
	Integrity       string          `json:"integrity"`
}

func (d *Devnet) ReplicationSnapshotJSON() ([]byte, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	snapshot, err := sealDevnetSnapshot(d.snapshotLocked())
	if err != nil {
		return nil, err
	}
	return json.Marshal(snapshot)
}

// ReplicationBatchJSON returns a bounded suffix of the authoritative history.
// Full application state is included only with the final suffix and carries a
// separate integrity seal; block continuity is verified across every suffix.
func (d *Devnet) ReplicationBatchJSON(afterHeight uint64, afterHash string) ([]byte, error) {
	return d.replicationBatchJSONWithLimit(afterHeight, afterHash, MaxReplicationBatchBlocks, MaxReplicationBatchPayloadBytes)
}

// replicationBatchJSONWithLimit emits the largest authenticated contiguous
// suffix that fits the supplied transport budget. A complete suffix is allowed
// to use the full snapshot ceiling because it carries the sealed state needed
// to make the follower authoritative at the source tip.
func (d *Devnet) replicationBatchJSONWithLimit(afterHeight uint64, afterHash string, maxBlocks uint64, payloadLimit int) ([]byte, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if maxBlocks == 0 {
		return nil, errors.New("replication batch block limit must be positive")
	}
	if payloadLimit <= 0 || payloadLimit > MaxReplicationSnapshotBytes {
		return nil, fmt.Errorf("replication batch payload limit must be between 1 and %d", MaxReplicationSnapshotBytes)
	}
	if afterHeight >= uint64(len(d.blocks)) || d.blocks[afterHeight].Hash != afterHash {
		return nil, fmt.Errorf("replication base %d/%s does not match authoritative history", afterHeight, afterHash)
	}
	source := d.blocks[len(d.blocks)-1]
	endHeight := source.Height
	if remaining := source.Height - afterHeight; remaining > maxBlocks {
		endHeight = afterHeight + maxBlocks
	}

	encode := func(candidateEnd uint64) ([]byte, error) {
		blocks := append([]Block(nil), d.blocks[afterHeight+1:candidateEnd+1]...)
		batch := replicationBatch{
			Version: replicationBatchVersion, SavedAt: time.Now().UTC(),
			BaseHeight: afterHeight, BaseBlockHash: afterHash,
			EndHeight: candidateEnd, EndBlockHash: d.blocks[candidateEnd].Hash,
			SourceHeight: source.Height, SourceBlockHash: source.Hash,
			Complete: candidateEnd == source.Height, Blocks: blocks,
		}
		if batch.Complete && len(blocks) > 0 {
			state := d.snapshotLocked()
			state.Blocks = nil
			integrity, err := replicationStateIntegrity(state)
			if err != nil {
				return nil, err
			}
			state.StateIntegrity = integrity
			batch.State = &state
		}
		integrity, err := replicationBatchIntegrity(batch)
		if err != nil {
			return nil, err
		}
		batch.Integrity = integrity
		return json.Marshal(batch)
	}

	low, high := afterHeight+1, endHeight
	if afterHeight == source.Height {
		// Preserve the existing authenticated no-op response for an already
		// synchronized follower instead of attempting to advance past tip.
		low = afterHeight
	}
	var best []byte
	for low <= high {
		candidateEnd := low + (high-low)/2
		payload, err := encode(candidateEnd)
		if err != nil {
			return nil, err
		}
		limit := payloadLimit
		if candidateEnd == source.Height {
			limit = MaxReplicationSnapshotBytes
		}
		if len(payload) <= limit {
			best = payload
			low = candidateEnd + 1
		} else {
			high = candidateEnd - 1
		}
	}
	if len(best) == 0 {
		payload, err := encode(afterHeight + 1)
		if err != nil {
			return nil, err
		}
		if len(payload) > MaxReplicationSnapshotBytes {
			return nil, fmt.Errorf("single replication block exceeds %d bytes", MaxReplicationSnapshotBytes)
		}
		best = payload
	}
	if len(best) > MaxReplicationSnapshotBytes {
		return nil, fmt.Errorf("replication batch exceeds %d bytes", MaxReplicationSnapshotBytes)
	}
	return best, nil
}

func (d *Devnet) ApplyReplicationBatchJSON(payload []byte) (ReplicationApplyResult, error) {
	if len(payload) == 0 {
		return ReplicationApplyResult{}, errors.New("replication batch is empty")
	}
	if len(payload) > MaxReplicationSnapshotBytes {
		return ReplicationApplyResult{}, fmt.Errorf("replication batch exceeds %d bytes", MaxReplicationSnapshotBytes)
	}
	var batch replicationBatch
	if err := json.Unmarshal(payload, &batch); err != nil {
		return ReplicationApplyResult{}, fmt.Errorf("decode replication batch: %w", err)
	}
	if err := validateReplicationBatch(batch, d.cfg); err != nil {
		return ReplicationApplyResult{}, err
	}

	d.mu.RLock()
	current := d.blocks[len(d.blocks)-1]
	result := ReplicationApplyResult{
		Complete: batch.Complete, Height: batch.SourceHeight, BlockHash: batch.SourceBlockHash, SnapshotAt: batch.SavedAt,
	}
	if current.Height != batch.BaseHeight || current.Hash != batch.BaseBlockHash {
		d.mu.RUnlock()
		return ReplicationApplyResult{}, fmt.Errorf("replication batch base %d/%s does not match local tip %d/%s", batch.BaseHeight, batch.BaseBlockHash, current.Height, current.Hash)
	}
	if len(batch.Blocks) == 0 {
		d.mu.RUnlock()
		return result, nil
	}
	if !batch.Complete {
		// Intermediate suffixes carry authenticated history only; authoritative
		// application state arrives with the final suffix. Commit the bounded
		// history window directly and defer the expensive full-history snapshot
		// rewrite until convergence. If the process exits before the final durable
		// checkpoint, restart simply resumes from the last complete snapshot.
		// This keeps low-memory followers from retaining the old history, a full
		// copied history and a 300+ MiB JSON checkpoint at the same time.
		d.mu.RUnlock()
		d.mu.Lock()
		defer d.mu.Unlock()
		current = d.blocks[len(d.blocks)-1]
		if current.Height != batch.BaseHeight || current.Hash != batch.BaseBlockHash {
			return ReplicationApplyResult{}, fmt.Errorf("replication batch base %d/%s does not match local tip %d/%s", batch.BaseHeight, batch.BaseBlockHash, current.Height, current.Hash)
		}
		d.blocks = append(d.blocks, batch.Blocks...)
		result.Applied = true
		return result, nil
	}

	// Intermediate appends normally leave spare capacity, so the final suffix
	// can reuse the existing history backing array instead of forcing another
	// complete copy. d.blocks keeps its old length until the durable snapshot is
	// written and the short commit lock succeeds.
	blocks := append(d.blocks, batch.Blocks...)
	candidate := *batch.State
	candidate.Blocks = blocks
	currentHeight, currentHash := current.Height, current.Hash
	d.mu.RUnlock()

	if err := validateReplicationState(*batch.State, d.cfg); err != nil {
		return ReplicationApplyResult{}, fmt.Errorf("validate final replication state: %w", err)
	}
	// A public testnet with a long run of empty blocks must not rewrite the full
	// append-only history snapshot every few seconds. Compare only authoritative
	// application state (peer observations are node-local). If it is unchanged,
	// advance the authenticated block suffix in memory and defer the expensive
	// durable rewrite to a bounded checkpoint. Any application-state change
	// bypasses this path and is persisted immediately below.
	d.mu.RLock()
	durableHeight := d.replicationDurableHeight
	localApplicationIntegrity, err := replicationApplicationStateIntegrity(d.snapshotLocked())
	d.mu.RUnlock()
	if err != nil {
		return ReplicationApplyResult{}, fmt.Errorf("hash local replication application state: %w", err)
	}
	sourceApplicationIntegrity, err := replicationApplicationStateIntegrity(*batch.State)
	if err != nil {
		return ReplicationApplyResult{}, fmt.Errorf("hash source replication application state: %w", err)
	}
	if hmac.Equal([]byte(localApplicationIntegrity), []byte(sourceApplicationIntegrity)) &&
		batch.SourceHeight >= durableHeight && batch.SourceHeight-durableHeight < ReplicationDurableCheckpointBlocks {
		d.mu.Lock()
		defer d.mu.Unlock()
		current = d.blocks[len(d.blocks)-1]
		if current.Height != batch.BaseHeight || current.Hash != batch.BaseBlockHash {
			return ReplicationApplyResult{}, fmt.Errorf("replication batch base %d/%s does not match local tip %d/%s", batch.BaseHeight, batch.BaseBlockHash, current.Height, current.Hash)
		}
		d.blocks = append(d.blocks, batch.Blocks...)
		result.Applied = true
		return result, nil
	}
	candidate.StateIntegrity = ""
	if err := validateResourceSponsorSnapshot(candidate); err != nil {
		return ReplicationApplyResult{}, fmt.Errorf("validate final replication Resource sponsor state: %w", err)
	}
	if err := validateReplicationBlockHistory(candidate, d.cfg); err != nil {
		return ReplicationApplyResult{}, fmt.Errorf("validate final replication block history: %w", err)
	}
	// Peer observations are local operational evidence and are not part of
	// the producer's authoritative application state.
	d.mu.RLock()
	candidate.Peers = copyValidatorPeers(d.validatorPeers)
	candidate.PeerSyncs = copyValidatorPeerSyncs(d.validatorPeerSyncs)
	d.mu.RUnlock()
	sealed, err := sealDevnetSnapshot(candidate)
	if err != nil {
		return ReplicationApplyResult{}, fmt.Errorf("seal replication batch snapshot: %w", err)
	}
	// Integrity hashing, JSON encoding, fsync and atomic rename can take seconds
	// for the append-only public history. They operate on a complete immutable
	// candidate before the short in-memory commit lock.
	if err := d.persistPreparedSnapshot(sealed); err != nil {
		return ReplicationApplyResult{}, fmt.Errorf("persist replication batch: %w", err)
	}

	d.mu.Lock()
	defer d.mu.Unlock()
	current = d.blocks[len(d.blocks)-1]
	if current.Height != currentHeight || current.Hash != currentHash {
		return ReplicationApplyResult{}, fmt.Errorf("local chain advanced while persisting replication batch")
	}
	localPeers := d.validatorPeers
	localPeerSyncs := d.validatorPeerSyncs
	d.applySnapshotLocked(sealed)
	d.validatorPeers = localPeers
	d.validatorPeerSyncs = localPeerSyncs
	result.Applied = true
	return result, nil
}

func copyValidatorPeers(input map[string]ValidatorPeer) map[string]ValidatorPeer {
	output := make(map[string]ValidatorPeer, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func copyValidatorPeerSyncs(input map[string]ValidatorPeerSync) map[string]ValidatorPeerSync {
	output := make(map[string]ValidatorPeerSync, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func validateReplicationBatch(batch replicationBatch, cfg NetworkConfig) error {
	if batch.Version != replicationBatchVersion {
		return fmt.Errorf("unsupported replication batch version %d", batch.Version)
	}
	actual, err := hex.DecodeString(batch.Integrity)
	if err != nil || len(actual) != sha256.Size {
		return errors.New("replication batch integrity is invalid")
	}
	expectedHex, err := replicationBatchIntegrity(batch)
	if err != nil {
		return err
	}
	expected, _ := hex.DecodeString(expectedHex)
	if !hmac.Equal(actual, expected) {
		return errors.New("replication batch integrity mismatch")
	}
	if batch.SavedAt.IsZero() || batch.SourceHeight < batch.EndHeight || batch.EndHeight < batch.BaseHeight {
		return errors.New("replication batch bounds are invalid")
	}
	if !validReplicationHash(batch.BaseBlockHash) || !validReplicationHash(batch.EndBlockHash) || !validReplicationHash(batch.SourceBlockHash) {
		return errors.New("replication batch block hash is invalid")
	}
	if uint64(len(batch.Blocks)) != batch.EndHeight-batch.BaseHeight {
		return errors.New("replication batch block count does not match bounds")
	}
	previousHash := batch.BaseBlockHash
	for i, block := range batch.Blocks {
		expectedHeight := batch.BaseHeight + uint64(i) + 1
		if block.Height != expectedHeight || block.ParentHash != previousHash {
			return fmt.Errorf("replication batch block %d continuity is invalid", expectedHeight)
		}
		hashBytes, hashErr := hex.DecodeString(block.Hash)
		if hashErr != nil || len(hashBytes) != sha256.Size || block.Time.IsZero() || block.Validator == "" {
			return fmt.Errorf("replication batch block %d identity is invalid", block.Height)
		}
		for _, tx := range block.Transactions {
			if tx.BlockNum != block.Height || tx.BlockHash != block.Hash {
				return fmt.Errorf("replication batch block %d contains transaction with mismatched block identity", block.Height)
			}
		}
		previousHash = block.Hash
	}
	if previousHash != batch.EndBlockHash {
		return errors.New("replication batch end hash does not match its blocks")
	}
	if batch.Complete != (batch.EndHeight == batch.SourceHeight) {
		return errors.New("replication batch completion marker is inconsistent")
	}
	if batch.Complete {
		if batch.EndBlockHash != batch.SourceBlockHash {
			return errors.New("complete replication batch source hash mismatch")
		}
		if len(batch.Blocks) > 0 {
			if batch.State == nil {
				return errors.New("complete replication batch is missing source state")
			}
			if batch.State.Config.ChainID != cfg.ChainID || batch.State.Config.Slug != cfg.Slug {
				return errors.New("replication batch source state network mismatch")
			}
		}
	} else if batch.State != nil {
		return errors.New("incomplete replication batch must not include future state")
	}
	return nil
}

func validReplicationHash(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

func replicationBatchIntegrity(batch replicationBatch) (string, error) {
	batch.Integrity = ""
	payload, err := json.Marshal(batch)
	if err != nil {
		return "", fmt.Errorf("encode replication batch integrity document: %w", err)
	}
	digest := sha256.New()
	_, _ = digest.Write([]byte(replicationBatchHashDomain))
	_, _ = digest.Write([]byte{0})
	_, _ = digest.Write(payload)
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func replicationStateIntegrity(state devnetSnapshot) (string, error) {
	state.Blocks = nil
	state.StateIntegrity = ""
	payload, err := json.Marshal(state)
	if err != nil {
		return "", fmt.Errorf("encode replication state integrity document: %w", err)
	}
	digest := sha256.New()
	_, _ = digest.Write([]byte(replicationStateHashDomain))
	_, _ = digest.Write([]byte{0})
	_, _ = digest.Write(payload)
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func replicationApplicationStateIntegrity(state devnetSnapshot) (string, error) {
	state.SavedAt = time.Time{}
	state.Blocks = nil
	state.Peers = nil
	state.PeerSyncs = nil
	state.Validators = append([]Validator(nil), state.Validators...)
	for i := range state.Validators {
		state.Validators[i].PeerReady = false
		state.Validators[i].PeerStatus = ""
		state.Validators[i].LatestHeight = 0
		state.Validators[i].LastSeenAt = nil
		state.Validators[i].UpdatedAt = nil
		state.Validators[i].PeerEvidence = ""
	}
	state.StateIntegrity = ""
	payload, err := json.Marshal(state)
	if err != nil {
		return "", fmt.Errorf("encode replication application state: %w", err)
	}
	digest := sha256.New()
	_, _ = digest.Write([]byte(replicationStateHashDomain))
	_, _ = digest.Write([]byte("/application"))
	_, _ = digest.Write([]byte{0})
	_, _ = digest.Write(payload)
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func validateReplicationState(state devnetSnapshot, cfg NetworkConfig) error {
	if state.Version != devnetSnapshotVersion {
		return fmt.Errorf("unsupported replication state version %d", state.Version)
	}
	if state.Config.ChainID != cfg.ChainID || state.Config.Slug != cfg.Slug {
		return fmt.Errorf("replication state network %s/%d does not match configured network %s/%d", state.Config.Slug, state.Config.ChainID, cfg.Slug, cfg.ChainID)
	}
	actual, err := hex.DecodeString(state.StateIntegrity)
	if err != nil || len(actual) != sha256.Size {
		return errors.New("replication state integrity is invalid")
	}
	expectedHex, err := replicationStateIntegrity(state)
	if err != nil {
		return err
	}
	expected, _ := hex.DecodeString(expectedHex)
	if !hmac.Equal(actual, expected) {
		return errors.New("replication state integrity mismatch")
	}
	return nil
}

func (d *Devnet) ApplyReplicationSnapshotJSON(payload []byte, allowAuthoritativeRebase bool) (ReplicationApplyResult, error) {
	if len(payload) == 0 {
		return ReplicationApplyResult{}, errors.New("replication snapshot is empty")
	}
	if len(payload) > MaxReplicationSnapshotBytes {
		return ReplicationApplyResult{}, fmt.Errorf("replication snapshot exceeds %d bytes", MaxReplicationSnapshotBytes)
	}
	var snapshot devnetSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		return ReplicationApplyResult{}, fmt.Errorf("decode replication snapshot: %w", err)
	}
	if err := validateReplicationSnapshot(snapshot, d.cfg); err != nil {
		return ReplicationApplyResult{}, err
	}

	d.mu.RLock()
	current := d.blocks[len(d.blocks)-1]
	incoming := snapshot.Blocks[len(snapshot.Blocks)-1]
	result := ReplicationApplyResult{Height: incoming.Height, BlockHash: incoming.Hash, SnapshotAt: snapshot.SavedAt}
	if current.Height == incoming.Height && current.Hash == incoming.Hash {
		d.mu.RUnlock()
		return result, nil
	}
	if !allowAuthoritativeRebase && incoming.Height < current.Height {
		d.mu.RUnlock()
		return ReplicationApplyResult{}, fmt.Errorf("replication snapshot height %d is behind local height %d", incoming.Height, current.Height)
	}
	currentHeight, currentHash := current.Height, current.Hash
	d.mu.RUnlock()

	// Persist the fully validated authoritative snapshot before taking the
	// in-memory write lock. A public follower can take seconds to fsync a large
	// append-only history; keeping that disk I/O outside the lock preserves
	// concurrent status, account and DEX reads during replication. The producer
	// snapshot has already passed its signed state-integrity validation, so
	// re-sealing the entire history here would only duplicate hundreds of MiB.
	if err := d.persistPreparedSnapshot(snapshot); err != nil {
		return ReplicationApplyResult{}, fmt.Errorf("persist replication snapshot: %w", err)
	}

	d.mu.Lock()
	defer d.mu.Unlock()
	current = d.blocks[len(d.blocks)-1]
	if current.Height != currentHeight || current.Hash != currentHash {
		return ReplicationApplyResult{}, fmt.Errorf("local chain advanced while persisting replication snapshot")
	}
	// Peer observations are node-local operational evidence, not replicated
	// chain state. Preserve the newest observations gathered while the snapshot
	// was being written, not the producer's observations.
	localPeers := d.validatorPeers
	localPeerSyncs := d.validatorPeerSyncs
	d.applySnapshotLocked(snapshot)
	d.validatorPeers = localPeers
	d.validatorPeerSyncs = localPeerSyncs
	result.Applied = true
	return result, nil
}

func (d *Devnet) persistPreparedSnapshot(snapshot devnetSnapshot) error {
	path := d.snapshotPath()
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create devnet data dir: %w", err)
	}
	if err := writeDurableSnapshotJSON(path, snapshot); err != nil {
		return err
	}
	if err := writeDurableSnapshot(d.snapshotIntegrityMarkerPath(), []byte("2\n")); err != nil {
		return fmt.Errorf("persist devnet snapshot integrity marker: %w", err)
	}
	return nil
}

func validateReplicationSnapshot(snapshot devnetSnapshot, cfg NetworkConfig) error {
	if snapshot.Version != legacyDevnetSnapshotVersion && snapshot.Version != devnetSnapshotVersion {
		return fmt.Errorf("unsupported replication snapshot version %d", snapshot.Version)
	}
	if snapshot.Config.ChainID != cfg.ChainID || snapshot.Config.Slug != cfg.Slug {
		return fmt.Errorf("replication snapshot network %s/%d does not match configured network %s/%d", snapshot.Config.Slug, snapshot.Config.ChainID, cfg.Slug, cfg.ChainID)
	}
	if len(snapshot.Blocks) == 0 {
		return errors.New("replication snapshot has no blocks")
	}
	if err := validateDevnetSnapshotIntegrity(snapshot); err != nil {
		return fmt.Errorf("validate replication snapshot integrity: %w", err)
	}
	if err := validateResourceSponsorSnapshot(snapshot); err != nil {
		return fmt.Errorf("validate replication Resource sponsor snapshot: %w", err)
	}
	return validateReplicationBlockHistory(snapshot, cfg)
}

func validateReplicationBlockHistory(snapshot devnetSnapshot, cfg NetworkConfig) error {
	expectedGenesis := hashParts("genesis", cfg.Slug, fmt.Sprint(cfg.ChainID))
	for i, block := range snapshot.Blocks {
		expectedHeight := uint64(i)
		if block.Height != expectedHeight {
			return fmt.Errorf("replication block index %d has height %d", i, block.Height)
		}
		if i == 0 {
			if block.Hash != expectedGenesis || block.ParentHash != "" {
				return errors.New("replication genesis block does not match configured network")
			}
			continue
		}
		parent := snapshot.Blocks[i-1]
		if block.ParentHash != parent.Hash {
			return fmt.Errorf("replication block %d parent hash mismatch", block.Height)
		}
		hashBytes, hashErr := hex.DecodeString(block.Hash)
		if hashErr != nil || len(hashBytes) != sha256.Size || block.Time.IsZero() || block.Validator == "" {
			return fmt.Errorf("replication block %d identity is invalid", block.Height)
		}
		for _, tx := range block.Transactions {
			if tx.BlockNum != block.Height || tx.BlockHash != block.Hash {
				return fmt.Errorf("replication block %d contains transaction with mismatched block identity", block.Height)
			}
		}
	}
	return nil
}

func sealDevnetSnapshot(snapshot devnetSnapshot) (devnetSnapshot, error) {
	snapshot.Version = devnetSnapshotVersion
	snapshot.StateIntegrity = ""
	integrity, err := devnetSnapshotIntegrity(snapshot)
	if err != nil {
		return devnetSnapshot{}, err
	}
	snapshot.StateIntegrity = integrity
	return snapshot, nil
}

func validateDevnetSnapshotIntegrity(snapshot devnetSnapshot) error {
	if snapshot.Version == legacyDevnetSnapshotVersion {
		if snapshot.StateIntegrity != "" {
			return errors.New("legacy devnet snapshot must not claim v2 state integrity")
		}
		return nil
	}
	if snapshot.Version != devnetSnapshotVersion {
		return fmt.Errorf("unsupported devnet snapshot version %d", snapshot.Version)
	}
	actual, err := hex.DecodeString(snapshot.StateIntegrity)
	if err != nil || len(actual) != sha256.Size {
		return errors.New("devnet snapshot state integrity is invalid")
	}
	expectedHex, err := devnetSnapshotIntegrity(snapshot)
	if err != nil {
		return err
	}
	expected, _ := hex.DecodeString(expectedHex)
	if !hmac.Equal(actual, expected) {
		return errors.New("devnet snapshot state integrity mismatch")
	}
	return nil
}

func devnetSnapshotIntegrity(snapshot devnetSnapshot) (string, error) {
	snapshot.StateIntegrity = ""
	digest := sha256.New()
	_, _ = digest.Write([]byte(devnetSnapshotHashDomain))
	_, _ = digest.Write([]byte{0})
	stream := jsonBodyWriter{target: digest}
	if err := json.NewEncoder(&stream).Encode(snapshot); err != nil {
		return "", fmt.Errorf("encode devnet snapshot integrity document: %w", err)
	}
	if err := stream.Finish(); err != nil {
		return "", fmt.Errorf("finish devnet snapshot integrity document: %w", err)
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

// jsonBodyWriter lets json.Encoder stream the exact bytes emitted by
// json.Marshal/MarshalIndent without retaining the encoder's final newline.
// Large public-history snapshots therefore do not require a second complete
// in-memory JSON buffer solely for integrity hashing or durable persistence.
type jsonBodyWriter struct {
	target  io.Writer
	tail    byte
	hasTail bool
}

func (w *jsonBodyWriter) Write(payload []byte) (int, error) {
	if len(payload) == 0 {
		return 0, nil
	}
	if w.hasTail {
		if _, err := w.target.Write([]byte{w.tail}); err != nil {
			return 0, err
		}
	}
	if len(payload) > 1 {
		if _, err := w.target.Write(payload[:len(payload)-1]); err != nil {
			return 0, err
		}
	}
	w.tail, w.hasTail = payload[len(payload)-1], true
	return len(payload), nil
}

func (w *jsonBodyWriter) Finish() error {
	if !w.hasTail || w.tail != '\n' {
		return errors.New("streamed JSON document has no canonical final newline")
	}
	w.hasTail = false
	return nil
}

func (d *Devnet) snapshotLocked() devnetSnapshot {
	snapshot := devnetSnapshot{Version: devnetSnapshotVersion, SavedAt: time.Now().UTC(), Config: d.cfg, Blocks: d.blocks, Pending: d.pending, Accounts: d.accounts, Validators: d.validators, Peers: d.validatorPeers, PeerSyncs: d.validatorPeerSyncs, Lots: d.lots, PayIntents: d.payIntents, Invoices: d.invoices, Refunds: d.refunds, PaySettlements: d.paySettlements, Webhooks: d.webhookSignatures, PayEvents: d.payEvents, RiskLabels: d.riskLabels, Evidence: d.evidencePackets, Governance: d.governanceRequests, Appeals: d.trustAppeals, Tracking: d.trackingReviews, AIPerms: d.aiPermissions, AIActions: d.aiActions, Transp: d.transparencyEntries, Delegation: d.resourceDelegations, Rentals: d.resourceRentals, Income: d.resourceIncome, Policy: d.resourcePolicy, Pools: d.resourcePools, Sponsors: d.resourceSponsorships, SponsorIDs: d.resourceSponsorIdem, ActionRefs: d.resourceActionRefs, SponsorLog: d.resourceSponsorAudit, Contracts: d.contracts, DexAssets: d.dexAssets, DexBalances: d.dexBalances, DexPools: d.dexPools, DexEvents: d.dexEvents}
	snapshot.SponsorIntegrity = resourceSponsorSnapshotIntegrity(snapshot)
	return snapshot
}

func (d *Devnet) applySnapshotLocked(snapshot devnetSnapshot) {
	d.blocks, d.pending, d.accounts, d.validators, d.validatorPeers, d.validatorPeerSyncs, d.lots, d.payIntents = snapshot.Blocks, snapshot.Pending, snapshot.Accounts, snapshot.Validators, snapshot.Peers, snapshot.PeerSyncs, snapshot.Lots, snapshot.PayIntents
	d.invoices, d.refunds, d.paySettlements, d.webhookSignatures, d.payEvents = snapshot.Invoices, snapshot.Refunds, snapshot.PaySettlements, snapshot.Webhooks, snapshot.PayEvents
	d.riskLabels, d.evidencePackets = snapshot.RiskLabels, snapshot.Evidence
	d.governanceRequests, d.trustAppeals, d.trackingReviews = snapshot.Governance, snapshot.Appeals, snapshot.Tracking
	d.aiPermissions, d.aiActions, d.transparencyEntries = snapshot.AIPerms, snapshot.AIActions, snapshot.Transp
	d.resourceDelegations, d.resourceRentals, d.resourceIncome, d.resourcePolicy, d.contracts = snapshot.Delegation, snapshot.Rentals, snapshot.Income, snapshot.Policy, snapshot.Contracts
	d.resourcePools, d.resourceSponsorships, d.resourceSponsorIdem = snapshot.Pools, snapshot.Sponsors, snapshot.SponsorIDs
	d.resourceActionRefs, d.resourceSponsorAudit = snapshot.ActionRefs, snapshot.SponsorLog
	d.dexAssets, d.dexBalances, d.dexPools, d.dexEvents = snapshot.DexAssets, snapshot.DexBalances, snapshot.DexPools, snapshot.DexEvents
	if len(snapshot.Blocks) > 0 {
		d.replicationDurableHeight = snapshot.Blocks[len(snapshot.Blocks)-1].Height
	}
	d.ensureStateDefaults()
}
