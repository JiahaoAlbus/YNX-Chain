package ynxbatch

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

type deploymentV2Golden struct {
	Domain     string               `json:"domain"`
	ActualHex  string               `json:"actualHex"`
	Manifest   DeploymentManifestV2 `json:"manifest"`
	PayloadHex string               `json:"payloadHex"`
	Binding    DeploymentV2Bind     `json:"binding"`
}

func deploymentV2Fixture(t *testing.T) (deploymentV2Golden, []byte, []byte) {
	t.Helper()
	raw, err := os.ReadFile("testdata/deployment_v2_sdk_a7.json")
	if err != nil {
		t.Fatal(err)
	}
	// Original public SDK a7bfd7800 blob f67da3479eca3046836c0a5d673f99b3709a56a3.
	if got := sha256.Sum256(raw); hex.EncodeToString(got[:]) != "bfff21c8195e2c1a81d46060caa04e73f756b1cb2a1dc164813aa9c6a6b86ecb" {
		t.Fatal("original SDK fixture changed")
	}
	var f deploymentV2Golden
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&f); err != nil {
		t.Fatal(err)
	}
	actual, err := hex.DecodeString(f.ActualHex)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := hex.DecodeString(f.PayloadHex)
	if err != nil {
		t.Fatal(err)
	}
	return f, actual, wire
}
func TestDeploymentManifestV2SDKFrozenGolden(t *testing.T) {
	f, actual, wire := deploymentV2Fixture(t)
	if f.Domain != DeploymentManifestV2Domain || DeploymentManifestV2Purpose != "CLOUD-DEPLOYMENT-MANIFEST-V2" {
		t.Fatal("fixed domains")
	}
	got, err := CreateDeploymentManifestV2DATA(f.Manifest, actual)
	if err != nil || !bytes.Equal(got.PayloadOriginal, wire) || got.Binding != f.Binding {
		t.Fatal("not exact original SDK E11", err)
	}
	decoded, err := DecodeDeploymentManifestV2DATA(wire, &f.Binding)
	if err != nil || decoded != f.Manifest {
		t.Fatal("not exact ten-key typed round trip", err)
	}
	bind, err := EncodeDeploymentV2Bind(f.Manifest.Artifact.Content)
	if err != nil || len(bind) != 152 {
		t.Fatal("BindE3", err)
	}
	rows, err := DecodeFields(bind, 3, 152)
	if err != nil || len(rows[0]) != 8 || len(rows[1]) != 64 || len(rows[2]) != 64 || !bytes.Equal(rows[0], []byte{0, 0, 0, 0, 0, 0, 0, 27}) {
		t.Fatal("DTO text leaked into raw BindE3")
	}
	if decoded, err := DecodeDeploymentV2Bind(bind); err != nil || decoded != f.Manifest.Artifact.Content {
		t.Fatal("bind roundtrip", err)
	}
	actual[0] ^= 1
	if _, err := AssertDeploymentArtifactV2DATA(wire, actual); err == nil {
		t.Fatal("actual artifact swap accepted")
	}
}
func TestDeploymentManifestV2ExactFieldsWidthsAndOriginalBytes(t *testing.T) {
	f, _, wire := deploymentV2Fixture(t)
	rows, err := DecodeFields(wire, 11, 16384)
	if err != nil {
		t.Fatal(err)
	}
	for _, index := range []int{4, 8, 10} {
		r := copyMessages(rows)
		r[index] = []byte("7")
		bad, _ := EncodeFields(r...)
		if _, err := DecodeDeploymentManifestV2DATA(bad, nil); err == nil {
			t.Fatal("decimal U64 text accepted", index)
		}
	}
	for _, bad := range [][]byte{append(bytes.Clone(wire), 0), wire[:len(wire)-1], append([]byte{0, 0, 0, 10}, wire[4:]...)} {
		if _, err := DecodeDeploymentManifestV2DATA(bad, nil); err == nil {
			t.Fatal("unknown/missing/trailing E11 accepted")
		}
	}
	r := copyMessages(rows)
	r[0] = []byte("ARTIFACT-RELEASE")
	bad, _ := EncodeFields(r...)
	if _, err := DecodeDeploymentManifestV2DATA(bad, nil); err == nil {
		t.Fatal("V1 domain accepted")
	}
	r = copyMessages(rows)
	r[1] = []byte{0xff}
	bad, _ = EncodeFields(r...)
	if _, err := DecodeDeploymentManifestV2DATA(bad, nil); err == nil {
		t.Fatal("invalid UTF8 accepted")
	}
	b := f.Binding
	b.SHA512 = strings.ToUpper(b.SHA512)
	if _, err := DecodeDeploymentManifestV2DATA(wire, &b); err == nil {
		t.Fatal("noncanonical expected binding accepted")
	}
	b = f.Binding
	b.Bytes = "0677"
	if _, err := EncodeDeploymentV2Bind(b); err == nil {
		t.Fatal("noncanonical decimal accepted")
	}
}
func TestDeploymentManifestV2SDKScopeEpochAndTextRules(t *testing.T) {
	f, actual, _ := deploymentV2Fixture(t)
	for _, value := range []string{"0", "18446744073709551615"} {
		m := f.Manifest
		m.Version = value
		m.PublisherEpoch = value
		m.IssuerEpoch = value
		m.Issuer.Rev = value
		got, err := CreateDeploymentManifestV2DATA(m, actual)
		if err != nil {
			t.Fatal("valid U64 boundary", value, err)
		}
		decoded, err := DecodeDeploymentManifestV2DATA(got.PayloadOriginal, nil)
		if err != nil || decoded != m {
			t.Fatal("boundary roundtrip", err)
		}
	}
	for _, value := range []string{"", "01", "+1", "-1", "18446744073709551616"} {
		m := f.Manifest
		m.PublisherEpoch = value
		if _, err := CreateDeploymentManifestV2DATA(m, actual); err == nil {
			t.Fatal("bad external canonical epoch", value)
		}
	}
	mutations := []func(*DeploymentManifestV2){func(m *DeploymentManifestV2) { m.Project.Realm = "other" }, func(m *DeploymentManifestV2) { m.Artifact.Ref.Tenant = "other" }, func(m *DeploymentManifestV2) { m.Publisher.Realm = "other" }, func(m *DeploymentManifestV2) { m.Env = " staging" }, func(m *DeploymentManifestV2) { m.Env = "staging\ufeff" }, func(m *DeploymentManifestV2) { m.Env = "a\nb" }, func(m *DeploymentManifestV2) { m.Artifact.ObjectKey = "https://example.test/file" }, func(m *DeploymentManifestV2) { m.Artifact.ObjectKey = "//host/file" }, func(m *DeploymentManifestV2) { m.Artifact.ObjectKey = "a\x00b" }, func(m *DeploymentManifestV2) { m.Artifact.MIME = "应用/octet-stream" }, func(m *DeploymentManifestV2) { m.Artifact.Size = "28" }}
	for i, mutate := range mutations {
		m := f.Manifest
		mutate(&m)
		if _, err := CreateDeploymentManifestV2DATA(m, actual); err == nil {
			t.Fatal("invalid finite field accepted", i)
		}
	}
	m := f.Manifest
	m.Issuer.Realm = "independent issuer realm"
	m.Issuer.Tenant = "independent tenant"
	m.Issuer.Rev = "29"
	m.IssuerEpoch = "11"
	if _, err := CreateDeploymentManifestV2DATA(m, actual); err != nil {
		t.Fatal("independent issuer DATA rejected", err)
	}
	if m.PublisherEpoch == m.Publisher.Rev || m.IssuerEpoch == m.Issuer.Rev {
		t.Fatal("fixture does not prove epoch independence")
	}
}
func TestDeploymentManifestV2IndependentBindingsRejectSameShapeSwaps(t *testing.T) {
	f, actual, wire := deploymentV2Fixture(t)
	b := DeploymentManifestV2SigningBinding{NetworkID: make([]byte, 32), SubjectOwner: "PUBLIC math label, not asset authority", PKA: make([]byte, PublicKeyASize), PKB: make([]byte, PublicKeyBSize), PayloadOriginal: wire, PayloadBind: f.Binding, ArtifactBind: f.Manifest.Artifact.Content}
	if _, err := PrepareDeploymentManifestV2Signing(wire, actual, b); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*DeploymentManifestV2){func(m *DeploymentManifestV2) { m.Project.ID += "/swap" }, func(m *DeploymentManifestV2) { m.Artifact.Ref.Rev = "8" }, func(m *DeploymentManifestV2) { m.Publisher.ID += "/swap" }, func(m *DeploymentManifestV2) { m.PublisherEpoch = "4" }, func(m *DeploymentManifestV2) { m.Issuer.ID += "/swap" }, func(m *DeploymentManifestV2) { m.IssuerEpoch = "12" }, func(m *DeploymentManifestV2) { m.Artifact.ObjectKey += ".swap" }} {
		m := f.Manifest
		change(&m)
		swapped, err := CreateDeploymentManifestV2DATA(m, actual)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := PrepareDeploymentManifestV2Signing(swapped.PayloadOriginal, actual, b); err == nil {
			t.Fatal("same-shaped independently unselected E11 accepted")
		}
	}
	wrong := b
	wrong.ArtifactBind.SHA512 = strings.Repeat("0", 128)
	if _, err := PrepareDeploymentManifestV2Signing(wire, actual, wrong); err == nil {
		t.Fatal("independent artifact bind ignored")
	}
	wrong = b
	wrong.NetworkID = nil
	if _, err := PrepareDeploymentManifestV2Signing(wire, actual, wrong); err == nil {
		t.Fatal("missing independent math label accepted")
	}
}
func TestDeploymentManifestV2OriginalDualANDAndN1(t *testing.T) {
	f, _, wire := deploymentV2Fixture(t)
	key, pk, err := KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	b := DeploymentManifestV2SigningBinding{NetworkID: bytes.Repeat([]byte{0x71}, 32), SubjectOwner: "PUBLIC held-publisher mathematical label", PKA: pk.PKA, PKB: pk.PKB, PayloadOriginal: wire, PayloadBind: f.Binding, ArtifactBind: f.Manifest.Artifact.Content}
	batch, err := BatchSign(key, Metadata{ChainID: b.NetworkID, Owner: b.SubjectOwner, Purpose: DeploymentManifestV2Purpose}, [][]byte{wire}, SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	m, err := Extract(batch, 0)
	if err != nil {
		t.Fatal(err)
	}
	member, err := EncodeMember(m)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyDeploymentManifestV2Member(member, b); err != nil {
		t.Fatal("real full AND failed", err)
	}
	for _, branch := range []string{"A", "B"} {
		changed := m
		changed.Certificate = m.Certificate
		changed.Certificate.SigmaA = bytes.Clone(m.Certificate.SigmaA)
		changed.Certificate.SigmaB = bytes.Clone(m.Certificate.SigmaB)
		if branch == "A" {
			changed.Certificate.SigmaA[0] ^= 1
		} else {
			changed.Certificate.SigmaB[0] ^= 1
		}
		bad, err := EncodeMember(changed)
		if err != nil {
			t.Fatal(err)
		}
		if err := VerifyDeploymentManifestV2Member(bad, b); err == nil {
			t.Fatal("broken independent signature accepted", branch)
		}
	}
	wrong := b
	wrong.PKB = bytes.Clone(b.PKB)
	wrong.PKB[0] ^= 1
	if err := VerifyDeploymentManifestV2Member(member, wrong); err == nil {
		t.Fatal("full pair B swap accepted")
	}
	m.Certificate.Purpose = ArtifactPublicationPurpose
	bad, err := EncodeMember(m)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := InspectDeploymentManifestV2Member(bad, b); err == nil {
		t.Fatal("old purpose accepted")
	}
	two, err := BatchSign(key, Metadata{ChainID: b.NetworkID, Owner: b.SubjectOwner, Purpose: DeploymentManifestV2Purpose}, [][]byte{wire, wire}, SignOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer two.Discard()
	twom, err := Extract(two, 0)
	if err != nil {
		t.Fatal(err)
	}
	bad, err = EncodeMember(twom)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyDeploymentManifestV2Member(bad, b); err == nil {
		t.Fatal("ordinary batch accepted as fixed N1")
	}
}
