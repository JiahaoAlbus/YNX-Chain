package chain

import (
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
)

// ErrOfflinePQCopyUnknown means the new target was reserved; its original
// contents must be inspected and retained rather than automatically retried.
var ErrOfflinePQCopyUnknown = errors.New("offline PQ copy outcome UNKNOWN; retain the original target")

type OfflinePQCopyPins struct {
	OriginalGenesisHash string
	SourceStateHash     string
	SourceHeight        uint64
	AdmissionHeight     uint64
}

type OfflinePQCopyResult struct {
	Version              string `json:"version"`
	Classification       string `json:"classification"`
	CopyDirectory        string `json:"copyDirectory"`
	SourceHeight         uint64 `json:"sourceHeight,string"`
	OriginalGenesisHash  string `json:"originalGenesisHash"`
	SourceStateHash      string `json:"sourceStateHash"`
	ScheduledStateHash   string `json:"scheduledStateHash"`
	AdmissionHeight      uint64 `json:"admissionHeight,string"`
	SourceStopProven     bool   `json:"sourceStopProven"`
	ActivationAuthorized bool   `json:"activationAuthorized"`
	PinOriginVerified    bool   `json:"pinOriginVerified"`
}

func offlinePQHash(s string) bool {
	b, err := hex.DecodeString(s)
	return err == nil && len(b) == 32 && hex.EncodeToString(b) == s
}

// Owner metadata differs by platform. Missing/unsupported Uid or an unknown
// effective user is never accepted as ownership of the private directory.
func offlinePQOwnedByEffectiveUser(info os.FileInfo) bool {
	if info == nil || os.Geteuid() < 0 {
		return false
	}
	v := reflect.Indirect(reflect.ValueOf(info.Sys()))
	if !v.IsValid() || v.Kind() != reflect.Struct {
		return false
	}
	uid := v.FieldByName("Uid")
	return uid.IsValid() && uid.Kind() == reflect.Uint32 && uid.Uint() == uint64(os.Geteuid())
}

func syncOfflinePQDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	return errors.Join(f.Sync(), f.Close())
}

// PrepareOfflinePQScheduledCopy creates only a new private target, from the
// complete validated source and explicit caller pins. It cannot prove that a
// source process was stopped, that pins are independently trusted, or that a
// same-user adversary did not mutate paths. It starts no listener or producer.
func PrepareOfflinePQScheduledCopy(source, target string, pins OfflinePQCopyPins) (result OfflinePQCopyResult, resultErr error) {
	return prepareOfflinePQScheduledCopy(source, target, pins, nil)
}

// afterSchedule is an in-package fault-injection hook. Production always
// passes nil; it never supplies an operation or an alternate source.
func prepareOfflinePQScheduledCopy(source, target string, pins OfflinePQCopyPins, afterSchedule func() error) (result OfflinePQCopyResult, resultErr error) {
	if !offlinePQHash(pins.OriginalGenesisHash) || !offlinePQHash(pins.SourceStateHash) || pins.AdmissionHeight == 0 || pins.AdmissionHeight <= pins.SourceHeight {
		return result, errors.New("explicit canonical genesis, source state, height and future admission pins required")
	}
	for _, path := range []string{source, target} {
		if !filepath.IsAbs(path) || filepath.Clean(path) != path {
			return result, errors.New("source and new target must be canonical absolute paths")
		}
	}
	realSource, err := filepath.EvalSymlinks(source)
	if err != nil || realSource != source {
		return result, errors.New("source must be an existing unaliased directory")
	}
	parent := filepath.Dir(target)
	realParent, err := filepath.EvalSymlinks(parent)
	if err != nil || realParent != parent {
		return result, errors.New("target parent must be an existing unaliased private directory")
	}
	info, err := os.Lstat(parent)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return result, errors.New("target parent must be a private 0700 directory")
	}
	if !offlinePQOwnedByEffectiveUser(info) {
		return result, errors.New("target parent must be owned by the effective user")
	}
	rel, err := filepath.Rel(source, target)
	if err != nil || rel == "." || rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return result, errors.New("target cannot be the source or inside it")
	}
	before, err := ExportConsensusMigrationCheckpoint(source)
	if err != nil {
		return result, err
	}
	if before.OriginalGenesisHash != pins.OriginalGenesisHash || before.StateHash != pins.SourceStateHash || before.Height != pins.SourceHeight {
		return result, errors.New("source does not match the independently supplied pins")
	}
	if before.AccountPolicy != nil && before.AccountPolicy.EnableAt != pins.AdmissionHeight {
		return result, errors.New("existing account PQ policy cannot be replaced")
	}
	d, err := before.RestoreSourceRuntime()
	if err != nil {
		return result, err
	}
	if err := os.Mkdir(target, 0700); err != nil {
		return result, err
	}
	defer func() {
		if resultErr != nil {
			result = OfflinePQCopyResult{}
			resultErr = errors.Join(ErrOfflinePQCopyUnknown, resultErr)
		}
	}()
	if err := syncOfflinePQDirectory(parent); err != nil {
		return result, err
	}
	dir, err := os.Open(target)
	if err != nil {
		return result, err
	}
	defer func() { resultErr = errors.Join(resultErr, dir.Close()) }()
	held, err := dir.Stat()
	if err != nil {
		return result, err
	}
	checkTarget := func() error {
		current, err := os.Lstat(target)
		if err != nil || !current.IsDir() || !os.SameFile(held, current) || current.Mode().Perm() != 0700 {
			return errors.New("new target directory changed during preparation")
		}
		if !offlinePQOwnedByEffectiveUser(current) {
			return errors.New("new target directory owner changed during preparation")
		}
		return nil
	}
	if err := checkTarget(); err != nil {
		return result, err
	}
	d.dataDir = target
	if err := d.persistSnapshot(); err != nil {
		return result, err
	}
	if err := checkTarget(); err != nil {
		return result, err
	}
	initial, err := ExportConsensusMigrationCheckpoint(target)
	if err != nil || !reflect.DeepEqual(initial, before) {
		return result, errors.Join(errors.New("new persisted copy differs from complete source"), err)
	}
	if err := d.EnableAccountPQ(pins.AdmissionHeight); err != nil {
		return result, err
	}
	if afterSchedule != nil {
		if err := afterSchedule(); err != nil {
			return result, err
		}
	}
	if err := checkTarget(); err != nil {
		return result, err
	}
	// Exercise the ordinary persisted constructor on the exclusively created
	// target, then re-export from its durable files rather than from memory.
	if _, err := NewPersistentDevnet(before.Network, target); err != nil {
		return result, err
	}
	if err := checkTarget(); err != nil {
		return result, err
	}
	after, err := ExportConsensusMigrationCheckpoint(target)
	if err != nil {
		return result, err
	}
	if err := VerifyConsensusPQSchedulePreservation(before, after, pins.AdmissionHeight); err != nil {
		return result, err
	}
	last, err := ExportConsensusMigrationCheckpoint(source)
	if err != nil || !reflect.DeepEqual(last, before) {
		return result, errors.Join(errors.New("source changed during copy preparation"), err)
	}
	if err := checkTarget(); err != nil {
		return result, err
	}
	if err := dir.Sync(); err != nil {
		return result, err
	}
	return OfflinePQCopyResult{Version: "YNX-OFFLINE-PQ-SCHEDULED-COPY/v1", Classification: "DATA", CopyDirectory: target, SourceHeight: before.Height, OriginalGenesisHash: before.OriginalGenesisHash, SourceStateHash: before.StateHash, ScheduledStateHash: after.StateHash, AdmissionHeight: pins.AdmissionHeight}, nil
}
