package openprotocol

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestDeploymentV2ActualBinding(t *testing.T) {
	actual := []byte("PUBLIC deployment artifact\n")
	b, e := BindDeploymentV2Bytes(actual)
	if e != nil {
		t.Fatal(e)
	}
	wire, e := EncodeDeploymentV2Bind(b)
	if e != nil {
		t.Fatal(e)
	}
	out, e := DecodeDeploymentV2Bind(wire)
	if e != nil || out != b {
		t.Fatal(out, e)
	}
	if _, e = AssertDeploymentV2BytesBinding(actual, b); e != nil {
		t.Fatal(e)
	}
	if _, e = AssertDeploymentV2BytesBinding(append(bytes.Clone(actual), 0), b); e == nil {
		t.Fatal("changed bytes")
	}
	if _, e = DecodeDeploymentV2Bind(append(bytes.Clone(wire), 0)); e == nil {
		t.Fatal("trailing")
	}
	b.Bytes = "01"
	if _, e = EncodeDeploymentV2Bind(b); e == nil {
		t.Fatal("decimal")
	}
}

func TestDeploymentV2SharedBindVector(t *testing.T) {
	raw, e := os.ReadFile("../test/fixtures/deployment-v2-bind.json")
	if e != nil {
		t.Fatal(e)
	}
	var v struct {
		ActualHex string
		Binding   DeploymentV2Bind
		WireHex   string
	}
	if e = json.Unmarshal(raw, &v); e != nil {
		t.Fatal(e)
	}
	actual, e := hex.DecodeString(v.ActualHex)
	if e != nil {
		t.Fatal(e)
	}
	b, e := BindDeploymentV2Bytes(actual)
	if e != nil || b != v.Binding {
		t.Fatal(b, e)
	}
	w, e := EncodeDeploymentV2Bind(b)
	if e != nil || hex.EncodeToString(w) != v.WireHex {
		t.Fatal("cross-language Bind", e)
	}
}

type deploymentVector struct {
	Domain     string
	ActualHex  string
	Manifest   DeploymentManifestV2
	PayloadHex string
	Binding    DeploymentV2Bind
}

func deploymentFixture(t *testing.T) deploymentVector {
	t.Helper()
	raw, e := os.ReadFile("../test/fixtures/deployment-v2-manifest.json")
	if e != nil {
		t.Fatal(e)
	}
	var v deploymentVector
	if e = json.Unmarshal(raw, &v); e != nil {
		t.Fatal(e)
	}
	return v
}
func TestDeploymentV2ManifestNormalConsumerAndVector(t *testing.T) {
	v := deploymentFixture(t)
	actual, e := hex.DecodeString(v.ActualHex)
	if e != nil {
		t.Fatal(e)
	}
	built, e := CreateDeploymentManifestV2DATA(v.Manifest, actual)
	if e != nil {
		t.Fatal(e)
	}
	if v.Domain != DeploymentManifestV2Domain || hex.EncodeToString(built.PayloadOriginal) != v.PayloadHex || built.Binding != v.Binding {
		t.Fatal("Go/TS golden payload or full Bind")
	}
	m, e := DecodeDeploymentManifestV2DATA(built.PayloadOriginal, &v.Binding)
	if e != nil || m != v.Manifest {
		t.Fatal("decode", m, e)
	}
	if m.PublisherEpoch == m.Publisher.Rev || m.Issuer.Tenant == m.Tenant {
		t.Fatal("fixture must exercise independent epoch and issuer")
	}
	if b, e := AssertDeploymentArtifactV2DATA(built.PayloadOriginal, actual); e != nil || b != m.Artifact.Content {
		t.Fatal("actual readback", e)
	}
	if _, e = AssertDeploymentArtifactV2DATA(built.PayloadOriginal, append(bytes.Clone(actual), 0)); e == nil {
		t.Fatal("changed artifact accepted")
	}
	f, _ := DecodeFields(built.PayloadOriginal, 11)
	f[6] = []byte("preview")
	changed, _ := EncodeFields(f...)
	if _, e = DecodeDeploymentManifestV2DATA(changed, nil); e != nil {
		t.Fatal("DATA can encode another env", e)
	}
	if _, e = DecodeDeploymentManifestV2DATA(changed, &v.Binding); e == nil {
		t.Fatal("independent binding ignored")
	}
}
func TestDeploymentV2ManifestInvalidProfile(t *testing.T) {
	v := deploymentFixture(t)
	actual, _ := hex.DecodeString(v.ActualHex)
	cases := []func(*DeploymentManifestV2){
		func(m *DeploymentManifestV2) { m.Project.Tenant = "other" }, func(m *DeploymentManifestV2) { m.Artifact.Ref.Realm = "other" }, func(m *DeploymentManifestV2) { m.Publisher.Tenant = "other" }, func(m *DeploymentManifestV2) { m.Version = "09" }, func(m *DeploymentManifestV2) { m.PublisherEpoch = "18446744073709551616" }, func(m *DeploymentManifestV2) { m.Artifact.Size = "0" }, func(m *DeploymentManifestV2) { m.Artifact.Size = "67108865"; m.Artifact.Content.Bytes = "67108865" }, func(m *DeploymentManifestV2) { m.Artifact.ObjectKey = "https://example.invalid/x" }, func(m *DeploymentManifestV2) { m.Artifact.MIME = "text/☃" }, func(m *DeploymentManifestV2) { m.Env = " staging" }, func(m *DeploymentManifestV2) { m.Project.ID = string([]byte{0xc0, 0x80}) }, func(m *DeploymentManifestV2) { m.Tenant = strings.Repeat("é", 129) }, func(m *DeploymentManifestV2) { m.Artifact.Content.SHA512 = strings.Repeat("0", 128) },
	}
	for i, mutate := range cases {
		m := v.Manifest
		mutate(&m)
		if _, e := CreateDeploymentManifestV2DATA(m, actual); e == nil {
			t.Fatalf("bad DTO %d", i)
		}
	}
	wire, _ := hex.DecodeString(v.PayloadHex)
	for _, bad := range [][]byte{append(bytes.Clone(wire), 0), make([]byte, 16385), []byte(`{"projectId":"old","version":"1","contentDigest":"old","publishPurpose":"deploy","targetEnvironment":"staging","byteSize":25}`)} {
		if _, e := DecodeDeploymentManifestV2DATA(bad, nil); e == nil {
			t.Fatal("bad WIRE accepted")
		}
	}
	f, _ := DecodeFields(wire, 11)
	f[0] = []byte("YNX-IDE-ARTIFACT-RELEASE-RESULT/v1")
	bad, _ := EncodeFields(f...)
	if _, e := DecodeDeploymentManifestV2DATA(bad, nil); e == nil {
		t.Fatal("old domain")
	}
	f, _ = DecodeFields(wire, 11)
	f[4] = make([]byte, 7)
	bad, _ = EncodeFields(f...)
	if _, e := DecodeDeploymentManifestV2DATA(bad, nil); e == nil {
		t.Fatal("width")
	}
	f, _ = DecodeFields(wire, 11)
	f[3], f[7] = f[7], f[3]
	bad, _ = EncodeFields(f...)
	if _, e := DecodeDeploymentManifestV2DATA(bad, &v.Binding); e == nil {
		t.Fatal("selected full ref swap")
	}
}
