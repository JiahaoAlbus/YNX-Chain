// Package ynxresourcepolicy adapts the original protected Chain policy reader
// to the fixed resource-consent backend. It is a host/backend package, not part
// of the portable mathematical C archive. It creates no Source, principal loan,
// Native decision, durable claim, signing capability or execution authority.
package ynxresourcepolicy

import (
	"bytes"
	"context"
	"errors"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxresourceconsent"
)

var ErrCurrent = errors.New("resource policy does not match the independently selected checkpoint and full registered pair")

// CurrentAtCheckpoint retains only detached public data from the actual sealed
// Chain reader. Its zero value is invalid. There is deliberately no JSON,
// caller-supplied projection, verification bool, provider or callback constructor.
// A copy shares immutable public contents; no key or parent lease is retained.
type CurrentAtCheckpoint struct{ state *currentAtCheckpoint }

type currentAtCheckpoint struct {
	read *consensus.PQWalletPolicyAtCheckpoint
	data ynxresourceconsent.CurrentDATA
}

// ReadAtCheckpoint invokes the original complete-state reader with independent
// migration/bootstrap/schedule/runtime authorization and an already authenticated
// engine or light-client checkpoint. The caller must acquire those inputs from
// its original trusted backend; a peer/RPC tuple or parsed Source statement is
// not that authority. The read checks no Root provenance or live freshness.
//
// AtCheckpoint means exactly H/AppHash, with policy execution at H+1. It is not
// a claim that H is the latest height. Supply the caller's independent clock
// to DataAtCheckpoint AFTER this synchronous read. It cannot renew any Source,
// registration or request window. Auth/Native
// must hold and check the SAME parent Source, principal/device current, original
// decision and durable slot before and after borrowing/signing; retirement and
// physical child-first drain remain with those owners.
//
// All input slices/objects must remain stable for this synchronous call. Context
// is checked before and after the original synchronous reader; cancellation does
// not detach a worker or interrupt/retry the reader while it owns a file loan.
func ReadAtCheckpoint(ctx context.Context, request consensus.PQWalletPolicyReadRequest, expected ynxbatch.NetworkResourceConsentBinding) (*CurrentAtCheckpoint, error) {
	if ctx == nil {
		return nil, ErrCurrent
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if request.Owner != expected.Owner {
		return nil, ErrCurrent
	}
	expected, epoch, issued, err := resourceExpected(expected)
	if err != nil {
		return nil, err
	}
	read, err := consensus.ReadPQWalletPolicyAtCheckpoint(request)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return bindRead(read, request.Checkpoint, expected, epoch, issued)
}

// QualifyAtCheckpoint consumes the concrete sealed result of either original
// Chain reader, including ReadPQWalletPolicyFromOperatorCheckpoint. It never
// accepts a public view, JSON projection, interface/provider or verification
// flag. It preserves the original checkpoint Origin; neither origin implies
// independent client finality, latestness, Root or protected-principal access.
func QualifyAtCheckpoint(ctx context.Context, read *consensus.PQWalletPolicyAtCheckpoint, expected ynxbatch.NetworkResourceConsentBinding) (*CurrentAtCheckpoint, error) {
	if ctx == nil {
		return nil, ErrCurrent
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	expected, epoch, issued, err := resourceExpected(expected)
	if err != nil {
		return nil, err
	}
	checkpoint, err := read.Checkpoint()
	if err != nil {
		return nil, ErrCurrent
	}
	return bindRead(read, checkpoint, expected, epoch, issued)
}

func resourceExpected(expected ynxbatch.NetworkResourceConsentBinding) (ynxbatch.NetworkResourceConsentBinding, uint64, uint64, error) {
	if !accountaddress.IsCanonical(expected.Owner) || len(expected.NetworkID) != 32 || len(expected.PKA) != ynxbatch.PublicKeyASize || len(expected.PKB) != ynxbatch.PublicKeyBSize {
		return ynxbatch.NetworkResourceConsentBinding{}, 0, 0, ErrCurrent
	}
	epoch, err := strconv.ParseUint(expected.KeyEpoch, 10, 64)
	if err != nil || epoch == 0 || strconv.FormatUint(epoch, 10) != expected.KeyEpoch {
		return ynxbatch.NetworkResourceConsentBinding{}, 0, 0, ErrCurrent
	}
	issued, err := strconv.ParseUint(expected.IssuedHeight, 10, 64)
	if err != nil || strconv.FormatUint(issued, 10) != expected.IssuedHeight {
		return ynxbatch.NetworkResourceConsentBinding{}, 0, 0, ErrCurrent
	}
	expected.NetworkID, expected.PKA, expected.PKB = bytes.Clone(expected.NetworkID), bytes.Clone(expected.PKA), bytes.Clone(expected.PKB)
	return expected, epoch, issued, nil
}

// Both production callers supply the concrete sealed result of the original
// reader. There is no public reader seam or alternate projection constructor.
func bindRead(read *consensus.PQWalletPolicyAtCheckpoint, selected consensus.PQWalletPolicyCheckpoint, expected ynxbatch.NetworkResourceConsentBinding, epoch, issued uint64) (*CurrentAtCheckpoint, error) {
	checkpoint, err := read.Checkpoint()
	if err != nil || checkpoint != selected {
		return nil, ErrCurrent
	}
	origin, err := read.Origin()
	if err != nil || (origin != consensus.PQWalletPolicyIndependentCheckpointInput && origin != consensus.PQWalletPolicyLocalEngineCheckpoint) {
		return nil, ErrCurrent
	}
	view, err := read.OwnerPolicy()
	if err != nil || view.Owner != expected.Owner || !bytes.Equal(view.NetworkID[:], expected.NetworkID) || view.CommittedHeight != checkpoint.Height || !view.PQSigningEnabled || view.ExecutionRegistration == nil || issued > view.ExecutionHeight {
		return nil, ErrCurrent
	}
	// Consume the original complete owner projection from the sealed reader,
	// including historical rotations and pending/effective revocation. Reuse the
	// existing policy resolver; PolicyAt or a status string cannot grant signing.
	policy, err := ynxauth.DecodeWalletPolicyProjection(view.PolicyOriginal, expected.NetworkID, expected.Owner)
	if err != nil {
		return nil, ErrCurrent
	}
	for _, height := range []uint64{issued, view.ExecutionHeight} {
		registration, err := policy.TrustedRegistration(expected.Owner, ynxbatch.NetworkResourceConsentPurpose, height)
		if err != nil || registration.PolicyRevision != expected.KeyEpoch || !bytes.Equal(registration.PKA, expected.PKA) || !bytes.Equal(registration.PKB, expected.PKB) {
			return nil, ErrCurrent
		}
	}
	r := view.ExecutionRegistration
	if r.AlgorithmVersion != ynxbatch.Version || r.Owner != expected.Owner || r.Revision != epoch || !bytes.Equal(r.PKA, expected.PKA) || !bytes.Equal(r.PKB, expected.PKB) {
		return nil, ErrCurrent
	}
	return &CurrentAtCheckpoint{state: &currentAtCheckpoint{
		read: read,
		data: ynxresourceconsent.CurrentDATA{SubjectOwner: view.Owner, PolicyOriginal: bytes.Clone(view.PolicyOriginal), ExecutionHeight: view.ExecutionHeight},
	}}, nil
}

// DataAtCheckpoint returns an independent copy for the existing fixed
// MaterialAttempt.Current, SignOnce or ConfirmCurrent call. It performs no new
// read and makes no live-current claim. Sample nowMillis from the independent
// caller clock after the read, not before a possibly long ledger reconstruction.
// A fresh original backend read and the parent's own current check are required
// at each Native lifecycle fence. This clock cannot renew the original window.
func (c *CurrentAtCheckpoint) DataAtCheckpoint(nowMillis int64) (ynxresourceconsent.CurrentDATA, error) {
	if c == nil || c.state == nil || c.state.read == nil || nowMillis < 0 || nowMillis > 9007199254740991 {
		return ynxresourceconsent.CurrentDATA{}, ErrCurrent
	}
	out := c.state.data
	out.PolicyOriginal = bytes.Clone(out.PolicyOriginal)
	out.NowMillis = nowMillis
	return out, nil
}

// Checkpoint returns the original independently selected H/AppHash identity.
func (c *CurrentAtCheckpoint) Checkpoint() (consensus.PQWalletPolicyCheckpoint, error) {
	if c == nil || c.state == nil || c.state.read == nil {
		return consensus.PQWalletPolicyCheckpoint{}, ErrCurrent
	}
	return c.state.read.Checkpoint()
}

// Origin preserves the reader's checkpoint acquisition label, not a Root,
// light verification or independent finality assertion.
func (c *CurrentAtCheckpoint) Origin() (consensus.PQWalletPolicyCheckpointOrigin, error) {
	if c == nil || c.state == nil || c.state.read == nil {
		return "", ErrCurrent
	}
	return c.state.read.Origin()
}

// OwnerPolicy returns the reader's detached complete owner view, preserving
// observed H, nonce, full registration and pending/effective revocation state.
func (c *CurrentAtCheckpoint) OwnerPolicy() (consensus.PQWalletPolicyAtCheckpointView, error) {
	if c == nil || c.state == nil || c.state.read == nil {
		return consensus.PQWalletPolicyAtCheckpointView{}, ErrCurrent
	}
	return c.state.read.OwnerPolicy()
}
