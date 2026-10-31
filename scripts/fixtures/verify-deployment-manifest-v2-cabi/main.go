// CI mathematical fixture only. Synthetic DER is private temporary test
// material, never a protected Native publisher, Auth Source or approval.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"

	batch "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const sdkCommit = "a7bfd7800a1e1f30f7bcb358ccb069249a545c1d"
const sdkVectorSHA = "bfff21c8195e2c1a81d46060caa04e73f756b1cb2a1dc164813aa9c6a6b86ecb"
const cExpectedCases = 54

var privateNames = []string{"SYNTHETIC-ONLY-a.der", "SYNTHETIC-ONLY-b.der"}
var variantNames = []string{"publisher-fullref", "publisher-epoch", "issuer-fullref", "issuer-epoch"}

type publicPin struct {
	Bytes  int    `json:"bytes"`
	SHA256 string `json:"sha256"`
}

func pin(raw []byte) publicPin {
	h := sha256.Sum256(raw)
	return publicPin{len(raw), hex.EncodeToString(h[:])}
}

type fileIdentity struct {
	Bytes  int64  `json:"bytes"`
	Device uint64 `json:"device"`
	Inode  uint64 `json:"inode"`
	Mode   uint32 `json:"mode"`
}

func identity(info os.FileInfo) (fileIdentity, error) {
	s, ok := info.Sys().(*syscall.Stat_t)
	if !ok || !info.Mode().IsRegular() || s.Nlink != 1 || s.Uid != uint32(os.Geteuid()) || info.Mode().Perm() != 0600 {
		return fileIdentity{}, errors.New("owned regular 0600 fixture required")
	}
	return fileIdentity{info.Size(), uint64(s.Dev), uint64(s.Ino), uint32(info.Mode().Perm())}, nil
}
func writeNew(path string, raw []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	if n, e := f.Write(raw); e != nil {
		return e
	} else if n != len(raw) {
		return io.ErrShortWrite
	}
	if err = f.Sync(); err != nil {
		return err
	}
	d, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
func writePrivate(directory, name string, raw []byte, owned map[string]fileIdentity) (err error) {
	f, err := os.OpenFile(filepath.Join(directory, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	// Capture the exact newly created inode even if a later write is partial.
	// An open/metadata failure never permits deleting an unknown existing leaf.
	defer func() {
		if info, e := f.Stat(); e == nil {
			if row, e := identity(info); e == nil {
				owned[name] = row
			}
		}
	}()
	if n, e := f.Write(raw); e != nil {
		return e
	} else if n != len(raw) {
		return io.ErrShortWrite
	}
	return f.Sync()
}
func readBounded(path string, minimum, maximum int) ([]byte, error) {
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if _, err = identity(info); err != nil {
		return nil, err
	}
	if info.Size() < int64(minimum) || info.Size() > int64(maximum) {
		return nil, errors.New("bounded fixture size required")
	}
	raw, err := io.ReadAll(io.LimitReader(f, int64(maximum)+1))
	if err != nil {
		return nil, err
	}
	if len(raw) != int(info.Size()) {
		return nil, errors.New("fixture changed during read")
	}
	return raw, nil
}
func strictJSON(raw []byte, value any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return errors.New("single closed JSON value required")
	}
	return nil
}
func sdkVector(path string) (artifact, payload []byte, manifest batch.DeploymentManifestV2, binding batch.DeploymentV2Bind, err error) {
	raw, err := readBounded(path, 3139, 3139)
	if err != nil {
		return nil, nil, manifest, binding, err
	}
	if pin(raw).SHA256 != sdkVectorSHA {
		return nil, nil, manifest, binding, errors.New("exact frozen SDK fixture pin differs")
	}
	var v struct {
		Domain     string                     `json:"domain"`
		ActualHex  string                     `json:"actualHex"`
		Manifest   batch.DeploymentManifestV2 `json:"manifest"`
		PayloadHex string                     `json:"payloadHex"`
		Binding    batch.DeploymentV2Bind     `json:"binding"`
	}
	if err = strictJSON(raw, &v); err != nil {
		return nil, nil, manifest, binding, err
	}
	if v.Domain != batch.DeploymentManifestV2Domain {
		return nil, nil, manifest, binding, errors.New("SDK E11 domain differs")
	}
	artifact, err = hex.DecodeString(v.ActualHex)
	if err != nil {
		return nil, nil, manifest, binding, err
	}
	payload, err = hex.DecodeString(v.PayloadHex)
	if err != nil {
		return nil, nil, manifest, binding, err
	}
	created, err := batch.CreateDeploymentManifestV2DATA(v.Manifest, artifact)
	if err != nil {
		return nil, nil, manifest, binding, err
	}
	if !bytes.Equal(created.PayloadOriginal, payload) || created.Binding != v.Binding {
		return nil, nil, manifest, binding, errors.New("original SDK vector and actual typed codec differ")
	}
	return artifact, payload, v.Manifest, v.Binding, nil
}
func selected(a, b, payload []byte, payloadBind, artifactBind batch.DeploymentV2Bind) batch.DeploymentManifestV2SigningBinding {
	return batch.DeploymentManifestV2SigningBinding{NetworkID: bytes.Repeat([]byte{0x42}, 32), SubjectOwner: "PUBLIC-ONLY-E11-PUBLISHER", PKA: bytes.Clone(a), PKB: bytes.Clone(b), PayloadOriginal: bytes.Clone(payload), PayloadBind: payloadBind, ArtifactBind: artifactBind}
}
func signed(key *batch.PrivateKey, b batch.DeploymentManifestV2SigningBinding, purpose string, n int) ([]byte, error) {
	messages := make([][]byte, n)
	for i := range messages {
		messages[i] = bytes.Clone(b.PayloadOriginal)
	}
	s, err := batch.BatchSign(key, batch.Metadata{ChainID: b.NetworkID, Owner: b.SubjectOwner, Purpose: purpose}, messages, batch.SignOptions{Optimized: true})
	if err != nil {
		return nil, err
	}
	defer s.Discard()
	m, err := batch.Extract(s, 0)
	if err != nil {
		return nil, err
	}
	return batch.EncodeMember(m)
}
func mutateManifest(m *batch.DeploymentManifestV2, which string) {
	switch which {
	case "publisher-fullref":
		m.Publisher.ID = "different/publisher"
	case "publisher-epoch":
		m.PublisherEpoch = "4"
	case "issuer-fullref":
		m.Issuer.Realm = "different authority realm"
	case "issuer-epoch":
		m.IssuerEpoch = "12"
	default:
		panic("closed fixture variant")
	}
}

type materialCatalog struct {
	Version       string                  `json:"version"`
	SyntheticOnly bool                    `json:"syntheticOnly"`
	Public        map[string]publicPin    `json:"public"`
	Private       map[string]fileIdentity `json:"privateFixtureFiles"`
}

func generate(directory, vectorPath string) (err error) {
	artifact, payload, manifest, payloadBind, err := sdkVector(vectorPath)
	if err != nil {
		return err
	}
	if err = os.Mkdir(directory, 0700); err != nil {
		return err
	}
	owned := map[string]fileIdentity{}
	defer func() {
		if err != nil {
			for name, want := range owned {
				path := filepath.Join(directory, name)
				info, e := os.Lstat(path)
				if e == nil {
					got, e := identity(info)
					if e == nil && got == want {
						_ = os.Remove(path)
					}
				}
			}
		}
	}()
	key, pub, err := batch.KeyGen()
	if err != nil {
		return err
	}
	defer key.Destroy()
	mat, err := batch.ExportKeyMaterial(key)
	if err != nil {
		return err
	}
	defer mat.Clear()
	b := selected(pub.PKA, pub.PKB, payload, payloadBind, manifest.Artifact.Content)
	data := map[string][]byte{"payloadOriginal.bin": payload, "artifact.bin": artifact, "pk-a.bin": pub.PKA, "pk-b.bin": pub.PKB}
	data["payload-bind.bin"], err = batch.EncodeDeploymentV2Bind(payloadBind)
	if err != nil {
		return err
	}
	data["artifact-bind.bin"], err = batch.EncodeDeploymentV2Bind(manifest.Artifact.Content)
	if err != nil {
		return err
	}
	for _, which := range variantNames {
		m := manifest
		mutateManifest(&m, which)
		v, e := batch.CreateDeploymentManifestV2DATA(m, artifact)
		if e != nil {
			return e
		}
		data["expected-"+which+".bin"] = v.PayloadOriginal
		data["expected-"+which+"-bind.bin"], err = batch.EncodeDeploymentV2Bind(v.Binding)
		if err != nil {
			return err
		}
	}
	empty := manifest
	empty.Artifact.Content, err = batch.BindDeploymentV2Bytes(nil)
	if err != nil {
		return err
	}
	empty.Artifact.Size = "0"
	emptyData, err := batch.CreateDeploymentManifestV2DATA(empty, nil)
	if err != nil {
		return err
	}
	data["empty-payload.bin"] = emptyData.PayloadOriginal
	data["empty-payload-bind.bin"], err = batch.EncodeDeploymentV2Bind(emptyData.Binding)
	if err != nil {
		return err
	}
	data["empty-artifact-bind.bin"], err = batch.EncodeDeploymentV2Bind(empty.Artifact.Content)
	if err != nil {
		return err
	}
	data["valid-other-purpose.bin"], err = signed(key, b, batch.ArtifactPublicationPurpose, 1)
	if err != nil {
		return err
	}
	data["valid-n2.bin"], err = signed(key, b, batch.DeploymentManifestV2Purpose, 2)
	if err != nil {
		return err
	}
	catalog := materialCatalog{Version: "YNX-DEPLOYMENT-V2-CABI-SYNTHETIC-MATERIAL/v1", SyntheticOnly: true, Public: map[string]publicPin{}, Private: owned}
	for name, raw := range data {
		if err = writeNew(filepath.Join(directory, name), raw); err != nil {
			return err
		}
		catalog.Public[name] = pin(raw)
	}
	for i, raw := range [][]byte{mat.PKCS8A, mat.PKCS8B} {
		if err = writePrivate(directory, privateNames[i], raw, owned); err != nil {
			return err
		}
	}
	raw, err := json.Marshal(catalog)
	if err != nil {
		return err
	}
	if err = writeNew(filepath.Join(directory, "MATERIAL.json"), append(raw, '\n')); err != nil {
		return err
	}
	fmt.Println("YNX_DEPLOYMENT_V2_SYNTHETIC_INPUT_READY sdkPinned=true noSource=true privateUpload=false")
	return nil
}
func readCatalog(directory string) (materialCatalog, error) {
	var c materialCatalog
	raw, err := readBounded(filepath.Join(directory, "MATERIAL.json"), 1, 16384)
	if err != nil {
		return c, err
	}
	if err = strictJSON(raw, &c); err != nil {
		return c, err
	}
	if c.Version != "YNX-DEPLOYMENT-V2-CABI-SYNTHETIC-MATERIAL/v1" || !c.SyntheticOnly || len(c.Private) != 2 {
		return c, errors.New("closed synthetic ownership catalog required")
	}
	for _, name := range privateNames {
		if _, ok := c.Private[name]; !ok {
			return c, errors.New("fixed private ownership missing")
		}
	}
	return c, nil
}
func cleanup(directory string) error {
	c, err := readCatalog(directory)
	if err != nil {
		return err
	}
	removed := 0
	for _, name := range privateNames {
		path := filepath.Join(directory, name)
		info, e := os.Lstat(path)
		if errors.Is(e, os.ErrNotExist) {
			continue
		}
		if e != nil {
			return e
		}
		got, e := identity(info)
		if e != nil {
			return e
		}
		if got != c.Private[name] {
			return errors.New("changed synthetic DER retained")
		}
		if e = os.Remove(path); e != nil {
			return e
		}
		removed++
	}
	fmt.Printf("YNX_DEPLOYMENT_V2_SYNTHETIC_DER_ABSENT remaining=0 newlyRemoved=%d physicalEraseClaimed=false\n", removed)
	return nil
}
func mathVerifier(b batch.DeploymentManifestV2SigningBinding, purpose string) (*batch.Verifier, error) {
	return batch.NewVerifier(batch.VerifierOptions{ChainID: b.NetworkID, Purpose: purpose, Optimized: true, ResolveTrustedOwner: func(r batch.TrustRequest) (batch.Registration, error) {
		if !bytes.Equal(r.ChainID, b.NetworkID) || r.Owner != b.SubjectOwner || r.Purpose != purpose || r.Height != 0 {
			return batch.Registration{}, errors.New("synthetic math context differs")
		}
		return batch.Registration{AlgorithmVersion: batch.Version, ChainID: bytes.Clone(b.NetworkID), Owner: b.SubjectOwner, Purpose: purpose, PKA: bytes.Clone(b.PKA), PKB: bytes.Clone(b.PKB), PolicyRevision: "PUBLIC-SYNTHETIC-E11-MATH-ONLY", Enabled: true}, nil
	}})
}

type checkedCase struct {
	Name     string `json:"name"`
	Rejected bool   `json:"rejected"`
}

func verify(input, output, vectorPath string) error {
	artifact, payload, manifest, payloadBind, err := sdkVector(vectorPath)
	if err != nil {
		return err
	}
	catalog, err := readCatalog(input)
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(input)
	if err != nil {
		return err
	}
	want := map[string]bool{"MATERIAL.json": true}
	for name := range catalog.Public {
		want[name] = true
	}
	for _, name := range privateNames {
		want[name] = true
	}
	if len(entries) != len(want) {
		return errors.New("closed material catalog differs")
	}
	for _, entry := range entries {
		if !want[entry.Name()] || entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return errors.New("unknown input leaf retained")
		}
	}
	for name, expected := range catalog.Public {
		raw, e := readBounded(filepath.Join(input, name), 1, batch.MaxMemberBytes)
		if e != nil {
			return e
		}
		if pin(raw) != expected {
			return errors.New("public synthetic input changed")
		}
	}
	a, err := readBounded(filepath.Join(input, "pk-a.bin"), batch.PublicKeyASize, batch.PublicKeyASize)
	if err != nil {
		return err
	}
	z, err := readBounded(filepath.Join(input, "pk-b.bin"), batch.PublicKeyBSize, batch.PublicKeyBSize)
	if err != nil {
		return err
	}
	b := selected(a, z, payload, payloadBind, manifest.Artifact.Content)
	wire, err := readBounded(filepath.Join(output, "memberOriginal.bin"), 1, batch.MaxMemberBytes)
	if err != nil {
		return err
	}
	wire2, err := readBounded(filepath.Join(output, "memberOriginal-second.bin"), 1, batch.MaxMemberBytes)
	if err != nil {
		return err
	}
	v, err := mathVerifier(b, batch.DeploymentManifestV2Purpose)
	if err != nil {
		return err
	}
	defer v.Clear()
	for _, raw := range [][]byte{wire, wire2} {
		if err = v.VerifyOne(raw, 0); err != nil {
			return errors.New("actual C member failed independent original dual AND verifier")
		}
		if _, err = batch.InspectDeploymentManifestV2Member(raw, b); err != nil {
			return err
		}
		if err = batch.VerifyDeploymentManifestV2Member(raw, b); err != nil {
			return err
		}
	}
	if bytes.Equal(wire, wire2) {
		return errors.New("distinct C calls reused complete randomized member")
	}
	cases := []checkedCase{}
	reject := func(name string, failure error) error {
		if failure == nil {
			return errors.New("negative accepted: " + name)
		}
		cases = append(cases, checkedCase{name, true})
		return nil
	}
	change := func(fn func(*batch.Member)) ([]byte, error) {
		m, e := batch.DecodeMember(wire)
		if e != nil {
			return nil, e
		}
		fn(&m)
		return batch.EncodeMember(m)
	}
	for _, branch := range []string{"A", "B"} {
		bad, e := change(func(m *batch.Member) {
			if branch == "A" {
				m.Certificate.SigmaA[0] ^= 1
			} else {
				m.Certificate.SigmaB[0] ^= 1
			}
		})
		if e != nil {
			return e
		}
		if _, e = batch.InspectDeploymentManifestV2Member(bad, b); e != nil {
			return e
		}
		if e = reject("signature-"+branch, v.VerifyOne(bad, 0)); e != nil {
			return e
		}
	}
	for _, purpose := range []string{batch.ArtifactPublicationPurpose, "TX-BATCH", "CONSENSUS-VOTE"} {
		bad, e := change(func(m *batch.Member) { m.Certificate.Purpose = purpose })
		if e != nil {
			return e
		}
		_, e = batch.InspectDeploymentManifestV2Member(bad, b)
		if e = reject("typed-purpose-"+purpose, e); e != nil {
			return e
		}
		if e = reject("math-purpose-"+purpose, v.VerifyOne(bad, 0)); e != nil {
			return e
		}
	}
	for _, which := range variantNames {
		m := manifest
		mutateManifest(&m, which)
		d, e := batch.CreateDeploymentManifestV2DATA(m, artifact)
		if e != nil {
			return e
		}
		other := b
		other.PayloadOriginal, other.PayloadBind = d.PayloadOriginal, d.Binding
		_, e = batch.InspectDeploymentManifestV2Member(wire, other)
		if e = reject("independent-expected-"+which, e); e != nil {
			return e
		}
	}
	flipHex := func(s string) string {
		c := byte('0')
		if s[0] == '0' {
			c = '1'
		}
		return string(c) + s[1:]
	}
	for _, which := range []string{"network", "subject", "public-A", "public-B", "payload-bind", "artifact-bind"} {
		other := selected(a, z, payload, payloadBind, manifest.Artifact.Content)
		switch which {
		case "network":
			other.NetworkID[0] ^= 1
		case "subject":
			other.SubjectOwner = "OTHER-PUBLIC-LABEL"
		case "public-A":
			other.PKA[0] ^= 1
		case "public-B":
			other.PKB[0] ^= 1
		case "payload-bind":
			other.PayloadBind.SHA512 = flipHex(other.PayloadBind.SHA512)
		case "artifact-bind":
			other.ArtifactBind.SHA3_512 = flipHex(other.ArtifactBind.SHA3_512)
		}
		_, e := batch.InspectDeploymentManifestV2Member(wire, other)
		if e = reject("binding-"+which, e); e != nil {
			return e
		}
	}
	changedArtifact := bytes.Clone(artifact)
	changedArtifact[0] ^= 1
	_, e := batch.PrepareDeploymentManifestV2Signing(payload, changedArtifact, b)
	if e = reject("actual-artifact-bytes", e); e != nil {
		return e
	}
	for _, file := range []struct{ name, purpose string }{{"valid-other-purpose.bin", batch.ArtifactPublicationPurpose}, {"valid-n2.bin", batch.DeploymentManifestV2Purpose}} {
		raw, e := readBounded(filepath.Join(input, file.name), 1, batch.MaxMemberBytes)
		if e != nil {
			return e
		}
		mv, e := mathVerifier(b, file.purpose)
		if e != nil {
			return e
		}
		e = mv.VerifyOne(raw, 0)
		mv.Clear()
		if e != nil {
			return errors.New("valid mathematical negative fixture failed")
		}
		_, e = batch.InspectDeploymentManifestV2Member(raw, b)
		if e = reject("valid-math-wrong-profile-"+file.name, e); e != nil {
			return e
		}
	}
	m, err := batch.DecodeMember(wire)
	if err != nil {
		return err
	}
	cert, err := batch.EncodeCertificate(m.Certificate)
	if err != nil {
		return err
	}
	for _, p := range []struct {
		name  string
		index uint32
		path  [][]byte
	}{{"index-one", 1, nil}, {"nonempty-path", 0, [][]byte{make([]byte, 64)}}} {
		pa, e := batch.EncodeFields(p.path...)
		if e != nil {
			return e
		}
		pb, e := batch.EncodeFields()
		if e != nil {
			return e
		}
		proof, e := batch.EncodeFields(batch.U32(p.index), pa, pb)
		if e != nil {
			return e
		}
		bad, e := batch.EncodeFields([]byte(batch.Version+"/MEMBER"), cert, m.Message, proof)
		if e != nil {
			return e
		}
		_, e = batch.InspectDeploymentManifestV2Member(bad, b)
		if e = reject(p.name, e); e != nil {
			return e
		}
	}
	whole, err := batch.EncodeWhole(batch.Whole{Certificate: m.Certificate, Messages: [][]byte{m.Message}})
	if err != nil {
		return err
	}
	for _, p := range []struct {
		name string
		raw  []byte
	}{{"whole-not-member", whole}, {"trailing-byte", append(bytes.Clone(wire), 0)}, {"truncated", wire[:len(wire)-1]}} {
		_, e := batch.InspectDeploymentManifestV2Member(p.raw, b)
		if e = reject(p.name, e); e != nil {
			return e
		}
	}
	emptyPayload, err := readBounded(filepath.Join(input, "empty-payload.bin"), 1, batch.DeploymentManifestV2MaxBytes)
	if err != nil {
		return err
	}
	emptyBinding, err := batch.BindDeploymentV2Bytes(emptyPayload)
	if err != nil {
		return err
	}
	emptyArtifact, err := batch.BindDeploymentV2Bytes(nil)
	if err != nil {
		return err
	}
	empty := selected(a, z, emptyPayload, emptyBinding, emptyArtifact)
	emptyWire, err := readBounded(filepath.Join(output, "memberOriginal-empty.bin"), 1, batch.MaxMemberBytes)
	if err != nil {
		return err
	}
	if err = v.VerifyOne(emptyWire, 0); err != nil {
		return err
	}
	if _, err = batch.InspectDeploymentManifestV2Member(emptyWire, empty); err != nil {
		return err
	}
	if _, err = batch.PrepareDeploymentManifestV2Signing(emptyPayload, nil, empty); err != nil {
		return err
	}
	raw, err := readBounded(filepath.Join(output, "C-RESULT.json"), 1, 1024)
	if err != nil {
		return err
	}
	var c struct {
		Version            string `json:"version"`
		Cases              int    `json:"cases"`
		SyntheticOnly      bool   `json:"syntheticOnly"`
		LogicalCleanupOnly bool   `json:"logicalCleanupOnly"`
	}
	if err = strictJSON(raw, &c); err != nil {
		return err
	}
	if c.Version != "YNX-DEPLOYMENT-V2-CABI-C-RESULT/v1" || c.Cases != cExpectedCases || !c.SyntheticOnly || !c.LogicalCleanupOnly {
		return errors.New("complete actual C controls missing")
	}
	result := map[string]any{"version": "YNX-DEPLOYMENT-V2-CABI-PUBLIC-RESULT/v1", "sdkCommit": sdkCommit, "sdkVector": publicPin{3139, sdkVectorSHA}, "suite": batch.Suite, "protocol": batch.Version, "purpose": batch.DeploymentManifestV2Purpose, "domain": batch.DeploymentManifestV2Domain, "actualCABI": true, "independentDualANDVerified": true, "typedN1Inspected": true, "cCases": c.Cases, "goNegativeCases": cases, "syntheticOnly": true, "SourceAdmission": false, "RootAdmission": false, "publisherCurrent": false, "approvedE11": false, "physicalEraseClaimed": false,
		"publicPins": map[string]publicPin{"payloadOriginal": pin(payload), "artifact": pin(artifact), "memberOriginal": pin(wire), "secondMember": pin(wire2), "emptyMember": pin(emptyWire)}, "publicInterop": map[string]string{"payloadOriginalBase64": base64.StdEncoding.EncodeToString(payload), "actualArtifactBase64": base64.StdEncoding.EncodeToString(artifact), "pkABase64": base64.StdEncoding.EncodeToString(a), "pkBBase64": base64.StdEncoding.EncodeToString(z), "memberOriginalBase64": base64.StdEncoding.EncodeToString(wire), "networkIDBase64": base64.StdEncoding.EncodeToString(b.NetworkID), "subjectOwner": b.SubjectOwner}, "payloadBind": payloadBind, "artifactBind": manifest.Artifact.Content}
	raw, err = json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	if err = writeNew(filepath.Join(output, "PUBLIC-RESULT.json"), append(raw, '\n')); err != nil {
		return err
	}
	fmt.Printf("YNX_DEPLOYMENT_MANIFEST_V2_CABI_INTEROP_PASS cCases=%d goNegativeCases=%d actualCABI=true authority=false\n", c.Cases, len(cases))
	return nil
}
func main() {
	var err error
	switch {
	case len(os.Args) == 4 && os.Args[1] == "generate":
		err = generate(os.Args[2], os.Args[3])
	case len(os.Args) == 5 && os.Args[1] == "verify":
		err = verify(os.Args[2], os.Args[3], os.Args[4])
	case len(os.Args) == 3 && os.Args[1] == "cleanup":
		err = cleanup(os.Args[2])
	default:
		err = errors.New("usage: fixture generate NEW_INPUT SDK_VECTOR | verify INPUT OUTPUT SDK_VECTOR | cleanup INPUT")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "YNX_DEPLOYMENT_V2_CABI_FIXTURE_REFUSED:", err)
		os.Exit(1)
	}
}
