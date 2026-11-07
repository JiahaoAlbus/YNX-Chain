// Package ynxresourceconsent provides the fixed same-Go-runtime mathematical
// consent backend. It does not acquire a protected principal, authenticate a
// Source, display Native approval, consume a durable nonce, or execute work.
// The original Auth producer must keep refusing until its owning private lease
// acquisition exists; passing these public DATA checks cannot substitute it.
package ynxresourceconsent

import (
	"bytes"
	"errors"
	"reflect"
	"strconv"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

var ErrRetired = errors.New("resource consent attempt retired")
var ErrAttempted = errors.New("resource consent original signing attempt already selected; reconcile original outcome")
var ErrCurrent = errors.New("resource consent independent current policy DATA mismatch")

// CurrentDATA must be obtained by the original owner from its authenticated
// same Source/current path. This package verifies its contents, not provenance.
type CurrentDATA struct {
	SubjectOwner    string
	PolicyOriginal  []byte
	ExecutionHeight uint64
	NowMillis       int64
}

// Outcome is detached and retained on every late failure. Its signature result
// is mathematical DATA, never execution permission or a durable once claim.
type Outcome struct {
	MemberOriginal       []byte
	SignatureVerified    bool
	BatchCleanupComplete bool
	CurrentDataMatched   bool
	AttemptSelected      bool
	FirstCause           error
}

// Attempt has bounded one-invocation memory and no key handle or resident
// goroutine. Retire/Drain/Close concern only this operation; parent Source,
// borrowed key, durable claim and physical custody remain original-owner debts.
type Attempt struct {
	mu                                  sync.Mutex
	scope, input                        []byte
	binding                             ynxbatch.NetworkResourceConsentBinding
	policy                              ynxauth.State
	height                              uint64
	nowMillis                           int64
	attempted, running, retired, closed bool
	out                                 Outcome
	// Private test seam; exported callers cannot supply signers/providers.
	sign func(*ynxbatch.PrivateKey, []byte, []byte, int64, ynxbatch.NetworkResourceConsentBinding) (ynxbatch.NetworkResourceConsentOutcome, error)
}

func checkPolicy(b ynxbatch.NetworkResourceConsentBinding, c CurrentDATA) (ynxauth.State, error) {
	if c.SubjectOwner != b.Owner {
		return ynxauth.State{}, ErrCurrent
	}
	s, err := ynxauth.DecodeWalletPolicyProjection(c.PolicyOriginal, b.NetworkID, b.Owner)
	if err != nil {
		return ynxauth.State{}, ErrCurrent
	}
	issued, err := strconv.ParseUint(b.IssuedHeight, 10, 64)
	if err != nil || issued > c.ExecutionHeight {
		return ynxauth.State{}, ErrCurrent
	}
	for _, h := range []uint64{issued, c.ExecutionHeight} {
		r, err := s.TrustedRegistration(b.Owner, ynxbatch.NetworkResourceConsentPurpose, h)
		if err != nil || r.PolicyRevision != b.KeyEpoch || !bytes.Equal(r.PKA, b.PKA) || !bytes.Equal(r.PKB, b.PKB) {
			return ynxauth.State{}, ErrCurrent
		}
	}
	return s, nil
}

func Prepare(scopeOriginal, inputOriginal []byte, b ynxbatch.NetworkResourceConsentBinding, c CurrentDATA) (*Attempt, error) {
	m, err := ynxbatch.BuildNetworkResourceConsentMessage(scopeOriginal, inputOriginal, c.NowMillis, b)
	if err != nil {
		return nil, err
	}
	s, err := checkPolicy(m.Binding, c)
	if err != nil {
		return nil, err
	}
	return &Attempt{scope: m.ScopeOriginal, input: bytes.Clone(inputOriginal), binding: m.Binding, policy: s, height: c.ExecutionHeight, nowMillis: c.NowMillis, sign: ynxbatch.SignNetworkResourceConsentDATA}, nil
}

func (a *Attempt) currentLocked(c CurrentDATA) error {
	if a == nil || a.closed || a.retired {
		return ErrRetired
	}
	if a.out.FirstCause != nil {
		return a.out.FirstCause
	}
	s, err := checkPolicy(a.binding, c)
	if err == nil && (c.ExecutionHeight < a.height || c.NowMillis < a.nowMillis || s.EnableAt != a.policy.EnableAt || len(s.Records) < len(a.policy.Records) || len(s.Revocations) < len(a.policy.Revocations)) {
		err = ErrCurrent
	}
	if err == nil && (!reflect.DeepEqual(s.Records[:len(a.policy.Records)], a.policy.Records) || !reflect.DeepEqual(s.Revocations[:len(a.policy.Revocations)], a.policy.Revocations)) {
		err = ErrCurrent
	}
	if err == nil {
		_, err = ynxbatch.BuildNetworkResourceConsentMessage(a.scope, a.input, c.NowMillis, a.binding)
	}
	if err != nil {
		a.out.FirstCause, a.out.CurrentDataMatched = err, false
		return err
	}
	a.policy, a.height, a.nowMillis = s, c.ExecutionHeight, c.NowMillis
	return nil
}

// Current rechecks complete issued/current registration and monotonic immutable
// policy DATA. Revocation, rotation, expiry or any first cause is terminal for
// this attempt. An original Source current check is still required separately.
func (a *Attempt) Current(c CurrentDATA) error {
	if a == nil {
		return ErrRetired
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.currentLocked(c)
}

func (a *Attempt) snapshotLocked() Outcome {
	out := a.out
	out.MemberOriginal = bytes.Clone(out.MemberOriginal)
	return out
}

// SignOnce never acquires/imports a key or retries. The synchronous caller must
// hold its actual protected parent/key borrow until this call returns and all
// original-owner debt drains. Retained originals are copied into a.out before
// checking a late error or retirement, including UNKNOWN outcomes.
func (a *Attempt) SignOnce(key *ynxbatch.PrivateKey, c CurrentDATA) (out Outcome, err error) {
	if a == nil {
		return out, ErrRetired
	}
	a.mu.Lock()
	if a.attempted {
		out = a.snapshotLocked()
		a.mu.Unlock()
		return out, ErrAttempted
	}
	if err = a.currentLocked(c); err != nil {
		out = a.snapshotLocked()
		a.mu.Unlock()
		return out, err
	}
	a.attempted, a.running, a.out.AttemptSelected = true, true, true
	a.mu.Unlock()
	var produced ynxbatch.NetworkResourceConsentOutcome
	defer func() {
		if recover() != nil {
			err = errors.New("resource fixed signing backend failed; reconcile original outcome")
		}
		a.mu.Lock()
		// Original partial custody is adopted before interpreting status.
		a.out.MemberOriginal = bytes.Clone(produced.MemberOriginal)
		a.out.SignatureVerified = produced.SignatureVerified
		a.out.BatchCleanupComplete = produced.BatchCleanupComplete
		a.running = false
		if a.out.FirstCause != nil {
			err = a.out.FirstCause
		} else if err != nil {
			a.out.FirstCause = err
		} else if a.retired || a.closed {
			err = ErrRetired
			a.out.FirstCause = err
		}
		// An independently refreshed post-sign Current must explicitly confirm.
		a.out.CurrentDataMatched = false
		out = a.snapshotLocked()
		a.mu.Unlock()
	}()
	produced, err = a.sign(key, a.scope, a.input, c.NowMillis, a.binding)
	return out, err
}

// ConfirmCurrent does no signing. It validates the original full member AND
// again under fresh policy contents before recording DATA-current completion.
// Its result does not assert that the supplied current came from a trusted Root.
func (a *Attempt) ConfirmCurrent(c CurrentDATA) (Outcome, error) {
	if a == nil {
		return Outcome{}, ErrRetired
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.running || !a.attempted || !a.out.SignatureVerified || !a.out.BatchCleanupComplete {
		return a.snapshotLocked(), errors.New("resource original signing outcome is incomplete")
	}
	if err := a.currentLocked(c); err != nil {
		return a.snapshotLocked(), err
	}
	_, err := ynxbatch.InspectNetworkResourceConsentMember(a.out.MemberOriginal, a.scope, a.input, c.NowMillis, a.binding)
	if err != nil {
		a.out.FirstCause = err
		return a.snapshotLocked(), err
	}
	a.out.CurrentDataMatched = true
	return a.snapshotLocked(), nil
}

func (a *Attempt) OriginalOutcome() Outcome {
	if a == nil {
		return Outcome{}
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.snapshotLocked()
}
func (a *Attempt) Retire() {
	if a == nil {
		return
	}
	a.mu.Lock()
	a.retired = true
	a.mu.Unlock()
}
func (a *Attempt) Drain() bool {
	if a == nil {
		return true
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return !a.running
}

// Close is nonblocking. A false return retains the whole parent operation until
// the synchronous sign finishes; the caller must observe Drain and call again.
// Public original outcomes survive close, so UNKNOWN can be reconciled.
func (a *Attempt) Close() bool {
	if a == nil {
		return true
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.retired = true
	if a.running {
		return false
	}
	clear(a.input)
	a.input = nil
	a.closed = true
	return true
}
