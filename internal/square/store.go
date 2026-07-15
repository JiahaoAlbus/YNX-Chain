package square

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func newState() persistentState {
	return persistentState{SchemaVersion: 1, Devices: map[string]Device{}, Posts: map[string]Post{}, Comments: map[string][]Comment{}, Reactions: map[string]Reaction{}, Follows: map[string]Follow{}, Reports: map[string]Report{}, Profiles: map[string]Profile{}, Notifications: map[string]Notification{}, Idempotency: map[string]idempotencyRecord{}, Audit: []AuditEvent{}}
}

func loadState(path string) (persistentState, bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return newState(), false, nil
	}
	if err != nil {
		return persistentState{}, false, fmt.Errorf("read square state: %w", err)
	}
	var state persistentState
	if err := json.Unmarshal(data, &state); err != nil {
		return persistentState{}, false, fmt.Errorf("decode square state: %w", err)
	}
	if state.SchemaVersion != 1 || state.IntegrityHash == "" {
		return persistentState{}, false, errors.New("square state schema or integrity hash is invalid")
	}
	expected, err := stateIntegrity(state)
	if err != nil {
		return persistentState{}, false, errors.New("square state integrity verification failed")
	}
	if expected != state.IntegrityHash {
		legacyExpected, legacyErr := legacyStateIntegrity(state)
		if legacyErr != nil || legacyExpected != state.IntegrityHash {
			return persistentState{}, false, errors.New("square state integrity verification failed")
		}
	}
	normalizeState(&state)
	return state, true, nil
}

type legacyPersistentStateV1 struct {
	SchemaVersion int                          `json:"schemaVersion"`
	Devices       map[string]Device            `json:"devices"`
	Posts         map[string]Post              `json:"posts"`
	Comments      map[string][]Comment         `json:"comments"`
	Reactions     map[string]Reaction          `json:"reactions"`
	Follows       map[string]Follow            `json:"follows"`
	Reports       map[string]Report            `json:"reports"`
	Idempotency   map[string]idempotencyRecord `json:"idempotency"`
	Audit         []AuditEvent                 `json:"audit"`
	IntegrityHash string                       `json:"integrityHash"`
}

func legacyStateIntegrity(state persistentState) (string, error) {
	legacy := legacyPersistentStateV1{
		SchemaVersion: state.SchemaVersion,
		Devices:       state.Devices,
		Posts:         state.Posts,
		Comments:      state.Comments,
		Reactions:     state.Reactions,
		Follows:       state.Follows,
		Reports:       state.Reports,
		Idempotency:   state.Idempotency,
		Audit:         state.Audit,
	}
	data, err := json.Marshal(legacy)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:]), nil
}

func normalizeState(state *persistentState) {
	if state.Devices == nil {
		state.Devices = map[string]Device{}
	}
	if state.Posts == nil {
		state.Posts = map[string]Post{}
	}
	if state.Comments == nil {
		state.Comments = map[string][]Comment{}
	}
	if state.Reactions == nil {
		state.Reactions = map[string]Reaction{}
	}
	if state.Follows == nil {
		state.Follows = map[string]Follow{}
	}
	if state.Reports == nil {
		state.Reports = map[string]Report{}
	}
	if state.Profiles == nil {
		state.Profiles = map[string]Profile{}
	}
	if state.Notifications == nil {
		state.Notifications = map[string]Notification{}
	}
	if state.Idempotency == nil {
		state.Idempotency = map[string]idempotencyRecord{}
	}
	if state.Audit == nil {
		state.Audit = []AuditEvent{}
	}
}

func saveState(path string, state *persistentState) error {
	integrity, err := stateIntegrity(*state)
	if err != nil {
		return err
	}
	state.IntegrityHash = integrity
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode square state: %w", err)
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create square state directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".square-state-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

func stateIntegrity(state persistentState) (string, error) {
	state.IntegrityHash = ""
	data, err := json.Marshal(state)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:]), nil
}
