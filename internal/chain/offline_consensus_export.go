package chain

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// ExportConsensusMigrationCheckpoint reads an existing, quiescent native
// checkpoint without opening a producer or changing the source. Startup member,
// network and feature overrides are deliberately not inputs: the checkpoint is
// the source of its original identity. V2 export retains the existing canonical
// runtime normalization and validation; this is not a new snapshot format.
//
// Use an offline copy. Re-reading detects ordinary concurrent writes/replacement,
// but cannot turn a self-sealed file into an independent trusted checkpoint or
// recover an earlier process's unrecorded fsync outcome. Incomplete marker/temp
// artifacts are retained and refused, not repaired by this read-only operation.
func ExportConsensusMigrationCheckpoint(dataDir string) (ConsensusMigrationState, error) {
	if dataDir == "" {
		return ConsensusMigrationState{}, errors.New("offline consensus export requires an existing data directory")
	}
	snapshotPath := filepath.Join(dataDir, "devnet-state.json")
	markerPath := filepath.Join(dataDir, "devnet-state.integrity-version")
	if err := rejectOfflineConsensusTemps(snapshotPath, markerPath); err != nil {
		return ConsensusMigrationState{}, err
	}
	original, err := readOfflineConsensusFile(snapshotPath, false)
	if err != nil {
		return ConsensusMigrationState{}, err
	}
	marker, err := readOfflineConsensusFile(markerPath, true)
	if err != nil {
		return ConsensusMigrationState{}, err
	}
	var snapshot devnetSnapshot
	decoder := json.NewDecoder(bytes.NewReader(original.data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&snapshot); err != nil {
		return ConsensusMigrationState{}, fmt.Errorf("decode offline checkpoint: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return ConsensusMigrationState{}, errors.New("offline checkpoint must contain exactly one JSON document")
	}
	switch snapshot.Version {
	case legacyDevnetSnapshotVersion:
		if marker.info != nil {
			return ConsensusMigrationState{}, errors.New("legacy checkpoint cannot follow an integrity-version marker")
		}
	case devnetSnapshotVersion, pqDevnetSnapshotVersion:
		if marker.info == nil || string(marker.data) != fmt.Sprintf("%d\n", snapshot.Version) {
			return ConsensusMigrationState{}, errors.New("offline checkpoint requires its exact committed integrity-version marker")
		}
	default:
		return ConsensusMigrationState{}, fmt.Errorf("unsupported offline checkpoint version %d", snapshot.Version)
	}
	if err := validateReplicationSnapshot(snapshot, snapshot.Config); err != nil {
		return ConsensusMigrationState{}, fmt.Errorf("validate offline checkpoint: %w", err)
	}
	// Do not use NewDevnet/applySnapshotLocked/ensureStateDefaults: they can
	// generate genesis, inject accounts or normalize validator authority. This
	// private view carries only decoded source fields and has no persistence path.
	view := offlineConsensusView(snapshot)
	state, err := view.ExportConsensusMigrationState()
	if err != nil {
		return ConsensusMigrationState{}, err
	}
	for _, source := range []offlineConsensusFile{original, marker} {
		if err := source.unchanged(); err != nil {
			return ConsensusMigrationState{}, err
		}
	}
	if err := rejectOfflineConsensusTemps(snapshotPath, markerPath); err != nil {
		return ConsensusMigrationState{}, err
	}
	return state, nil
}

type offlineConsensusFile struct {
	path string
	info os.FileInfo
	data []byte
}

func readOfflineConsensusFile(path string, optional bool) (offlineConsensusFile, error) {
	source := offlineConsensusFile{path: path}
	info, err := os.Lstat(path)
	if optional && errors.Is(err, os.ErrNotExist) {
		return source, nil
	}
	if err != nil {
		return source, fmt.Errorf("read offline checkpoint file %s: %w", path, err)
	}
	if !info.Mode().IsRegular() {
		return source, fmt.Errorf("offline checkpoint file must be regular, not a symlink: %s", path)
	}
	file, err := os.Open(path)
	if err != nil {
		return source, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return source, err
	}
	if !os.SameFile(info, opened) || !opened.Mode().IsRegular() {
		return source, errors.New("offline checkpoint changed while opening")
	}
	source.data, err = io.ReadAll(file)
	if err != nil {
		return source, err
	}
	after, err := file.Stat()
	if err != nil {
		return source, err
	}
	if !sameOfflineConsensusFile(opened, after) || int64(len(source.data)) != after.Size() {
		return source, errors.New("offline checkpoint changed while reading")
	}
	source.info = after
	return source, nil
}

func sameOfflineConsensusFile(a, b os.FileInfo) bool {
	return os.SameFile(a, b) && a.Size() == b.Size() && a.ModTime().Equal(b.ModTime()) && a.Mode() == b.Mode()
}

func (source offlineConsensusFile) unchanged() error {
	changed := fmt.Errorf("offline checkpoint changed during export: %s", source.path)
	info, err := os.Lstat(source.path)
	if source.info == nil && errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if source.info == nil || !info.Mode().IsRegular() || !sameOfflineConsensusFile(source.info, info) {
		return changed
	}
	file, err := os.Open(source.path)
	if err != nil {
		return err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return err
	}
	if !opened.Mode().IsRegular() || !sameOfflineConsensusFile(info, opened) {
		return changed
	}
	// The original bytes are already retained for decoding. Compare this second
	// read through a fixed buffer instead of allocating another checkpoint-sized
	// byte slice. Initial loading/JSON parsing and V2 export still allocate.
	var buffer [64 << 10]byte
	offset := 0
	for {
		n, readErr := file.Read(buffer[:])
		if n > len(source.data)-offset || !bytes.Equal(buffer[:n], source.data[offset:offset+n]) {
			return changed
		}
		offset += n
		if readErr == io.EOF {
			if offset != len(source.data) {
				return changed
			}
			break
		}
		if readErr != nil {
			return readErr
		}
		if n == 0 {
			return io.ErrNoProgress
		}
	}
	after, err := file.Stat()
	if err != nil {
		return err
	}
	finalPath, err := os.Lstat(source.path)
	if err != nil {
		return err
	}
	if !sameOfflineConsensusFile(opened, after) || !finalPath.Mode().IsRegular() || !sameOfflineConsensusFile(after, finalPath) {
		return changed
	}
	return nil
}

func rejectOfflineConsensusTemps(paths ...string) error {
	for _, path := range paths {
		if _, err := os.Lstat(path + ".tmp"); !errors.Is(err, os.ErrNotExist) {
			if err != nil {
				return err
			}
			return fmt.Errorf("offline checkpoint has an unresolved temporary artifact; preserve and reconcile %s.tmp", path)
		}
	}
	return nil
}

func offlineConsensusView(s devnetSnapshot) *Devnet {
	return &Devnet{
		pqBatches: s.PQBatches, accountPolicy: s.AccountPolicy,
		cfg: s.Config, blocks: s.Blocks, pending: s.Pending, accounts: s.Accounts,
		validators: s.Validators, validatorPeers: s.Peers, validatorPeerSyncs: s.PeerSyncs,
		lots: s.Lots, payIntents: s.PayIntents, invoices: s.Invoices, refunds: s.Refunds,
		paySettlements: s.PaySettlements, webhookSignatures: s.Webhooks, payEvents: s.PayEvents,
		riskLabels: s.RiskLabels, evidencePackets: s.Evidence, governanceRequests: s.Governance,
		trustAppeals: s.Appeals, trackingReviews: s.Tracking, aiPermissions: s.AIPerms,
		aiActions: s.AIActions, transparencyEntries: s.Transp,
		resourceDelegations: s.Delegation, resourceRentals: s.Rentals, resourceIncome: s.Income,
		resourcePolicy: s.Policy, resourcePools: s.Pools, resourceSponsorships: s.Sponsors,
		resourceSponsorIdem: s.SponsorIDs, resourceActionRefs: s.ActionRefs, resourceSponsorAudit: s.SponsorLog,
		contracts: s.Contracts, dexAssets: s.DexAssets, dexBalances: s.DexBalances, dexPools: s.DexPools, dexEvents: s.DexEvents,
	}
}
