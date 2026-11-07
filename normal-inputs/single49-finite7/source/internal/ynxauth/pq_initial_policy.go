package ynxauth

import (
	"bytes"
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// AdmitPQInitialRegistration consumes a finite independent bootstrap assignment.
// ownerExists is observed by the ledger under the same lock used to commit the
// returned policy and zero-balance nonce1 account. It is not a request field.
// This operation never changes the legacy migration path or creates value.
func (s State) AdmitPQInitialRegistration(wire []byte, trustedRegistration ynxbatch.Registration, height uint64, ownerExists bool) (State, error) {
	if err := s.Validate(s.NetworkID); err != nil {
		return State{}, err
	}
	if !supportedPolicyVersion(s.Version) || height < s.EnableAt || ownerExists || !bytes.Equal(trustedRegistration.ChainID, s.NetworkID) {
		return State{}, errors.New("initial registration requires an enabled policy and unoccupied trusted owner")
	}
	for _, record := range s.Records {
		if record.Owner == trustedRegistration.Owner {
			return State{}, errors.New("initial registration cannot replace any existing or pending policy")
		}
	}
	if _, exists := s.revocationFor(trustedRegistration.Owner); exists {
		return State{}, ErrPolicy
	}
	intent, err := VerifyPQInitialRegistrationPossession(wire, trustedRegistration, height)
	if err != nil {
		return State{}, err
	}
	record := Record{AlgorithmVersion: ynxbatch.Version, Owner: intent.Owner, PKA: bytes.Clone(intent.PKA), PKB: bytes.Clone(intent.PKB), Revision: 1, RegisteredAt: height, ActiveFrom: intent.ActivateAt, LedgerNonce: 1}
	out := s.Clone()
	at := len(out.Records)
	for i, existing := range out.Records {
		if existing.Owner > record.Owner {
			at = i
			break
		}
	}
	out.Records = append(out.Records, Record{})
	copy(out.Records[at+1:], out.Records[at:])
	out.Records[at] = record
	return out, out.Validate(out.NetworkID)
}
