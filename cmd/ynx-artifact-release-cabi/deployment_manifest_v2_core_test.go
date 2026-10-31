package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func deploymentManifestV2CoreFixture(t *testing.T) deploymentManifestV2Inputs {
	t.Helper()
	raw, err := os.ReadFile("../../internal/ynxbatch/testdata/deployment_v2_sdk_a7.json")
	if err != nil {
		t.Fatal(err)
	}
	if digest := sha256.Sum256(raw); hex.EncodeToString(digest[:]) != "bfff21c8195e2c1a81d46060caa04e73f756b1cb2a1dc164813aa9c6a6b86ecb" {
		t.Fatal("SDK original fixture changed")
	}
	var f struct {
		ActualHex  string                        `json:"actualHex"`
		PayloadHex string                        `json:"payloadHex"`
		Binding    ynxbatch.DeploymentV2Bind     `json:"binding"`
		Manifest   ynxbatch.DeploymentManifestV2 `json:"manifest"`
	}
	if err = json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	actual, err := hex.DecodeString(f.ActualHex)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := hex.DecodeString(f.PayloadHex)
	if err != nil {
		t.Fatal(err)
	}
	return deploymentManifestV2Inputs{payload: payload, actualArtifact: actual, expected: ynxbatch.DeploymentManifestV2SigningBinding{NetworkID: bytes.Repeat([]byte{0x72}, 32), SubjectOwner: "PUBLIC independently selected publisher label", PKA: make([]byte, ynxbatch.PublicKeyASize), PKB: make([]byte, ynxbatch.PublicKeyBSize), PayloadOriginal: bytes.Clone(payload), PayloadBind: f.Binding, ArtifactBind: f.Manifest.Artifact.Content}}
}

func TestDeploymentManifestV2CorePublicPreflight(t *testing.T) {
	in := deploymentManifestV2CoreFixture(t)
	plan, code := prepareDeploymentManifestV2(in, deploymentManifestCapacity)
	if code != resultOK {
		t.Fatal(code)
	}
	in.payload[0] ^= 1
	in.expected.PKA[0] ^= 1
	in.expected.PayloadOriginal[0] ^= 1
	if plan.payload[0] != 0 || plan.expected.PKA[0] != 0 || plan.expected.PayloadOriginal[0] != 0 {
		t.Fatal("public plan aliases caller inputs")
	}
	in = deploymentManifestV2CoreFixture(t)
	if _, code := prepareDeploymentManifestV2(in, deploymentManifestCapacity-1); code != resultCapacity {
		t.Fatal("capacity mismatch", code)
	}
	in.actualArtifact[0] ^= 1
	if _, code := prepareDeploymentManifestV2(in, deploymentManifestCapacity); code != resultPublicBinding {
		t.Fatal("actual artifact ignored", code)
	}
	in = deploymentManifestV2CoreFixture(t)
	in.expected.PayloadBind.SHA512 = ""
	if _, code := prepareDeploymentManifestV2(in, deploymentManifestCapacity); code != resultPublicBinding {
		t.Fatal("outer full Bind ignored", code)
	}
	in = deploymentManifestV2CoreFixture(t)
	in.payload = nil
	if _, code := prepareDeploymentManifestV2(in, deploymentManifestCapacity); code != resultBounds {
		t.Fatal("empty payload accepted", code)
	}
}
func TestDeploymentManifestV2CoreActualDualANDAndPrivateBorrow(t *testing.T) {
	in := deploymentManifestV2CoreFixture(t)
	key, pk, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	material, err := ynxbatch.ExportKeyMaterial(key)
	if err != nil {
		t.Fatal(err)
	}
	defer material.Clear()
	in.expected.PKA, in.expected.PKB = pk.PKA, pk.PKB
	plan, code := prepareDeploymentManifestV2(in, deploymentManifestCapacity)
	if code != resultOK {
		t.Fatal(code)
	}
	beforeA, beforeB := bytes.Clone(material.PKCS8A), bytes.Clone(material.PKCS8B)
	defer clear(beforeA)
	defer clear(beforeB)
	member, code, cleanup := signDeploymentManifestV2Prepared(plan, material)
	defer clear(member)
	if code != resultOK || cleanup != cleanupLogicalComplete || len(member) == 0 {
		t.Fatal("actual E11 signing", code, cleanup)
	}
	if !bytes.Equal(beforeA, material.PKCS8A) || !bytes.Equal(beforeB, material.PKCS8B) {
		t.Fatal("callee changed caller private borrow")
	}
	if err := ynxbatch.VerifyDeploymentManifestV2Member(member, in.expected); err != nil {
		t.Fatal("real independent AND", err)
	}
	decoded, err := ynxbatch.DecodeMember(member)
	if err != nil || !bytes.Equal(decoded.Message, in.payload) || decoded.Certificate.Purpose != ynxbatch.DeploymentManifestV2Purpose || decoded.Certificate.N != 1 || decoded.Index != 0 || len(decoded.PathA) != 0 || len(decoded.PathB) != 0 {
		t.Fatal("not exact E11 N1 output", err)
	}
	bad := ynxbatch.KeyMaterial{PKCS8A: bytes.Clone(material.PKCS8A), PKCS8B: bytes.Clone(material.PKCS8B), PKA: bytes.Clone(material.PKA), PKB: bytes.Clone(material.PKB)}
	defer bad.Clear()
	bad.PKCS8B[0] ^= 1
	if output, code, cleanup := signDeploymentManifestV2Prepared(plan, bad); output != nil || code != resultKeyMaterial || cleanup != cleanupLogicalComplete {
		t.Fatal("tampered private pair admitted", code, cleanup)
	}
	bad.Clear()
	bad = ynxbatch.KeyMaterial{}
	if output, code, cleanup := signDeploymentManifestV2Prepared(plan, bad); output != nil || code != resultKeyMaterial || cleanup != cleanupNotRequired {
		t.Fatal("missing borrow changed stage", code, cleanup)
	}
}
func TestDeploymentManifestV2CoreCleanupFailureAndUnknownRemainClosed(t *testing.T) {
	for _, c := range []struct {
		code            resultCode
		panicked, clean bool
		wantCode        resultCode
		wantCleanup     cleanupCode
	}{
		{resultOK, false, true, resultOK, cleanupLogicalComplete},
		{resultOK, true, true, resultInternal, cleanupUnknown},
		{resultOK, false, false, resultCleanup, cleanupFailed},
		{resultKeyMaterial, false, false, resultKeyMaterial, cleanupFailed},
		{resultSigning, true, true, resultSigning, cleanupUnknown},
	} {
		candidate := []byte{1, 2, 3}
		output, code, cleanup := finishDeploymentManifestV2(candidate, c.code, c.panicked, c.clean)
		if code != c.wantCode || cleanup != c.wantCleanup {
			t.Fatal("first failure or UNKNOWN lost", code, cleanup)
		}
		if code != resultOK && (output != nil || !bytes.Equal(candidate, []byte{0, 0, 0})) {
			t.Fatal("partial candidate released")
		}
	}
}
