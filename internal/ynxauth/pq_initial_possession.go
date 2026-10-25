package ynxauth

import (
	"bytes"
	"errors"
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const MaxPQInitialRegistrationBytes = 128 << 10

// DecodePQInitialRegistrationMember checks only the canonical public wire and
// initial-registration fields. It does not authenticate either signature or
// establish an account's authority.
func DecodePQInitialRegistrationMember(wire []byte) (RegistrationIntent, ynxbatch.Member, error) {
	var zero RegistrationIntent
	if len(wire) == 0 || len(wire) > MaxPQInitialRegistrationBytes {
		return zero, ynxbatch.Member{}, errors.New("initial registration member size")
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return zero, ynxbatch.Member{}, err
	}
	intent, err := DecodeRegistrationIntent(member.Message)
	if err != nil {
		return zero, ynxbatch.Member{}, err
	}
	if intent.PriorRevision != 0 || intent.NewRevision != 1 || intent.LedgerNonce != 1 || intent.ActivateAt > math.MaxInt64 ||
		member.Certificate.Owner != intent.Owner || member.Certificate.Purpose != TransactionPurpose ||
		!bytes.Equal(member.Certificate.ChainID, intent.ChainID) || !bytes.Equal(member.Certificate.PKA, intent.PKA) || !bytes.Equal(member.Certificate.PKB, intent.PKB) {
		return zero, ynxbatch.Member{}, errors.New("initial registration fields or complete certificate identity")
	}
	return intent, member, nil
}

// VerifyPQInitialRegistrationPossession verifies an existing registration intent
// carried by a normal TX-BATCH Member. trusted must come from an independently
// authenticated bootstrap binding, never from this Member's submitted keys. This
// function proves possession of that exact pair only: it neither chooses an
// account address nor authorizes occupancy, changes policy, or grants a balance.
// A ledger caller must separately reject an existing owner and commit the first
// registration/nonce atomically under its state lock.
func VerifyPQInitialRegistrationPossession(wire []byte, trusted ynxbatch.Registration, height uint64) (RegistrationIntent, error) {
	var zero RegistrationIntent
	if height == 0 || height >= math.MaxInt64 {
		return zero, errors.New("initial registration execution height")
	}
	intent, member, err := DecodePQInitialRegistrationMember(wire)
	if err != nil {
		return zero, err
	}
	if intent.ActivateAt <= height {
		return zero, errors.New("initial registration activation")
	}
	if trusted.AlgorithmVersion != ynxbatch.Version || trusted.Purpose != TransactionPurpose || !trusted.Enabled || trusted.Owner != intent.Owner ||
		!bytes.Equal(trusted.ChainID, intent.ChainID) || !bytes.Equal(trusted.PKA, intent.PKA) || !bytes.Equal(trusted.PKB, intent.PKB) {
		return zero, errors.New("initial registration requires the independent complete bootstrap pair")
	}
	// Detach the trusted source's mutable slices. The verifier still rechecks
	// this complete binding at the actual execution height on every handle use.
	trusted.ChainID, trusted.PKA, trusted.PKB = bytes.Clone(trusted.ChainID), bytes.Clone(trusted.PKA), bytes.Clone(trusted.PKB)
	if trusted.RevokedAt != nil {
		height := *trusted.RevokedAt
		trusted.RevokedAt = &height
	}
	v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: intent.ChainID, Purpose: TransactionPurpose, ResolveTrustedOwner: func(request ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
		if request.Height != height || request.Owner != intent.Owner || request.Purpose != TransactionPurpose || !bytes.Equal(request.ChainID, intent.ChainID) {
			return ynxbatch.Registration{}, ynxbatch.ErrUntrusted
		}
		return trusted, nil
	}})
	if err != nil {
		return zero, err
	}
	defer v.Clear()
	certificate, err := ynxbatch.EncodeCertificate(member.Certificate)
	if err != nil {
		return zero, err
	}
	handle, err := v.AuthenticateCertificate(certificate, height)
	if err != nil {
		return zero, err
	}
	if err := v.VerifyMember(handle, member.Message, member.Proof, height); err != nil {
		return zero, err
	}
	return intent, nil
}
