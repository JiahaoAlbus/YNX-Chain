package chain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
)

// NativeMigrationArchive owns the entire immutable native snapshot, including
// history and modules that cannot be reinterpreted as signed BFT records.
// It is stored once outside the mutable BFT state; its root is in the anchor.
type NativeMigrationArchive struct {
	snapshot      devnetSnapshot
	migrationHash string
	transactions  map[string][]nativeOriginTransactionLocation
}

type nativeOriginTransactionLocation struct{ block, index int }

type NativeOriginRecord struct {
	SourceArchiveRoot   string          `json:"sourceArchiveRoot"`
	Module              string          `json:"module"`
	ID                  string          `json:"id"`
	RecordHash          string          `json:"recordHash"`
	Record              json.RawMessage `json:"record"`
	SignatureProvenance string          `json:"signatureProvenance"`
}

// SaveConsensusMigrationBundle is an offline operation. Use a stopped, verified
// copy of the native ledger. It creates a new directory, never replaces one,
// and writes the anchor last so partial exports cannot be loaded as complete.
func (d *Devnet) SaveConsensusMigrationBundle(directory string) (ConsensusMigrationState, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return saveNativeMigrationBundle(directory, d.snapshotLocked())
}

// SaveConsensusMigrationBundleFromSnapshot never opens a producer or writes to
// the input. The caller supplies a private frozen v2 snapshot; unknown fields,
// incomplete writes, pending admissions and invalid history fail closed.
func SaveConsensusMigrationBundleFromSnapshot(sourcePath, directory string) (ConsensusMigrationState, error) {
	var snapshot devnetSnapshot
	if err := readPrivateMigrationJSON(sourcePath, &snapshot); err != nil {
		return ConsensusMigrationState{}, err
	}
	if snapshot.Version != devnetSnapshotVersion {
		return ConsensusMigrationState{}, errors.New("full migration source must be an integrity-sealed native v2 snapshot")
	}
	if err := validateDevnetSnapshotIntegrity(snapshot); err != nil {
		return ConsensusMigrationState{}, err
	}
	if err := validateReplicationBlockHistory(snapshot, snapshot.Config); err != nil {
		return ConsensusMigrationState{}, err
	}
	if err := validateResourceSponsorSnapshot(snapshot); err != nil {
		return ConsensusMigrationState{}, err
	}
	return saveNativeMigrationBundle(directory, snapshot)
}

func migrationBoundaryFromSnapshot(snapshot devnetSnapshot) (ConsensusMigrationState, error) {
	temporary := &Devnet{cfg: snapshot.Config, blocks: snapshot.Blocks, pending: snapshot.Pending, accounts: snapshot.Accounts, validators: snapshot.Validators, dexAssets: snapshot.DexAssets, dexBalances: snapshot.DexBalances, dexPools: snapshot.DexPools, dexEvents: snapshot.DexEvents, resourcePolicy: snapshot.Policy}
	return temporary.exportConsensusMigrationStateLocked()
}

func saveNativeMigrationBundle(directory string, snapshot devnetSnapshot) (ConsensusMigrationState, error) {
	state, err := migrationBoundaryFromSnapshot(snapshot)
	if err != nil {
		return ConsensusMigrationState{}, err
	}
	// SavedAt is export metadata. Normalize it to the committed tip time so the
	// archive root is reproducible; all 38 ledger/operational fields are retained.
	snapshot.SavedAt = snapshot.Blocks[len(snapshot.Blocks)-1].Time.UTC()
	snapshot, err = sealDevnetSnapshot(snapshot)
	if err != nil {
		return ConsensusMigrationState{}, err
	}
	state.Version = FullConsensusMigrationVersion
	state.SourceFormat = "ynx-devnet-state-v2"
	state.SourceArchiveRoot = snapshot.StateIntegrity
	state.StateHash, err = state.calculateHash()
	if err != nil {
		return ConsensusMigrationState{}, err
	}
	if err := state.Validate(); err != nil {
		return ConsensusMigrationState{}, err
	}
	if err := os.Mkdir(directory, 0700); err != nil {
		return ConsensusMigrationState{}, fmt.Errorf("create exclusive migration bundle: %w", err)
	}
	if err := writeDurableSnapshotJSON(filepath.Join(directory, "native-origin.json"), snapshot); err != nil {
		return ConsensusMigrationState{}, err
	}
	if err := writeDurableSnapshotJSON(filepath.Join(directory, "migration.json"), state); err != nil {
		return ConsensusMigrationState{}, err
	}
	if err := syncSnapshotDirectory(filepath.Dir(directory)); err != nil {
		return ConsensusMigrationState{}, err
	}
	return state, nil
}

func readPrivateMigrationJSON(path string, destination any) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return errors.New("migration bundle file must be private and regular")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return err
	}
	if !os.SameFile(info, opened) || !opened.Mode().IsRegular() || opened.Mode().Perm()&0077 != 0 {
		return errors.New("migration source changed while opening")
	}
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("migration bundle has trailing JSON")
	}
	after, err := file.Stat()
	if err != nil {
		return err
	}
	if after.Size() != opened.Size() || !after.ModTime().Equal(opened.ModTime()) {
		return errors.New("migration source changed while reading")
	}
	return nil
}

func LoadConsensusMigrationBundle(directory string) (ConsensusMigrationState, *NativeMigrationArchive, error) {
	var state ConsensusMigrationState
	if err := readPrivateMigrationJSON(filepath.Join(directory, "migration.json"), &state); err != nil {
		return state, nil, err
	}
	archive, err := LoadNativeMigrationArchive(filepath.Join(directory, "native-origin.json"), state)
	return state, archive, err
}

func LoadNativeMigrationArchive(path string, state ConsensusMigrationState) (*NativeMigrationArchive, error) {
	if err := state.Validate(); err != nil {
		return nil, err
	}
	if state.Version != FullConsensusMigrationVersion {
		return nil, errors.New("full native archive requires migration v2")
	}
	var snapshot devnetSnapshot
	if err := readPrivateMigrationJSON(path, &snapshot); err != nil {
		return nil, err
	}
	if snapshot.Version != devnetSnapshotVersion || snapshot.StateIntegrity != state.SourceArchiveRoot {
		return nil, errors.New("native archive root does not match migration")
	}
	if err := validateDevnetSnapshotIntegrity(snapshot); err != nil {
		return nil, err
	}
	if err := validateReplicationBlockHistory(snapshot, snapshot.Config); err != nil {
		return nil, err
	}
	if err := validateResourceSponsorSnapshot(snapshot); err != nil {
		return nil, err
	}
	// Reconcile the executable balance/nonce/DEX/policy boundary against the
	// archived source as well as its hash. Key bindings may be added afterward.
	expected, err := migrationBoundaryFromSnapshot(snapshot)
	if err != nil {
		return nil, err
	}
	if len(expected.Validators) != len(state.Validators) {
		return nil, errors.New("archive validator set differs")
	}
	for i := range expected.Validators {
		expected.Validators[i].ConsensusKeyType = state.Validators[i].ConsensusKeyType
		expected.Validators[i].ConsensusPubKey = state.Validators[i].ConsensusPubKey
		expected.Validators[i].ConsensusAddress = state.Validators[i].ConsensusAddress
	}
	expected.Version = FullConsensusMigrationVersion
	expected.SourceFormat = "ynx-devnet-state-v2"
	expected.SourceArchiveRoot = state.SourceArchiveRoot
	expected.StateHash, err = expected.calculateHash()
	if err != nil {
		return nil, err
	}
	if expected.StateHash != state.StateHash {
		return nil, errors.New("migration balances, nonces, DEX, policy or tip differ from archived source")
	}
	archive := &NativeMigrationArchive{snapshot: snapshot, migrationHash: state.StateHash, transactions: make(map[string][]nativeOriginTransactionLocation)}
	for blockIndex, block := range snapshot.Blocks {
		for txIndex, tx := range block.Transactions {
			hash := strings.ToLower(strings.TrimPrefix(tx.Hash, "0x"))
			archive.transactions[hash] = append(archive.transactions[hash], nativeOriginTransactionLocation{blockIndex, txIndex})
		}
	}
	return archive, nil
}

func (a *NativeMigrationArchive) Root() string {
	if a == nil {
		return ""
	}
	return a.snapshot.StateIntegrity
}

// Record returns a detached original map record. Its digest is a reference
// bound to this validated archive, not a standalone Merkle inclusion proof.
// Original BFT signatures are never inferred.
func (a *NativeMigrationArchive) Record(module, id string) (NativeOriginRecord, error) {
	if a == nil {
		return NativeOriginRecord{}, errors.New("native origin archive unavailable")
	}
	if module == "transactions" {
		return a.transactionRecord(id)
	}
	value := reflect.ValueOf(a.snapshot)
	kind := value.Type()
	for i := 0; i < kind.NumField(); i++ {
		if strings.Split(kind.Field(i).Tag.Get("json"), ",")[0] != module {
			continue
		}
		field := value.Field(i)
		if field.Kind() != reflect.Map || field.Type().Key().Kind() != reflect.String {
			return NativeOriginRecord{}, errors.New("native origin module is not keyed by record ID")
		}
		record := field.MapIndex(reflect.ValueOf(id))
		if !record.IsValid() {
			return NativeOriginRecord{}, os.ErrNotExist
		}
		payload, err := json.Marshal(record.Interface())
		if err != nil {
			return NativeOriginRecord{}, err
		}
		return a.originRecord(module, id, payload)
	}
	return NativeOriginRecord{}, errors.New("unknown native origin module")
}

func (a *NativeMigrationArchive) MatchesMigration(state ConsensusMigrationState) bool {
	return a != nil && a.Root() == state.SourceArchiveRoot && a.migrationHash == state.StateHash
}

func (a *NativeMigrationArchive) originRecord(module, id string, payload json.RawMessage) (NativeOriginRecord, error) {
	document := struct {
		Domain string          `json:"domain"`
		Root   string          `json:"sourceArchiveRoot"`
		Module string          `json:"module"`
		ID     string          `json:"id"`
		Record json.RawMessage `json:"record"`
	}{"YNX_NATIVE_ORIGIN_RECORD_V1", a.Root(), module, id, payload}
	encoded, err := json.Marshal(document)
	if err != nil {
		return NativeOriginRecord{}, err
	}
	digest := sha256.Sum256(encoded)
	return NativeOriginRecord{a.Root(), module, id, hex.EncodeToString(digest[:]), payload, "original-native-record; no BFT signature inferred"}, nil
}

func (a *NativeMigrationArchive) transactionRecord(hash string) (NativeOriginRecord, error) {
	normalized := strings.ToLower(strings.TrimPrefix(hash, "0x"))
	raw, err := hex.DecodeString(normalized)
	if err != nil || len(raw) != sha256.Size {
		return NativeOriginRecord{}, errors.New("native origin transaction hash must be 32 bytes")
	}
	locations := a.transactions[normalized]
	if len(locations) == 0 {
		return NativeOriginRecord{}, os.ErrNotExist
	}
	if len(locations) != 1 {
		return NativeOriginRecord{}, errors.New("native origin transaction hash is ambiguous across archived history")
	}
	location := locations[0]
	block := a.snapshot.Blocks[location.block]
	tx := block.Transactions[location.index]
	found, err := json.Marshal(struct {
		Transaction Transaction `json:"transaction"`
		BlockHeight uint64      `json:"blockHeight"`
		BlockHash   string      `json:"blockHash"`
		Index       int         `json:"transactionIndex"`
	}{tx, block.Height, block.Hash, location.index})
	if err != nil {
		return NativeOriginRecord{}, err
	}
	return a.originRecord("transactions", "0x"+normalized, found)
}
