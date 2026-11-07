package ynxresourceconsent

import (
	"bytes"
	"errors"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

var ErrMaterial = errors.New("resource fixed borrowed key material mismatch")
var ErrCleanup = errors.New("resource borrowed key logical cleanup incomplete")
var ErrInternal = errors.New("resource fixed attempt interrupted; reconcile original outcome")

// MaterialOutcome includes only public originals and logical completion. It is
// not a Root, Source, device, approval, durable-once or execution assertion.
type MaterialOutcome struct {
	Outcome
	KeyCleanupComplete       bool
	Running, Retired, Closed bool
}

// MaterialAttempt is a copy-safe reference to one fixed-purpose operation. It
// never retains a private key. The real Native owner must retain its SAME
// protected Source/key lease and durable once across sign/current/drain/close.
type MaterialAttempt struct{ state *materialState }
type materialState struct {
	mu                                 sync.Mutex
	attempt                            *Attempt
	pka, pkb                           []byte
	selected, running, retired, closed bool
	out                                MaterialOutcome
}

func PrepareMaterial(scope, input []byte, b ynxbatch.NetworkResourceConsentBinding, c CurrentDATA) (*MaterialAttempt, error) {
	a, err := Prepare(scope, input, b, c)
	if err != nil {
		return nil, err
	}
	return &MaterialAttempt{&materialState{attempt: a, pka: bytes.Clone(b.PKA), pkb: bytes.Clone(b.PKB)}}, nil
}
func (s *materialState) snapshot() MaterialOutcome {
	out := s.out
	out.MemberOriginal = bytes.Clone(out.MemberOriginal)
	out.AttemptSelected = s.selected
	out.Running = s.running
	out.Retired = s.retired
	out.Closed = s.closed
	return out
}
func (s *materialState) fail(err error) error {
	if err != nil {
		if s.out.FirstCause == nil {
			s.out.FirstCause = err
		}
		s.out.CurrentDataMatched = false
	}
	return err
}
func (a *MaterialAttempt) Current(c CurrentDATA) error {
	if a == nil || a.state == nil {
		return ErrRetired
	}
	s := a.state
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.retired || s.closed {
		return ErrRetired
	}
	if s.out.FirstCause != nil {
		return s.out.FirstCause
	}
	return s.fail(s.attempt.Current(c))
}

// SignOnce borrows the four input slices exclusively for this call. Shape,
// full public pair and independent current are checked before private copying.
// Selection is terminal BEFORE that first copy, including import/UNKNOWN errors.
// All explicit owned copies are cleared and the imported handle is Destroyed;
// physical Go/provider erasure is NOT guaranteed. Caller clears its own loan.
func (a *MaterialAttempt) SignOnce(material ynxbatch.KeyMaterial, c CurrentDATA) (out MaterialOutcome, err error) {
	if a == nil || a.state == nil {
		return out, ErrRetired
	}
	s := a.state
	s.mu.Lock()
	if s.selected {
		out = s.snapshot()
		s.mu.Unlock()
		return out, ErrAttempted
	}
	if s.retired || s.closed {
		out = s.snapshot()
		s.mu.Unlock()
		return out, ErrRetired
	}
	if s.out.FirstCause != nil {
		out = s.snapshot()
		err = s.out.FirstCause
		s.mu.Unlock()
		return
	}
	if err = s.attempt.Current(c); err == nil && (len(material.PKCS8A) != ynxbatch.PKCS8ASize || len(material.PKCS8B) != ynxbatch.PKCS8BSize || !bytes.Equal(material.PKA, s.pka) || !bytes.Equal(material.PKB, s.pkb)) {
		err = ErrMaterial
	}
	if err != nil {
		s.fail(err)
		out = s.snapshot()
		s.mu.Unlock()
		return
	}
	s.selected, s.running = true, true
	s.mu.Unlock()
	var owned ynxbatch.KeyMaterial
	var key *ynxbatch.PrivateKey
	var produced Outcome
	defer func() {
		if recover() != nil {
			err = ErrInternal
		}
		cleaned := true
		for _, cleanup := range []func(){key.Destroy, owned.Clear} {
			func() {
				defer func() {
					if recover() != nil {
						cleaned = false
						err = ErrCleanup
					}
				}()
				cleanup()
			}()
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		// Preserve nonnull partial FIRST, including any later retirement or failure.
		s.out.Outcome = produced
		s.out.KeyCleanupComplete = cleaned
		s.out.CurrentDataMatched = false
		s.running = false
		if !cleaned {
			err = ErrCleanup
		}
		if s.retired || s.closed {
			if err == nil {
				err = ErrRetired
			}
		}
		// An earlier concurrent Current failure is held by the underlying attempt.
		original := s.attempt.OriginalOutcome()
		if original.FirstCause != nil {
			err = original.FirstCause
		}
		s.fail(err)
		out = s.snapshot()
	}()
	owned.PKCS8A = bytes.Clone(material.PKCS8A)
	owned.PKCS8B = bytes.Clone(material.PKCS8B)
	owned.PKA = bytes.Clone(material.PKA)
	owned.PKB = bytes.Clone(material.PKB)
	key, _, err = ynxbatch.ImportKeyMaterial(owned)
	if err != nil {
		err = ErrMaterial
		return
	}
	produced, err = s.attempt.SignOnce(key, c)
	return
}
func (a *MaterialAttempt) ConfirmCurrent(c CurrentDATA) (MaterialOutcome, error) {
	if a == nil || a.state == nil {
		return MaterialOutcome{}, ErrRetired
	}
	s := a.state
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.retired || s.closed {
		return s.snapshot(), ErrRetired
	}
	if s.running {
		return s.snapshot(), ErrAttempted
	}
	if s.out.FirstCause != nil {
		return s.snapshot(), s.out.FirstCause
	}
	if !s.selected || !s.out.KeyCleanupComplete {
		return s.snapshot(), ErrCleanup
	}
	out, err := s.attempt.ConfirmCurrent(c)
	s.out.Outcome = out
	s.fail(err)
	return s.snapshot(), err
}
func (a *MaterialAttempt) OriginalOutcome() MaterialOutcome {
	if a == nil || a.state == nil {
		return MaterialOutcome{}
	}
	s := a.state
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshot()
}
func (a *MaterialAttempt) Retire() {
	if a == nil || a.state == nil {
		return
	}
	s := a.state
	s.mu.Lock()
	defer s.mu.Unlock()
	s.retired = true
	s.out.CurrentDataMatched = false
	s.attempt.Retire()
}
func (a *MaterialAttempt) Drain() bool {
	if a == nil || a.state == nil {
		return true
	}
	s := a.state
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.running && s.attempt.Drain()
}
func (a *MaterialAttempt) Close() bool {
	if a == nil || a.state == nil {
		return true
	}
	s := a.state
	s.mu.Lock()
	defer s.mu.Unlock()
	s.retired = true
	s.out.CurrentDataMatched = false
	s.attempt.Retire()
	if s.running || !s.attempt.Close() {
		return false
	}
	s.closed = true
	return true
}
