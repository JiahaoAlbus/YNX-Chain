package main

import (
	"bytes"
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	productDeviceVersion             = 4
	productDeviceOriginalMaximum     = 16384
	productDeviceMessageMaximum      = 16384
	productDeviceMemberCapacity      = 98304
	productDeviceMemberMaximum       = 20 + len(ynxbatch.Version+"/MEMBER") + ynxbatch.MaxCertificateBytes + productDeviceMessageMaximum + 28
	productDeviceRegistrationPurpose = "PRODUCT-SESSION-DEVICE-REGISTRATION"
	productDeviceChallengePurpose    = "PRODUCT-SESSION-DEVICE-CHALLENGE"
)

type productDeviceKind uint8

const (
	productDeviceRegistration productDeviceKind = iota + 1
	productDeviceChallenge
)

// Owned public DATA only. This is not a custody slot, approval, authenticated
// registration, current lease, clock or durable once token. No plan is exported.
type productDevicePlan struct {
	kind                             productDeviceKind
	registration, challenge, message []byte
	expected                         ynxbatch.ProductSessionDeviceV4Binding
}

func copyProductDeviceBinding(in ynxbatch.ProductSessionDeviceV4Binding) ynxbatch.ProductSessionDeviceV4Binding {
	return ynxbatch.ProductSessionDeviceV4Binding{NetworkID: bytes.Clone(in.NetworkID), Owner: in.Owner,
		PKA: bytes.Clone(in.PKA), PKB: bytes.Clone(in.PKB)}
}

func prepareProductDeviceRegistration(registration []byte, expected ynxbatch.ProductSessionDeviceV4Binding, capacity uint64) (productDevicePlan, resultCode) {
	if capacity != productDeviceMemberCapacity {
		return productDevicePlan{}, resultCapacity
	}
	if len(registration) == 0 || len(registration) > productDeviceOriginalMaximum {
		return productDevicePlan{}, resultBounds
	}
	p := productDevicePlan{kind: productDeviceRegistration, registration: bytes.Clone(registration), expected: copyProductDeviceBinding(expected)}
	_, message, err := productDeviceMessage(p)
	if err != nil {
		return productDevicePlan{}, resultPublicBinding
	}
	p.message = message
	return p, resultOK
}

// The discriminator is private implementation state, not an ABI purpose input.
// Every exported entry uses one corresponding typed builder, never raw E5.
func productDeviceMessage(p productDevicePlan) (string, []byte, error) {
	var purpose string
	var message []byte
	var err error
	switch p.kind {
	case productDeviceRegistration:
		if len(p.challenge) != 0 {
			return "", nil, errors.New("registration cannot carry a challenge")
		}
		purpose = productDeviceRegistrationPurpose
		message, err = ynxbatch.BuildProductSessionDeviceRegistrationV4Message(p.registration, p.expected)
	case productDeviceChallenge:
		purpose = productDeviceChallengePurpose
		message, err = ynxbatch.BuildProductSessionDeviceChallengeV4Message(p.challenge, p.registration, p.expected)
	default:
		return "", nil, errors.New("unsupported fixed product device operation")
	}
	if err != nil {
		return "", nil, err
	}
	if len(message) == 0 || len(message) > productDeviceMessageMaximum || productDeviceMemberMaximum > productDeviceMemberCapacity {
		return "", nil, errors.New("fixed product device message exceeds bound")
	}
	return purpose, message, nil
}

func inspectProductDeviceTypedMember(raw []byte, p productDevicePlan) error {
	switch p.kind {
	case productDeviceRegistration:
		_, err := ynxbatch.InspectProductSessionDeviceRegistrationV4Member(raw, p.registration, p.expected)
		return err
	case productDeviceChallenge:
		_, err := ynxbatch.InspectProductSessionDeviceChallengeV4Member(raw, p.challenge, p.registration, p.expected)
		return err
	default:
		return errors.New("unsupported fixed product device operation")
	}
}

// The typed inspector is structural only. This separate real verifier performs
// BOTH certificate signatures and BOTH membership roots under the independently
// supplied complete device pair, not trust obtained from a Member's certificate.
// It is mathematics only: Auth still owns registration/current/real clock/once.
func verifyProductDeviceActualAND(raw []byte, p productDevicePlan) error {
	if err := inspectProductDeviceTypedMember(raw, p); err != nil {
		return err
	}
	purpose, message, err := productDeviceMessage(p)
	if err != nil || !bytes.Equal(message, p.message) {
		return errors.New("fixed product device prepared message changed")
	}
	e := copyProductDeviceBinding(p.expected)
	v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: e.NetworkID, Purpose: purpose, CacheEntries: 0, Optimized: true,
		ResolveTrustedOwner: func(r ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
			if !bytes.Equal(r.ChainID, e.NetworkID) || r.Owner != e.Owner || r.Purpose != purpose || r.Height != 0 {
				return ynxbatch.Registration{}, ynxbatch.ErrUntrusted
			}
			return ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, ChainID: e.NetworkID, Owner: e.Owner,
				PKA: e.PKA, PKB: e.PKB, Purpose: purpose, PolicyRevision: "product-device-v4-math-only", Enabled: true}, nil
		}})
	if err != nil {
		return err
	}
	defer v.Clear()
	return v.VerifyOne(raw, 0)
}

type productDeviceChecks struct {
	postcondition func([]byte, productDevicePlan) error
	cleanup       func(...func()) bool
}

func signProductDevicePrepared(p productDevicePlan, borrowed ynxbatch.KeyMaterial) ([]byte, resultCode, cleanupCode) {
	return signProductDevicePreparedWithChecks(p, borrowed, nil)
}

// Test seams are private Go fixture inputs only. No callback/provider/clock or
// purpose selector is exposed through either C entry. EACH invocation calls the
// existing BatchSign at most once. It cannot enforce cross-call/restart once.
func signProductDevicePreparedWithChecks(p productDevicePlan, borrowed ynxbatch.KeyMaterial, checks *productDeviceChecks) (output []byte, code resultCode, cleanup cleanupCode) {
	purpose, message, err := productDeviceMessage(p)
	if err != nil || !bytes.Equal(message, p.message) {
		return nil, resultPublicBinding, cleanupNotRequired
	}
	if len(borrowed.PKCS8A) != ynxbatch.PKCS8ASize || len(borrowed.PKCS8B) != ynxbatch.PKCS8BSize ||
		len(borrowed.PKA) != ynxbatch.PublicKeyASize || len(borrowed.PKB) != ynxbatch.PublicKeyBSize {
		return nil, resultKeyMaterial, cleanupNotRequired
	}
	var owned ynxbatch.KeyMaterial
	var key *ynxbatch.PrivateKey
	var batch *ynxbatch.Batch
	var candidate []byte
	logicalCleanup := runLogicalCleanup
	postcondition := verifyProductDeviceActualAND
	if checks != nil {
		if checks.cleanup != nil {
			logicalCleanup = checks.cleanup
		}
		if checks.postcondition != nil {
			postcondition = checks.postcondition
		}
	}
	code, cleanup = resultInternal, cleanupUnknown
	defer func() {
		panicked := recover() != nil
		clean := logicalCleanup(func() { batch.Discard() }, func() { key.Destroy() }, func() { owned.Clear() })
		// Reuse the existing fixed-callee original retention and first-cause
		// cleanup semantics. Public output survives late failure/UNKNOWN.
		output, code, cleanup = finishDeviceHTTP(candidate, code, panicked, clean)
	}()
	owned.PKCS8A = bytes.Clone(borrowed.PKCS8A)
	owned.PKCS8B = bytes.Clone(borrowed.PKCS8B)
	owned.PKA = bytes.Clone(borrowed.PKA)
	owned.PKB = bytes.Clone(borrowed.PKB)
	if !bytes.Equal(owned.PKA, p.expected.PKA) || !bytes.Equal(owned.PKB, p.expected.PKB) {
		return nil, resultKeyMaterial, cleanupUnknown
	}
	var public ynxbatch.PublicKey
	key, public, err = ynxbatch.ImportKeyMaterial(owned)
	if err != nil || !bytes.Equal(public.PKA, p.expected.PKA) || !bytes.Equal(public.PKB, p.expected.PKB) {
		return nil, resultKeyMaterial, cleanupUnknown
	}
	batch, err = ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: p.expected.NetworkID, Owner: p.expected.Owner, Purpose: purpose},
		[][]byte{p.message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return nil, resultSigning, cleanupUnknown
	}
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	candidate, err = ynxbatch.EncodeMember(member)
	if err != nil || len(candidate) == 0 || len(candidate) > productDeviceMemberMaximum || len(candidate) > productDeviceMemberCapacity {
		return nil, resultOutputValidation, cleanupUnknown
	}
	if err := postcondition(candidate, p); err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	return candidate, resultOK, cleanupUnknown
}
