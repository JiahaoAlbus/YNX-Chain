package main

import (
	"bytes"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	deploymentManifestVersion       = 2
	deploymentManifestCapacity      = 98304
	deploymentManifestMemberMaximum = 20 + len(ynxbatch.Version+"/MEMBER") + ynxbatch.MaxCertificateBytes + ynxbatch.DeploymentManifestV2MaxBytes + 28
)

type deploymentManifestV2Inputs struct {
	payload, actualArtifact []byte
	expected                ynxbatch.DeploymentManifestV2SigningBinding
}
type deploymentManifestV2Plan struct {
	payload  []byte
	expected ynxbatch.DeploymentManifestV2SigningBinding
}

func prepareDeploymentManifestV2(in deploymentManifestV2Inputs, capacity uint64) (deploymentManifestV2Plan, resultCode) {
	if capacity != deploymentManifestCapacity {
		return deploymentManifestV2Plan{}, resultCapacity
	}
	if len(in.payload) < 1 || len(in.payload) > ynxbatch.DeploymentManifestV2MaxBytes || len(in.actualArtifact) > ynxbatch.DeploymentArtifactV2MaxBytes || deploymentManifestMemberMaximum > deploymentManifestCapacity {
		return deploymentManifestV2Plan{}, resultBounds
	}
	if _, err := ynxbatch.PrepareDeploymentManifestV2Signing(in.payload, in.actualArtifact, in.expected); err != nil {
		return deploymentManifestV2Plan{}, resultPublicBinding
	}
	b := in.expected
	b.NetworkID = bytes.Clone(b.NetworkID)
	b.PKA = bytes.Clone(b.PKA)
	b.PKB = bytes.Clone(b.PKB)
	b.PayloadOriginal = bytes.Clone(b.PayloadOriginal)
	return deploymentManifestV2Plan{bytes.Clone(in.payload), b}, resultOK
}

// Preserve the first failure and explicit cleanup uncertainty. A failed call
// never publishes a partial member. Logical cleanup is not physical erasure.
func finishDeploymentManifestV2(candidate []byte, code resultCode, panicked, clean bool) ([]byte, resultCode, cleanupCode) {
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
	if code != resultOK || cleanup != cleanupLogicalComplete {
		clear(candidate)
		return nil, code, cleanup
	}
	return candidate, code, cleanup
}

// Fixed N1 E11 signing only. Original Auth/Native has already obtained current
// fullRefs/epochs, independent E11 approval and the held publisher key. This
// mathematical callee does not manufacture any of those facts or retain keys.
func signDeploymentManifestV2Prepared(plan deploymentManifestV2Plan, borrowed ynxbatch.KeyMaterial) (output []byte, code resultCode, cleanup cleanupCode) {
	if len(borrowed.PKCS8A) != ynxbatch.PKCS8ASize || len(borrowed.PKCS8B) != ynxbatch.PKCS8BSize || len(borrowed.PKA) != ynxbatch.PublicKeyASize || len(borrowed.PKB) != ynxbatch.PublicKeyBSize {
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
		output, code, cleanup = finishDeploymentManifestV2(candidate, code, panicked, clean)
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
	batch, err = ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: plan.expected.NetworkID, Owner: plan.expected.SubjectOwner, Purpose: ynxbatch.DeploymentManifestV2Purpose}, [][]byte{plan.payload}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		return nil, resultSigning, cleanupUnknown
	}
	member, err := ynxbatch.Extract(batch, 0)
	if err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	candidate, err = ynxbatch.EncodeMember(member)
	if err != nil || len(candidate) == 0 || len(candidate) > deploymentManifestMemberMaximum || len(candidate) > deploymentManifestCapacity {
		return nil, resultOutputValidation, cleanupUnknown
	}
	// Actual independent dual-AND verification and fixed N1/context/typed E11
	// inspection run before C output. The local public-key resolver is math only.
	if err = ynxbatch.VerifyDeploymentManifestV2Member(candidate, plan.expected); err != nil {
		return nil, resultOutputValidation, cleanupUnknown
	}
	return candidate, resultOK, cleanupUnknown
}
