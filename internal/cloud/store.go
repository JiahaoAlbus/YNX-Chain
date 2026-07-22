package cloud

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const CurrentStateSchemaVersion = 3

func newState() persistentState {
	return persistentState{SchemaVersion: CurrentStateSchemaVersion, Objects: map[string]Object{}, Versions: map[string][]Version{}, Grants: map[string]Grant{}, Links: map[string]ShareLink{}, AccessRequests: map[string]AccessRequest{}, Comments: map[string][]Comment{}, Presence: map[string]Presence{}, AIJobs: map[string]AIJob{}, Sessions: map[string]Session{}, WalletChallenges: map[string]PendingWalletChallenge{}, Nonces: map[string]time.Time{}, Audit: []AuditEvent{}, MultipartUploads: map[string]MultipartUpload{}, BlobDeletions: map[string]BlobDeletion{}, DirectUploads: map[string]DirectUpload{}}
}

func loadState(path string) (persistentState, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return newState(), nil
	}
	if err != nil {
		return persistentState{}, fmt.Errorf("read cloud state: %w", err)
	}
	var state persistentState
	if err := json.Unmarshal(b, &state); err != nil {
		return persistentState{}, fmt.Errorf("decode cloud state: %w", err)
	}
	if (state.SchemaVersion != 1 && state.SchemaVersion != 2 && state.SchemaVersion != CurrentStateSchemaVersion) || state.IntegrityHash == "" {
		return persistentState{}, errors.New("cloud state schema or integrity hash is invalid")
	}
	if !verifyStoredState(b, state) {
		return persistentState{}, errors.New("cloud state integrity verification failed")
	}
	if state.SchemaVersion < CurrentStateSchemaVersion {
		from := state.SchemaVersion
		if err := writeMigrationBackup(path, b, from); err != nil {
			return persistentState{}, fmt.Errorf("backup v%d state before migration: %w", from, err)
		}
		normalize(&state)
		migrateObjectProducts(&state)
		state.SchemaVersion = CurrentStateSchemaVersion
		if err := saveState(path, &state); err != nil {
			return persistentState{}, fmt.Errorf("persist v%d to v%d migration: %w", from, CurrentStateSchemaVersion, err)
		}
	} else {
		normalize(&state)
	}
	return state, nil
}

func writeMigrationBackup(path string, b []byte, version int) error {
	backup := fmt.Sprintf("%s.v%d.bak", path, version)
	f, err := os.OpenFile(backup, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		existing, readErr := os.ReadFile(backup)
		if readErr != nil {
			return readErr
		}
		var state persistentState
		if json.Unmarshal(existing, &state) != nil || state.SchemaVersion != version {
			return errors.New("existing migration backup is invalid")
		}
		if !verifyStoredState(existing, state) {
			return errors.New("existing migration backup integrity failed")
		}
		if !bytes.Equal(existing, b) {
			return errors.New("existing migration backup does not match migration source")
		}
		return nil
	}
	if err != nil {
		return err
	}
	if _, err = f.Write(b); err != nil {
		f.Close()
		os.Remove(backup)
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		os.Remove(backup)
		return err
	}
	return f.Close()
}

func migrateObjectProducts(state *persistentState) {
	for id, obj := range state.Objects {
		if obj.Product == "" {
			if obj.Kind == KindDoc {
				obj.Product = "docs"
			} else {
				obj.Product = "cloud"
			}
			state.Objects[id] = obj
		}
	}
	for id, u := range state.MultipartUploads {
		if u.Product == "" {
			u.Product = "cloud"
			state.MultipartUploads[id] = u
		}
	}
	for id, u := range state.DirectUploads {
		if u.Product == "" {
			u.Product = "cloud"
			state.DirectUploads[id] = u
		}
	}
	for id, job := range state.AIJobs {
		if job.Product != "" {
			continue
		}
		product := ""
		valid := len(job.ObjectIDs) > 0
		for _, objectID := range job.ObjectIDs {
			obj, ok := state.Objects[objectID]
			if !ok || obj.Product == "" || (product != "" && product != obj.Product) {
				valid = false
				break
			}
			product = obj.Product
		}
		if valid {
			job.Product = product
		} else {
			job.Status = "failed"
			job.Error = "legacy AI job lacked a single product boundary; fresh consent is required"
		}
		state.AIJobs[id] = job
	}
}

func RollbackStateToV1(source, destination string) error {
	if strings.TrimSpace(source) == "" || strings.TrimSpace(destination) == "" || source == destination {
		return errors.New("distinct source and destination are required")
	}
	if _, err := os.Stat(destination); !errors.Is(err, os.ErrNotExist) {
		if err == nil {
			return errors.New("rollback destination already exists")
		}
		return err
	}
	b, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	var state persistentState
	if err = json.Unmarshal(b, &state); err != nil {
		return err
	}
	if state.SchemaVersion != CurrentStateSchemaVersion {
		return errors.New("rollback source is not current schema")
	}
	want, err := stateIntegrity(state)
	if err != nil || want != state.IntegrityHash {
		return errors.New("rollback source integrity verification failed")
	}
	normalize(&state)
	return writeLegacyState(destination, 1, state)
}

type objectStateV2 struct {
	ID         string     `json:"id"`
	Owner      string     `json:"owner"`
	ParentID   string     `json:"parentId,omitempty"`
	Kind       ObjectKind `json:"kind"`
	Name       string     `json:"name"`
	MIME       string     `json:"mime,omitempty"`
	Size       int64      `json:"size"`
	Hash       string     `json:"hash,omitempty"`
	Version    int        `json:"version"`
	Starred    bool       `json:"starred"`
	TrashedAt  *time.Time `json:"trashedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	Encryption Encryption `json:"encryption"`
	ScanStatus string     `json:"scanStatus,omitempty"`
	Artifact   *Artifact  `json:"artifact,omitempty"`
}
type multipartStateV2 struct {
	ID           string                `json:"id"`
	Owner        string                `json:"owner"`
	ParentID     string                `json:"parentId,omitempty"`
	Name         string                `json:"name"`
	MIME         string                `json:"mime"`
	Encryption   Encryption            `json:"encryption"`
	Artifact     *Artifact             `json:"artifact,omitempty"`
	ExpectedSize int64                 `json:"expectedSize"`
	ExpectedHash string                `json:"expectedHash"`
	Status       string                `json:"status"`
	Parts        map[int]MultipartPart `json:"parts"`
	CreatedAt    time.Time             `json:"createdAt"`
	UpdatedAt    time.Time             `json:"updatedAt"`
}
type directStateV2 struct {
	ID           string     `json:"id"`
	Owner        string     `json:"owner"`
	ParentID     string     `json:"parentId,omitempty"`
	Name         string     `json:"name"`
	MIME         string     `json:"mime"`
	Encryption   Encryption `json:"encryption"`
	Artifact     *Artifact  `json:"artifact,omitempty"`
	ExpectedSize int64      `json:"expectedSize"`
	ExpectedHash string     `json:"expectedHash"`
	ProviderRef  string     `json:"providerRef,omitempty"`
	Status       string     `json:"status"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
	ExpiresAt    time.Time  `json:"expiresAt"`
}
type aiJobStateV2 struct {
	ID          string     `json:"id"`
	Actor       string     `json:"actor"`
	Mode        string     `json:"mode"`
	ObjectIDs   []string   `json:"objectIds"`
	Versions    []int      `json:"versions"`
	Instruction string     `json:"instruction"`
	Provider    string     `json:"provider"`
	Model       string     `json:"model"`
	Estimate    int        `json:"estimatedUnits"`
	ConsentAt   time.Time  `json:"consentAt"`
	Status      string     `json:"status"`
	Result      string     `json:"result,omitempty"`
	Citations   []string   `json:"citations,omitempty"`
	Error       string     `json:"error,omitempty"`
	AppliedAt   *time.Time `json:"appliedAt,omitempty"`
	RejectedAt  *time.Time `json:"rejectedAt,omitempty"`
}
type blobDeletionStateV2 struct {
	ID          string    `json:"id"`
	Owner       string    `json:"owner"`
	Hash        string    `json:"hash"`
	Ref         string    `json:"ref,omitempty"`
	Status      string    `json:"status"`
	Attempts    int       `json:"attempts"`
	RequestedAt time.Time `json:"requestedAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	LastError   string    `json:"lastError,omitempty"`
}
type persistentStateV2 struct {
	SchemaVersion    int                               `json:"schemaVersion"`
	Objects          map[string]objectStateV2          `json:"objects"`
	Versions         map[string][]Version              `json:"versions"`
	Grants           map[string]Grant                  `json:"grants"`
	Links            map[string]ShareLink              `json:"links"`
	AccessRequests   map[string]AccessRequest          `json:"accessRequests"`
	Comments         map[string][]Comment              `json:"comments"`
	Presence         map[string]Presence               `json:"presence"`
	AIJobs           map[string]aiJobStateV2           `json:"aiJobs"`
	Sessions         map[string]Session                `json:"sessions"`
	WalletChallenges map[string]PendingWalletChallenge `json:"walletChallenges"`
	Nonces           map[string]time.Time              `json:"nonces"`
	Audit            []AuditEvent                      `json:"audit"`
	MultipartUploads map[string]multipartStateV2       `json:"multipartUploads"`
	BlobDeletions    map[string]blobDeletionStateV2    `json:"blobDeletions"`
	DirectUploads    map[string]directStateV2          `json:"directUploads"`
	IntegrityHash    string                            `json:"integrityHash"`
}

func writeLegacyState(destination string, target int, state persistentState) error {
	legacy := persistentStateV2{SchemaVersion: target, Objects: map[string]objectStateV2{}, Versions: state.Versions, Grants: state.Grants, Links: state.Links, AccessRequests: state.AccessRequests, Comments: state.Comments, Presence: state.Presence, AIJobs: map[string]aiJobStateV2{}, Sessions: state.Sessions, WalletChallenges: state.WalletChallenges, Nonces: state.Nonces, Audit: state.Audit, MultipartUploads: map[string]multipartStateV2{}, BlobDeletions: map[string]blobDeletionStateV2{}, DirectUploads: map[string]directStateV2{}}
	for id, o := range state.Objects {
		legacy.Objects[id] = objectStateV2{ID: o.ID, Owner: o.Owner, ParentID: o.ParentID, Kind: o.Kind, Name: o.Name, MIME: o.MIME, Size: o.Size, Hash: o.Hash, Version: o.Version, Starred: o.Starred, TrashedAt: o.TrashedAt, CreatedAt: o.CreatedAt, UpdatedAt: o.UpdatedAt, Encryption: o.Encryption, ScanStatus: o.ScanStatus, Artifact: o.Artifact}
	}
	for id, u := range state.MultipartUploads {
		legacy.MultipartUploads[id] = multipartStateV2{ID: u.ID, Owner: u.Owner, ParentID: u.ParentID, Name: u.Name, MIME: u.MIME, Encryption: u.Encryption, Artifact: u.Artifact, ExpectedSize: u.ExpectedSize, ExpectedHash: u.ExpectedHash, Status: u.Status, Parts: u.Parts, CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt}
	}
	for id, u := range state.DirectUploads {
		legacy.DirectUploads[id] = directStateV2{ID: u.ID, Owner: u.Owner, ParentID: u.ParentID, Name: u.Name, MIME: u.MIME, Encryption: u.Encryption, Artifact: u.Artifact, ExpectedSize: u.ExpectedSize, ExpectedHash: u.ExpectedHash, ProviderRef: u.ProviderRef, Status: u.Status, CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt, ExpiresAt: u.ExpiresAt}
	}
	for id, job := range state.AIJobs {
		legacy.AIJobs[id] = aiJobStateV2{ID: job.ID, Actor: job.Actor, Mode: job.Mode, ObjectIDs: job.ObjectIDs, Versions: job.Versions, Instruction: job.Instruction, Provider: job.Provider, Model: job.Model, Estimate: job.Estimate, ConsentAt: job.ConsentAt, Status: job.Status, Result: job.Result, Citations: job.Citations, Error: job.Error, AppliedAt: job.AppliedAt, RejectedAt: job.RejectedAt}
	}
	for id, deletion := range state.BlobDeletions {
		legacy.BlobDeletions[id] = blobDeletionStateV2{ID: deletion.ID, Owner: deletion.Owner, Hash: deletion.Hash, Ref: deletion.Ref, Status: deletion.Status, Attempts: deletion.Attempts, RequestedAt: deletion.RequestedAt, UpdatedAt: deletion.UpdatedAt, LastError: deletion.LastError}
	}
	compact, err := json.Marshal(legacy)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(compact)
	legacy.IntegrityHash = hex.EncodeToString(sum[:])
	body, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err = f.Write(body); err != nil {
		f.Close()
		os.Remove(destination)
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		os.Remove(destination)
		return err
	}
	return f.Close()
}

func verifyStoredState(raw []byte, state persistentState) bool {
	want, err := stateIntegrity(state)
	if err == nil && want == state.IntegrityHash {
		return true
	}
	key := []byte(`"integrityHash"`)
	at := bytes.LastIndex(raw, key)
	if at < 0 {
		return false
	}
	colon := bytes.IndexByte(raw[at+len(key):], ':')
	if colon < 0 {
		return false
	}
	start := at + len(key) + colon + 1
	for start < len(raw) && (raw[start] == ' ' || raw[start] == '\n' || raw[start] == '\r' || raw[start] == '\t') {
		start++
	}
	if start >= len(raw) || raw[start] != '"' {
		return false
	}
	end := start + 1
	for end < len(raw) {
		if raw[end] == '"' && raw[end-1] != '\\' {
			break
		}
		end++
	}
	if end >= len(raw) {
		return false
	}
	candidate := append([]byte(nil), raw[:start]...)
	candidate = append(candidate, '"', '"')
	candidate = append(candidate, raw[end+1:]...)
	var compact bytes.Buffer
	if json.Compact(&compact, candidate) != nil {
		return false
	}
	sum := sha256.Sum256(compact.Bytes())
	return hex.EncodeToString(sum[:]) == state.IntegrityHash
}

func normalize(s *persistentState) {
	if s.Objects == nil {
		s.Objects = map[string]Object{}
	}
	if s.Versions == nil {
		s.Versions = map[string][]Version{}
	}
	if s.Grants == nil {
		s.Grants = map[string]Grant{}
	}
	if s.Links == nil {
		s.Links = map[string]ShareLink{}
	}
	if s.AccessRequests == nil {
		s.AccessRequests = map[string]AccessRequest{}
	}
	if s.Comments == nil {
		s.Comments = map[string][]Comment{}
	}
	if s.Presence == nil {
		s.Presence = map[string]Presence{}
	}
	if s.AIJobs == nil {
		s.AIJobs = map[string]AIJob{}
	}
	if s.Sessions == nil {
		s.Sessions = map[string]Session{}
	}
	if s.WalletChallenges == nil {
		s.WalletChallenges = map[string]PendingWalletChallenge{}
	}
	if s.Nonces == nil {
		s.Nonces = map[string]time.Time{}
	}
	if s.Audit == nil {
		s.Audit = []AuditEvent{}
	}
	if s.MultipartUploads == nil {
		s.MultipartUploads = map[string]MultipartUpload{}
	}
	if s.BlobDeletions == nil {
		s.BlobDeletions = map[string]BlobDeletion{}
	}
	if s.DirectUploads == nil {
		s.DirectUploads = map[string]DirectUpload{}
	}
}

func stateIntegrity(s persistentState) (string, error) {
	s.IntegrityHash = ""
	b, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:]), nil
}

func saveState(path string, s *persistentState) error {
	h, err := stateIntegrity(*s)
	if err != nil {
		return err
	}
	s.IntegrityHash = h
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".cloud-state-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if err := f.Chmod(0o600); err != nil {
		f.Close()
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

func writeBlob(root, hash string, content []byte) (string, error) {
	dir := filepath.Join(root, hash[:2])
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(dir, hash)
	if existing, err := os.ReadFile(path); err == nil {
		h := sha256.Sum256(existing)
		if hex.EncodeToString(h[:]) != hash {
			return "", errors.New("existing object integrity mismatch")
		}
		return path, nil
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", err
	}
	if _, err := f.Write(content); err != nil {
		f.Close()
		os.Remove(path)
		return "", err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(path)
		return "", err
	}
	return path, f.Close()
}

func readBlob(path, expected string) ([]byte, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	h := sha256.Sum256(b)
	if hex.EncodeToString(h[:]) != expected {
		return nil, errors.New("object integrity verification failed")
	}
	return b, nil
}
