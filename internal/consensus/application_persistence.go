package consensus

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"

	abci "github.com/cometbft/cometbft/abci/types"
)

const ApplicationPersistencePath = "/node/persistence"
const ApplicationPersistenceVersion = "YNX-APPLICATION-PERSISTENCE/v1"

// This is an observation of this Application's original storage operations.
// It is neither a signed consensus proof nor an authority or finality grant.
type ApplicationPersistenceView struct {
	Version          string `json:"version"`
	Source           string `json:"source"`
	StateHeight      int64  `json:"stateHeight,string"`
	StateAppHash     string `json:"stateAppHash"`
	Storage          string `json:"storage"`
	Persistence      bool   `json:"persistence"`
	PersistenceError string `json:"persistenceError"`
}

func ValidateApplicationPersistenceView(v ApplicationPersistenceView) error {
	hash, err := hex.DecodeString(v.StateAppHash)
	if v.Version != ApplicationPersistenceVersion || v.Source != "ynx-abci" || v.StateHeight < 0 || err != nil || len(hash) != 32 || hex.EncodeToString(hash) != v.StateAppHash {
		return errors.New("invalid application persistence identity or coordinates")
	}
	switch v.Storage {
	case "memory", "atomic-json", "snapshot-journal-v1", "block-journal-v2":
	default:
		return errors.New("unknown application persistence storage")
	}
	if v.Persistence {
		if v.Storage == "memory" || v.PersistenceError != "" {
			return errors.New("invalid successful persistence observation")
		}
		return nil
	}
	if v.Storage == "memory" {
		if v.PersistenceError != "memory_only" {
			return errors.New("invalid in-memory persistence observation")
		}
		return nil
	}
	switch v.PersistenceError {
	case "not_persisted", "save_failed", "durability_uncertain", "source_unavailable", "source_changed", "checkpoint_unconfirmed":
		return nil
	default:
		return errors.New("unknown failed persistence observation")
	}
}

// Private, non-consensus metadata. Never enters a state hash, journal or
// snapshot. The first save error is retained until real persistence succeeds;
// the public view exposes a closed code, not paths from an os.PathError.
type applicationPersistenceObservation struct {
	height     int64
	hash       string
	file       os.FileInfo
	firstError error
	errorCode  string
}

func applicationPersistenceFile(path string) (os.FileInfo, error) {
	if strings.TrimSpace(path) == "" {
		return nil, nil
	}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
		return nil, errors.New("original persistence path is not a private regular file")
	}
	return info, nil
}

// Called only after the existing full load/Validate/directory Sync path. An
// absent path is a migration-only in-memory view, even with a configured name.
// Metadata checks cannot promote a file that was not actually loaded.
func (a *Application) observeLoadedPersistence(before os.FileInfo, beforeErr error) {
	if a.statePath == "" {
		return
	}
	after, err := applicationPersistenceFile(a.statePath)
	if beforeErr != nil || err != nil {
		a.persistence = applicationPersistenceObservation{errorCode: "source_unavailable", firstError: errors.Join(beforeErr, err)}
		return
	}
	if before == nil {
		if after != nil {
			a.persistence.errorCode = "source_changed"
		}
		return
	}
	if !samePQStateFile(before, after) {
		a.persistence = applicationPersistenceObservation{errorCode: "source_changed"}
		return
	}
	a.persistence = applicationPersistenceObservation{height: a.committed.Height, hash: a.committed.AppHash, file: after}
}

// Save already includes the original layout's validation, file Sync and
// publication/confirmation rules. This hook does not change its return value.
// The caller holds a.mu, or is still constructing the unpublished Application.
func (a *Application) observePersistenceResult(state CommittedState, err error) {
	if a.statePath == "" {
		a.persistence = applicationPersistenceObservation{}
		return
	}
	if err != nil {
		if a.persistence.firstError == nil {
			a.persistence.firstError = err
			a.persistence.errorCode = "save_failed"
			if errors.Is(err, ErrCommittedStateDurabilityUncertain) {
				a.persistence.errorCode = "durability_uncertain"
			}
		}
		return
	}
	// A newly opened snapshot journal contains only its migration-bound header.
	// Its initial state still comes from the supplied migration, not a saved
	// snapshot record. Only a real save/recovery of a record can acknowledge it.
	if a.journal != nil && a.journal.records == 0 {
		a.persistence = applicationPersistenceObservation{}
		return
	}
	info, statErr := applicationPersistenceFile(a.statePath)
	if statErr != nil || info == nil {
		a.persistence = applicationPersistenceObservation{errorCode: "source_unavailable", firstError: statErr}
		return
	}
	a.persistence = applicationPersistenceObservation{height: state.Height, hash: state.AppHash, file: info}
}

func (a *Application) persistenceViewLocked() ApplicationPersistenceView {
	v := ApplicationPersistenceView{Version: ApplicationPersistenceVersion, Source: "ynx-abci", StateHeight: a.committed.Height, StateAppHash: a.committed.AppHash, Storage: "memory", PersistenceError: "memory_only"}
	if a.statePath == "" {
		return v
	}
	v.Storage = "atomic-json"
	if a.journal != nil {
		v.Storage = "snapshot-journal-v1"
	}
	if a.blockJournal != nil {
		v.Storage = "block-journal-v2"
	}
	v.PersistenceError = a.persistence.errorCode
	if v.PersistenceError != "" {
		return v
	}
	if a.persistence.file == nil {
		v.PersistenceError = "not_persisted"
		return v
	}
	if a.persistence.height != a.committed.Height || a.persistence.hash != a.committed.AppHash {
		v.PersistenceError = "checkpoint_unconfirmed"
		return v
	}
	// Read-only metadata only: no replay, Sync, repair, cache promotion or writes
	// from a query. The observation must still refer to its original file.
	current, err := applicationPersistenceFile(a.statePath)
	if err != nil || current == nil {
		v.PersistenceError = "source_unavailable"
		return v
	}
	if !samePQStateFile(a.persistence.file, current) {
		v.PersistenceError = "source_changed"
		return v
	}
	v.Persistence = true
	return v
}

func (a *Application) queryPersistence(response *abci.ResponseQuery, request *abci.RequestQuery) bool {
	if request.Path != ApplicationPersistencePath {
		return false
	}
	if request.Prove || len(request.Data) != 0 || request.Height < 0 || request.Height != 0 && request.Height != a.committed.Height {
		response.Code, response.Log = 1, "persistence query supports current committed height only, without proof or data"
		return true
	}
	view := a.persistenceViewLocked()
	if err := ValidateApplicationPersistenceView(view); err != nil {
		response.Code, response.Log = 1, err.Error()
		return true
	}
	response.Value, _ = json.Marshal(view)
	return true
}
