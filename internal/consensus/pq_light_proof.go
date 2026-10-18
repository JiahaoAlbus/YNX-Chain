package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	"github.com/cometbft/cometbft/light"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

const (
	PQLightProofVersion         = "YNX-PQ-LIGHT-PROOF/v1"
	MaxPQLightProofRequestBytes = 14 << 20
	MaxPQTrustedLightBlockBytes = 10 << 20
	maxPQLightCommitBytes       = 8 << 20
	maxPQLightValidatorsBytes   = 2 << 20
	maxPQLightValidators        = 100
)

// PQLightProofRequest transports the original RPC RESULT objects, not RPC
// envelopes. JSON encodes each []byte as base64. It contains no trust settings.
type PQLightProofRequest struct {
	Version          string `json:"version"`
	CommitResult     []byte `json:"commitResult"`
	ValidatorsResult []byte `json:"validatorsResult"`
}

// PQLightProofTrust is supplied by the trusted host, never decoded from proof.
// Snapshot must come from the normal independently pinned engine loader; the
// trusted LightBlock must already be authenticated by that host. A successful
// transition does not authenticate the provenance of either trust input.
type PQLightProofTrust struct {
	Snapshot          *PQEngineSnapshot
	TrustedLightBlock *cmttypes.LightBlock
	TrustingPeriod    time.Duration
	MaxClockDrift     time.Duration
	TrustLevel        cmtmath.Fraction
	Now               time.Time
}

// PQLightProofExpectation binds the caller's requested target. Header H commits
// the application state at H-1. These fields do not themselves grant trust.
type PQLightProofExpectation struct {
	ChainID      string
	HeaderHeight int64
	BlockHash    []byte
	StateHeight  int64
	StateAppHash []byte
}

// PQLightProofResult reports one mathematical transition, not transaction
// inclusion, witness agreement, a running light client, or product authority.
type PQLightProofResult struct {
	Version                 string `json:"version"`
	Classification          string `json:"classification"`
	ChainID                 string `json:"chainId"`
	GenesisSHA256           string `json:"genesisSha256"`
	AuthorityThroughHeight  int64  `json:"authorityThroughHeight,string"`
	TrustedHeight           int64  `json:"trustedHeight,string"`
	TrustedBlockHash        string `json:"trustedBlockHash"`
	HeaderHeight            int64  `json:"headerHeight,string"`
	BlockHash               string `json:"blockHash"`
	StateHeight             int64  `json:"stateHeight,string"`
	StateAppHash            string `json:"stateAppHash"`
	ValidatorsHash          string `json:"validatorsHash"`
	NextValidatorsHash      string `json:"nextValidatorsHash"`
	ConsensusHash           string `json:"consensusHash"`
	CommitVerified          bool   `json:"commitVerified"`
	LightTransitionVerified bool   `json:"lightTransitionVerified"`
}

// PQLightProofError has a stable stage code and bounded public explanation.
// Cryptographic failures deliberately do not echo full signature/proof bytes.
type PQLightProofError struct{ Code, Detail string }

func (e *PQLightProofError) Error() string     { return e.Code + ": " + e.Detail }
func pqLightFailure(code, detail string) error { return &PQLightProofError{Code: code, Detail: detail} }

func DecodePQLightProofRequest(raw []byte) (PQLightProofRequest, error) {
	var out PQLightProofRequest
	if len(raw) == 0 || len(raw) > MaxPQLightProofRequestBytes || pqLightUniqueJSON(raw) != nil || pqLightJSONShape(raw, "request") != nil {
		return out, pqLightFailure("invalid_proof", "invalid bounded proof request JSON")
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return PQLightProofRequest{}, pqLightFailure("invalid_proof", "invalid proof byte encoding")
	}
	if err := out.validate(); err != nil {
		return PQLightProofRequest{}, err
	}
	canonical, err := json.Marshal(out)
	if err != nil || !pqLightJSONEquivalent(raw, canonical) {
		return PQLightProofRequest{}, pqLightFailure("invalid_proof", "noncanonical proof fields or base64 encoding")
	}
	return out, nil
}

func (p PQLightProofRequest) validate() error {
	if p.Version != PQLightProofVersion || len(p.CommitResult) == 0 || len(p.CommitResult) > maxPQLightCommitBytes || len(p.ValidatorsResult) == 0 || len(p.ValidatorsResult) > maxPQLightValidatorsBytes {
		return pqLightFailure("invalid_proof", "proof version or RPC result size is invalid")
	}
	return nil
}

// DecodePQTrustedLightBlock decodes an independently authenticated Comet JSON
// LightBlock. Decoding alone does not establish trust or attach key authority.
func DecodePQTrustedLightBlock(raw []byte) (*cmttypes.LightBlock, error) {
	var block cmttypes.LightBlock
	if err := pqLightDecodeComet(raw, "light-block", &block, MaxPQTrustedLightBlockBytes); err != nil {
		return nil, err
	}
	if err := pqLightBlockStructure(&block); err != nil {
		return nil, err
	}
	return &block, nil
}

func VerifyPQLightProof(trust PQLightProofTrust, expected PQLightProofExpectation, proof PQLightProofRequest) (PQLightProofResult, error) {
	var empty PQLightProofResult
	if err := proof.validate(); err != nil {
		return empty, err
	}
	if trust.Snapshot == nil || trust.Snapshot.bootstrap == nil || trust.Snapshot.history == nil || trust.Snapshot.schedule == nil || trust.TrustedLightBlock == nil || trust.TrustingPeriod <= 0 || trust.MaxClockDrift < 0 || trust.Now.IsZero() {
		return empty, pqLightFailure("invalid_trust", "independent snapshot, trusted block, clock and explicit positive trust period are required")
	}
	anchor := trust.Snapshot.Anchor()
	if len(anchor.GenesisID) != 32 || expected.ChainID != anchor.ChainID || expected.StateHeight < 0 || expected.StateHeight >= math.MaxInt64-1 || expected.HeaderHeight != expected.StateHeight+1 || len(expected.BlockHash) != 32 || len(expected.StateAppHash) != 32 {
		return empty, pqLightFailure("anchor_mismatch", "invalid chain, successor height or full expected hashes")
	}
	// Round-trip detaches all caller-owned bytes and removes attached key
	// capabilities. Only the separately supplied snapshot can bind them again.
	if err := pqLightBlockStructure(trust.TrustedLightBlock); err != nil {
		return empty, pqLightFailure("invalid_trust", "invalid trusted light block structure")
	}
	trustedRaw, err := cmtjson.Marshal(trust.TrustedLightBlock)
	if err != nil || len(trustedRaw) > MaxPQTrustedLightBlockBytes {
		return empty, pqLightFailure("invalid_trust", "trusted light block cannot be encoded within bounds")
	}
	trusted, err := DecodePQTrustedLightBlock(trustedRaw)
	if err != nil {
		return empty, pqLightFailure("invalid_trust", "trusted light block is not canonical")
	}
	if expected.HeaderHeight <= trusted.Height || trusted.ChainID != anchor.ChainID || trusted.Time.IsZero() || trusted.Time.After(trust.Now.Add(trust.MaxClockDrift)) {
		return empty, pqLightFailure("invalid_trust", "trusted header chain, time or transition height mismatch")
	}
	level, err := pqLightTrustLevel(trust.TrustLevel, trusted.ValidatorSet.TotalVotingPower())
	if err != nil {
		return empty, err
	}
	if light.HeaderExpired(trusted.SignedHeader, trust.TrustingPeriod, trust.Now) {
		return empty, pqLightFailure("expired_trust", "trusted header has expired at the independently supplied local time")
	}
	var commit coretypes.ResultCommit
	var validators coretypes.ResultValidators
	if err := pqLightDecodeComet(proof.CommitResult, "commit-result", &commit, maxPQLightCommitBytes); err != nil {
		return empty, err
	}
	if err := pqLightDecodeComet(proof.ValidatorsResult, "validators-result", &validators, maxPQLightValidatorsBytes); err != nil {
		return empty, err
	}
	if commit.Header == nil || commit.Commit == nil || commit.ChainID != anchor.ChainID || commit.Height != expected.HeaderHeight || !bytes.Equal(commit.Header.Hash(), expected.BlockHash) || !bytes.Equal(commit.Header.AppHash, expected.StateAppHash) {
		return empty, pqLightFailure("anchor_mismatch", "actual header does not commit the requested block and preceding application state")
	}
	if validators.BlockHeight != expected.HeaderHeight || validators.Count != len(validators.Validators) || validators.Total != validators.Count || validators.Count == 0 || validators.Count > maxPQLightValidators {
		return empty, pqLightFailure("invalid_proof", "complete nonpaginated validator result at the target height is required")
	}
	set := &cmttypes.ValidatorSet{Validators: validators.Validators}
	for _, member := range set.Validators {
		if member != nil && bytes.Equal(member.Address, commit.ProposerAddress) {
			set.Proposer = member
		}
	}
	target := &cmttypes.LightBlock{SignedHeader: &commit.SignedHeader, ValidatorSet: set}
	if err := pqLightBlockStructure(target); err != nil {
		return empty, err
	}
	for _, block := range []*cmttypes.LightBlock{trusted, target} {
		params, err := trust.Snapshot.ParamsAt(block.Height)
		if err != nil || block.Version.App != params.Version.App {
			return empty, pqLightFailure("authority_rejected", "header application version differs from independently authorized parameters at its height")
		}
	}
	// RPC canonical=true/false is transport metadata. Both canonical commits
	// and latest-height seen commits must pass these identical checks.
	trusted, err = light.BindLightBlock(trust.Snapshot, trusted)
	if err != nil {
		return empty, pqLightFailure("authority_rejected", "trusted header parameters or historical full validator set differ from independent authority")
	}
	target, err = light.BindLightBlock(trust.Snapshot, target)
	if err != nil {
		return empty, pqLightFailure("authority_rejected", "target parameters, current/next full validator set or height differ from independent authority")
	}
	if err := trusted.ValidatorSet.VerifyCommit(anchor.ChainID, trusted.Commit.BlockID, trusted.Height, trusted.Commit); err != nil {
		return empty, pqLightFailure("invalid_trust", "trusted full commit signatures or quorum are invalid")
	}
	// VerifyCommit checks EVERY present signature (including nil votes), exact
	// index/address correspondence, and strictly >2/3 block voting power. The
	// light shortcut alone would not detect a bad tail after reaching quorum.
	if err := target.ValidatorSet.VerifyCommit(anchor.ChainID, target.Commit.BlockID, target.Height, target.Commit); err != nil {
		return empty, pqLightFailure("commit_invalid", "target full commit signatures or strict two-thirds quorum are invalid")
	}
	if err := light.Verify(trusted.SignedHeader, trusted.ValidatorSet, target.SignedHeader, target.ValidatorSet, trust.TrustingPeriod, trust.Now, trust.MaxClockDrift, level); err != nil {
		return empty, pqLightFailure("light_transition_invalid", "normal Comet light trust transition rejected the target")
	}
	return PQLightProofResult{Version: PQLightProofVersion, Classification: "data", ChainID: anchor.ChainID, GenesisSHA256: hex.EncodeToString(anchor.GenesisID), AuthorityThroughHeight: trust.Snapshot.through, TrustedHeight: trusted.Height, TrustedBlockHash: hex.EncodeToString(trusted.Hash()), HeaderHeight: target.Height, BlockHash: hex.EncodeToString(target.Hash()), StateHeight: target.Height - 1, StateAppHash: hex.EncodeToString(target.AppHash), ValidatorsHash: hex.EncodeToString(target.ValidatorsHash), NextValidatorsHash: hex.EncodeToString(target.NextValidatorsHash), ConsensusHash: hex.EncodeToString(target.ConsensusHash), CommitVerified: true, LightTransitionVerified: true}, nil
}

func pqLightTrustLevel(level cmtmath.Fraction, power int64) (cmtmath.Fraction, error) {
	n, d := level.Numerator, level.Denominator
	minimum := d / 3
	if d%3 != 0 {
		minimum++
	}
	if n == 0 || d == 0 || n > d || n < minimum || n > math.MaxInt64 || d > math.MaxInt64 || power <= 0 {
		return cmtmath.Fraction{}, pqLightFailure("invalid_trust", "trust level must be an explicit fraction between one third and one")
	}
	a, b := n, d
	for b != 0 {
		a, b = b, a%b
	}
	n, d = n/a, d/a
	// Preserve the exact fraction while keeping upstream uint64 *3 and int64
	// voting-power multiplication safe. Unsupported giant fractions fail closed.
	if n > math.MaxUint64/3 || n > uint64(math.MaxInt64/power) {
		return cmtmath.Fraction{}, pqLightFailure("invalid_trust", "trust fraction exceeds safe Comet arithmetic")
	}
	level = cmtmath.Fraction{Numerator: n, Denominator: d}
	if light.ValidateTrustLevel(level) != nil {
		return cmtmath.Fraction{}, pqLightFailure("invalid_trust", "invalid Comet trust fraction")
	}
	return level, nil
}

func pqLightBlockStructure(block *cmttypes.LightBlock) error {
	if block == nil || block.SignedHeader == nil || block.Header == nil || block.Commit == nil || block.ValidatorSet == nil || block.Height <= 0 || block.Height == math.MaxInt64 || len(block.ValidatorSet.Validators) == 0 || len(block.ValidatorSet.Validators) > maxPQLightValidators || len(block.Commit.Signatures) != len(block.ValidatorSet.Validators) {
		return pqLightFailure("invalid_proof", "invalid bounded complete light block")
	}
	seen := make(map[string]bool, len(block.ValidatorSet.Validators))
	var total int64
	proposerMatches := false
	for index, v := range block.ValidatorSet.Validators {
		if v == nil || v.ValidateBasic() != nil || v.VotingPower <= 0 || v.VotingPower > cmttypes.MaxTotalVotingPower-total || seen[string(v.Address)] {
			return pqLightFailure("invalid_proof", "invalid or duplicate validator or voting power")
		}
		seen[string(v.Address)] = true
		total += v.VotingPower
		sig := block.Commit.Signatures[index]
		if sig.ValidateBasic() != nil || sig.BlockIDFlag != cmttypes.BlockIDFlagAbsent && !bytes.Equal(sig.ValidatorAddress, v.Address) {
			return pqLightFailure("invalid_proof", "commit slot, address, absent or nil vote encoding is invalid")
		}
		p := block.ValidatorSet.Proposer
		if p != nil && p.PubKey != nil && bytes.Equal(p.Address, v.Address) && p.PubKey.Equals(v.PubKey) && p.VotingPower == v.VotingPower && p.ProposerPriority == v.ProposerPriority {
			proposerMatches = true
		}
	}
	if !proposerMatches || !seen[string(block.ProposerAddress)] || !sort.IsSorted(cmttypes.ValidatorsByVotingPower(block.ValidatorSet.Validators)) {
		return pqLightFailure("invalid_proof", "validator order or complete proposer identity is invalid")
	}
	if block.ValidateBasic(block.ChainID) != nil || !block.Commit.BlockID.IsComplete() {
		return pqLightFailure("invalid_proof", "header hash, full BlockID, commit or validator hash mismatch")
	}
	return nil
}

func pqLightDecodeComet(raw []byte, kind string, out any, limit int) error {
	if len(raw) == 0 || len(raw) > limit || pqLightUniqueJSON(raw) != nil || pqLightJSONShape(raw, kind) != nil {
		return pqLightFailure("invalid_proof", "invalid bounded Comet JSON grammar")
	}
	if cmtjson.Unmarshal(raw, out) != nil {
		return pqLightFailure("invalid_proof", "invalid Comet typed value")
	}
	canonical, err := cmtjson.Marshal(out)
	if err != nil || !pqLightJSONEquivalent(raw, canonical) {
		return pqLightFailure("invalid_proof", "noncanonical Comet fields or integer encoding")
	}
	return nil
}

// Compare typed canonical representations while allowing JSON whitespace and
// object field ordering. This retains decimal-string precision and rejects
// omitted/null fields, noncanonical integer/hash/base64 encodings and aliases.
func pqLightJSONEquivalent(a, b []byte) bool {
	normalize := func(raw []byte) []byte {
		var value any
		d := json.NewDecoder(bytes.NewReader(raw))
		d.UseNumber()
		if d.Decode(&value) != nil {
			return nil
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil
		}
		return encoded
	}
	x, y := normalize(a), normalize(b)
	return x != nil && y != nil && bytes.Equal(x, y)
}

// Token validation is intentionally recursive: encoding/json and the Comet
// codec alone accept duplicate object keys. All work is bounded before typed
// allocations; no unrecognized opaque subtree can carry alternate semantics.
func pqLightUniqueJSON(raw []byte) error {
	if !utf8.Valid(raw) {
		return errors.New("invalid UTF-8 JSON")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	tokens := 0
	var visit func(int) error
	visit = func(depth int) error {
		if depth > 16 || tokens > 10000 {
			return errors.New("JSON complexity limit")
		}
		tokens++
		token, err := d.Token()
		if err != nil {
			return err
		}
		delim, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				key, err := d.Token()
				if err != nil {
					return err
				}
				name, ok := key.(string)
				if !ok || seen[name] || len(seen) >= 1024 {
					return errors.New("duplicate or excessive JSON fields")
				}
				seen[name] = true
				if err := visit(depth + 1); err != nil {
					return err
				}
			}
		case '[':
			count := 0
			for d.More() {
				count++
				if count > maxPQLightValidators {
					return errors.New("JSON array limit")
				}
				if err := visit(depth + 1); err != nil {
					return err
				}
			}
		default:
			return errors.New("invalid JSON delimiter")
		}
		_, err = d.Token()
		return err
	}
	if err := visit(0); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return errors.New("trailing JSON")
	}
	return nil
}

func pqLightJSONShape(raw json.RawMessage, kind string) error {
	type child struct {
		field, kind string
		array       bool
	}
	var allowed string
	var children []child
	switch kind {
	case "request":
		allowed = "version commitResult validatorsResult"
	case "light-block":
		allowed = "signed_header validator_set"
		children = []child{{"signed_header", "signed-header", false}, {"validator_set", "validator-set", false}}
	case "validator-set":
		allowed = "validators proposer"
		children = []child{{"validators", "validator", true}, {"proposer", "validator", false}}
	case "commit-result":
		allowed = "signed_header canonical"
		children = []child{{"signed_header", "signed-header", false}}
	case "validators-result":
		allowed = "block_height validators count total"
		children = []child{{"validators", "validator", true}}
	case "signed-header":
		allowed = "header commit"
		children = []child{{"header", "header", false}, {"commit", "commit", false}}
	case "header":
		allowed = "version chain_id height time last_block_id last_commit_hash data_hash validators_hash next_validators_hash consensus_hash app_hash last_results_hash evidence_hash proposer_address"
		children = []child{{"version", "version", false}, {"last_block_id", "block-id", false}}
	case "version":
		allowed = "block app"
	case "block-id":
		allowed = "hash parts"
		children = []child{{"parts", "parts", false}}
	case "parts":
		allowed = "total hash"
	case "commit":
		allowed = "height round block_id signatures"
		children = []child{{"block_id", "block-id", false}, {"signatures", "commit-signature", true}}
	case "commit-signature":
		allowed = "block_id_flag validator_address timestamp signature"
	case "validator":
		allowed = "address pub_key voting_power proposer_priority"
		children = []child{{"pub_key", "pub-key", false}}
	case "pub-key":
		allowed = "type value"
	default:
		return errors.New("unknown Comet grammar")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return errors.New("JSON object required")
	}
	names := strings.Fields(allowed)
	// Comet's actual protobuf version JSON omits App when zero. Preserve that
	// historical encoding; the typed canonical round-trip still rejects an
	// explicitly encoded zero, and authority binding enforces the value at H.
	if kind == "version" && len(fields) == 1 {
		names = []string{"block"}
	}
	if len(fields) != len(names) {
		return errors.New("missing or unknown field")
	}
	for _, name := range names {
		if _, ok := fields[name]; !ok {
			return errors.New("missing field")
		}
	}
	for _, c := range children {
		if c.array {
			var values []json.RawMessage
			if json.Unmarshal(fields[c.field], &values) != nil || len(values) == 0 || len(values) > maxPQLightValidators {
				return errors.New("complete bounded array required")
			}
			for _, value := range values {
				if err := pqLightJSONShape(value, c.kind); err != nil {
					return err
				}
			}
		} else if err := pqLightJSONShape(fields[c.field], c.kind); err != nil {
			return err
		}
	}
	return nil
}
