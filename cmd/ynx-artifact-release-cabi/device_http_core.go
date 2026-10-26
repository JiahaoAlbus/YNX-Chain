package main

import (
	"bytes"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	deviceHTTPVersion        = 4
	deviceHTTPMemberCapacity = ynxbatch.MaxProductSessionHTTPMemberBytes
	deviceHTTPMessageMaximum = ynxbatch.MaxProductSessionHTTPMessageBytes
	// E(member tag, fixed certificate, E5 message, empty N1 proof).
	deviceHTTPMemberMaximum = 20 + len(ynxbatch.Version+"/MEMBER") + ynxbatch.MaxCertificateBytes + deviceHTTPMessageMaximum + 28
)

type deviceHTTPInputs struct {
	unsigned []byte
	expected ynxbatch.ProductSessionHTTPBinding
}

// Detached public DATA only. Auth owns Source/current/full registration,
// private slot selection, original clock/window, scope/revoke and durable once.
type deviceHTTPPlan struct {
	unsigned, message []byte
	expected          ynxbatch.ProductSessionHTTPBinding
}

func prepareDeviceHTTP(in deviceHTTPInputs, capacity uint64) (deviceHTTPPlan, resultCode) {
	if capacity != deviceHTTPMemberCapacity {
		return deviceHTTPPlan{}, resultCapacity
	}
	if len(in.unsigned) == 0 || len(in.unsigned) > deviceHTTPMessageMaximum {
		return deviceHTTPPlan{}, resultBounds
	}
	message, err := ynxbatch.BuildProductSessionHTTPMessage(in.unsigned, in.expected)
	if err != nil || len(message) > deviceHTTPMessageMaximum || deviceHTTPMemberMaximum > deviceHTTPMemberCapacity {
		return deviceHTTPPlan{}, resultPublicBinding
	}
	if _, err := ynxbatch.InspectProductSessionHTTPMessage(message, in.expected, in.unsigned); err != nil {
		return deviceHTTPPlan{}, resultPublicBinding
	}
	e := in.expected
	e.NetworkID, e.PKA, e.PKB = bytes.Clone(e.NetworkID), bytes.Clone(e.PKA), bytes.Clone(e.PKB)
	return deviceHTTPPlan{unsigned: bytes.Clone(in.unsigned), message: message, expected: e}, resultOK
}

func finishDeviceHTTP(candidate []byte, code resultCode, panicked, clean bool) ([]byte, resultCode, cleanupCode) {
	cleanup := cleanupLogicalComplete
	if panicked {
		if code == resultOK {
			code = resultInternal
		}
		cleanup = cleanupUnknown
	}
	if !clean {
		if code == resultOK {
			code = resultCleanup
		}
		cleanup = cleanupFailed
	}
	// An actual produced public original survives postcondition/cleanup
	// failure. Failure must never make a nonce eligible for another signing.
	// An over-capacity value cannot be exported through the fixed allocation.
	if len(candidate) > deviceHTTPMemberCapacity {
		clear(candidate)
		candidate = nil
		if code == resultOK {
			code = resultOutputValidation
		}
	}
	return candidate, code, cleanup
}

// The C bridge uses this same bounded public copy before interpreting rc or
// cleanup. Failure originals remain observable without becoming valid proofs.
func retainDeviceHTTPOutcome(buffer, member []byte, code resultCode, cleanup cleanupCode) (int, resultCode) {
	if len(buffer) != deviceHTTPMemberCapacity {
		return 0, resultCapacity
	}
	if len(member) > len(buffer) {
		if code != resultOK {
			return 0, code
		}
		return 0, resultOutputValidation
	}
	written := copy(buffer, member)
	if code != resultOK {
		return written, code
	}
	if cleanup != cleanupLogicalComplete || written == 0 {
		return written, resultOutputValidation
	}
	return written, resultOK
}

func signDeviceHTTPPrepared(plan deviceHTTPPlan, borrowed ynxbatch.KeyMaterial) (output []byte, code resultCode, cleanup cleanupCode) {
	return signDeviceHTTPPreparedWithChecks(plan, borrowed, nil)
}

// Private fixture seam only: the C export always selects the fixed inspector
// and all three real logical cleanups. No callback/provider is an ABI input.
type deviceHTTPChecks struct {
	postcondition func([]byte, ynxbatch.ProductSessionHTTPBinding, []byte) error
	cleanup       func(...func()) bool
}

func signDeviceHTTPPreparedWithChecks(plan deviceHTTPPlan, borrowed ynxbatch.KeyMaterial, checks *deviceHTTPChecks) (output []byte, code resultCode, cleanup cleanupCode) {
	if len(borrowed.PKCS8A) != ynxbatch.PKCS8ASize || len(borrowed.PKCS8B) != ynxbatch.PKCS8BSize ||
		len(borrowed.PKA) != ynxbatch.PublicKeyASize || len(borrowed.PKB) != ynxbatch.PublicKeyBSize {
		return nil, resultKeyMaterial, cleanupNotRequired
	}
	var owned ynxbatch.KeyMaterial
	var key *ynxbatch.PrivateKey
	var batch *ynxbatch.Batch
	var candidate []byte
	logicalCleanup := runLogicalCleanup
	postcondition := func(raw []byte, expected ynxbatch.ProductSessionHTTPBinding, unsigned []byte) error {
		_, err := ynxbatch.InspectProductSessionHTTPMember(raw, expected, unsigned)
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
	// Record every independent allocation immediately so cleanup owns partial
	// import/copy progress. Neither supplied public nor private spans are changed.
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
	batch, err = ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: plan.expected.NetworkID,
		Owner: plan.expected.Owner, Purpose: ynxbatch.ProductSessionHTTPPurpose}, [][]byte{plan.message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return nil, resultSigning, cleanupUnknown
	}
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	candidate, err = ynxbatch.EncodeMember(member)
	if err != nil || len(candidate) == 0 || len(candidate) > deviceHTTPMemberMaximum || len(candidate) > deviceHTTPMemberCapacity {
		return nil, resultOutputValidation, cleanupUnknown
	}
	// This fixed DATA inspector also verifies BOTH actual signatures under the
	// exact supplied full pair. It cannot authenticate that pair's device Source.
	if err := postcondition(candidate, plan.expected, plan.unsigned); err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	return candidate, resultOK, cleanupUnknown
}
