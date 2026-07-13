package bridgegateway

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type idempotencyRecord struct {
	Digest     string `json:"digest"`
	TransferID string `json:"transferId"`
}

type persistentState struct {
	SchemaVersion       int                          `json:"schemaVersion"`
	Transfers           map[string]Transfer          `json:"transfers"`
	SourceEvents        map[string]string            `json:"sourceEvents"`
	CreateIdempotency   map[string]idempotencyRecord `json:"createIdempotency"`
	FinalizeIdempotency map[string]idempotencyRecord `json:"finalizeIdempotency"`
	Audit               []AuditEvent                 `json:"audit"`
	Integrity           string                       `json:"integrity"`
}

func newPersistentState() persistentState {
	return persistentState{
		SchemaVersion: SchemaVersion, Transfers: map[string]Transfer{}, SourceEvents: map[string]string{},
		CreateIdempotency: map[string]idempotencyRecord{}, FinalizeIdempotency: map[string]idempotencyRecord{}, Audit: []AuditEvent{},
	}
}

func loadState(path string) (persistentState, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return newPersistentState(), nil
	}
	if err != nil {
		return persistentState{}, fmt.Errorf("read bridge state: %w", err)
	}
	var state persistentState
	if err := json.Unmarshal(raw, &state); err != nil {
		return persistentState{}, fmt.Errorf("decode bridge state: %w", err)
	}
	if state.SchemaVersion != SchemaVersion || state.Transfers == nil || state.SourceEvents == nil || state.CreateIdempotency == nil || state.FinalizeIdempotency == nil || state.Audit == nil {
		return persistentState{}, errors.New("bridge state schema is invalid")
	}
	got := state.Integrity
	state.Integrity = ""
	expected, err := stateDigest(state)
	if err != nil || got != expected {
		return persistentState{}, errors.New("bridge state integrity mismatch")
	}
	state.Integrity = got
	if err := validateAuditChain(state.Audit); err != nil {
		return persistentState{}, err
	}
	return state, nil
}

func saveState(path string, state *persistentState) error {
	state.Integrity = ""
	digest, err := stateDigest(*state)
	if err != nil {
		return err
	}
	state.Integrity = digest
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode bridge state: %w", err)
	}
	raw = append(raw, '\n')
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create bridge state directory: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return fmt.Errorf("restrict bridge state directory: %w", err)
	}
	temp, err := os.OpenFile(path+".tmp", os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("create bridge state temp file: %w", err)
	}
	ok := false
	defer func() {
		_ = temp.Close()
		if !ok {
			_ = os.Remove(temp.Name())
		}
	}()
	if _, err := temp.Write(raw); err != nil {
		return fmt.Errorf("write bridge state: %w", err)
	}
	if err := temp.Sync(); err != nil {
		return fmt.Errorf("sync bridge state: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close bridge state: %w", err)
	}
	if err := os.Rename(temp.Name(), path); err != nil {
		return fmt.Errorf("replace bridge state: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return fmt.Errorf("restrict bridge state: %w", err)
	}
	ok = true
	return nil
}

func cloneState(state persistentState) persistentState {
	raw, _ := json.Marshal(state)
	var clone persistentState
	_ = json.Unmarshal(raw, &clone)
	return clone
}

func stateDigest(state persistentState) (string, error) {
	state.Integrity = ""
	raw, err := json.Marshal(state)
	if err != nil {
		return "", err
	}
	return "sha256:" + hashBytes(raw), nil
}

func appendAudit(state *persistentState, at, action, transferID, detailHash string) {
	previous := "genesis"
	if len(state.Audit) > 0 {
		previous = state.Audit[len(state.Audit)-1].Hash
	}
	event := AuditEvent{Sequence: uint64(len(state.Audit) + 1), At: at, Action: action, TransferID: transferID, DetailHash: detailHash, Previous: previous}
	event.Hash = auditHash(event)
	state.Audit = append(state.Audit, event)
}

func validateAuditChain(events []AuditEvent) error {
	previous := "genesis"
	for i, event := range events {
		if event.Sequence != uint64(i+1) || event.Previous != previous || event.Hash != auditHash(event) {
			return errors.New("bridge audit hash chain is invalid")
		}
		previous = event.Hash
	}
	return nil
}

func auditHash(event AuditEvent) string {
	event.Hash = ""
	raw, _ := json.Marshal(event)
	return "sha256:" + hashBytes(raw)
}

func hashBytes(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}
