package main

import (
	"bytes"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const productApprovalV4Capacity = 98304

type productApprovalV4Plan struct {
	message  []byte
	expected ynxbatch.ProductSessionApprovalV4Binding
}

func copyApprovalV4Binding(e ynxbatch.ProductSessionApprovalV4Binding) ynxbatch.ProductSessionApprovalV4Binding {
	return ynxbatch.ProductSessionApprovalV4Binding{NetworkID: bytes.Clone(e.NetworkID), Owner: e.Owner,
		PKA: bytes.Clone(e.PKA), PKB: bytes.Clone(e.PKB), KeyRevision: e.KeyRevision}
}
func prepareProductApprovalV4(message []byte, e ynxbatch.ProductSessionApprovalV4Binding, capacity uint64) (productApprovalV4Plan, resultCode) {
	if capacity != productApprovalV4Capacity {
		return productApprovalV4Plan{}, resultCapacity
	}
	if len(message) == 0 || len(message) > ynxbatch.MaxProductSessionApprovalV4MessageBytes {
		return productApprovalV4Plan{}, resultBounds
	}
	p := productApprovalV4Plan{expected: copyApprovalV4Binding(e)}
	var err error
	p.message, err = ynxbatch.ValidateProductSessionApprovalV4Message(message, p.expected)
	if err != nil {
		return productApprovalV4Plan{}, resultPublicBinding
	}
	return p, resultOK
}
func verifyProductApprovalV4AND(member []byte, p productApprovalV4Plan) error {
	if _, err := ynxbatch.InspectProductSessionApprovalV4Member(member, p.message, p.expected); err != nil {
		return err
	}
	e := copyApprovalV4Binding(p.expected)
	purpose := ynxbatch.ProductSessionApprovalV4Purpose
	v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: e.NetworkID, Purpose: purpose, CacheEntries: 0, Optimized: true,
		ResolveTrustedOwner: func(r ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
			if !bytes.Equal(r.ChainID, e.NetworkID) || r.Owner != e.Owner || r.Purpose != purpose || r.Height != 0 {
				return ynxbatch.Registration{}, ynxbatch.ErrUntrusted
			}
			return ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, ChainID: e.NetworkID, Owner: e.Owner, PKA: e.PKA, PKB: e.PKB,
				Purpose: purpose, PolicyRevision: e.KeyRevision, Enabled: true}, nil
		}})
	if err != nil {
		return err
	}
	defer v.Clear()
	return v.VerifyOne(member, 0)
}

// Private test seam only. No callback, provider or signer is exported.
type productApprovalV4Checks struct {
	postcondition func([]byte, productApprovalV4Plan) error
	cleanup       func(...func()) bool
}

func signProductApprovalV4(p productApprovalV4Plan, borrowed ynxbatch.KeyMaterial) ([]byte, resultCode, cleanupCode) {
	return signProductApprovalV4WithChecks(p, borrowed, nil)
}
func signProductApprovalV4WithChecks(p productApprovalV4Plan, borrowed ynxbatch.KeyMaterial, checks *productApprovalV4Checks) (output []byte, code resultCode, cleanup cleanupCode) {
	rebuilt, err := ynxbatch.ValidateProductSessionApprovalV4Message(p.message, p.expected)
	if err != nil || !bytes.Equal(rebuilt, p.message) {
		return nil, resultPublicBinding, cleanupNotRequired
	}
	if len(borrowed.PKCS8A) != ynxbatch.PKCS8ASize || len(borrowed.PKCS8B) != ynxbatch.PKCS8BSize ||
		!bytes.Equal(borrowed.PKA, p.expected.PKA) || !bytes.Equal(borrowed.PKB, p.expected.PKB) {
		return nil, resultKeyMaterial, cleanupNotRequired
	}
	var owned ynxbatch.KeyMaterial
	var key *ynxbatch.PrivateKey
	var batch *ynxbatch.Batch
	var candidate []byte
	logicalCleanup, postcondition := runLogicalCleanup, verifyProductApprovalV4AND
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
		output, code, cleanup = finishDeviceHTTP(candidate, code, panicked, clean)
	}()
	owned.PKCS8A = bytes.Clone(borrowed.PKCS8A)
	owned.PKCS8B = bytes.Clone(borrowed.PKCS8B)
	owned.PKA = bytes.Clone(borrowed.PKA)
	owned.PKB = bytes.Clone(borrowed.PKB)
	var public ynxbatch.PublicKey
	key, public, err = ynxbatch.ImportKeyMaterial(owned)
	if err != nil || !bytes.Equal(public.PKA, p.expected.PKA) || !bytes.Equal(public.PKB, p.expected.PKB) {
		return nil, resultKeyMaterial, cleanupUnknown
	}
	batch, err = ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: p.expected.NetworkID, Owner: p.expected.Owner, Purpose: ynxbatch.ProductSessionApprovalV4Purpose}, [][]byte{p.message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return nil, resultSigning, cleanupUnknown
	}
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	candidate, err = ynxbatch.EncodeMember(member)
	if err != nil || len(candidate) == 0 || len(candidate) > productApprovalV4Capacity {
		return nil, resultOutputValidation, cleanupUnknown
	}
	if err = postcondition(candidate, p); err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	return candidate, resultOK, cleanupUnknown
}
