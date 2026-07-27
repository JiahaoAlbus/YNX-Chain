package music

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func newState() persistentState {
	return persistentState{SchemaVersion: 1, Profiles: map[string]Profile{}, Tracks: map[string]Track{}, Playlists: map[string]Playlist{}, Listeners: map[string]ListenerState{}, Usage: map[string]UsageRecord{}, Allocations: map[string]RevenueAllocation{}, Settlements: map[string]SettlementIntent{}, Cases: map[string]Case{}, AIProposals: map[string]AIProposal{}, Idempotency: map[string]string{}, Audit: []AuditEvent{}}
}

func loadState(path, mediaDir string) (persistentState, bool, error) {
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
	if state.Profiles == nil || state.Tracks == nil || state.Playlists == nil || state.Listeners == nil || state.Usage == nil || state.Allocations == nil || state.Settlements == nil || state.Cases == nil || state.AIProposals == nil || state.Idempotency == nil || state.Audit == nil {
		return persistentState{}, false, errors.New("music state collections are invalid")
	}
	expected, err := stateIntegrity(state)
	if err != nil || expected != state.IntegrityHash {
		return persistentState{}, false, errors.New("music state integrity verification failed")
	}
	if err := verifyAuditChain(state.Audit); err != nil {
		return persistentState{}, false, err
	}
	for id, track := range state.Tracks {
		if track.ID != id || !validStoredTrackID(id) {
			return persistentState{}, false, fmt.Errorf("music track identity is invalid: %q", id)
		}
		track.AudioFile = filepath.Join(mediaDir, id+".wav")
		if err := verifyPrivateMedia(track.AudioFile, track.AudioSHA256); err != nil {
			return persistentState{}, false, fmt.Errorf("music audio integrity verification failed for %s: %w", id, err)
		}
		if track.ArtworkSHA256 != "" {
			track.ArtworkFile = filepath.Join(mediaDir, id+".art")
			if err := verifyPrivateMedia(track.ArtworkFile, track.ArtworkSHA256); err != nil {
				return persistentState{}, false, fmt.Errorf("music artwork integrity verification failed for %s: %w", id, err)
			}
		} else if track.ArtworkMIME != "" {
			return persistentState{}, false, fmt.Errorf("music artwork metadata is inconsistent for %s", id)
		}
		state.Tracks[id] = track
	}
	return state, true, nil
}

func verifyAuditChain(audit []AuditEvent) error {
	previous := ""
	for i, event := range audit {
		if event.Sequence != uint64(i+1) {
			return fmt.Errorf("music audit sequence verification failed at %d", i+1)
		}
		if event.Type == "" || event.ObjectID == "" || event.Actor == "" || event.At.IsZero() || !validSHA256Hex(event.PayloadHash) {
			return fmt.Errorf("music audit fields are invalid at sequence %d", event.Sequence)
		}
		if event.PreviousHash != previous {
			return fmt.Errorf("music audit previous hash verification failed at sequence %d", event.Sequence)
		}
		if !validSHA256Hex(event.Hash) {
			return fmt.Errorf("music audit hash encoding is invalid at sequence %d", event.Sequence)
		}
		candidate := event
		candidate.Hash = ""
		if expected := hashJSON(candidate); expected != event.Hash {
			return fmt.Errorf("music audit hash verification failed at sequence %d", event.Sequence)
		}
		previous = event.Hash
	}
	return nil
}

func validStoredTrackID(id string) bool {
	if len(id) != 28 || !strings.HasPrefix(id, "trk_") {
		return false
	}
	decoded, err := hex.DecodeString(id[4:])
	return err == nil && len(decoded) == 12
}

func validSHA256Hex(value string) bool {
	if len(value) != sha256.Size*2 || value != strings.ToLower(value) {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

func verifyPrivateMedia(path, expectedHash string) error {
	if !validSHA256Hex(expectedHash) {
		return errors.New("invalid expected SHA-256")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("media object is not a regular file")
	}
	if info.Mode().Perm()&0o077 != 0 {
		return fmt.Errorf("media permissions are too broad: %04o", info.Mode().Perm())
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	if actual := hex.EncodeToString(h.Sum(nil)); actual != expectedHash {
		return errors.New("media SHA-256 mismatch")
	}
	return nil
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
