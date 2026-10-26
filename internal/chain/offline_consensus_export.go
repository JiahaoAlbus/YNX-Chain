package chain

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
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
func ExportConsensusMigrationCheckpoint(dataDir string) (state ConsensusMigrationState, resultErr error) {
	if dataDir == "" {
		return state, errors.New("offline consensus export requires an existing data directory")
	}
	snapshotPath := filepath.Join(dataDir, "devnet-state.json")
	markerPath := filepath.Join(dataDir, "devnet-state.integrity-version")
	if err := rejectOfflineConsensusTemps(snapshotPath, markerPath); err != nil {
		return state, err
	}
	original, err := openOfflineConsensusFile(snapshotPath, false)
	if err != nil {
		return state, err
	}
	defer func() {
		if err := original.close(); err != nil {
			state = ConsensusMigrationState{}
			resultErr = errors.Join(resultErr, err)
		}
	}()
	marker, err := readOfflineConsensusFile(markerPath, true)
	if err != nil {
		return state, err
	}
	defer func() {
		if err := marker.close(); err != nil {
			state = ConsensusMigrationState{}
			resultErr = errors.Join(resultErr, err)
		}
	}()

	// Hash the bytes consumed by the typed streaming decoder on the original
	// held descriptor. There is no checkpoint-sized raw buffer or root Decode.
	digest := sha256.New()
	snapshot, err := decodeOfflineConsensusSnapshot(io.TeeReader(original.file, digest))
	if err != nil {
		return state, fmt.Errorf("decode offline checkpoint: %w", err)
	}
	position, err := original.file.Seek(0, io.SeekCurrent)
	if err != nil {
		return state, err
	}
	if position != original.info.Size() {
		return state, errors.New("offline checkpoint changed while decoding")
	}
	if err := original.checkIdentity(); err != nil {
		return state, err
	}
	copy(original.fingerprint[:], digest.Sum(nil))
	original.fingerprinted = true

	switch snapshot.Version {
	case legacyDevnetSnapshotVersion:
		if marker.info != nil {
			return state, errors.New("legacy checkpoint cannot follow an integrity-version marker")
		}
	case devnetSnapshotVersion, pqDevnetSnapshotVersion:
		if marker.info == nil {
			return state, errors.New("offline checkpoint requires its exact committed integrity-version marker")
		}
		if err := marker.matchMarker(fmt.Sprintf("%d\n", snapshot.Version)); err != nil {
			return state, err
		}
	default:
		return state, fmt.Errorf("unsupported offline checkpoint version %d", snapshot.Version)
	}
	if err := validateReplicationSnapshot(snapshot, snapshot.Config); err != nil {
		return state, fmt.Errorf("validate offline checkpoint: %w", err)
	}
	// The decoder owns all fields and validation is complete. Transfer that
	// ownership to the existing V2 exporter instead of cloning a live Devnet.
	state, err = exportOwnedConsensusMigrationSnapshot(snapshot)
	if err != nil {
		return ConsensusMigrationState{}, err
	}
	for _, source := range []*offlineConsensusFile{&original, &marker} {
		if err := source.unchanged(); err != nil {
			return ConsensusMigrationState{}, err
		}
	}
	if err := rejectOfflineConsensusTemps(snapshotPath, markerPath); err != nil {
		return ConsensusMigrationState{}, err
	}
	for _, source := range []*offlineConsensusFile{&original, &marker} {
		if err := source.checkIdentity(); err != nil {
			return ConsensusMigrationState{}, err
		}
	}
	return state, nil
}

type offlineConsensusFile struct {
	path          string
	info          os.FileInfo
	file          *os.File
	fingerprint   [sha256.Size]byte
	fingerprinted bool
}

func openOfflineConsensusFile(path string, optional bool) (offlineConsensusFile, error) {
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
	source.info, source.file = info, file
	if err := source.checkIdentity(); err != nil {
		return offlineConsensusFile{path: path}, errors.Join(err, file.Close())
	}
	return source, nil
}

// The small marker and file-identity tests use the same fixed-buffer digest
// path. The large snapshot instead fingerprints during its streaming decode.
func readOfflineConsensusFile(path string, optional bool) (offlineConsensusFile, error) {
	source, err := openOfflineConsensusFile(path, optional)
	if err != nil || source.file == nil {
		return source, err
	}
	fingerprint, err := source.hashHeldFile()
	if err != nil {
		return offlineConsensusFile{path: path}, errors.Join(err, source.close())
	}
	source.fingerprint, source.fingerprinted = fingerprint, true
	return source, nil
}

func sameOfflineConsensusFile(a, b os.FileInfo) bool {
	return os.SameFile(a, b) && a.Size() == b.Size() && a.ModTime().Equal(b.ModTime()) && a.Mode() == b.Mode()
}

func sameOfflineConsensusIdentity(a, b os.FileInfo) bool {
	if !sameOfflineConsensusFile(a, b) {
		return false
	}
	// Sys differs across supported GOOSes. Compare the available Unix owner,
	// link and change-time fields without coupling this reader to syscall.Stat_t.
	// Access time is deliberately excluded: our own read may update it.
	x, y := reflect.Indirect(reflect.ValueOf(a.Sys())), reflect.Indirect(reflect.ValueOf(b.Sys()))
	if !x.IsValid() || !y.IsValid() || x.Type() != y.Type() {
		return !x.IsValid() && !y.IsValid()
	}
	if x.Kind() != reflect.Struct {
		return reflect.DeepEqual(a.Sys(), b.Sys())
	}
	for _, name := range []string{"Uid", "Gid", "Nlink", "Ctim", "Ctimespec"} {
		left, right := x.FieldByName(name), y.FieldByName(name)
		if left.IsValid() != right.IsValid() || left.IsValid() && !reflect.DeepEqual(left.Interface(), right.Interface()) {
			return false
		}
	}
	return true
}

func (source offlineConsensusFile) checkIdentity() error {
	changed := fmt.Errorf("offline checkpoint changed during export: %s", source.path)
	pathInfo, err := os.Lstat(source.path)
	if source.info == nil && source.file == nil && errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if source.info == nil || source.file == nil || !pathInfo.Mode().IsRegular() || !sameOfflineConsensusIdentity(source.info, pathInfo) {
		return changed
	}
	fdInfo, err := source.file.Stat()
	if err != nil {
		return err
	}
	if !fdInfo.Mode().IsRegular() || !sameOfflineConsensusIdentity(source.info, fdInfo) {
		return changed
	}
	return nil
}

func (source offlineConsensusFile) hashHeldFile() ([sha256.Size]byte, error) {
	var result [sha256.Size]byte
	if err := source.checkIdentity(); err != nil {
		return result, err
	}
	if _, err := source.file.Seek(0, io.SeekStart); err != nil {
		return result, err
	}
	digest := sha256.New()
	var buffer [64 << 10]byte
	var count int64
	for {
		n, err := source.file.Read(buffer[:])
		if n > 0 {
			_, _ = digest.Write(buffer[:n])
			count += int64(n)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return result, err
		}
		if n == 0 {
			return result, io.ErrNoProgress
		}
	}
	if count != source.info.Size() {
		return result, errors.New("offline checkpoint size changed while hashing")
	}
	if err := source.checkIdentity(); err != nil {
		return result, err
	}
	copy(result[:], digest.Sum(nil))
	return result, nil
}

func (source offlineConsensusFile) unchanged() error {
	if source.info == nil {
		return source.checkIdentity()
	}
	if !source.fingerprinted {
		return errors.New("offline checkpoint has no original fingerprint")
	}
	actual, err := source.hashHeldFile()
	if err != nil {
		return err
	}
	if actual != source.fingerprint {
		return fmt.Errorf("offline checkpoint bytes changed during export: %s", source.path)
	}
	return nil
}

func (source offlineConsensusFile) matchMarker(expected string) error {
	if err := source.checkIdentity(); err != nil {
		return err
	}
	if source.info.Size() != int64(len(expected)) {
		return errors.New("offline checkpoint requires its exact committed integrity-version marker")
	}
	if _, err := source.file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	actual := make([]byte, len(expected))
	if _, err := io.ReadFull(source.file, actual); err != nil {
		return err
	}
	if string(actual) != expected {
		return errors.New("offline checkpoint requires its exact committed integrity-version marker")
	}
	return source.checkIdentity()
}

func (source offlineConsensusFile) close() error {
	if source.file != nil {
		return source.file.Close()
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
