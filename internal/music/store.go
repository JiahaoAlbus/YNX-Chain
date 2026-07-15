package music

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
	return persistentState{SchemaVersion: 1, Profiles: map[string]Profile{}, Tracks: map[string]Track{}, Playlists: map[string]Playlist{}, Listeners: map[string]ListenerState{}, Usage: map[string]UsageRecord{}, Allocations: map[string]RevenueAllocation{}, Settlements: map[string]SettlementIntent{}, Cases: map[string]Case{}, AIProposals: map[string]AIProposal{}, Idempotency: map[string]string{}, Audit: []AuditEvent{}}
}

func loadState(path string) (persistentState, bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return newState(), false, nil
	}
	if err != nil {
		return persistentState{}, false, fmt.Errorf("read music state: %w", err)
	}
	var state persistentState
	if json.Unmarshal(data, &state) != nil || state.SchemaVersion != 1 || state.IntegrityHash == "" {
		return persistentState{}, false, errors.New("music state schema or integrity hash is invalid")
	}
	if state.Profiles == nil || state.Tracks == nil || state.Listeners == nil || state.Usage == nil || state.Audit == nil {
		return persistentState{}, false, errors.New("music state collections are invalid")
	}
	expected, err := stateIntegrity(state)
	if err != nil || expected != state.IntegrityHash {
		return persistentState{}, false, errors.New("music state integrity verification failed")
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
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".music-state-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err = tmp.Write(data); err == nil {
		err = tmp.Sync()
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(name, path); err != nil {
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
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}
