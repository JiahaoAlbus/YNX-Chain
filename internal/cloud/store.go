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

const CurrentStateSchemaVersion = 2

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
	if (state.SchemaVersion != 1 && state.SchemaVersion != CurrentStateSchemaVersion) || state.IntegrityHash == "" {
		return persistentState{}, errors.New("cloud state schema or integrity hash is invalid")
	}
	if !verifyStoredState(b, state) {
		return persistentState{}, errors.New("cloud state integrity verification failed")
	}
	if state.SchemaVersion == 1 {
		if err := writeMigrationBackup(path, b); err != nil {
			return persistentState{}, fmt.Errorf("backup v1 state before migration: %w", err)
		}
		normalize(&state)
		state.SchemaVersion = CurrentStateSchemaVersion
		if err := saveState(path, &state); err != nil {
			return persistentState{}, fmt.Errorf("persist v1 to v2 migration: %w", err)
		}
	} else {
		normalize(&state)
	}
	return state, nil
}

func writeMigrationBackup(path string, b []byte) error {
	backup := path + ".v1.bak"
	f, err := os.OpenFile(backup, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		existing, readErr := os.ReadFile(backup)
		if readErr != nil {
			return readErr
		}
		var state persistentState
		if json.Unmarshal(existing, &state) != nil || state.SchemaVersion != 1 {
			return errors.New("existing v1 migration backup is invalid")
		}
		if !verifyStoredState(existing, state) {
			return errors.New("existing v1 migration backup integrity failed")
		}
		if !bytes.Equal(existing, b) {
			return errors.New("existing v1 migration backup does not match migration source")
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
	state.SchemaVersion = 1
	state.IntegrityHash = ""
	return saveState(destination, &state)
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
