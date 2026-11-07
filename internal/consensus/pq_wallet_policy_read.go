package consensus

import (
	"bytes"
	"encoding/hex"
	"errors"
	"math"
	"path/filepath"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// PQWalletPolicyCheckpoint is an INDEPENDENT input to the protected backend.
// Obtain it from the authenticated engine or an independently anchored normal
// light verification (header H+1 commits state H). Neither an RPC observation
// nor the file being read can authenticate these values. This API authenticates
// the complete ledger against that input; it does not establish its provenance,
// latestness, Root admission, user approval or a wall-clock freshness window.
type PQWalletPolicyCheckpoint struct {
	ChainID string
	Height  int64
	AppHash [32]byte
}

// Origin describes only how this invocation obtained its checkpoint. The
// direct input case does NOT attest that the caller actually ran light.Verify;
// retain any externally verified TrustedLightBlock evidence separately. A
// local engine checkpoint is not independent client BFT finality evidence.
type PQWalletPolicyCheckpointOrigin string

const (
	PQWalletPolicyIndependentCheckpointInput PQWalletPolicyCheckpointOrigin = "independent-checkpoint-input"
	PQWalletPolicyLocalEngineCheckpoint      PQWalletPolicyCheckpointOrigin = "local-engine-checkpoint"
)

// PQWalletPolicyReadRequest belongs to the existing protected Source backend,
// not an HTTP/JS request. Bootstrap, optional schedule/runtime authorization and
// checkpoint must all come from independently pinned normal configuration.
// There is no fallback to observed policy JSON or a self-reported issuer.
type PQWalletPolicyReadRequest struct {
	Migration            chain.ConsensusMigrationState
	StatePath            string
	Bootstrap            *ConsensusBootstrap
	EngineAuthorization  *PQEngineAuthorization
	RuntimeAuthorization *RuntimeUpgradeAuthorization
	Checkpoint           PQWalletPolicyCheckpoint
	Owner                string
}

// PQWalletPolicyAtCheckpointView is detached DATA, not a constructor for the
// sealed result. PolicyOriginal is the existing canonical Wallet policy codec,
// including all of this owner's registrations and terminal revocations. A key
// epoch is Record.Revision, not a validator epoch or policy format version.
// Registrations are present only when TrustedRegistration permits TX-BATCH at
// the indicated height; callers of other fixed purposes must still qualify
// that purpose through their existing policy and protected source boundary.
type PQWalletPolicyAtCheckpointView struct {
	Owner                        string
	NetworkID                    [32]byte
	NativeChainID                int64
	CommittedHeight              int64
	ExecutionHeight              uint64
	LedgerNonce                  uint64
	PolicyOriginal               []byte
	CommittedAuthorizationStatus string
	CommittedPQSigningEnabled    bool
	AuthorizationStatus          string
	PQSigningEnabled             bool
	CommittedRegistration        *ynxauth.Record
	ExecutionRegistration        *ynxauth.Record
}

type pqWalletPolicySeal struct {
	checkpoint PQWalletPolicyCheckpoint
	view       PQWalletPolicyAtCheckpointView
	origin     PQWalletPolicyCheckpointOrigin
}

// PQWalletPolicyAtCheckpoint has no public fields or decoder. Its zero value
// cannot attest anything. Only a successful complete original-ledger read can
// construct it. It retains no file handle, signer, mutable ledger or authority
// cache. All accessors return detached data. Re-read for each new checkpoint;
// retaining a previous result does not turn it into a CURRENT authorization.
type PQWalletPolicyAtCheckpoint struct{ seal *pqWalletPolicySeal }

func (r *PQWalletPolicyAtCheckpoint) Origin() (PQWalletPolicyCheckpointOrigin, error) {
	if r == nil || r.seal == nil {
		return "", errors.New("unverified Wallet policy checkpoint")
	}
	return r.seal.origin, nil
}

func (r *PQWalletPolicyAtCheckpoint) Checkpoint() (PQWalletPolicyCheckpoint, error) {
	if r == nil || r.seal == nil {
		return PQWalletPolicyCheckpoint{}, errors.New("unverified Wallet policy checkpoint")
	}
	return r.seal.checkpoint, nil
}

func clonePQWalletPolicyRecord(r *ynxauth.Record) *ynxauth.Record {
	if r == nil {
		return nil
	}
	copy := *r
	copy.PKA, copy.PKB = bytes.Clone(r.PKA), bytes.Clone(r.PKB)
	return &copy
}

func (r *PQWalletPolicyAtCheckpoint) OwnerPolicy() (PQWalletPolicyAtCheckpointView, error) {
	if r == nil || r.seal == nil {
		return PQWalletPolicyAtCheckpointView{}, errors.New("unverified Wallet policy checkpoint")
	}
	v := r.seal.view
	v.PolicyOriginal = bytes.Clone(v.PolicyOriginal)
	v.CommittedRegistration = clonePQWalletPolicyRecord(v.CommittedRegistration)
	v.ExecutionRegistration = clonePQWalletPolicyRecord(v.ExecutionRegistration)
	return v, nil
}

func pqWalletPolicyPath(path string) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return errors.New("Wallet policy source requires an absolute canonical original path")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return err
	}
	if resolved != path {
		return errors.New("Wallet policy source cannot use a symlink or parent alias")
	}
	return nil
}

// ReadPQWalletPolicyAtCheckpoint uses the original atomic/snapshot-journal/
// block-journal reader, full state/history/registry validation, independent
// runtime/schedule and exact checkpoint binding. It never opens a writer,
// repairs a tail, creates a lock, signs, or installs a new Root/provider.
func ReadPQWalletPolicyAtCheckpoint(req PQWalletPolicyReadRequest) (*PQWalletPolicyAtCheckpoint, error) {
	return readPQWalletPolicyAtCheckpoint(req, capturePQEngineState)
}

// ReadPQWalletPolicyFromOperatorCheckpoint is the normal stopped-operator
// backend. The existing inspector obtains H/AppHash from the actual protected
// Comet state database, excluding application/signing writers and binding the
// original three validator sets/parameters. The policy read must then match
// that exact checkpoint. No caller-supplied observation selects its hash.
// It remains checkpoint DATA: the caller's normal Root-pin/source admission
// and live CURRENT/approval/loan lifecycle are not provided by this function.
func ReadPQWalletPolicyFromOperatorCheckpoint(migration chain.ConsensusMigrationState, rawGenesis []byte, pins ConsensusBootstrapPins, options OperatorCheckpointOptions, owner string) (*PQWalletPolicyAtCheckpoint, error) {
	if !accountaddress.IsCanonical(owner) || options.BackupOutput != "" || options.BackupLegacyKeyPath != "" || options.BackupNodeKeyPath != "" || options.ProposePQActivationHeight != 0 || options.NextAuthorization != nil || options.LegacyStakingOwner != "" {
		return nil, errors.New("Wallet policy inspection is readonly and requires only the original checkpoint authorities")
	}
	checkpoint, err := InspectOperatorCheckpoint(migration, rawGenesis, pins, options)
	if err != nil {
		return nil, err
	}
	bootstrap, err := NewConsensusBootstrap(rawGenesis, pins, migration)
	if err != nil {
		return nil, err
	}
	hash, err := hex.DecodeString(checkpoint.AppHash)
	if err != nil || len(hash) != 32 {
		return nil, errors.New("original engine checkpoint has no complete AppHash")
	}
	cp := PQWalletPolicyCheckpoint{ChainID: checkpoint.ChainID, Height: checkpoint.Height}
	copy(cp.AppHash[:], hash)
	result, err := ReadPQWalletPolicyAtCheckpoint(PQWalletPolicyReadRequest{Migration: migration, StatePath: options.StatePath, Bootstrap: bootstrap, EngineAuthorization: options.Authorization, RuntimeAuthorization: options.RuntimeUpgrade, Checkpoint: cp, Owner: owner})
	if err != nil {
		return nil, err
	}
	result.seal.origin = PQWalletPolicyLocalEngineCheckpoint
	return result, nil
}

// The capture seam is private, used by the original-file failure regressions;
// callers cannot substitute a custom reader or a "verified" boolean.
func readPQWalletPolicyAtCheckpoint(req PQWalletPolicyReadRequest, capture func(string) (*pqEngineStateRead, error)) (result *PQWalletPolicyAtCheckpoint, err error) {
	if req.Bootstrap == nil || !accountaddress.IsCanonical(req.Owner) || req.Checkpoint.ChainID != req.Bootstrap.record.ChainID || req.Checkpoint.Height <= 0 || req.Checkpoint.Height > math.MaxInt64-2 || req.Checkpoint.AppHash == [32]byte{} {
		return nil, errors.New("Wallet policy read requires an independent chain/checkpoint, pinned bootstrap and canonical owner")
	}
	if err := pqWalletPolicyPath(req.StatePath); err != nil {
		return nil, err
	}
	witness, err := newValidatedMigration(req.Migration, req.Bootstrap)
	if err != nil {
		return nil, err
	}
	if req.RuntimeAuthorization != nil {
		if err := validateRuntimeUpgradeBootstrap(witness.migration, witness.bootstrap, req.RuntimeAuthorization); err != nil {
			return nil, err
		}
	} else if witness.bootstrap.record.Params.Version == nil || witness.bootstrap.record.Params.Version.App != ApplicationVersion {
		return nil, errors.New("historical Wallet policy source requires its independent runtime upgrade authorization")
	}
	var held *pqEngineStateRead
	var closeOriginal func() error
	defer func() {
		// Keep the original-source lifecycle through projection construction.
		// Any change or Close failure invalidates even an otherwise valid read.
		if held != nil {
			err = errors.Join(err, held.unchanged(), pqWalletPolicyPath(req.StatePath))
		}
		if closeOriginal != nil {
			err = errors.Join(err, closeOriginal())
		}
		if err != nil {
			result = nil
		}
	}()
	state, err := readPQEngineCommittedStateOwned(req.StatePath, witness, req.EngineAuthorization, req.RuntimeAuthorization, func(path string) (*pqEngineStateRead, error) {
		r, captureErr := capture(path)
		if captureErr != nil {
			return nil, captureErr
		}
		held, closeOriginal = r, r.closeOriginal
		r.closeOriginal = nil // the outer owned lifecycle closes exactly once
		return r, nil
	})
	if err != nil {
		return nil, err
	}
	if !state.Initialized || state.Height != req.Checkpoint.Height || state.AppHash != hex.EncodeToString(req.Checkpoint.AppHash[:]) {
		return nil, errors.New("Wallet policy source differs from the independent initialized checkpoint")
	}
	if state.Version <= 13 && req.RuntimeAuthorization == nil {
		return nil, errors.New("historical Wallet policy state cannot use the current execution domain without its original runtime plan")
	}
	if _, err := runtimeStateApplicationVersion(state, req.RuntimeAuthorization); err != nil {
		return nil, err
	}
	if err := req.EngineAuthorization.ValidateCommittedSchedule(state.PQEngineSchedule, state.Height); err != nil {
		return nil, err
	}
	if req.EngineAuthorization != nil && state.PQEngineSchedule == nil {
		if req.EngineAuthorization.schedule.RegistryHeight != state.Height {
			return nil, errors.New("Wallet policy schedule does not bind the actual committed registry height")
		}
		if _, err := newPQEngineSnapshotOwned(witness, witness.bootstrap, state.ValidatorRegistry, req.EngineAuthorization.schedule, req.EngineAuthorization.schedule.AuthorizedAt); err != nil {
			return nil, err
		}
	}
	// Complete registry replay and the next two membership sets use the same
	// authenticated bootstrap as the normal engine source, including old sets.
	if _, err := newPQEngineSnapshotOwned(witness, witness.bootstrap, state.ValidatorRegistry, state.PQEngineSchedule, state.Height); err != nil {
		return nil, err
	}
	return pqWalletPolicyProjection(state, witness.migration, req.Owner, req.Checkpoint, PQWalletPolicyIndependentCheckpointInput)
}

// Only the original full-state reader or a constructor-bound owning Node/App
// read calls this projection. It is not a public decoder or trust constructor.
func pqWalletPolicyProjection(state CommittedState, migration chain.ConsensusMigrationState, owner string, checkpoint PQWalletPolicyCheckpoint, origin PQWalletPolicyCheckpointOrigin) (*PQWalletPolicyAtCheckpoint, error) {
	if _, exists := accountIndex(state.Accounts, owner); !exists {
		return nil, errors.New("Wallet policy owner has no original ledger account")
	}
	view, err := pqWalletAccountView(state, migration, owner)
	if err != nil {
		return nil, err
	}
	if view.Policy == nil || len(view.Policy.Records) == 0 {
		return nil, errors.New("Wallet policy owner has no committed PQ registration history")
	}
	original, err := ynxauth.EncodeWalletPolicyProjection(*view.Policy, owner)
	if err != nil {
		return nil, err
	}
	v := PQWalletPolicyAtCheckpointView{
		Owner: owner, NativeChainID: view.NativeChainID, CommittedHeight: view.CommittedHeight,
		ExecutionHeight: view.ExecutionHeight, LedgerNonce: view.LedgerNonce, PolicyOriginal: original,
		CommittedAuthorizationStatus: view.CommittedAuthorizationStatus, CommittedPQSigningEnabled: view.CommittedPQSigningEnabled,
		AuthorizationStatus: view.AuthorizationStatus, PQSigningEnabled: view.PQSigningEnabled,
	}
	copy(v.NetworkID[:], view.Policy.NetworkID)
	if view.CommittedPQSigningEnabled {
		if _, err := view.Policy.TrustedRegistration(owner, ynxauth.TransactionPurpose, uint64(state.Height)); err != nil {
			return nil, err
		}
		r, _ := view.Policy.PolicyAt(owner, uint64(state.Height))
		v.CommittedRegistration = clonePQWalletPolicyRecord(&r)
	}
	if view.PQSigningEnabled {
		if _, err := view.Policy.TrustedRegistration(owner, ynxauth.TransactionPurpose, view.ExecutionHeight); err != nil {
			return nil, err
		}
		r, _ := view.Policy.PolicyAt(owner, view.ExecutionHeight)
		v.ExecutionRegistration = clonePQWalletPolicyRecord(&r)
	}
	return &PQWalletPolicyAtCheckpoint{seal: &pqWalletPolicySeal{checkpoint: checkpoint, view: v, origin: origin}}, nil
}
