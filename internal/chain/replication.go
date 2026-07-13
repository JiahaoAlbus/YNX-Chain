package chain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

const MaxReplicationSnapshotBytes = 64 << 20

type ReplicationApplyResult struct {
	Applied    bool      `json:"applied"`
	Height     uint64    `json:"height"`
	BlockHash  string    `json:"blockHash"`
	SnapshotAt time.Time `json:"snapshotAt"`
}

func (d *Devnet) ReplicationSnapshotJSON() ([]byte, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return json.Marshal(d.snapshotLocked())
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
	d.applySnapshotLocked(snapshot)
	// Peer observations are node-local operational evidence, not replicated chain state.
	d.validatorPeers = localPeers
	d.validatorPeerSyncs = localPeerSyncs
	if err := d.persistSnapshotLocked(); err != nil {
		return ReplicationApplyResult{}, err
	}
	result.Applied = true
	return result, nil
}

func validateReplicationSnapshot(snapshot devnetSnapshot, cfg NetworkConfig) error {
	if snapshot.Version != 1 {
		return fmt.Errorf("unsupported replication snapshot version %d", snapshot.Version)
	}
	if snapshot.Config.ChainID != cfg.ChainID || snapshot.Config.Slug != cfg.Slug {
		return fmt.Errorf("replication snapshot network %s/%d does not match configured network %s/%d", snapshot.Config.Slug, snapshot.Config.ChainID, cfg.Slug, cfg.ChainID)
	}
	if len(snapshot.Blocks) == 0 {
		return errors.New("replication snapshot has no blocks")
	}
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

func (d *Devnet) snapshotLocked() devnetSnapshot {
	snapshot := devnetSnapshot{Version: 1, SavedAt: time.Now().UTC(), Config: d.cfg, Blocks: d.blocks, Pending: d.pending, Accounts: d.accounts, Validators: d.validators, Peers: d.validatorPeers, PeerSyncs: d.validatorPeerSyncs, Lots: d.lots, PayIntents: d.payIntents, Invoices: d.invoices, Refunds: d.refunds, Webhooks: d.webhookSignatures, PayEvents: d.payEvents, RiskLabels: d.riskLabels, Evidence: d.evidencePackets, Governance: d.governanceRequests, Appeals: d.trustAppeals, Tracking: d.trackingReviews, AIPerms: d.aiPermissions, AIActions: d.aiActions, Transp: d.transparencyEntries, Delegation: d.resourceDelegations, Rentals: d.resourceRentals, Income: d.resourceIncome, Policy: d.resourcePolicy, Pools: d.resourcePools, Sponsors: d.resourceSponsorships, SponsorIDs: d.resourceSponsorIdem, ActionRefs: d.resourceActionRefs, SponsorLog: d.resourceSponsorAudit, Contracts: d.contracts}
	snapshot.SponsorIntegrity = resourceSponsorSnapshotIntegrity(snapshot)
	return snapshot
}

func (d *Devnet) applySnapshotLocked(snapshot devnetSnapshot) {
	d.blocks, d.pending, d.accounts, d.validators, d.validatorPeers, d.validatorPeerSyncs, d.lots, d.payIntents = snapshot.Blocks, snapshot.Pending, snapshot.Accounts, snapshot.Validators, snapshot.Peers, snapshot.PeerSyncs, snapshot.Lots, snapshot.PayIntents
	d.invoices, d.refunds, d.webhookSignatures, d.payEvents = snapshot.Invoices, snapshot.Refunds, snapshot.Webhooks, snapshot.PayEvents
	d.riskLabels, d.evidencePackets = snapshot.RiskLabels, snapshot.Evidence
	d.governanceRequests, d.trustAppeals, d.trackingReviews = snapshot.Governance, snapshot.Appeals, snapshot.Tracking
	d.aiPermissions, d.aiActions, d.transparencyEntries = snapshot.AIPerms, snapshot.AIActions, snapshot.Transp
	d.resourceDelegations, d.resourceRentals, d.resourceIncome, d.resourcePolicy, d.contracts = snapshot.Delegation, snapshot.Rentals, snapshot.Income, snapshot.Policy, snapshot.Contracts
	d.resourcePools, d.resourceSponsorships, d.resourceSponsorIdem = snapshot.Pools, snapshot.Sponsors, snapshot.SponsorIDs
	d.resourceActionRefs, d.resourceSponsorAudit = snapshot.ActionRefs, snapshot.SponsorLog
	d.ensureStateDefaults()
}
