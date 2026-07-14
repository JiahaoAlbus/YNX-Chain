package appgateway

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

type persistentState struct {
	SchemaVersion int                   `json:"schemaVersion"`
	Challenges    map[string]Challenge  `json:"challenges"`
	Sessions      map[string]AppSession `json:"sessions"`
	Audit         []AuditEvent          `json:"audit"`
	AuditSequence uint64                `json:"auditSequence"`
	IntegrityHash string                `json:"integrityHash"`
}

func newState() persistentState {
	return persistentState{SchemaVersion: 1, Challenges: map[string]Challenge{}, Sessions: map[string]AppSession{}, Audit: []AuditEvent{}}
}

func loadState(path string) (persistentState, bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return newState(), false, nil
	}
	if err != nil {
		return persistentState{}, false, fmt.Errorf("read app gateway state: %w", err)
	}
	var state persistentState
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return persistentState{}, false, fmt.Errorf("decode app gateway state: %w", err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return persistentState{}, false, errors.New("app gateway state must contain exactly one JSON object")
	}
	if state.SchemaVersion != 1 || state.Challenges == nil || state.Sessions == nil || state.Audit == nil || state.IntegrityHash == "" {
		return persistentState{}, false, errors.New("app gateway state schema or integrity hash is invalid")
	}
	expected, err := stateIntegrity(state)
	if err != nil || expected != state.IntegrityHash {
		return persistentState{}, false, errors.New("app gateway state integrity verification failed")
	}
	if err := validateAudit(state); err != nil {
		return persistentState{}, false, err
	}
	return state, true, nil
}

func validateAudit(state persistentState) error {
	if len(state.Challenges) > maxStoredChallenges || len(state.Sessions) > maxStoredSessions || len(state.Audit) > maxStoredAudit {
		return errors.New("app gateway state exceeds bounded capacity")
	}
	for id, challenge := range state.Challenges {
		native, err := nativewallet.NormalizeNativeAddress(challenge.Account)
		canonical, canonicalErr := normalizeAccountAddress(challenge.Account)
		_, keyErr := nativewallet.DecodePublicKey(challenge.DeviceSigningPublicKey, 32)
		validStatus := challenge.Status == "pending" || (challenge.Status == "consumed" && !challenge.ConsumedAt.IsZero())
		if id != challenge.ID || !validSegment(id) || err != nil || native != challenge.Account || canonicalErr != nil || canonical != challenge.CanonicalAddress || !identifierPattern.MatchString(challenge.DeviceID) || keyErr != nil || !validStoredOrigin(challenge.Origin) || challenge.IssuedAt.IsZero() || !challenge.ExpiresAt.After(challenge.IssuedAt) || !validStatus {
			return errors.New("app gateway challenge state is invalid")
		}
	}
	for id, session := range state.Sessions {
		native, err := nativewallet.NormalizeNativeAddress(session.Account)
		canonical, canonicalErr := normalizeAccountAddress(session.Account)
		_, keyErr := nativewallet.DecodePublicKey(session.DeviceSigningPublicKey, 32)
		tokenHash, hashErr := hex.DecodeString(session.TokenHash)
		validStatus := session.Status == "active" || (session.Status == "revoked" && !session.RevokedAt.IsZero())
		if id != session.ID || !validSegment(id) || err != nil || native != session.Account || canonicalErr != nil || canonical != session.CanonicalAddress || !identifierPattern.MatchString(session.DeviceID) || keyErr != nil || hashErr != nil || len(tokenHash) != sha256.Size || !validStoredOrigin(session.Origin) || session.IssuedAt.IsZero() || !session.ExpiresAt.After(session.IssuedAt) || !validStatus {
			return errors.New("app gateway session state is invalid")
		}
	}
	var previous AuditEvent
	for index, event := range state.Audit {
		if event.Sequence == 0 || event.Sequence > state.AuditSequence || (index > 0 && (event.Sequence != previous.Sequence+1 || event.PreviousHash != previous.Hash)) {
			return errors.New("app gateway audit sequence is invalid")
		}
		copy := event
		copy.Hash = ""
		payload, err := json.Marshal(copy)
		if err != nil {
			return err
		}
		digest := sha256.Sum256(payload)
		if event.Hash != hex.EncodeToString(digest[:]) {
			return errors.New("app gateway audit hash verification failed")
		}
		previous = event
	}
	if len(state.Audit) > 0 && state.Audit[len(state.Audit)-1].Sequence != state.AuditSequence {
		return errors.New("app gateway audit sequence tail is invalid")
	}
	return nil
}

func validStoredOrigin(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.Path == "" && parsed.RawQuery == "" && parsed.Fragment == "" && parsed.User == nil
}

func saveState(path string, state *persistentState) error {
	integrity, err := stateIntegrity(*state)
	if err != nil {
		return err
	}
	state.IntegrityHash = integrity
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode app gateway state: %w", err)
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create app gateway state directory: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return fmt.Errorf("secure app gateway state directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".app-gateway-state-*")
	if err != nil {
		return fmt.Errorf("create app gateway state temp file: %w", err)
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
		return fmt.Errorf("replace app gateway state: %w", err)
	}
	return os.Chmod(path, 0o600)
}

func stateIntegrity(state persistentState) (string, error) {
	state.IntegrityHash = ""
	data, err := json.Marshal(state)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:]), nil
}

func cloneState(state persistentState) persistentState {
	copy := state
	copy.Challenges = make(map[string]Challenge, len(state.Challenges))
	for key, value := range state.Challenges {
		copy.Challenges[key] = value
	}
	copy.Sessions = make(map[string]AppSession, len(state.Sessions))
	for key, value := range state.Sessions {
		copy.Sessions[key] = value
	}
	copy.Audit = append([]AuditEvent(nil), state.Audit...)
	return copy
}
