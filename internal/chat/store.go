package chat

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
	return persistentState{SchemaVersion: 1, Devices: map[string]Device{}, Conversations: map[string]Conversation{}, Messages: map[string][]Message{}, Rotations: map[string]DeviceRotation{}, Idempotency: map[string]idempotencyRecord{}, Audit: []AuditEvent{}}
}

func loadState(path string) (persistentState, bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return newState(), false, nil
	}
	if err != nil {
		return persistentState{}, false, fmt.Errorf("read chat state: %w", err)
	}
	var state persistentState
	if err := json.Unmarshal(data, &state); err != nil {
		return persistentState{}, false, fmt.Errorf("decode chat state: %w", err)
	}
	if state.SchemaVersion != 1 || state.IntegrityHash == "" {
		return persistentState{}, false, errors.New("chat state schema or integrity hash is invalid")
	}
	if state.Devices == nil || state.Conversations == nil || state.Messages == nil || state.Idempotency == nil || state.Audit == nil {
		return persistentState{}, false, errors.New("chat state collections are invalid")
	}
	if state.Rotations == nil {
		state.Rotations = map[string]DeviceRotation{}
	}
	expected, err := stateIntegrity(state)
	if err != nil || expected != state.IntegrityHash {
		return persistentState{}, false, errors.New("chat state integrity verification failed")
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
		return fmt.Errorf("encode chat state: %w", err)
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create chat state directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".chat-state-*")
	if err != nil {
		return fmt.Errorf("create chat state temp file: %w", err)
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
		return fmt.Errorf("replace chat state: %w", err)
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
