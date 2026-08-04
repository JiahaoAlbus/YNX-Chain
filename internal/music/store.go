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

const currentStateSchemaVersion = 2

type stateDocumentHeader struct {
	SchemaVersion int `json:"schemaVersion"`
}

type stateMigration func(json.RawMessage) (json.RawMessage, error)

// Migrations are registered by source schema version and must advance exactly
// one version. Unknown and future schemas fail closed rather than being decoded
// opportunistically.
var stateMigrationRegistry = map[int]stateMigration{
	1: migrateStateV1ToV2,
}

func newState() persistentState {
	return persistentState{SchemaVersion: currentStateSchemaVersion, Profiles: map[string]Profile{}, Tracks: map[string]Track{}, Playlists: map[string]Playlist{}, Listeners: map[string]ListenerState{}, Usage: map[string]UsageRecord{}, Allocations: map[string]RevenueAllocation{}, Settlements: map[string]SettlementIntent{}, Cases: map[string]Case{}, AIProposals: map[string]AIProposal{}, Idempotency: map[string]string{}, Audit: []AuditEvent{}}
}

func loadState(path, mediaDir string) (persistentState, bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return newState(), false, nil
	}
	if err != nil {
		return persistentState{}, false, fmt.Errorf("read music state: %w", err)
	}
	var originalHeader stateDocumentHeader
	if err := json.Unmarshal(data, &originalHeader); err != nil {
		return persistentState{}, false, errors.New("music state schema is invalid")
	}
	state, err := decodePersistedState(data)
	if err != nil {
		return persistentState{}, false, err
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
	if originalHeader.SchemaVersion != currentStateSchemaVersion {
		if err := saveState(path, &state); err != nil {
			return persistentState{}, false, fmt.Errorf("persist migrated music state: %w", err)
		}
	}
	return state, true, nil
}

func decodePersistedState(data []byte) (persistentState, error) {
	migrated, err := migrateStateDocument(data, stateMigrationRegistry)
	if err != nil {
		return persistentState{}, err
	}
	var state persistentState
	if err := json.Unmarshal(migrated, &state); err != nil || state.SchemaVersion != currentStateSchemaVersion || state.IntegrityHash == "" {
		return persistentState{}, errors.New("music state schema or integrity hash is invalid")
	}
	return state, nil
}

func migrateStateDocument(data []byte, registry map[int]stateMigration) ([]byte, error) {
	current := append([]byte(nil), data...)
	for {
		var header stateDocumentHeader
		if err := json.Unmarshal(current, &header); err != nil {
			return nil, errors.New("music state schema is invalid")
		}
		if header.SchemaVersion <= 0 {
			return nil, fmt.Errorf("music state schema version %d is unsupported", header.SchemaVersion)
		}
		if header.SchemaVersion > currentStateSchemaVersion {
			return nil, fmt.Errorf("music state schema version %d is newer than supported version %d", header.SchemaVersion, currentStateSchemaVersion)
		}
		if header.SchemaVersion == currentStateSchemaVersion {
			return current, nil
		}
		migration, ok := registry[header.SchemaVersion]
		if !ok {
			return nil, fmt.Errorf("music state migration from schema version %d is unavailable", header.SchemaVersion)
		}
		next, err := migration(json.RawMessage(current))
		if err != nil {
			return nil, fmt.Errorf("migrate music state schema version %d: %w", header.SchemaVersion, err)
		}
		var nextHeader stateDocumentHeader
		if err := json.Unmarshal(next, &nextHeader); err != nil || nextHeader.SchemaVersion != header.SchemaVersion+1 {
			return nil, fmt.Errorf("music state migration from schema version %d did not advance exactly one version", header.SchemaVersion)
		}
		current = append(current[:0], next...)
	}
}

func migrateStateV1ToV2(raw json.RawMessage) (json.RawMessage, error) {
	var legacy persistentState
	if err := json.Unmarshal(raw, &legacy); err != nil || legacy.SchemaVersion != 1 || legacy.IntegrityHash == "" {
		return nil, errors.New("music state schema v1 document is invalid")
	}
	if legacy.Profiles == nil || legacy.Tracks == nil || legacy.Playlists == nil || legacy.Listeners == nil || legacy.Usage == nil || legacy.Allocations == nil || legacy.Settlements == nil || legacy.Cases == nil || legacy.AIProposals == nil || legacy.Idempotency == nil || legacy.Audit == nil {
		return nil, errors.New("music state schema v1 collections are invalid")
	}
	expected, err := stateIntegrity(legacy)
	if err != nil || expected != legacy.IntegrityHash {
		return nil, errors.New("music state schema v1 integrity verification failed")
	}
	if err := verifyAuditChain(legacy.Audit); err != nil {
		return nil, err
	}
	legacy.SchemaVersion = 2
	legacy.IntegrityHash, err = stateIntegrity(legacy)
	if err != nil {
		return nil, err
	}
	migrated, err := json.Marshal(legacy)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(migrated), nil
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
