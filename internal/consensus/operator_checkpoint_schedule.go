package consensus

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
)

// OperatorCheckpointScheduleCandidate is public configuration, never approval. In
// particular, ScheduleHash is the original domain-separated schedule hash;
// CanonicalScheduleSHA256 is only the SHA256 of the decoded public file bytes.
type OperatorCheckpointScheduleCandidate struct {
	Version                 string `json:"version"`
	CanonicalScheduleBase64 string `json:"canonicalScheduleBase64"`
	CanonicalScheduleSHA256 string `json:"canonicalScheduleSHA256"`
	ScheduleHash            string `json:"scheduleHash"`
	CandidateOnly           bool   `json:"candidateOnly"`
	AuthorizationGranted    bool   `json:"authorizationGranted"`
}

// The caller has already bound state to the stopped actual Comet H/AppHash
// and holds the original writer/DB locks. Keep the protocol library's generic
// constructor unchanged; this public-operator tool requires all four original
// public-testnet members and never promotes its output to an authorization.
func proposeOperatorCheckpointSchedule(bootstrap *ConsensusBootstrap, state CommittedState, actualHeight, activationHeight int64) (*OperatorCheckpointScheduleCandidate, error) {
	if bootstrap == nil || len(bootstrap.record.Members) != 4 || state.ValidatorRegistry == nil || state.PQEngineSchedule != nil || !state.Initialized || state.Height != actualHeight || actualHeight <= 0 || actualHeight > math.MaxInt64-4 || activationHeight <= 0 || activationHeight > math.MaxInt64-2 {
		return nil, errors.New("public schedule proposal requires the actual initialized unscheduled four-member registry checkpoint and bounded future activation height")
	}
	schedule, err := NewPQEngineSchedule(bootstrap, state.ValidatorRegistry, actualHeight, activationHeight)
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(schedule)
	if err != nil {
		return nil, err
	}
	domainHash, err := schedule.Hash()
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(raw)
	return &OperatorCheckpointScheduleCandidate{Version: "YNX-PQ-ENGINE-SCHEDULE-CANDIDATE/v1", CanonicalScheduleBase64: base64.StdEncoding.EncodeToString(raw), CanonicalScheduleSHA256: hex.EncodeToString(digest[:]), ScheduleHash: domainHash, CandidateOnly: true}, nil
}
