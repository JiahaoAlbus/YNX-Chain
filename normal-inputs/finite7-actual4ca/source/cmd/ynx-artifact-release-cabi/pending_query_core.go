package main

import (
	"bytes"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const pendingQueryCapacity = ynxbatch.MaxProductPairPendingOriginalQueryMemberBytes

type pendingQueryInputs struct {
	query, registration, originalPair []byte
	expected                          ynxbatch.ProductPairPendingOriginalQueryBinding
}
type pendingQueryPlan struct {
	inputs  pendingQueryInputs
	message []byte
}

func preparePendingQuery(in pendingQueryInputs, capacity uint64) (pendingQueryPlan, resultCode) {
	if capacity != pendingQueryCapacity {
		return pendingQueryPlan{}, resultCapacity
	}
	if len(in.query) == 0 || len(in.query) > 1024 || len(in.registration) == 0 || len(in.registration) > ynxbatch.MaxProductSessionDeviceV4MessageBytes || len(in.originalPair) == 0 || len(in.originalPair) > ynxbatch.MaxProductPairPendingOriginalBodyBytes {
		return pendingQueryPlan{}, resultBounds
	}
	message, err := ynxbatch.BuildProductPairPendingOriginalQueryMessage(in.query, in.registration, in.originalPair, in.expected)
	if err != nil {
		return pendingQueryPlan{}, resultPublicBinding
	}
	in.query, in.registration, in.originalPair = bytes.Clone(in.query), bytes.Clone(in.registration), bytes.Clone(in.originalPair)
	in.expected.NetworkID, in.expected.PKA, in.expected.PKB = bytes.Clone(in.expected.NetworkID), bytes.Clone(in.expected.PKA), bytes.Clone(in.expected.PKB)
	return pendingQueryPlan{in, message}, resultOK
}

func inspectPendingQuery(plan pendingQueryPlan, wire []byte) error {
	i := plan.inputs
	_, err := ynxbatch.InspectProductPairPendingOriginalQueryMember(wire, i.query, i.registration, i.originalPair, i.expected)
	return err
}

// Internal failure controls only. The public ABI always uses the fixed AND
// inspector and the actual Clear/Destroy/Discard operations, never callbacks.
type pendingQueryChecks struct {
	inspect func(pendingQueryPlan, []byte) error
	cleanup func(...func()) bool
}

func signPendingQueryPrepared(plan pendingQueryPlan, borrowed ynxbatch.KeyMaterial) ([]byte, resultCode, cleanupCode) {
	return signPendingQueryPreparedWithChecks(plan, borrowed, nil)
}

func signPendingQueryPreparedWithChecks(plan pendingQueryPlan, borrowed ynxbatch.KeyMaterial, checks *pendingQueryChecks) (output []byte, code resultCode, cleanup cleanupCode) {
	if len(borrowed.PKCS8A) != ynxbatch.PKCS8ASize || len(borrowed.PKCS8B) != ynxbatch.PKCS8BSize || len(borrowed.PKA) != ynxbatch.PublicKeyASize || len(borrowed.PKB) != ynxbatch.PublicKeyBSize ||
		!bytes.Equal(borrowed.PKA, plan.inputs.expected.PKA) || !bytes.Equal(borrowed.PKB, plan.inputs.expected.PKB) {
		return nil, resultKeyMaterial, cleanupNotRequired
	}
	var owned ynxbatch.KeyMaterial
	var key *ynxbatch.PrivateKey
	var batch *ynxbatch.Batch
	var candidate []byte
	inspect, clean := inspectPendingQuery, runLogicalCleanup
	if checks != nil {
		if checks.inspect != nil {
			inspect = checks.inspect
		}
		if checks.cleanup != nil {
			clean = checks.cleanup
		}
	}
	code, cleanup = resultInternal, cleanupUnknown
	defer func() {
		panicked := recover() != nil
		logical := clean(func() { batch.Discard() }, func() { key.Destroy() }, func() { owned.Clear() })
		output, code, cleanup = finishDeviceHTTP(candidate, code, panicked, logical)
	}()
	owned.PKCS8A = bytes.Clone(borrowed.PKCS8A)
	owned.PKCS8B = bytes.Clone(borrowed.PKCS8B)
	owned.PKA = bytes.Clone(borrowed.PKA)
	owned.PKB = bytes.Clone(borrowed.PKB)
	var public ynxbatch.PublicKey
	var err error
	key, public, err = ynxbatch.ImportKeyMaterial(owned)
	if err != nil || !bytes.Equal(public.PKA, plan.inputs.expected.PKA) || !bytes.Equal(public.PKB, plan.inputs.expected.PKB) {
		return nil, resultKeyMaterial, cleanupUnknown
	}
	batch, err = ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: plan.inputs.expected.NetworkID, Owner: plan.inputs.expected.Owner, Purpose: ynxbatch.ProductPairPendingOriginalQueryPurpose}, [][]byte{plan.message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return nil, resultSigning, cleanupUnknown
	}
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	candidate, err = ynxbatch.EncodeMember(member)
	if err != nil || len(candidate) == 0 || len(candidate) > pendingQueryCapacity {
		return nil, resultOutputValidation, cleanupUnknown
	}
	if err = inspect(plan, candidate); err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	return candidate, resultOK, cleanupUnknown
}

// This private layout gate is independent of the public wire field grammar.
// In particular no public parser may read a span aliasing borrowed PKCS8.
// All integer extents are validated before overlap arithmetic. It does not
// dereference caller memory, admit an Auth Source or select a private key.
func checkPendingQueryLayout(request memoryRange, public, private, outputs []memoryRange) resultCode {
	inputs := append(append(make([]memoryRange, 0, len(public)+len(private)), public...), private...)
	if code := checkMemoryLayout(request, inputs, outputs); code != resultOK {
		return code
	}
	for _, secret := range private {
		if overlaps(request, secret) {
			return resultOverlap
		}
	}
	for _, p := range public {
		for _, secret := range private {
			if overlaps(p, secret) {
				return resultOverlap
			}
		}
	}
	return resultOK
}
