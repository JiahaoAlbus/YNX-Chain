package video

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Store struct {
	mu              sync.RWMutex
	root, statePath string
	integrityKey    []byte
	state           State
}

const currentStateSchemaVersion = 1

type stateMigration struct {
	from int
	to   int
	up   func(*State) error
	down func(*State) error
}

var stateMigrations = []stateMigration{
	{
		from: 0,
		to:   1,
		up: func(state *State) error {
			state.SchemaVersion = 1
			return nil
		},
		down: func(state *State) error {
			state.SchemaVersion = 0
			return nil
		},
	},
}

func OpenStore(root string, integrityKey []byte) (*Store, error) {
	if root == "" {
		return nil, errors.New("video store root is required")
	}
	if err := os.MkdirAll(filepath.Join(root, "objects"), 0700); err != nil {
		return nil, err
	}
	if len(integrityKey) < 32 {
		return nil, errors.New("video store integrity key must be at least 32 bytes")
	}
	s := &Store{root: root, statePath: filepath.Join(root, "state.json"), integrityKey: append([]byte(nil), integrityKey...), state: emptyState()}
	b, err := os.ReadFile(s.statePath)
	if err == nil {
		var loaded State
		if err = json.Unmarshal(b, &loaded); err != nil {
			return nil, err
		}
		s.state = loaded
		normalize(&s.state)
		if err = s.verifyIntegrity(); err != nil {
			return nil, err
		}
		migrated, migrationErr := migrateState(&s.state, currentStateSchemaVersion)
		if migrationErr != nil {
			return nil, migrationErr
		}
		if migrated {
			if err = s.persistLocked(); err != nil {
				return nil, fmt.Errorf("persist migrated video state: %w", err)
			}
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return s, nil
}

func emptyState() State {
	s := State{SchemaVersion: currentStateSchemaVersion}
	normalize(&s)
	return s
}
func normalize(s *State) {
	if s.Videos == nil {
		s.Videos = map[string]*Video{}
	}
	if s.Channels == nil {
		s.Channels = map[string]*Channel{}
	}
	if s.Subscriptions == nil {
		s.Subscriptions = map[string]Subscription{}
	}
	if s.Playlists == nil {
		s.Playlists = map[string]*Playlist{}
	}
	if s.Comments == nil {
		s.Comments = map[string]*Comment{}
	}
	if s.WatchEvents == nil {
		s.WatchEvents = map[string]WatchEvent{}
	}
	if s.Reports == nil {
		s.Reports = map[string]*Report{}
	}
	if s.Appeals == nil {
		s.Appeals = map[string]*Appeal{}
	}
	if s.Monetization == nil {
		s.Monetization = map[string]*Monetization{}
	}
	if s.PayoutIntents == nil {
		s.PayoutIntents = map[string]*PayoutIntent{}
	}
	if s.Revenue == nil {
		s.Revenue = map[string]*RevenueRecord{}
	}
	if s.Disputes == nil {
		s.Disputes = map[string]*Dispute{}
	}
	if s.AIJobs == nil {
		s.AIJobs = map[string]*AIJob{}
	}
	if s.GatewayNonces == nil {
		s.GatewayNonces = map[string]GatewayNonce{}
	}
	if s.Idempotency == nil {
		s.Idempotency = map[string]IdempotencyRecord{}
	}
}
func (s *Store) read(fn func(State) error) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return fn(s.state)
}
func (s *Store) update(fn func(*State) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := fn(&s.state); err != nil {
		return err
	}
	if err := validateAuditChain(s.state.Audit); err != nil {
		return err
	}
	return s.persistLocked()
}

func (s *Store) persistLocked() error {
	s.state.Integrity = ""
	canonical, err := json.Marshal(s.state)
	if err != nil {
		return err
	}
	mac := hmac.New(sha256.New, s.integrityKey)
	_, _ = mac.Write(canonical)
	s.state.Integrity = hex.EncodeToString(mac.Sum(nil))
	b, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.statePath + ".tmp"
	if err = os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	f, err := os.OpenFile(tmp, os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	f.Close()
	return os.Rename(tmp, s.statePath)
}

func migrateState(state *State, target int) (bool, error) {
	if target < 0 || target > currentStateSchemaVersion {
		return false, fmt.Errorf("unsupported video state target schema version %d", target)
	}
	if state.SchemaVersion > currentStateSchemaVersion {
		return false, fmt.Errorf("video state schema version %d is newer than supported version %d", state.SchemaVersion, currentStateSchemaVersion)
	}
	changed := false
	for state.SchemaVersion < target {
		migration, ok := findStateMigration(state.SchemaVersion, state.SchemaVersion+1)
		if !ok {
			return changed, fmt.Errorf("missing video state migration %d to %d", state.SchemaVersion, state.SchemaVersion+1)
		}
		if err := migration.up(state); err != nil {
			return changed, fmt.Errorf("migrate video state %d to %d: %w", migration.from, migration.to, err)
		}
		changed = true
	}
	for state.SchemaVersion > target {
		migration, ok := findStateMigration(state.SchemaVersion-1, state.SchemaVersion)
		if !ok {
			return changed, fmt.Errorf("missing video state rollback migration %d to %d", state.SchemaVersion, state.SchemaVersion-1)
		}
		if err := migration.down(state); err != nil {
			return changed, fmt.Errorf("rollback video state %d to %d: %w", migration.to, migration.from, err)
		}
		changed = true
	}
	return changed, nil
}

func findStateMigration(from, to int) (stateMigration, bool) {
	for _, migration := range stateMigrations {
		if migration.from == from && migration.to == to {
			return migration, true
		}
	}
	return stateMigration{}, false
}

func (s *Store) verifyIntegrity() error {
	provided := s.state.Integrity
	if len(provided) != sha256.Size*2 {
		return errors.New("video state integrity tag is missing or invalid")
	}
	s.state.Integrity = ""
	canonical, err := json.Marshal(s.state)
	if err != nil {
		return err
	}
	mac := hmac.New(sha256.New, s.integrityKey)
	_, _ = mac.Write(canonical)
	expected := mac.Sum(nil)
	actual, err := hex.DecodeString(provided)
	if err != nil || !hmac.Equal(actual, expected) {
		return errors.New("video state integrity verification failed")
	}
	s.state.Integrity = provided
	return validateAuditChain(s.state.Audit)
}

func validateAuditChain(events []AuditEvent) error {
	previous := ""
	for i, event := range events {
		if event.Sequence != uint64(i+1) || event.PreviousHash != previous || event.Hash != auditEventHash(event) {
			return errors.New("video audit hash chain is invalid")
		}
		previous = event.Hash
	}
	return nil
}

func auditEventHash(event AuditEvent) string {
	material := []byte(fmt.Sprintf("%d\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s", event.Sequence, event.ID, event.Actor, event.Action, event.ObjectType, event.ObjectID, event.Detail, event.At.UTC().Format(time.RFC3339Nano), event.PayloadHash+"\n"+event.PreviousHash))
	sum := sha256.Sum256(material)
	return hex.EncodeToString(sum[:])
}
