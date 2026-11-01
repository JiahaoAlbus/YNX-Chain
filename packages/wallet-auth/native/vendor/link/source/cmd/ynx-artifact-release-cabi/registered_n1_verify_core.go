package main

import (
	"bytes"
	"errors"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

type registeredN1VerifyCode int32

const (
	registeredN1OK registeredN1VerifyCode = iota
	registeredN1Argument
	registeredN1Malformed
	registeredN1TrustDenied
	registeredN1Required
	registeredN1MathInvalid
	registeredN1Internal
)

const (
	registeredN1Version        = 1
	registeredN1MemberMaximum  = 98304
	registeredN1MessageMaximum = 65536
)

// Entirely public borrowed DATA. The C bridge detaches each span, and the core
// takes a second bounded ownership snapshot before installing its local resolver.
// There is no Root admission, key, signature generation, global state or cache.
type registeredN1Inputs struct {
	member, message, network, pkA, pkB         []byte
	owner, purpose                             string
	policyRevision, observedHeight, activeFrom uint64
	revokedAt                                  uint64
	enabled, hasRevokedAt                      uint32
}

func registeredN1ASCII(value string, maximum int) bool {
	if len(value) < 1 || len(value) > maximum {
		return false
	}
	for i := range value {
		if value[i] < 32 || value[i] > 126 {
			return false
		}
	}
	return true
}

func verifyRegisteredANDMemberN1(in registeredN1Inputs) registeredN1VerifyCode {
	if len(in.member) == 0 || len(in.member) > registeredN1MemberMaximum || len(in.message) > registeredN1MessageMaximum ||
		len(in.network) != 32 || len(in.pkA) != ynxbatch.PublicKeyASize || len(in.pkB) != ynxbatch.PublicKeyBSize ||
		!registeredN1ASCII(in.owner, 128) || !registeredN1ASCII(in.purpose, 64) || in.enabled > 1 || in.hasRevokedAt > 1 ||
		in.hasRevokedAt == 0 && in.revokedAt != 0 {
		return registeredN1Argument
	}
	if in.enabled != 1 || in.policyRevision == 0 || in.observedHeight == 0 || in.observedHeight < in.activeFrom ||
		in.hasRevokedAt == 1 && (in.revokedAt < in.activeFrom || in.observedHeight >= in.revokedAt) {
		return registeredN1TrustDenied
	}
	// Freeze expected binding and wire independently of each other. The only
	// resolver below returns these expected bytes, never certificate fields.
	in.member, in.message, in.network = bytes.Clone(in.member), bytes.Clone(in.message), bytes.Clone(in.network)
	in.pkA, in.pkB = bytes.Clone(in.pkA), bytes.Clone(in.pkB)
	member, err := ynxbatch.DecodeMember(in.member)
	if err != nil {
		return registeredN1Malformed
	}
	if member.Certificate.N != 1 || member.Index != 0 || len(member.PathA) != 0 || len(member.PathB) != 0 {
		return registeredN1Required
	}
	if !bytes.Equal(member.Certificate.ChainID, in.network) || member.Certificate.Owner != in.owner ||
		member.Certificate.Purpose != in.purpose || !bytes.Equal(member.Certificate.PKA, in.pkA) || !bytes.Equal(member.Certificate.PKB, in.pkB) {
		return registeredN1TrustDenied
	}
	if !bytes.Equal(member.Message, in.message) {
		return registeredN1MathInvalid
	}
	registration := ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, ChainID: in.network, Owner: in.owner,
		Purpose: in.purpose, PKA: in.pkA, PKB: in.pkB, PolicyRevision: strconv.FormatUint(in.policyRevision, 10),
		Enabled: true, ActiveFrom: in.activeFrom}
	if in.hasRevokedAt == 1 {
		at := in.revokedAt
		registration.RevokedAt = &at
	}
	verifier, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: in.network, Purpose: in.purpose,
		Optimized: true, ResolveTrustedOwner: func(request ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
			if !bytes.Equal(request.ChainID, in.network) || request.Owner != in.owner || request.Purpose != in.purpose || request.Height != in.observedHeight {
				return ynxbatch.Registration{}, ynxbatch.ErrUntrusted
			}
			return registration, nil
		}})
	if err != nil {
		return registeredN1Internal
	}
	// VerifyOne performs BOTH real certificate signatures and BOTH membership
	// roots, refreshing this exact registration before and after mathematics.
	// No authenticated handle or successful certificate escapes this call.
	if err := verifier.VerifyOne(in.member, in.observedHeight); err != nil {
		if errors.Is(err, ynxbatch.ErrUntrusted) {
			return registeredN1TrustDenied
		}
		return registeredN1MathInvalid
	}
	return registeredN1OK
}
