package social

import (
	"bytes"
	"crypto/hmac"
	"encoding/json"
	"fmt"
	"os"
)

type StateCompatibility struct {
	StoredSchema         int    `json:"storedSchema"`
	RequiredReaderSchema int    `json:"requiredReaderSchema"`
	Action               string `json:"action"`
}

// The check prints no identifiers, relationships, key material or message bodies.
// Upgrade/recover require a stopped exclusive writer; callers obtain its lease.
func CheckSocialState(path string, key []byte, targetReader int, action string) (StateCompatibility, error) {
	if len(key) < 32 {
		return StateCompatibility{}, ErrInvalid
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return StateCompatibility{}, err
	}
	var state persistentState
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil {
		return StateCompatibility{}, err
	}
	if state.SchemaVersion < 1 || state.SchemaVersion > SchemaVersion {
		return StateCompatibility{}, ErrConflict
	}
	normalizeState(&state)
	hash, err := stateIntegrity(state, key)
	if err != nil || !hmac.Equal([]byte(hash), []byte(state.IntegrityHash)) {
		return StateCompatibility{}, fmt.Errorf("state integrity validation failed")
	}
	required := state.SchemaVersion
	if len(state.PublicIdentities) > 0 {
		if required < 6 {
			required = 6
		}
	}
	for _, request := range state.Requests {
		if request.Message != "" || request.ExpiresAt != nil {
			if required < 6 {
				required = 6
			}
			break
		}
	}
	if state.AudienceProofTime != nil || len(state.MatrixAudienceNonces) > 0 || state.AudiencePolicyRevision != 0 || len(state.MatrixAudiences) > 0 || len(state.RestrictedMomentIndexes) > 0 {
		required = 7
	}
	result := StateCompatibility{StoredSchema: state.SchemaVersion, RequiredReaderSchema: required, Action: action}
	if targetReader < required || targetReader > SchemaVersion {
		return result, fmt.Errorf("reader schema %d cannot safely consume required schema %d", targetReader, required)
	}
	switch action {
	case "check":
		return result, nil
	case "upgrade":
		if targetReader != SchemaVersion {
			return result, ErrConflict
		}
		state.SchemaVersion = SchemaVersion
		if err := saveState(path, &state, key); err != nil {
			return result, err
		}
		result.StoredSchema = SchemaVersion
		result.RequiredReaderSchema = SchemaVersion
		return result, nil
	case "recover":
		if state.SchemaVersion != SchemaVersion || targetReader != SchemaVersion {
			return result, ErrConflict
		}
		if err := syncStateDirectory(path); err != nil {
			return result, err
		}
		return result, nil
	default:
		return result, ErrInvalid
	}
}
