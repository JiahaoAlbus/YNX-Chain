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

const (
	legacyDevnetSnapshotVersion = 1
	devnetSnapshotVersion       = 2
	devnetSnapshotHashDomain    = "YNX_CHAIN_DEVNET_SNAPSHOT_V2"
)

type ReplicationApplyResult struct {
	Applied    bool      `json:"applied"`
	Height     uint64    `json:"height"`
	BlockHash  string    `json:"blockHash"`
	SnapshotAt time.Time `json:"snapshotAt"`
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
	d.ensureStateDefaults()
}
