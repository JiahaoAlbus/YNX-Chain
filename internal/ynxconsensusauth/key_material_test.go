package ynxconsensusauth

import (
	"bytes"
	"encoding/hex"
	"testing"
)

func cloneCandidateMaterial(m CandidateKeyMaterial) CandidateKeyMaterial {
	m.PKCS8A, m.PKCS8B = bytes.Clone(m.PKCS8A), bytes.Clone(m.PKCS8B)
	m.PublicA, m.PublicB = bytes.Clone(m.PublicA), bytes.Clone(m.PublicB)
	return m
}

func TestCandidateKeyMaterialExactPublicABIAndRealSigning(t *testing.T) {
	key, material, err := GenerateCandidateKeyMaterial()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	defer material.Clear()
	if hex.EncodeToString(material.PKCS8A[:22]) != "3034020100300b060960864801650304031304228020" || hex.EncodeToString(material.PKCS8B[:22]) != "308193020100300b0609608648016503040319048180" || len(material.PKCS8A) != 54 || len(material.PKCS8B) != 150 {
		t.Fatal("public SDK exact DER ABI differs")
	}
	restored, err := ImportCandidateKeyMaterial(material, material.PublicA, material.PublicB)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Destroy()
	a, b, err := restored.publicMaterial()
	if err != nil || !bytes.Equal(a, material.PublicA) || !bytes.Equal(b, material.PublicB) {
		t.Fatal("restored complete public pair differs", err)
	}
	registry := fixtureRegistry()
	registry.record.MLDSA87PublicKey, registry.record.SLHDSASHA2256fPublicKey = bytes.Clone(a), bytes.Clone(b)
	request := fixtureRequest(t, 100)
	// Package-private test access exercises the actual imported primitive; the
	// production API still exposes no raw signing method or self-test signature.
	signature, err := restored.signRequest(request, registry.record)
	if err != nil {
		t.Fatal(err)
	}
	policy := Policy{Version: ConsensusGenesisVersion, GenesisID: fixtureGenesis(), ChainID: registry.record.ChainID, ActivationHeight: 100}
	verifier, err := NewCIRCLVerifier(policy, registry, nil)
	if err != nil || verifier.Verify(request, signature) != nil {
		t.Fatal("restored private pair failed actual dual verification", err)
	}
	material.Clear()
	if _, _, err = restored.publicMaterial(); err != nil {
		t.Fatal("import retained caller plaintext", err)
	}
	restored.Destroy()
	if _, err = restored.signRequest(request, registry.record); err == nil {
		t.Fatal("destroyed imported handle signed")
	}
}

func TestCandidateKeyMaterialRejectsMalformedAndInconsistentSecrets(t *testing.T) {
	key, original, err := GenerateCandidateKeyMaterial()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	defer original.Clear()
	for _, name := range []string{"format", "algorithm", "suite", "trailingA", "trailingB", "oidA", "oidB", "ml-seed", "slh-private-seed", "slh-public-seed", "slh-root", "publicA", "publicB", "expectedA", "expectedB", "expandedML"} {
		t.Run(name, func(t *testing.T) {
			m := cloneCandidateMaterial(original)
			defer m.Clear()
			a, b := bytes.Clone(original.PublicA), bytes.Clone(original.PublicB)
			switch name {
			case "format":
				m.Format += "x"
			case "algorithm":
				m.AlgorithmVersion += "x"
			case "suite":
				m.Suite += "x"
			case "trailingA":
				m.PKCS8A = append(m.PKCS8A, 0)
			case "trailingB":
				m.PKCS8B = append(m.PKCS8B, 0)
			case "oidA":
				m.PKCS8A[17] ^= 1
			case "oidB":
				m.PKCS8B[18] ^= 1
			case "ml-seed":
				m.PKCS8A[22] ^= 1
			case "slh-private-seed":
				m.PKCS8B[22] ^= 1 // embedded public bytes unchanged
			case "slh-public-seed":
				m.PKCS8B[22+64] ^= 1
			case "slh-root":
				m.PKCS8B[22+96] ^= 1
			case "publicA":
				m.PublicA[0] ^= 1
			case "publicB":
				m.PublicB[0] ^= 1
			case "expectedA":
				a[0] ^= 1
			case "expectedB":
				b[0] ^= 1
			case "expandedML":
				m.PKCS8A = make([]byte, 4896)
			}
			got, err := ImportCandidateKeyMaterial(m, a, b)
			if err == nil || got != nil {
				if got != nil {
					got.Destroy()
				}
				t.Fatal("invalid private/public material accepted")
			}
		})
	}
}
