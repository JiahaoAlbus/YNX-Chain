package main

import (
	"bytes"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	controlABIVersion     = 1
	controlMemberCapacity = 98304
	principalMaximum      = 8192
	commandMaximum        = 8192
	decisionMaximum       = 4096
	// Exact E13 fixed context and three bounded original JSON payloads.
	controlMessageMaximum = 4 + 13*4 + len(ynxbatch.ProjectControlMessageVersion) + len(ynxbatch.Version) + len(ynxbatch.Suite) + len(ynxbatch.ProjectControlPurpose) + 32 + 42 + 20 + 20 + 256 + 256 + principalMaximum + commandMaximum + decisionMaximum
	// E(member tag, certificate, message, empty-path N1 proof).
	controlMemberMaximum = 20 + len(ynxbatch.Version+"/MEMBER") + ynxbatch.MaxCertificateBytes + controlMessageMaximum + 28
)

type controlInputs struct {
	principal, command, decision []byte
	expected                     ynxbatch.ProjectControlBinding
	atMS                         uint64
}

// Public preflight does not grant current/ACL/custody or consume Main's once.
// Original bytes are detached before any private-byte borrow is imported.
type controlPlan struct {
	message, principal, command, decision []byte
	expected                              ynxbatch.ProjectControlBinding
	atMS                                  uint64
}

func prepareControl(in controlInputs, capacity uint64) (controlPlan, resultCode) {
	if capacity != controlMemberCapacity {
		return controlPlan{}, resultCapacity
	}
	if len(in.principal) < 1 || len(in.principal) > principalMaximum ||
		len(in.command) < 1 || len(in.command) > commandMaximum ||
		len(in.decision) < 1 || len(in.decision) > decisionMaximum {
		return controlPlan{}, resultBounds
	}
	message, err := ynxbatch.BuildProjectControlMessage(in.principal, in.command, in.decision, in.expected, in.atMS)
	if err != nil {
		return controlPlan{}, resultPublicBinding
	}
	if _, err = ynxbatch.InspectProjectControlMessage(message, in.expected, in.principal, in.command, in.decision, in.atMS); err != nil || len(message) > controlMessageMaximum || controlMemberMaximum > controlMemberCapacity {
		return controlPlan{}, resultPublicBinding
	}
	expected := in.expected
	expected.NetworkID = bytes.Clone(expected.NetworkID)
	expected.PKA = bytes.Clone(expected.PKA)
	expected.PKB = bytes.Clone(expected.PKB)
	return controlPlan{message: message, principal: bytes.Clone(in.principal), command: bytes.Clone(in.command), decision: bytes.Clone(in.decision), expected: expected, atMS: in.atMS}, resultOK
}

func finishControl(candidate []byte, code resultCode, panicked, clean bool) ([]byte, resultCode, cleanupCode) {
	cleanup := cleanupLogicalComplete
	switch {
	case !clean:
		code, cleanup = resultCleanup, cleanupFailed
	case panicked:
		code, cleanup = resultInternal, cleanupUnknown
	}
	if code != resultOK || cleanup != cleanupLogicalComplete {
		clear(candidate)
		return nil, code, cleanup
	}
	return candidate, code, cleanup
}

// The only private operation is fixed ProjectControl N=1 signing. Material
// is borrowed only for this call; copies are first made after public preflight.
// Neither the package nor this function retains any key/handle on return.
func signControlPrepared(plan controlPlan, borrowed ynxbatch.KeyMaterial) (output []byte, code resultCode, cleanup cleanupCode) {
	if len(borrowed.PKCS8A) != ynxbatch.PKCS8ASize || len(borrowed.PKCS8B) != ynxbatch.PKCS8BSize ||
		len(borrowed.PKA) != ynxbatch.PublicKeyASize || len(borrowed.PKB) != ynxbatch.PublicKeyBSize {
		return nil, resultKeyMaterial, cleanupNotRequired
	}
	var owned ynxbatch.KeyMaterial
	var key *ynxbatch.PrivateKey
	var batch *ynxbatch.Batch
	var candidate []byte
	code, cleanup = resultInternal, cleanupUnknown
	defer func() {
		panicked := recover() != nil
		clean := runLogicalCleanup(func() { batch.Discard() }, func() { key.Destroy() }, func() { owned.Clear() })
		// A panic inside import/provider may hide partial internal state.
		// Clearing known owned buffers does not turn that into a guarantee.
		output, code, cleanup = finishControl(candidate, code, panicked, clean)
	}()
	// Assign each independent allocation before attempting the next, so partial
	// ownership is visible to deferred cleanup. Never mutate the borrowed spans.
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
		Owner: plan.expected.Owner, Purpose: ynxbatch.ProjectControlPurpose}, [][]byte{plan.message}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return nil, resultSigning, cleanupUnknown
	}
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	candidate, err = ynxbatch.EncodeMember(member)
	if err != nil || len(candidate) == 0 || len(candidate) > controlMemberMaximum || len(candidate) > controlMemberCapacity {
		return nil, resultOutputValidation, cleanupUnknown
	}
	if _, err := ynxbatch.InspectProjectControlMember(candidate, plan.expected, plan.principal, plan.command, plan.decision, plan.atMS); err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	// The named return is released only after the deferred logical cleanup has
	// run. This is not a claim that the Go/CIRCL heaps have been physically wiped.
	return candidate, resultOK, cleanupUnknown
}
