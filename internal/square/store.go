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
	return persistentState{SchemaVersion: 1, Devices: map[string]Device{}, Posts: map[string]Post{}, Comments: map[string][]Comment{}, Reactions: map[string]Reaction{}, Follows: map[string]Follow{}, Reports: map[string]Report{}, Idempotency: map[string]idempotencyRecord{}, Audit: []AuditEvent{}}
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
	if err != nil || expected != state.IntegrityHash {
		return persistentState{}, false, errors.New("square state integrity verification failed")
	}
	return state, true, nil
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
