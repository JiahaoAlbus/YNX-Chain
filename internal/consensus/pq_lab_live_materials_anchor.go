//go:build unix

package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	"github.com/cometbft/cometbft/light"
	cmttypes "github.com/cometbft/cometbft/types"
)

// This is captured during the EXISTING stopped activation checkpoint, from
// all four original stores with their writer/signing leases. It is separately
// pinned in the startup policy. A later RPC or request cannot replace it.
type PQLabLiveMaterialsAnchor struct {
	Version          string `json:"version"`
	PlanSHA256       string `json:"planSHA256"`
	ActivationSHA256 string `json:"activationSHA256"`
	Height           int64  `json:"height,string"`
	AppHash          string `json:"appHash"`
	RegistryRoot     string `json:"registryRoot"`
	CommittedState   []byte `json:"committedState"`
	LightBlock       []byte `json:"lightBlock"`
}

func (in *pqLabLiveMaterialsInputs) validateAnchor() error {
	a := in.anchor
	if a.Version != "YNX-PQ-LAB-ORIGINAL-R-ANCHOR/v1" || a.PlanSHA256 != in.policy.PlanSHA256 || a.ActivationSHA256 != in.policy.ActivationSHA256 || a.Height != in.activation.RegistryHeight || a.AppHash != in.activation.AppHash || a.RegistryRoot != in.activation.RegistryRoot {
		return errors.New("independent original R anchor differs from activation")
	}
	if len(a.CommittedState) == 0 || len(a.CommittedState) > 96<<20 {
		return errors.New("bounded complete original R state required")
	}
	var state CommittedState
	if pqLightUniqueJSON(a.CommittedState) != nil || json.Unmarshal(a.CommittedState, &state) != nil {
		return errors.New("invalid original R state")
	}
	_, _, b, err := loadPQLab(in.plan.RootDir, in.policy.PlanSHA256)
	if err != nil {
		return err
	}
	state.bootstrap = b
	if err = state.Validate(in.migration); err != nil {
		return err
	}
	if !state.Initialized || state.Height != a.Height || state.AppHash != a.AppHash || state.ValidatorRegistry == nil || state.ValidatorRegistry.Root != a.RegistryRoot || state.PQEngineSchedule != nil {
		return errors.New("anchor is not the original unscheduled complete registry checkpoint")
	}
	snapshot, err := newPQEngineSnapshot(b, state.ValidatorRegistry, nil, state.Height)
	if err != nil {
		return err
	}
	block, err := DecodePQTrustedLightBlock(a.LightBlock)
	if err != nil {
		return err
	}
	if block.Height != a.Height || block.ChainID != in.plan.ChainID {
		return errors.New("original anchor header height or chain differs")
	}
	block, err = light.BindLightBlock(snapshot, block)
	if err != nil {
		return err
	}
	return block.ValidatorSet.VerifyCommit(in.plan.ChainID, block.Commit.BlockID, block.Height, block.Commit)
}

func (in *pqLabLiveMaterialsInputs) captureOriginalAnchor() (out PQLabLiveMaterialsAnchor, err error) {
	var held []*pqLabStoppedSource
	defer func() {
		for i := len(held) - 1; i >= 0; i-- {
			err = errors.Join(err, held[i].close())
		}
		if err != nil {
			out = PQLabLiveMaterialsAnchor{}
		}
	}()
	_, _, b, err := loadPQLab(in.plan.RootDir, in.policy.PlanSHA256)
	if err != nil {
		return out, err
	}
	for _, n := range in.plan.Nodes {
		s, e := openPQLabStoppedSource(n)
		if e != nil {
			return out, e
		}
		held = append(held, s)
	}
	var firstHash []byte
	for i, s := range held {
		actual := s.state
		if actual.ChainID != in.plan.ChainID || actual.LastBlockHeight != in.activation.RegistryHeight || hex.EncodeToString(actual.AppHash) != in.activation.AppHash {
			return out, errors.New("setup requires all four original stopped exact R checkpoints, never a later self-selected header")
		}
		state, e := readPQEngineCommittedState(in.plan.Nodes[i].StatePath, in.migration, b, nil, nil)
		if e != nil {
			return out, e
		}
		if state.Height != actual.LastBlockHeight || state.AppHash != in.activation.AppHash || state.ValidatorRegistry == nil || state.ValidatorRegistry.Root != in.activation.RegistryRoot || state.PQEngineSchedule != nil {
			return out, errors.New("original R application/registry mismatch")
		}
		block, e := s.ledger.lightBlock(actual.LastBlockHeight)
		if e != nil {
			return out, e
		}
		if !block.Commit.BlockID.Equals(actual.LastBlockID) {
			return out, errors.New("original R engine BlockID differs from retained commit")
		}
		stateRaw, e := encodeCommittedStateJSON(state)
		if e != nil {
			return out, e
		}
		blockRaw, e := cmtjson.Marshal(block)
		if e != nil {
			return out, e
		}
		candidate := PQLabLiveMaterialsAnchor{Version: "YNX-PQ-LAB-ORIGINAL-R-ANCHOR/v1", PlanSHA256: in.policy.PlanSHA256, ActivationSHA256: in.policy.ActivationSHA256, Height: actual.LastBlockHeight, AppHash: state.AppHash, RegistryRoot: state.ValidatorRegistry.Root, CommittedState: stateRaw, LightBlock: blockRaw}
		in.anchor = candidate
		if e = in.validateAnchor(); e != nil {
			return out, e
		}
		if i == 0 {
			out = candidate
			firstHash = bytes.Clone(block.Hash())
		} else if !bytes.Equal(firstHash, block.Hash()) || !bytes.Equal(out.CommittedState, stateRaw) {
			return out, errors.New("four original R checkpoints differ")
		}
	}
	return out, in.current()
}

// Derive the usable PQ predecessor ONLY through the normal light algorithm
// from the independently captured R anchor. Crossing Ed->PQ is adjacent and
// checks every present signature; no RPC or selected current hash is trusted.
func (in *pqLabLiveMaterialsInputs) advanceAnchor(l proofHostLedger, snapshot *PQEngineSnapshot, target int64, now time.Time) (*cmttypes.LightBlock, error) {
	trusted, err := DecodePQTrustedLightBlock(in.anchor.LightBlock)
	if err != nil {
		return nil, err
	}
	trusted, err = light.BindLightBlock(snapshot, trusted)
	if err != nil {
		return nil, err
	}
	if err = trusted.ValidatorSet.VerifyCommit(in.plan.ChainID, trusted.Commit.BlockID, trusted.Height, trusted.Commit); err != nil {
		return nil, err
	}
	// At stopped R, each original node may have a different valid seen-commit
	// subset. R+1 fixes one canonical last commit. Authenticate that complete
	// commit against the SAME pinned header/full BlockID; never require its
	// serialization to equal the independently captured valid seen commit.
	retained, err := l.lightBlock(trusted.Height)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(retained.Hash(), trusted.Hash()) || !retained.Commit.BlockID.Equals(trusted.Commit.BlockID) {
		return nil, errors.New("retained R header differs from independent original anchor")
	}
	retained, err = light.BindLightBlock(snapshot, retained)
	if err != nil {
		return nil, err
	}
	if err = retained.ValidatorSet.VerifyCommit(in.plan.ChainID, retained.Commit.BlockID, retained.Height, retained.Commit); err != nil {
		return nil, err
	}
	trusted = retained
	// A fixed anchor expires; a request cannot roll it forward or extend time.
	if light.HeaderExpired(trusted.SignedHeader, in.policy.TrustingPeriod, now) || trusted.Time.After(now.Add(in.policy.MaxClockDrift)) {
		return nil, errors.New("independent original R trust anchor expired or is future dated")
	}
	end := in.activation.ActivationHeight
	if target <= end {
		end = target - 1
	}
	if end <= trusted.Height || end-trusted.Height > 8 {
		return nil, errors.New("unsupported bounded original activation transition")
	}
	for h := trusted.Height + 1; h <= end; h++ {
		next, e := l.lightBlock(h)
		if e != nil {
			return nil, e
		}
		if !next.LastBlockID.Equals(trusted.Commit.BlockID) || !bytes.Equal(next.LastCommitHash, trusted.Commit.Hash()) {
			return nil, errors.New("original activation header/commit continuity mismatch")
		}
		if h == in.anchor.Height+1 && hex.EncodeToString(next.AppHash) != in.anchor.AppHash {
			return nil, errors.New("live history does not authenticate the independent original R AppHash")
		}
		next, e = light.BindLightBlock(snapshot, next)
		if e != nil {
			return nil, e
		}
		if e = next.ValidatorSet.VerifyCommit(in.plan.ChainID, next.Commit.BlockID, h, next.Commit); e != nil {
			return nil, e
		}
		level, e := pqLightTrustLevel(cmtmath.Fraction{Numerator: in.policy.TrustNumerator, Denominator: in.policy.TrustDenominator}, trusted.ValidatorSet.TotalVotingPower())
		if e != nil {
			return nil, e
		}
		if e = light.Verify(trusted.SignedHeader, trusted.ValidatorSet, next.SignedHeader, next.ValidatorSet, in.policy.TrustingPeriod, now, in.policy.MaxClockDrift, level); e != nil {
			return nil, e
		}
		trusted = next
	}
	return trusted, nil
}
