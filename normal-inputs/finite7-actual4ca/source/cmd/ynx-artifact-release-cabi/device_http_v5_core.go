package main

import (
	"bytes"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	deviceHTTPV5Version        = 5
	deviceHTTPV5MemberCapacity = ynxbatch.MaxProductSessionHTTPV5MemberBytes
	deviceHTTPV5MessageMaximum = ynxbatch.MaxProductSessionHTTPV5MessageBytes
	deviceHTTPV5MemberMaximum  = 20 + len(ynxbatch.Version+"/MEMBER") + ynxbatch.MaxCertificateBytes + deviceHTTPV5MessageMaximum + 28
)

type deviceHTTPV5Inputs struct {
	unsigned, actualBody []byte
	actualContentType    string
	expected             ynxbatch.ProductSessionHTTPBinding
}

// Only detached public E6 and independent full identity survive preflight.
// The 65MiB body is not retained while handling private material or signing.
type deviceHTTPV5Plan struct {
	message  []byte
	expected ynxbatch.ProductSessionHTTPBinding
}

func prepareDeviceHTTPV5(in deviceHTTPV5Inputs, capacity uint64) (deviceHTTPV5Plan, resultCode) {
	if capacity != deviceHTTPV5MemberCapacity {
		return deviceHTTPV5Plan{}, resultCapacity
	}
	if len(in.unsigned) == 0 || len(in.unsigned) > deviceHTTPV5MessageMaximum || len(in.actualBody) == 0 || len(in.actualBody) > ynxbatch.MaxProductSessionHTTPV5BodyBytes || len(in.actualContentType) == 0 || len(in.actualContentType) > ynxbatch.MaxProductSessionHTTPV5ContentTypeBytes {
		return deviceHTTPV5Plan{}, resultBounds
	}
	message, err := ynxbatch.BuildProductSessionHTTPV5Message(in.unsigned, in.actualBody, in.actualContentType, in.expected)
	if err != nil || deviceHTTPV5MemberMaximum > deviceHTTPV5MemberCapacity {
		return deviceHTTPV5Plan{}, resultPublicBinding
	}
	inspected, err := ynxbatch.InspectProductSessionHTTPV5Message(message, in.expected)
	if err != nil {
		return deviceHTTPV5Plan{}, resultPublicBinding
	}
	return deviceHTTPV5Plan{message: inspected.MessageOriginal, expected: inspected.Binding}, resultOK
}

type deviceHTTPV5Checks struct {
	postcondition func([]byte, ynxbatch.ProductSessionHTTPBinding, []byte) error
	cleanup       func(...func()) bool
}

func signDeviceHTTPV5Prepared(plan deviceHTTPV5Plan, borrowed ynxbatch.KeyMaterial) ([]byte, resultCode, cleanupCode) {
	return signDeviceHTTPV5PreparedWithChecks(plan, borrowed, nil)
}

// Private test seam only. The exported C entry cannot choose callbacks,
// purpose, provider, parameters or entropy. Logical cleanup is not secure-heap
// or OS key custody attestation, and errors retain actual produced originals.
func signDeviceHTTPV5PreparedWithChecks(plan deviceHTTPV5Plan, borrowed ynxbatch.KeyMaterial, checks *deviceHTTPV5Checks) (output []byte, code resultCode, cleanup cleanupCode) {
	if len(borrowed.PKCS8A) != ynxbatch.PKCS8ASize || len(borrowed.PKCS8B) != ynxbatch.PKCS8BSize || len(borrowed.PKA) != ynxbatch.PublicKeyASize || len(borrowed.PKB) != ynxbatch.PublicKeyBSize {
		return nil, resultKeyMaterial, cleanupNotRequired
	}
	var owned ynxbatch.KeyMaterial
	var key *ynxbatch.PrivateKey
	var batch *ynxbatch.Batch
	var candidate []byte
	logicalCleanup := runLogicalCleanup
	postcondition := func(raw []byte, b ynxbatch.ProductSessionHTTPBinding, original []byte) error {
		_, err := ynxbatch.InspectProductSessionHTTPV5Member(raw, b, original)
		return err
	}
	if checks != nil {
		if checks.postcondition != nil {
			postcondition = checks.postcondition
		}
		if checks.cleanup != nil {
			logicalCleanup = checks.cleanup
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
	if !bytes.Equal(owned.PKA, plan.expected.PKA) || !bytes.Equal(owned.PKB, plan.expected.PKB) {
		return nil, resultKeyMaterial, cleanupUnknown
	}
	var public ynxbatch.PublicKey
	var err error
	key, public, err = ynxbatch.ImportKeyMaterial(owned)
	if err != nil || !bytes.Equal(public.PKA, plan.expected.PKA) || !bytes.Equal(public.PKB, plan.expected.PKB) {
		return nil, resultKeyMaterial, cleanupUnknown
	}
	// Recheck the entire typed plan, even for an internal Go caller. No generic
	// raw message/purpose can be smuggled into this fixed signing function.
	if _, err = ynxbatch.InspectProductSessionHTTPV5Message(plan.message, plan.expected); err != nil {
		return nil, resultPublicBinding, cleanupUnknown
	}
	batch, err = ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: plan.expected.NetworkID, Owner: plan.expected.Owner, Purpose: ynxbatch.ProductSessionHTTPPurpose}, [][]byte{plan.message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return nil, resultSigning, cleanupUnknown
	}
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	candidate, err = ynxbatch.EncodeMember(member)
	if err != nil || len(candidate) == 0 || len(candidate) > deviceHTTPV5MemberMaximum || len(candidate) > deviceHTTPV5MemberCapacity {
		return nil, resultOutputValidation, cleanupUnknown
	}
	if err := postcondition(candidate, plan.expected, plan.message); err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	return candidate, resultOK, cleanupUnknown
}
