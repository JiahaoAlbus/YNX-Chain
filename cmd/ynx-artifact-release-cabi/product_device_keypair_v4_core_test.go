package main

import (
	"bytes"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func productDeviceKeypairTestCopy(m ynxbatch.KeyMaterial) ynxbatch.KeyMaterial {
	return ynxbatch.KeyMaterial{PKCS8A: bytes.Clone(m.PKCS8A), PKCS8B: bytes.Clone(m.PKCS8B), PKA: bytes.Clone(m.PKA), PKB: bytes.Clone(m.PKB)}
}

func TestProductDeviceKeypairV4FreshActualImportAndAND(t *testing.T) {
	first, code, cleanup := generateProductDeviceKeypairV4()
	defer first.Clear()
	if code != resultOK || cleanup != cleanupLogicalComplete || !productDeviceKeypairMaterialComplete(first) {
		t.Fatal("new device keypair generation did not complete")
	}
	second, code, cleanup := generateProductDeviceKeypairV4()
	defer second.Clear()
	if code != resultOK || cleanup != cleanupLogicalComplete || bytes.Equal(first.PKA, second.PKA) || bytes.Equal(first.PKB, second.PKB) {
		t.Fatal("each device creation must generate both fresh branches")
	}
	if productDeviceKeypairPurpose != "product-session-device-v4" || productDeviceKeypairVersion != 4 {
		t.Fatal("device creation role changed")
	}
	for _, material := range []ynxbatch.KeyMaterial{first, second} {
		before := productDeviceKeypairTestCopy(material)
		defer before.Clear()
		key, public, err := ynxbatch.ImportKeyMaterial(material)
		if err != nil {
			before.Clear()
			t.Fatal("actual generated device DER cannot be reimported")
		}
		defer key.Destroy()
		original, expected := productDeviceTestOriginal(t, public)
		message, err := ynxbatch.BuildProductSessionDeviceRegistrationV4Message(original, expected)
		requireNoError(t, err)
		signed, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: expected.NetworkID, Owner: expected.Owner,
			Purpose: productDeviceRegistrationPurpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
		requireNoError(t, err)
		defer signed.Discard()
		member, err := ynxbatch.Extract(signed, 0)
		requireNoError(t, err)
		wire, err := ynxbatch.EncodeMember(member)
		requireNoError(t, err)
		plan, result := prepareProductDeviceRegistration(original, expected, productDeviceMemberCapacity)
		if result != resultOK {
			t.Fatal("typed device registration refused")
		}
		requireNoError(t, verifyProductDeviceActualAND(wire, plan))
		for _, branch := range []string{"A", "B"} {
			bad, err := ynxbatch.DecodeMember(wire)
			requireNoError(t, err)
			if branch == "A" {
				bad.Certificate.SigmaA[0] ^= 1
			} else {
				bad.Certificate.SigmaB[0] ^= 1
			}
			changed, err := ynxbatch.EncodeMember(bad)
			requireNoError(t, err)
			if verifyProductDeviceActualAND(changed, plan) == nil {
				t.Fatal("one invalid signature branch was accepted")
			}
		}
		if !bytes.Equal(material.PKCS8A, before.PKCS8A) || !bytes.Equal(material.PKCS8B, before.PKCS8B) ||
			!bytes.Equal(material.PKA, before.PKA) || !bytes.Equal(material.PKB, before.PKB) {
			t.Fatal("import/sign mutated transferred device material")
		}
		key.Destroy()
		signed.Discard()
		before.Clear()
	}
}

func TestProductDeviceKeypairV4FullPairAndDERCorruptionRejected(t *testing.T) {
	material, code, cleanup := generateProductDeviceKeypairV4()
	defer material.Clear()
	if code != resultOK || cleanup != cleanupLogicalComplete {
		t.Fatal("actual generated pair required")
	}
	for _, branch := range []string{"DER-A", "DER-B-root", "public-A", "public-B"} {
		bad := productDeviceKeypairTestCopy(material)
		switch branch {
		case "DER-A":
			bad.PKCS8A[len(bad.PKCS8A)-1] ^= 1
		case "DER-B-root":
			bad.PKCS8B[len(bad.PKCS8B)-1] ^= 1
		case "public-A":
			bad.PKA[0] ^= 1
		case "public-B":
			bad.PKB[0] ^= 1
		}
		key, _, err := ynxbatch.ImportKeyMaterial(bad)
		key.Destroy()
		bad.Clear()
		if err == nil {
			t.Fatal("inconsistent generated material was accepted:", branch)
		}
	}
}

func TestProductDeviceKeypairV4PreTransferFailureClearsAndPreservesFirstCause(t *testing.T) {
	for _, condition := range []struct {
		name            string
		code            resultCode
		panicked, clean bool
		want            resultCode
		cleanup         cleanupCode
	}{
		{"original-error", resultKeyMaterial, false, true, resultKeyMaterial, cleanupLogicalComplete},
		{"panic", resultOK, true, true, resultInternal, cleanupUnknown},
		{"cleanup", resultOK, false, false, resultCleanup, cleanupFailed},
		{"first-error-and-cleanup", resultOutputValidation, true, false, resultOutputValidation, cleanupFailed},
	} {
		t.Run(condition.name, func(t *testing.T) {
			// Byte markers test only cleanup ownership, never crypto success.
			candidate := ynxbatch.KeyMaterial{PKCS8A: bytes.Repeat([]byte{1}, 54), PKCS8B: bytes.Repeat([]byte{2}, 150),
				PKA: bytes.Repeat([]byte{3}, 2592), PKB: bytes.Repeat([]byte{4}, 64)}
			aliases := [][]byte{candidate.PKCS8A, candidate.PKCS8B, candidate.PKA, candidate.PKB}
			out, code, cleanup := finishProductDeviceKeypairV4(candidate, condition.code, condition.panicked, condition.clean)
			defer out.Clear()
			if code != condition.want || cleanup != condition.cleanup || len(out.PKCS8A)+len(out.PKCS8B)+len(out.PKA)+len(out.PKB) != 0 {
				t.Fatal("pre-transfer failure released material or changed first cause")
			}
			for _, raw := range aliases {
				if !bytes.Equal(raw, make([]byte, len(raw))) {
					t.Fatal("explicit owned material not cleared")
				}
			}
		})
	}
}

func TestProductDeviceKeypairV4LatePrivateOutcomeStaysUnknown(t *testing.T) {
	for _, condition := range []struct {
		code                             resultCode
		cleanup                          cleanupCode
		began, complete, panicked, clean bool
		want                             resultCode
		state                            uint32
	}{
		{resultOK, cleanupLogicalComplete, true, true, false, true, resultOK, productDeviceKeypairComplete},
		{resultOK, cleanupLogicalComplete, true, true, true, true, resultInternal, productDeviceKeypairUnknown},
		{resultOK, cleanupLogicalComplete, true, true, false, false, resultCleanup, productDeviceKeypairUnknown},
		{resultKeyMaterial, cleanupLogicalComplete, true, false, false, true, resultKeyMaterial, productDeviceKeypairUnknown},
		{resultOutputValidation, cleanupUnknown, true, true, true, false, resultOutputValidation, productDeviceKeypairUnknown},
		{resultKeyMaterial, cleanupLogicalComplete, false, false, false, true, resultKeyMaterial, productDeviceKeypairNone},
		{resultOK, cleanupUnknown, false, false, false, true, resultOutputValidation, productDeviceKeypairNone},
	} {
		code, cleanup, state := finishProductDeviceKeypairTransferV4(condition.code, condition.cleanup, condition.began, condition.complete, condition.panicked, condition.clean)
		if code != condition.want || state != condition.state || code == resultOK && (cleanup != cleanupLogicalComplete || state != productDeviceKeypairComplete) {
			t.Fatal("late outcome was lost or falsely reported as mathematical success")
		}
	}
}
