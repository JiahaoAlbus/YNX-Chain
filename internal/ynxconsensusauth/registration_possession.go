package ynxconsensusauth

import (
	"bytes"
	"crypto/rand"
	"errors"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/cloudflare/circl/sign/slhdsa"
)

// RegistrationPossession signs only the frozen, complete new-key possession
// domain. It grants no old-key approval, consensus authority or raw signing API.
// The caller still needs the separately authorized registration committed.
func (k *CandidateKey) RegistrationPossession(intent RegistrationIntent) (a, b []byte, err error) {
	if k == nil || k.state == nil {
		return nil, nil, errors.New("missing consensus registration key")
	}
	if intent.Kind != RegisterValidator && intent.Kind != RotateValidator {
		return nil, nil, errors.New("only registration and rotation have new-key possession proofs")
	}
	message, err := intent.PossessionSigningBytes()
	if err != nil {
		return nil, nil, err
	}
	s := k.state
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.a == nil || s.b == nil || !bytes.Equal(intent.MLDSA87PublicKey, s.pa) || !bytes.Equal(intent.SLHDSASHA2256fPublicKey, s.pb) {
		return nil, nil, errors.New("registration possession keys differ from candidate key")
	}
	complete := false
	defer func() {
		if !complete {
			clear(a)
			clear(b)
			a, b = nil, nil
		}
	}()
	a = make([]byte, MLDSA87SignatureSize)
	if err = mldsa87.SignTo(s.a, message, nil, true, a); err != nil {
		return a, b, err
	}
	b, err = slhdsa.SignRandomized(s.b, rand.Reader, slhdsa.NewMessage(message), nil)
	if err != nil {
		return a, b, err
	}
	if err = verifyRegistrationPair(CIRCLProvider{}, s.pa, s.pb, message, a, b); err != nil {
		return a, b, err
	}
	complete = true
	return a, b, nil
}
