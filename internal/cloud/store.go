package cloud

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const currentSchemaVersion = 2

func newState() persistentState {
	return persistentState{SchemaVersion: currentSchemaVersion, Objects: map[string]Object{}, Versions: map[string][]Version{}, Grants: map[string]Grant{}, Links: map[string]ShareLink{}, AccessRequests: map[string]AccessRequest{}, Comments: map[string][]Comment{}, Presence: map[string]Presence{}, AIJobs: map[string]AIJob{}, Sessions: map[string]Session{}, Nonces: map[string]time.Time{}, Audit: []AuditEvent{}}
}

func loadState(path string) (persistentState, error) {
	return loadStateWithMigration(path, true)
}

func loadStateReadOnly(path string) (persistentState, error) {
	return loadStateWithMigration(path, false)
}

func loadStateWithMigration(path string, persistMigration bool) (persistentState, error) {
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
	if state.SchemaVersion < 1 || state.SchemaVersion > currentSchemaVersion || state.IntegrityHash == "" {
		return persistentState{}, errors.New("cloud state schema or integrity hash is invalid")
	}
	want, err := stateIntegrity(state)
	if err != nil || want != state.IntegrityHash {
		return persistentState{}, errors.New("cloud state integrity verification failed")
	}
	migrated := state.SchemaVersion != currentSchemaVersion
	if state.SchemaVersion == 1 {
		migrateV1ToV2(&state)
	}
	normalize(&state)
	if migrated && persistMigration {
		if err := saveState(path, &state); err != nil {
			return persistentState{}, fmt.Errorf("persist cloud state migration: %w", err)
		}
	}
	return state, nil
}

func migrateV1ToV2(s *persistentState) {
	for objectID, comments := range s.Comments {
		for i := range comments {
			if comments[i].ThreadID == "" {
				comments[i].ThreadID = comments[i].ID
			}
		}
		s.Comments[objectID] = comments
	}
	s.SchemaVersion = currentSchemaVersion
}

func cloneState(state persistentState) (persistentState, error) {
	encoded, err := json.Marshal(state)
	if err != nil {
		return persistentState{}, fmt.Errorf("encode cloud state snapshot: %w", err)
	}
	var clone persistentState
	if err := json.Unmarshal(encoded, &clone); err != nil {
		return persistentState{}, fmt.Errorf("decode cloud state snapshot: %w", err)
	}
	normalize(&clone)
	return clone, nil
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
	if s.Nonces == nil {
		s.Nonces = map[string]time.Time{}
	}
	if s.Audit == nil {
		s.Audit = []AuditEvent{}
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
	if !validSHA256(hash) {
		return "", errors.New("object hash is invalid")
	}
	dir := filepath.Join(root, hash[:2])
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	if err := validatePrivateDirectory(root, "object store root"); err != nil {
		return "", err
	}
	if err := validatePrivateDirectory(dir, "object store hash directory"); err != nil {
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

func validatePrivateDirectory(path, label string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect %s: %w", label, err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("%s must be a real directory", label)
	}
	if info.Mode().Perm()&0o077 != 0 {
		return fmt.Errorf("%s permissions are too broad", label)
	}
	return nil
}

func validateLocalObjectRef(root, ref, hash string) error {
	if !validSHA256(hash) {
		return errors.New("object hash is invalid")
	}
	rootAbs, err := filepath.Abs(filepath.Clean(root))
	if err != nil {
		return err
	}
	refAbs, err := filepath.Abs(filepath.Clean(ref))
	if err != nil {
		return err
	}
	expected := filepath.Join(rootAbs, hash[:2], hash)
	if refAbs != expected {
		return errors.New("object reference escapes the content-addressed store")
	}
	if err := validatePrivateDirectory(rootAbs, "object store root"); err != nil {
		return err
	}
	if err := validatePrivateDirectory(filepath.Dir(expected), "object store hash directory"); err != nil {
		return err
	}
	info, err := os.Lstat(expected)
	if err != nil {
		return fmt.Errorf("inspect object file: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("object file must be a regular file")
	}
	if info.Mode().Perm()&0o077 != 0 {
		return errors.New("object file permissions are too broad")
	}
	return nil
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
