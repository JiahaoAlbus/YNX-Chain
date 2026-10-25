package yusdsandbox

import (
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

type idempotencyRecord struct {
	Action   string `json:"action"`
	Digest   string `json:"digest"`
	ObjectID string `json:"objectId"`
}
type state struct {
	SchemaVersion  int                          `json:"schemaVersion"`
	Reserve        uint64                       `json:"reserve"`
	Supply         uint64                       `json:"supply"`
	Paused         bool                         `json:"paused"`
	ProviderStatus string                       `json:"providerStatus"`
	Accounts       map[string]uint64            `json:"accounts"`
	Redemptions    map[string]Redemption        `json:"redemptions"`
	DailyAccount   map[string]uint64            `json:"dailyAccount"`
	DailyGlobal    map[string]uint64            `json:"dailyGlobal"`
	Idempotency    map[string]idempotencyRecord `json:"idempotency"`
	Audit          []AuditEvent                 `json:"audit"`
	Integrity      string                       `json:"integrity"`
}

func newState() state {
	return state{SchemaVersion: SchemaVersion, ProviderStatus: "available", Accounts: map[string]uint64{}, Redemptions: map[string]Redemption{}, DailyAccount: map[string]uint64{}, DailyGlobal: map[string]uint64{}, Idempotency: map[string]idempotencyRecord{}, Audit: []AuditEvent{}}
}
func loadState(path string) (state, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return newState(), nil
	}
	if err != nil {
		return state{}, err
	}
	var value state
	if json.Unmarshal(raw, &value) != nil || value.SchemaVersion != SchemaVersion || value.Accounts == nil || value.Redemptions == nil || value.DailyAccount == nil || value.DailyGlobal == nil || value.Idempotency == nil || value.Audit == nil {
		return state{}, errors.New("YUSD sandbox state schema is invalid")
	}
	got := value.Integrity
	value.Integrity = ""
	expected, _ := digest(value)
	if got != expected {
		return state{}, errors.New("YUSD sandbox state integrity mismatch")
	}
	value.Integrity = got
	return value, validateAudit(value.Audit)
}
func saveState(path string, value *state) error {
	value.Integrity = ""
	sum, err := digest(*value)
	if err != nil {
		return err
	}
	value.Integrity = sum
	raw, _ := json.MarshalIndent(value, "", "  ")
	raw = append(raw, '\n')
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(dir, ".yusd-*")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(raw); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(name, path); err != nil {
		return err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return err
	}
	return nil
}
func digest(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}
func appendAudit(value *state, at time.Time, action, objectID, evidenceHash string) {
	previous := "genesis"
	if len(value.Audit) > 0 {
		previous = value.Audit[len(value.Audit)-1].Hash
	}
	event := AuditEvent{Sequence: uint64(len(value.Audit) + 1), At: at, Action: action, ObjectID: objectID, EvidenceHash: evidenceHash, PreviousHash: previous}
	event.Hash = auditHash(event)
	value.Audit = append(value.Audit, event)
}
func auditHash(event AuditEvent) string { event.Hash = ""; sum, _ := digest(event); return sum }
func validateAudit(events []AuditEvent) error {
	previous := "genesis"
	for i, event := range events {
		if event.Sequence != uint64(i+1) || event.At.IsZero() || strings.TrimSpace(event.Action) == "" || strings.TrimSpace(event.ObjectID) == "" || !evidencePattern.MatchString(event.EvidenceHash) || event.PreviousHash != previous || event.Hash != auditHash(event) {
			return fmt.Errorf("YUSD sandbox audit chain invalid at %d", i+1)
		}
		previous = event.Hash
	}
	return nil
}
