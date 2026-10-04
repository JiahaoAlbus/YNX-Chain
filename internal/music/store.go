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

const currentStateSchemaVersion = 5

type stateDocumentHeader struct {
	SchemaVersion int `json:"schemaVersion"`
}

type stateMigration func(json.RawMessage) (json.RawMessage, error)

// Migrations are registered by source schema version and must advance exactly
// one version. Unknown and future schemas fail closed rather than being decoded
// opportunistically.
var stateMigrationRegistry = map[int]stateMigration{
	1: migrateStateV1ToV2,
	2: migrateStateV2ToV3,
	3: migrateStateV3ToV4,
	4: migrateStateV4ToV5,
}

func newState() persistentState {
	return persistentState{SchemaVersion: currentStateSchemaVersion, Profiles: map[string]Profile{}, Tracks: map[string]Track{}, Playlists: map[string]Playlist{}, Listeners: map[string]ListenerState{}, Usage: map[string]UsageRecord{}, Allocations: map[string]RevenueAllocation{}, Settlements: map[string]SettlementIntent{}, Cases: map[string]Case{}, AIProposals: map[string]AIProposal{}, Idempotency: map[string]string{}, Audit: []AuditEvent{}}
}

func loadState(path, mediaDir string) (persistentState, bool, error) {
	return loadStateMode(path, mediaDir, true)
}
func loadStateMode(path, mediaDir string, persistMigration bool) (persistentState, bool, error) {
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
	if err := validateMusicOriginalOperations(state); err != nil {
		return persistentState{}, false, err
	}
	if len(state.BusinessNonces) > 4096 || len(state.BusinessNonces) > 0 && (state.BusinessClock == nil || state.BusinessClock.IsZero()) {
		return persistentState{}, false, errors.New("music business replay metadata is invalid")
	}
	for key, entry := range state.BusinessNonces {
		parts := strings.Split(key, ":")
		actor, actorErr := normalizeActor(entry.Actor)
		if len(parts) != 2 || !digestPattern.MatchString(parts[0]) || !musicProofNonce.MatchString(parts[1]) || actorErr != nil || actor != entry.Actor || !validSHA256Hex(entry.BodyDigest) || entry.ExpiresAt.IsZero() {
			return persistentState{}, false, errors.New("music business replay entry is invalid")
		}
	}
	if len(state.BusinessEffects) > 2048 {
		return persistentState{}, false, errors.New("music external effect capacity is invalid")
	}
	for key, e := range state.BusinessEffects {
		if key != effectKey(e.Actor, e.Kind, e.ObjectID) || !digestPattern.MatchString(key) || !validSHA256Hex(e.WireDigest) || !validSHA256Hex(e.EndpointDigest) || e.AdmittedAt.IsZero() || effectObject(&state, e.Actor, e.Kind, e.ObjectID) != nil {
			return persistentState{}, false, errors.New("music external effect identity is invalid")
		}
		if e.Status == "dispatch_admitted" && len(e.Receipt) == 0 {
			continue
		}
		if e.Status != "receipt" || len(e.Receipt) > 1<<20 {
			return persistentState{}, false, errors.New("music external effect receipt state is invalid")
		}
		var err error
		if e.Kind == "ai" {
			err = validateAIReceipt(e.Receipt)
		} else if e.Kind == "pay" {
			err = validatePayReceipt(e.Receipt)
		} else {
			err = validateTrustReceipt(e.Receipt)
		}
		if err != nil {
			return persistentState{}, false, errors.New("music external effect receipt is invalid")
		}
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
	if persistMigration && originalHeader.SchemaVersion != currentStateSchemaVersion {
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

var ErrMusicStatePublicationUnconfirmed = errors.New("Music state publication unconfirmed")

// Legacy creation/migration/maintenance retains the original writer contract.
func saveState(path string, state *persistentState) error {
	_, err := saveStateCurrent(path, state, nil)
	return err
}
func saveStateCurrent(path string, state *persistentState, current func() error) (published bool, err error) {
	defer func() {
		if published && err != nil {
			err = fmt.Errorf("%w: %w", ErrMusicStatePublicationUnconfirmed, err)
		}
	}()
	check := func() error {
		if current != nil {
			return current()
		}
		return nil
	}
	if err = check(); err != nil {
		return false, err
	}
	integrity, err := stateIntegrity(*state)
	if err != nil {
		return false, err
	}
	state.IntegrityHash = integrity
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return false, err
	}
	if err = check(); err != nil {
		return false, err
	}
	dir := filepath.Dir(path)
	if err = os.MkdirAll(dir, 0o700); err != nil {
		return false, err
	}
	tmp, err := os.CreateTemp(dir, ".music-state-*")
	if err != nil {
		return false, err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err = tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return false, err
	}
	if _, err = tmp.Write(data); err == nil {
		err = tmp.Sync()
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return false, err
	}
	// Same captured local Current, after the actual staged write/fsync and before
	// publishing. The prepared temporary file is removed on every refusal.
	if err = check(); err != nil {
		return false, err
	}
	if err = os.Rename(name, path); err != nil {
		return false, err
	}
	published = true
	if err = check(); err != nil {
		return true, err
	}
	if err = os.Chmod(path, 0o600); err != nil {
		return true, err
	}
	directory, err := os.Open(dir)
	if err != nil {
		return true, err
	}
	err = directory.Sync()
	if closeErr := directory.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return true, err
	}
	confirmed, err := os.ReadFile(path)
	if err != nil {
		return true, err
	}
	if string(confirmed) != string(data) {
		return true, errors.New("Music published state readback mismatch")
	}
	if err = check(); err != nil {
		return true, err
	}
	return true, nil
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

// Verify the original document before adding the replay ledger; old content,
// audit, idempotency and media metadata are preserved. Old binaries reject v3.
func migrateStateV2ToV3(raw json.RawMessage) (json.RawMessage, error) {
	var original persistentState
	if err := json.Unmarshal(raw, &original); err != nil || original.SchemaVersion != 2 || original.IntegrityHash == "" {
		return nil, errors.New("music state schema v2 document is invalid")
	}
	expected, err := stateIntegrity(original)
	if err != nil || expected != original.IntegrityHash {
		return nil, errors.New("music state schema v2 integrity verification failed")
	}
	if err = verifyAuditChain(original.Audit); err != nil {
		return nil, err
	}
	original.SchemaVersion = 3
	original.IntegrityHash, err = stateIntegrity(original)
	if err != nil {
		return nil, err
	}
	return json.Marshal(original)
}

func migrateStateV3ToV4(raw json.RawMessage) (json.RawMessage, error) {
	var original persistentState
	if err := json.Unmarshal(raw, &original); err != nil || original.SchemaVersion != 3 || original.IntegrityHash == "" {
		return nil, errors.New("music state schema v3 document is invalid")
	}
	expected, err := stateIntegrity(original)
	if err != nil || expected != original.IntegrityHash {
		return nil, errors.New("music state schema v3 integrity verification failed")
	}
	if err = verifyAuditChain(original.Audit); err != nil {
		return nil, err
	}
	original.SchemaVersion = 4
	original.IntegrityHash, err = stateIntegrity(original)
	if err != nil {
		return nil, err
	}
	return json.Marshal(original)
}

func migrateStateV4ToV5(raw json.RawMessage) (json.RawMessage, error) {
	var st persistentState
	if err := json.Unmarshal(raw, &st); err != nil || st.SchemaVersion != 4 {
		return nil, errors.New("music schema4 is invalid")
	}
	sum, err := stateIntegrity(st)
	if err != nil || sum != st.IntegrityHash {
		return nil, errors.New("music schema4 integrity failed")
	}
	if err := verifyAuditChain(st.Audit); err != nil {
		return nil, err
	}
	st.SchemaVersion = 5
	st.IntegrityHash, err = stateIntegrity(st)
	if err != nil {
		return nil, err
	}
	return json.Marshal(st)
}
