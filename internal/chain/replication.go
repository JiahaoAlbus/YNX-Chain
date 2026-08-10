package chain

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"
)

// MaxReplicationSnapshotBytes bounds the authenticated, decompressed state
// snapshot. Public testnet history is append-only and has crossed 128 MiB;
// 256 MiB preserves a finite allocation ceiling while allowing followers to
// rebase from the current authoritative state.
const MaxReplicationSnapshotBytes = 256 << 20
const MaxReplicationBatchBlocks = 4096
const operationalCheckpointInterval = 5 * time.Minute

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
	d.mu.RLock()
	defer d.mu.RUnlock()
	if afterHeight >= uint64(len(d.blocks)) || d.blocks[afterHeight].Hash != afterHash {
		return nil, fmt.Errorf("replication base %d/%s does not match authoritative history", afterHeight, afterHash)
	}
	source := d.blocks[len(d.blocks)-1]
	endHeight := source.Height
	if remaining := source.Height - afterHeight; remaining > MaxReplicationBatchBlocks {
		endHeight = afterHeight + MaxReplicationBatchBlocks
	}
	blocks := append([]Block(nil), d.blocks[afterHeight+1:endHeight+1]...)
	batch := replicationBatch{
		Version: replicationBatchVersion, SavedAt: time.Now().UTC(),
		BaseHeight: afterHeight, BaseBlockHash: afterHash,
		EndHeight: endHeight, EndBlockHash: d.blocks[endHeight].Hash,
		SourceHeight: source.Height, SourceBlockHash: source.Hash,
		Complete: endHeight == source.Height, Blocks: blocks,
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
	var err error
	batch.Integrity, err = replicationBatchIntegrity(batch)
	if err != nil {
		return nil, err
	}
	payload, err := json.Marshal(batch)
	if err != nil {
		return nil, err
	}
	if len(payload) > MaxReplicationSnapshotBytes {
		return nil, fmt.Errorf("replication batch exceeds %d bytes", MaxReplicationSnapshotBytes)
	}
	return payload, nil
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

	d.mu.Lock()
	defer d.mu.Unlock()
	current := d.blocks[len(d.blocks)-1]
	result := ReplicationApplyResult{
		Height: batch.SourceHeight, BlockHash: batch.SourceBlockHash, SnapshotAt: batch.SavedAt,
	}
	if current.Height != batch.BaseHeight || current.Hash != batch.BaseBlockHash {
		return ReplicationApplyResult{}, fmt.Errorf("replication batch base %d/%s does not match local tip %d/%s", batch.BaseHeight, batch.BaseBlockHash, current.Height, current.Hash)
	}
	if len(batch.Blocks) == 0 {
		return result, nil
	}

	blocks := make([]Block, 0, len(d.blocks)+len(batch.Blocks))
	blocks = append(blocks, d.blocks...)
	blocks = append(blocks, batch.Blocks...)
	rollback := d.snapshotLocked()
	localPeers := d.validatorPeers
	localPeerSyncs := d.validatorPeerSyncs
	if batch.Complete {
		candidate := *batch.State
		candidate.Blocks = blocks
		if err := validateReplicationState(*batch.State, d.cfg); err != nil {
			return ReplicationApplyResult{}, fmt.Errorf("validate final replication state: %w", err)
		}
		candidate.StateIntegrity = ""
		if err := validateResourceSponsorSnapshot(candidate); err != nil {
			return ReplicationApplyResult{}, fmt.Errorf("validate final replication Resource sponsor state: %w", err)
		}
		d.applySnapshotLocked(candidate)
		d.validatorPeers = localPeers
		d.validatorPeerSyncs = localPeerSyncs
	} else {
		d.blocks = blocks
		d.publishBlockReadViewLocked()
	}
	d.publishStatusReadViewLocked()
	if d.shouldCheckpointReplicationLocked(batch.EndHeight, time.Now().UTC()) {
		if err := d.persistSnapshotLocked(); err != nil {
			d.applySnapshotLocked(rollback)
			if rollbackErr := d.persistSnapshotLocked(); rollbackErr != nil {
				return ReplicationApplyResult{}, fmt.Errorf("persist replication batch: %v; persist rollback snapshot: %w", err, rollbackErr)
			}
			return ReplicationApplyResult{}, fmt.Errorf("persist replication batch: %w", err)
		}
		d.replicaCheckpoint = replicationCheckpointState{
			Height: batch.EndHeight,
			At:     time.Now().UTC(),
			Ready:  true,
		}
	}
	result.Applied = true
	return result, nil
}

func (d *Devnet) shouldCheckpointReplicationLocked(height uint64, now time.Time) bool {
	if d.dataDir == "" {
		return false
	}
	if !d.replicaCheckpoint.Ready {
		return true
	}
	if height >= d.replicaCheckpoint.Height && height-d.replicaCheckpoint.Height >= MaxReplicationBatchBlocks {
		return true
	}
	return d.replicaCheckpoint.At.IsZero() || now.Sub(d.replicaCheckpoint.At) >= operationalCheckpointInterval
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

	d.mu.Lock()
	defer d.mu.Unlock()
	current := d.blocks[len(d.blocks)-1]
	incoming := snapshot.Blocks[len(snapshot.Blocks)-1]
	result := ReplicationApplyResult{Height: incoming.Height, BlockHash: incoming.Hash, SnapshotAt: snapshot.SavedAt}
	if current.Height == incoming.Height && current.Hash == incoming.Hash {
		return result, nil
	}
	if !allowAuthoritativeRebase && incoming.Height < current.Height {
		return ReplicationApplyResult{}, fmt.Errorf("replication snapshot height %d is behind local height %d", incoming.Height, current.Height)
	}

	localPeers := d.validatorPeers
	localPeerSyncs := d.validatorPeerSyncs
	rollback := d.snapshotLocked()
	d.applySnapshotLocked(snapshot)
	// Peer observations are node-local operational evidence, not replicated chain state.
	d.validatorPeers = localPeers
	d.validatorPeerSyncs = localPeerSyncs
	d.publishStatusReadViewLocked()
	if err := d.persistSnapshotLocked(); err != nil {
		d.applySnapshotLocked(rollback)
		if rollbackErr := d.persistSnapshotLocked(); rollbackErr != nil {
			return ReplicationApplyResult{}, fmt.Errorf("persist replication snapshot: %v; persist rollback snapshot: %w", err, rollbackErr)
		}
		return ReplicationApplyResult{}, fmt.Errorf("persist replication snapshot: %w", err)
	}
	result.Applied = true
	return result, nil
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
	snapshot := devnetSnapshot{Version: devnetSnapshotVersion, SavedAt: time.Now().UTC(), Config: d.cfg, Blocks: d.blocks, Pending: d.pending, Accounts: d.accounts, Validators: d.validators, Peers: d.validatorPeers, PeerSyncs: d.validatorPeerSyncs, Lots: d.lots, PayIntents: d.payIntents, Invoices: d.invoices, Refunds: d.refunds, PaySettlements: d.paySettlements, Webhooks: d.webhookSignatures, PayEvents: d.payEvents, RiskLabels: d.riskLabels, Evidence: d.evidencePackets, Governance: d.governanceRequests, Appeals: d.trustAppeals, Tracking: d.trackingReviews, AIPerms: d.aiPermissions, AIActions: d.aiActions, Transp: d.transparencyEntries, Delegation: d.resourceDelegations, Rentals: d.resourceRentals, Income: d.resourceIncome, Policy: d.resourcePolicy, Pools: d.resourcePools, Sponsors: d.resourceSponsorships, SponsorIDs: d.resourceSponsorIdem, ActionRefs: d.resourceActionRefs, SponsorLog: d.resourceSponsorAudit, Contracts: d.contracts}
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
	d.ensureStateDefaults()
	d.publishBlockReadViewLocked()
	d.publishStatusReadViewLocked()
}
