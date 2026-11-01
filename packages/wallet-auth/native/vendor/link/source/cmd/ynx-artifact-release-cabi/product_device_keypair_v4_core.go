package main

import (
	"bytes"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	productDeviceKeypairVersion  = 4
	productDeviceKeypairPurpose  = "product-session-device-v4"
	productDeviceKeypairNone     = 0
	productDeviceKeypairComplete = 1
	productDeviceKeypairUnknown  = 2
)

func productDeviceKeypairMaterialComplete(m ynxbatch.KeyMaterial) bool {
	return len(m.PKCS8A) == ynxbatch.PKCS8ASize && len(m.PKCS8B) == ynxbatch.PKCS8BSize &&
		len(m.PKA) == ynxbatch.PublicKeyASize && len(m.PKB) == ynxbatch.PublicKeyBSize
}

// The production creator has no injected RNG/provider/seed or caller-selected
// role. The role belongs to original Auth Native custody, not to a chain key.
func generateProductDeviceKeypairV4() (output ynxbatch.KeyMaterial, code resultCode, cleanup cleanupCode) {
	var generated, imported *ynxbatch.PrivateKey
	var material, candidate ynxbatch.KeyMaterial
	code, cleanup = resultInternal, cleanupUnknown
	defer func() {
		panicked := recover() != nil
		clean := runLogicalCleanup(func() { imported.Destroy() }, func() { generated.Destroy() }, func() { material.Clear() })
		output, code, cleanup = finishProductDeviceKeypairV4(candidate, code, panicked, clean)
	}()
	var pair, derived ynxbatch.PublicKey
	var err error
	generated, pair, err = ynxbatch.KeyGen()
	if err != nil {
		return output, resultKeyMaterial, cleanupUnknown
	}
	material, err = ynxbatch.ExportKeyMaterial(generated)
	if err != nil || !productDeviceKeypairMaterialComplete(material) || !bytes.Equal(pair.PKA, material.PKA) || !bytes.Equal(pair.PKB, material.PKB) {
		return output, resultKeyMaterial, cleanupUnknown
	}
	// This recomputes ML-DSA public from seed and the complete SLH secret/root;
	// merely parsing embedded public bytes would not establish pair consistency.
	imported, derived, err = ynxbatch.ImportKeyMaterial(material)
	if err != nil || !bytes.Equal(pair.PKA, derived.PKA) || !bytes.Equal(pair.PKB, derived.PKB) {
		return output, resultOutputValidation, cleanupUnknown
	}
	// Assign each owned allocation before the next, so deferred cleanup covers
	// every explicit partial allocation. These are same-call transfer copies.
	candidate.PKCS8A = bytes.Clone(material.PKCS8A)
	candidate.PKCS8B = bytes.Clone(material.PKCS8B)
	candidate.PKA = bytes.Clone(material.PKA)
	candidate.PKB = bytes.Clone(material.PKB)
	return candidate, resultOK, cleanupUnknown
}

func finishProductDeviceKeypairV4(candidate ynxbatch.KeyMaterial, code resultCode, panicked, clean bool) (ynxbatch.KeyMaterial, resultCode, cleanupCode) {
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
	if code != resultOK || cleanup != cleanupLogicalComplete || !productDeviceKeypairMaterialComplete(candidate) {
		candidate.Clear()
		if code == resultOK {
			code = resultOutputValidation
		}
		return ynxbatch.KeyMaterial{}, code, cleanup
	}
	return candidate, code, cleanup
}

// A transfer begins BEFORE the first private write. Once begun, a late error
// must preserve the Native-owned outcome/once association, never claim NONE.
func finishProductDeviceKeypairTransferV4(code resultCode, cleanup cleanupCode, began, complete, panicked, clean bool) (resultCode, cleanupCode, uint32) {
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
	if code == resultOK && (cleanup != cleanupLogicalComplete || !complete) {
		code = resultOutputValidation
	}
	if !began {
		return code, cleanup, productDeviceKeypairNone
	}
	if code == resultOK && cleanup == cleanupLogicalComplete && complete {
		return code, cleanup, productDeviceKeypairComplete
	}
	if code == resultOK {
		code = resultOutputValidation
	}
	return code, cleanup, productDeviceKeypairUnknown
}
