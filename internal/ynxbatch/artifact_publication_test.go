package ynxbatch

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
)

// All identities, labels and keys in this file are PUBLIC SYNTHETIC FIXTURES.
// No test supplies an Auth Source, registration issuer, approval or live ACL.
func artifactTestPublisher(p PublicKey) ArtifactPublisherRegistration {
	return ArtifactPublisherRegistration{NetworkID: bytes.Repeat([]byte{0x42}, 32), SubjectOwner: "0x" + strings.Repeat("11", 20),
		Account: "developer-synthetic-owner", ProjectID: "project-alpha", PublisherID: "publisher-alpha", PublisherKeyVersion: "1", PKA: clone(p.PKA), PKB: clone(p.PKB)}
}

func artifactTestManifest() []byte {
	return []byte(`{"byteSize":1,"contentDigest":"2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881","projectId":"project-alpha","publishPurpose":"release","targetEnvironment":"testnet","version":"1.0.0"}`)
}

func artifactTestFixedPublisher(t testing.TB) ArtifactPublisherRegistration {
	t.Helper()
	c, err := DecodeCertificate(b64(t, fixture(t).Certificate))
	requireNoError(t, err)
	return artifactTestPublisher(PublicKey{PKA: c.PKA, PKB: c.PKB})
}

// Deliberately independent of production EncodeFields for the golden E check.
func artifactTestFrame(values ...[]byte) []byte {
	var out bytes.Buffer
	_ = binary.Write(&out, binary.BigEndian, uint32(len(values)))
	for _, v := range values {
		_ = binary.Write(&out, binary.BigEndian, uint32(len(v)))
		_, _ = out.Write(v)
	}
	return out.Bytes()
}

func artifactTestSHA(raw []byte) string {
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:])
}

func TestArtifactPublicationExactPublicCodecAndGolden(t *testing.T) {
	r := artifactTestFixedPublisher(t)
	raw, err := EncodeArtifactPublisherRegistration(r)
	requireNoError(t, err)
	wantR := artifactTestFrame([]byte("YNX-IDE-ARTIFACT-PUBLISHER/v1"), []byte("YNX-BATCH/v0.1"), []byte("ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512"),
		[]byte("ARTIFACT-RELEASE"), []byte("ide-artifact-publisher"), r.NetworkID, []byte(r.SubjectOwner), []byte(r.Account), []byte(r.ProjectID), []byte(r.PublisherID), []byte("1"), r.PKA, r.PKB)
	same(t, raw, wantR)
	if len(raw) != 2969 || artifactTestSHA(raw) != "8535b3944107cdd499cdc311e324426d3139e295661b26a0116600fa2a690fae" {
		t.Fatal("independent public R golden changed")
	}
	publicSHA, err := ArtifactPublisherPublicSHA256(raw)
	requireNoError(t, err)
	if publicSHA != artifactTestSHA(raw) {
		t.Fatal("public R digest did not identify exact bytes")
	}
	decoded, err := DecodeArtifactPublisherRegistration(raw)
	requireNoError(t, err)
	roundTrip, err := EncodeArtifactPublisherRegistration(decoded)
	requireNoError(t, err)
	same(t, roundTrip, raw)
	manifest := artifactTestManifest()
	m, err := ParseArtifactPublicationManifest(manifest)
	requireNoError(t, err)
	if m.ByteSize != 1 || m.ContentDigest != artifactTestSHA([]byte("x")) || m.ProjectID != r.ProjectID {
		t.Fatal("golden manifest does not bind its actual public content")
	}
	message, err := BuildArtifactPublicationMessage(raw, manifest, r)
	requireNoError(t, err)
	same(t, message, artifactTestFrame([]byte("YNX-IDE-ARTIFACT-RELEASE/v1"), raw, manifest))
	if len(message) != 3212 || artifactTestSHA(message) != "b53ee323c4c6945b74d65bc6d300ed62ce65f8c054515de649d2662e8eeb46f6" || artifactTestSHA(manifest) != "9ea04b9e0faa18a2d79ff368da49c4b19195b87e4b2e26d51fb7cf98bb5dd423" {
		t.Fatal("independent original M/manifest golden changed")
	}
	inspected, err := InspectArtifactPublicationMessage(message, r, manifest)
	requireNoError(t, err)
	same(t, inspected.RegistrationOriginal, raw)
	same(t, inspected.ManifestOriginal, manifest)
	// No retained alias can rewrite the original input or a later decode.
	inspected.Publisher.PKA[0] ^= 1
	inspected.Publisher.PKB[0] ^= 1
	inspected.Publisher.NetworkID[0] ^= 1
	inspected.RegistrationOriginal[0] ^= 1
	inspected.ManifestOriginal[0] ^= 1
	same(t, raw, wantR)
	requireNoError(t, func() error { _, e := InspectArtifactPublicationMessage(message, r, manifest); return e }())
	t.Logf("ARTIFACT_PUBLICATION_FIXED_GOLDEN registrationBytes=%d registrationSHA256=%s manifestBytes=%d manifestSHA256=%s messageBytes=%d messageSHA256=%s", len(raw), publicSHA, len(manifest), artifactTestSHA(manifest), len(message), artifactTestSHA(message))
}

func TestArtifactPublicationRegistrationAndExpectedBindingRejects(t *testing.T) {
	r := artifactTestFixedPublisher(t)
	raw, err := EncodeArtifactPublisherRegistration(r)
	requireNoError(t, err)
	for _, tc := range []struct {
		name string
		edit func(*ArtifactPublisherRegistration)
	}{
		{"short network", func(x *ArtifactPublisherRegistration) { x.NetworkID = x.NetworkID[:31] }},
		{"unicode subject", func(x *ArtifactPublisherRegistration) { x.SubjectOwner = "发布者" }},
		{"upper subject", func(x *ArtifactPublisherRegistration) { x.SubjectOwner = "0x" + strings.Repeat("AB", 20) }},
		{"empty account", func(x *ArtifactPublisherRegistration) { x.Account = "" }},
		{"account inner space", func(x *ArtifactPublisherRegistration) { x.Account = "owner account" }},
		{"project control", func(x *ArtifactPublisherRegistration) { x.ProjectID = "project\x7f" }},
		{"publisher invalid UTF8", func(x *ArtifactPublisherRegistration) { x.PublisherID = string([]byte{0xff}) }},
		{"publisher byte cap", func(x *ArtifactPublisherRegistration) { x.PublisherID = strings.Repeat("发", 86) }},
		{"zero version", func(x *ArtifactPublisherRegistration) { x.PublisherKeyVersion = "0" }},
		{"padded version", func(x *ArtifactPublisherRegistration) { x.PublisherKeyVersion = "01" }},
		{"signed version", func(x *ArtifactPublisherRegistration) { x.PublisherKeyVersion = "+1" }},
		{"negative version", func(x *ArtifactPublisherRegistration) { x.PublisherKeyVersion = "-1" }},
		{"overflow version", func(x *ArtifactPublisherRegistration) { x.PublisherKeyVersion = "18446744073709551616" }},
		{"short A", func(x *ArtifactPublisherRegistration) { x.PKA = x.PKA[:PublicKeyASize-1] }},
		{"short B", func(x *ArtifactPublisherRegistration) { x.PKB = x.PKB[:PublicKeyBSize-1] }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			x, e := DecodeArtifactPublisherRegistration(raw)
			requireNoError(t, e)
			tc.edit(&x)
			_, e = EncodeArtifactPublisherRegistration(x)
			requireError(t, e)
		})
	}
	maxVersion := r
	maxVersion.PublisherKeyVersion = "18446744073709551615"
	_, err = EncodeArtifactPublisherRegistration(maxVersion)
	requireNoError(t, err)
	unicodeID := r
	unicodeID.Account, unicodeID.PublisherID = "开发者", strings.Repeat("发", 85)+"x"
	_, err = EncodeArtifactPublisherRegistration(unicodeID)
	requireNoError(t, err) // Public IDs need not fit the Batch ASCII Owner label.

	f, err := DecodeFields(raw, 13, MaxArtifactPublisherBytes)
	requireNoError(t, err)
	for _, index := range []int{0, 1, 2, 3, 4} {
		changed, e := DecodeFields(raw, 13, MaxArtifactPublisherBytes)
		requireNoError(t, e)
		changed[index] = []byte("OTHER")
		bad, e := EncodeFields(changed...)
		requireNoError(t, e)
		_, e = DecodeArtifactPublisherRegistration(bad)
		requireError(t, e)
	}
	f[7], f[8] = f[8], f[7]
	swapped, err := EncodeFields(f...)
	requireNoError(t, err)
	_, err = BuildArtifactPublicationMessage(swapped, artifactTestManifest(), r)
	requireError(t, err)
	for _, bad := range [][]byte{append(clone(raw), 0), raw[:len(raw)-1], append([]byte{0, 0, 0, 12}, raw[4:]...), bytes.Repeat([]byte{'x'}, MaxArtifactPublisherBytes+1)} {
		_, e := DecodeArtifactPublisherRegistration(bad)
		requireError(t, e)
		_, e = ArtifactPublisherPublicSHA256(bad)
		requireError(t, e)
	}
	for _, tc := range []struct {
		name string
		edit func(*ArtifactPublisherRegistration)
	}{
		{"network", func(x *ArtifactPublisherRegistration) { x.NetworkID[0] ^= 1 }},
		{"subject", func(x *ArtifactPublisherRegistration) { x.SubjectOwner = "0x" + strings.Repeat("22", 20) }},
		{"account", func(x *ArtifactPublisherRegistration) { x.Account = "other-owner" }},
		{"project", func(x *ArtifactPublisherRegistration) { x.ProjectID = "project-beta" }},
		{"publisher", func(x *ArtifactPublisherRegistration) { x.PublisherID = "publisher-beta" }},
		{"key version", func(x *ArtifactPublisherRegistration) { x.PublisherKeyVersion = "2" }},
		{"A", func(x *ArtifactPublisherRegistration) { x.PKA[0] ^= 1 }},
		{"B", func(x *ArtifactPublisherRegistration) { x.PKB[0] ^= 1 }},
	} {
		t.Run("expected "+tc.name, func(t *testing.T) {
			x, e := DecodeArtifactPublisherRegistration(raw)
			requireNoError(t, e)
			tc.edit(&x)
			_, e = BuildArtifactPublicationMessage(raw, artifactTestManifest(), x)
			requireError(t, e)
		})
	}
	otherProject := r
	otherProject.ProjectID = "project-beta"
	otherR, err := EncodeArtifactPublisherRegistration(otherProject)
	requireNoError(t, err)
	_, err = BuildArtifactPublicationMessage(otherR, artifactTestManifest(), otherProject)
	requireError(t, err) // Matching R/expected still cannot sign another project.
}

func TestArtifactPublicationManifestOriginalR159Strict(t *testing.T) {
	good := string(artifactTestManifest())
	for name, bad := range map[string]string{
		"bool":                     strings.Replace(good, `"byteSize":1`, `"byteSize":true`, 1),
		"float":                    strings.Replace(good, `"byteSize":1`, `"byteSize":1.0`, 1),
		"exponent":                 strings.Replace(good, `"byteSize":1`, `"byteSize":1e0`, 1),
		"zero":                     strings.Replace(good, `"byteSize":1`, `"byteSize":0`, 1),
		"negative":                 strings.Replace(good, `"byteSize":1`, `"byteSize":-1`, 1),
		"too large":                strings.Replace(good, `"byteSize":1`, `"byteSize":67108865`, 1),
		"null size":                strings.Replace(good, `"byteSize":1`, `"byteSize":null`, 1),
		"string size":              strings.Replace(good, `"byteSize":1`, `"byteSize":"1"`, 1),
		"unknown self key":         strings.TrimSuffix(good, "}") + `,"publicKey":"self"}`,
		"duplicate":                strings.Replace(good, `"byteSize":1`, `"byteSize":1,"byteSize":1`, 1),
		"escaped duplicate":        strings.Replace(good, `"byteSize":1`, `"byteSize":1,"byte\u0053ize":1`, 1),
		"missing":                  strings.Replace(good, `,"version":"1.0.0"`, "", 1),
		"upper hash":               strings.Replace(good, "2d711642", "2D711642", 1),
		"trailing whitespace":      good + "\n",
		"trailing object":          good + "{}",
		"BOM":                      "\ufeff" + good,
		"leading whitespace":       " " + good,
		"value leading whitespace": strings.Replace(good, `"release"`, `" release"`, 1),
		"control":                  strings.Replace(good, `"release"`, `"re\nlease"`, 1),
		"C1 control":               strings.Replace(good, `"release"`, "\"re\u0085lease\"", 1),
		"format control":           strings.Replace(good, `"release"`, "\"re\u200blease\"", 1),
		"escaped ordinary value":   strings.Replace(good, `"release"`, `"releas\u0065"`, 1),
		"escaped field":            strings.Replace(good, `"byteSize"`, `"byte\u0053ize"`, 1),
		"null text":                strings.Replace(good, `"release"`, `null`, 1),
		"unpaired surrogate":       strings.Replace(good, `"release"`, `"\ud800"`, 1),
		"non UTF8":                 strings.Replace(good, `"release"`, "\"\xff\"", 1),
		"long text":                strings.Replace(good, `"release"`, strconv.Quote(strings.Repeat("发", 86)), 1),
	} {
		t.Run(name, func(t *testing.T) { _, e := ParseArtifactPublicationManifest([]byte(bad)); requireError(t, e) })
	}
	for _, value := range []string{"实际发布", "release/internal", "release <>&", `release "quoted" \`, "release\u2028internal", strings.Repeat("x", 256), strings.Repeat("发", 85) + "x"} {
		// Test construction uses this explicit JSON scalar encoder only; input
		// remains exact raw bytes and never passes through production reserialization.
		quoted := artifactJSONString(nil, value)
		raw := []byte(strings.Replace(good, `"release"`, string(quoted), 1))
		parsed, err := ParseArtifactPublicationManifest(raw)
		requireNoError(t, err)
		if parsed.PublishPurpose != value {
			t.Fatal("valid UTF8 text changed")
		}
	}
	maxSize := []byte(strings.Replace(good, `"byteSize":1`, `"byteSize":67108864`, 1))
	_, err := ParseArtifactPublicationManifest(maxSize)
	requireNoError(t, err)
	_, err = ParseArtifactPublicationManifest(bytes.Repeat([]byte{'x'}, MaxArtifactManifestBytes+1))
	requireError(t, err)
	// Business purpose/target are signed fields, never cryptographic-domain selectors.
	_, err = ParseArtifactPublicationManifest([]byte(strings.Replace(good, `"release"`, `"AUTH-PROTECTED-KEY-CALL"`, 1)))
	requireNoError(t, err)
}

func TestArtifactPublicationN1ActualDualANDAndPublicVector(t *testing.T) {
	key, public, err := KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	r := artifactTestPublisher(public)
	rawR, err := EncodeArtifactPublisherRegistration(r)
	requireNoError(t, err)
	manifest := artifactTestManifest()
	message, err := BuildArtifactPublicationMessage(rawR, manifest, r)
	requireNoError(t, err)
	metadata := Metadata{ChainID: r.NetworkID, Owner: r.SubjectOwner, Purpose: ArtifactPublicationPurpose}
	batch, err := BatchSign(key, metadata, [][]byte{message}, SignOptions{Optimized: true})
	requireNoError(t, err)
	defer batch.Discard()
	member, err := Extract(batch, 0)
	requireNoError(t, err)
	wire, err := EncodeMember(member)
	requireNoError(t, err)
	_, err = InspectArtifactPublicationMember(wire, r, manifest)
	requireNoError(t, err)
	// Explicit public test resolver only. This exercises the original math,
	// not a production Auth adapter, chain registration or publisher authority.
	reg := Registration{AlgorithmVersion: Version, ChainID: clone(r.NetworkID), Owner: r.SubjectOwner, Purpose: ArtifactPublicationPurpose,
		PKA: clone(public.PKA), PKB: clone(public.PKB), PolicyRevision: "public-synthetic-artifact-fixture", Enabled: true, ActiveFrom: 0}
	v := verifier(t, &reg, 2, true)
	requireNoError(t, v.VerifyOne(wire, 0))
	for _, branch := range []string{"A", "B"} {
		bad, e := DecodeMember(wire)
		requireNoError(t, e)
		if branch == "A" {
			bad.Certificate.SigmaA[0] ^= 1
		} else {
			bad.Certificate.SigmaB[0] ^= 1
		}
		badWire, e := EncodeMember(bad)
		requireNoError(t, e)
		_, e = InspectArtifactPublicationMember(badWire, r, manifest)
		requireNoError(t, e) // Structural DATA never falsely claims signature validity.
		requireError(t, v.VerifyOne(badWire, 0))
	}
	for _, purpose := range []string{"TX-BATCH", "AUTH-PROTECTED-KEY-CALL", "CONSENSUS-VOTE"} {
		bad, e := DecodeMember(wire)
		requireNoError(t, e)
		bad.Certificate.Purpose = purpose
		badWire, e := EncodeMember(bad)
		requireNoError(t, e)
		_, e = InspectArtifactPublicationMember(badWire, r, manifest)
		requireError(t, e)
	}
	// Full original message binds account/publisher/version even though the
	// existing mathematical Owner label remains the same subjectOwner.
	for _, mutate := range []func(*ArtifactPublisherRegistration){
		func(x *ArtifactPublisherRegistration) { x.Account = "other-synthetic-owner" },
		func(x *ArtifactPublisherRegistration) { x.PublisherID = "other-publisher" },
		func(x *ArtifactPublisherRegistration) { x.PublisherKeyVersion = "2" },
	} {
		changed, e := DecodeArtifactPublisherRegistration(rawR)
		requireNoError(t, e)
		mutate(&changed)
		changedR, e := EncodeArtifactPublisherRegistration(changed)
		requireNoError(t, e)
		changedM, e := BuildArtifactPublicationMessage(changedR, manifest, changed)
		requireNoError(t, e)
		bad, e := DecodeMember(wire)
		requireNoError(t, e)
		bad.Message = changedM
		badWire, e := EncodeMember(bad)
		requireNoError(t, e)
		_, e = InspectArtifactPublicationMember(badWire, changed, manifest)
		requireNoError(t, e)
		requireError(t, v.VerifyOne(badWire, 0))
	}
	otherPublic := artifactTestFixedPublisher(t)
	changed, err := DecodeArtifactPublisherRegistration(rawR)
	requireNoError(t, err)
	changed.PKB = otherPublic.PKB
	_, err = InspectArtifactPublicationMember(wire, changed, manifest)
	requireError(t, err) // A correct A cannot authorize a different registered B.

	two, err := BatchSign(key, metadata, [][]byte{message, message}, SignOptions{})
	requireNoError(t, err)
	defer two.Discard()
	twoMember, err := Extract(two, 0)
	requireNoError(t, err)
	twoWire, err := EncodeMember(twoMember)
	requireNoError(t, err)
	requireNoError(t, v.VerifyOne(twoWire, 0)) // Legitimate original mathematics.
	_, err = InspectArtifactPublicationMember(twoWire, r, manifest)
	requireError(t, err) // This business profile is deliberately N=1 only.
	cert, err := EncodeCertificate(member.Certificate)
	requireNoError(t, err)
	for _, badProof := range [][]byte{
		artifactTestFrame(u32(1), artifactTestFrame(), artifactTestFrame()),
		artifactTestFrame(u32(0), artifactTestFrame(make([]byte, 64)), artifactTestFrame()),
	} {
		badWire := artifactTestFrame([]byte(Version+"/MEMBER"), cert, message, badProof)
		_, err = InspectArtifactPublicationMember(badWire, r, manifest)
		requireError(t, err)
	}
	whole, err := batch.WholeWire()
	requireNoError(t, err)
	_, err = InspectArtifactPublicationMember(whole, r, manifest)
	requireError(t, err)
	_, err = InspectArtifactPublicationMember(append(clone(wire), 0), r, manifest)
	requireError(t, err)
	changedManifest := []byte(strings.Replace(string(manifest), `"testnet"`, `"other-environment"`, 1))
	_, err = InspectArtifactPublicationMember(wire, r, changedManifest)
	requireError(t, err)
	// Original verifier refreshes trust even after a successful cached signature.
	reg.Enabled = false
	requireError(t, v.VerifyOne(wire, 0))
	reg.Enabled = true
	at := uint64(0)
	reg.RevokedAt = &at
	requireError(t, v.VerifyOne(wire, 0))

	// Optional actual CI output is PUBLIC ONLY: no seed, private material, Auth
	// proof, credential, issuer or fabricated authority flags are serialized.
	vector := struct {
		Version            string `json:"version"`
		SyntheticFixture   bool   `json:"syntheticFixture"`
		RegistrationBase64 string `json:"registrationBase64"`
		RegistrationSHA256 string `json:"registrationSHA256"`
		ManifestBase64     string `json:"manifestBase64"`
		MessageBase64      string `json:"messageBase64"`
		MessageSHA256      string `json:"messageSHA256"`
		MemberBase64       string `json:"memberBase64"`
		MemberSHA256       string `json:"memberSHA256"`
	}{"YNX-IDE-ARTIFACT-PUBLIC-VECTOR/v1", true, base64.StdEncoding.EncodeToString(rawR), artifactTestSHA(rawR), base64.StdEncoding.EncodeToString(manifest), base64.StdEncoding.EncodeToString(message), artifactTestSHA(message), base64.StdEncoding.EncodeToString(wire), artifactTestSHA(wire)}
	publicJSON, err := json.Marshal(vector)
	requireNoError(t, err)
	publicJSON = append(publicJSON, '\n')
	if output := os.Getenv("YNX_IDE_ARTIFACT_PUBLIC_FIXTURE_OUT"); output != "" {
		f, e := os.OpenFile(output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		requireNoError(t, e)
		_, writeErr := f.Write(publicJSON)
		syncErr := f.Sync()
		closeErr := f.Close()
		requireNoError(t, writeErr)
		requireNoError(t, syncErr)
		requireNoError(t, closeErr)
		readback, e := os.ReadFile(output)
		requireNoError(t, e)
		same(t, readback, publicJSON)
	}
	t.Logf("ARTIFACT_PUBLICATION_ACTUAL_DUAL_AND_N1_PASS publicVectorBytes=%d publicVectorSHA256=%s registrationSHA256=%s messageSHA256=%s memberBytes=%d memberSHA256=%s", len(publicJSON), artifactTestSHA(publicJSON), artifactTestSHA(rawR), artifactTestSHA(message), len(wire), artifactTestSHA(wire))
}
