package social

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chat"
)

func newState() persistentState {
	state := persistentState{SchemaVersion: SchemaVersion}
	normalizeState(&state)
	return state
}

func normalizeState(s *persistentState) {
	if s.Sessions == nil {
		s.Sessions = map[string]Session{}
	}
	if s.UsedNonces == nil {
		s.UsedNonces = map[string]time.Time{}
	}
	if s.WalletChallenges == nil {
		s.WalletChallenges = map[string]PendingWalletChallenge{}
	}
	if s.Settings == nil {
		s.Settings = map[string]ProfileSettings{}
	}
	if s.Invites == nil {
		s.Invites = map[string]Invite{}
	}
	if s.Requests == nil {
		s.Requests = map[string]ContactRequest{}
	}
	if s.Contacts == nil {
		s.Contacts = map[string]Contact{}
	}
	if s.Blocks == nil {
		s.Blocks = map[string]time.Time{}
	}
	if s.Mutes == nil {
		s.Mutes = map[string]time.Time{}
	}
	if s.Notifications == nil {
		s.Notifications = map[string]Notification{}
	}
	if s.AIJobs == nil {
		s.AIJobs = map[string]AIJob{}
	}
	if s.Automation == nil {
		s.Automation = map[string]AutomationRule{}
	}
	if s.Devices == nil {
		s.Devices = map[string]ProductDevice{}
	}
	if s.Groups == nil {
		s.Groups = map[string]GroupConversation{}
	}
	if s.GroupMessages == nil {
		s.GroupMessages = map[string][]chat.Message{}
	}
	if s.Media == nil {
		s.Media = map[string]MediaObject{}
	}
	if s.Moments == nil {
		s.Moments = map[string]Moment{}
	}
	if s.MomentComments == nil {
		s.MomentComments = map[string][]MomentComment{}
	}
	if s.MomentReactions == nil {
		s.MomentReactions = map[string]MomentReaction{}
	}
	if s.Reports == nil {
		s.Reports = map[string]SocialReport{}
	}
	if s.Idempotency == nil {
		s.Idempotency = map[string]idempotencyRecord{}
	}
	if s.Audit == nil {
		s.Audit = []AuditEvent{}
	}
}

func loadState(path string, key []byte) (persistentState, bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return newState(), false, nil
	}
	if err != nil {
		return persistentState{}, false, err
	}
	var state persistentState
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return persistentState{}, true, fmt.Errorf("decode social state: %w", err)
	}
	version := state.SchemaVersion
	if version != 1 && version != 2 && version != 3 && version != SchemaVersion {
		return persistentState{}, true, fmt.Errorf("unsupported social state schema %d", state.SchemaVersion)
	}
	normalizeState(&state)
	want := state.IntegrityHash
	got, err := stateIntegrity(state, key)
	if err != nil || !hmac.Equal([]byte(want), []byte(got)) {
		return persistentState{}, true, errors.New("social state integrity check failed")
	}
	if version < SchemaVersion {
		state.SchemaVersion = SchemaVersion
		if err := saveState(path, &state, key); err != nil {
			return persistentState{}, true, fmt.Errorf("migrate social state: %w", err)
		}
	}
	return state, true, nil
}

func saveState(path string, state *persistentState, key []byte) error {
	integrity, err := stateIntegrity(*state, key)
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
	tmp, err := os.CreateTemp(dir, ".social-state-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

func stateIntegrity(state persistentState, key []byte) (string, error) {
	state.IntegrityHash = ""
	data, err := json.Marshal(state)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(data)
	return hex.EncodeToString(mac.Sum(nil)), nil
}
