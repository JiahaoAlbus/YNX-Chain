// This executable is a CI-only mathematical fixture. Its ephemeral DER files
// are deliberately synthetic and must never be uploaded or used as authority.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	batch "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const manifestText = `{"byteSize":1,"contentDigest":"2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881","projectId":"project-alpha","publishPurpose":"release","targetEnvironment":"testnet","version":"1.0.0"}`

func publisher(a, b []byte) batch.ArtifactPublisherRegistration {
	return batch.ArtifactPublisherRegistration{NetworkID: bytes.Repeat([]byte{0x42}, 32),
		SubjectOwner: "0x" + strings.Repeat("11", 20), Account: "developer-synthetic-owner", ProjectID: "project-alpha",
		PublisherID: "publisher-alpha", PublisherKeyVersion: "1", PKA: bytes.Clone(a), PKB: bytes.Clone(b)}
}

func writeExclusive(path string, raw []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil { return err }
	defer f.Close()
	if _, err = f.Write(raw); err != nil { return err }
	if err = f.Sync(); err != nil { return err }
	parent, err := os.Open(filepath.Dir(path))
	if err != nil { return err }
	defer parent.Close()
	return parent.Sync()
}

func readBounded(path string, maximum int) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil { return nil, err }
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > int64(maximum) { return nil, errors.New("bounded fixture file required") }
	raw, err := os.ReadFile(path)
	if err != nil { return nil, err }
	if len(raw) != int(info.Size()) { return nil, errors.New("fixture file changed") }
	return raw, nil
}

func signedMember(key *batch.PrivateKey, r batch.ArtifactPublisherRegistration, message []byte, purpose string, n int) ([]byte, error) {
	messages := make([][]byte, n)
	for i := range messages { messages[i] = bytes.Clone(message) }
	signed, err := batch.BatchSign(key, batch.Metadata{ChainID: r.NetworkID, Owner: r.SubjectOwner, Purpose: purpose}, messages, batch.SignOptions{Optimized: true})
	if err != nil { return nil, err }
	defer signed.Discard()
	m, err := batch.Extract(signed, 0)
	if err != nil { return nil, err }
	return batch.EncodeMember(m)
}

func generate(directory string) error {
	if err := os.Mkdir(directory, 0700); err != nil { return err }
	key, public, err := batch.KeyGen()
	if err != nil { return err }
	defer key.Destroy()
	material, err := batch.ExportKeyMaterial(key)
	if err != nil { return err }
	defer material.Clear()
	r := publisher(public.PKA, public.PKB)
	registration, err := batch.EncodeArtifactPublisherRegistration(r)
	if err != nil { return err }
	manifest := []byte(manifestText)
	message, err := batch.BuildArtifactPublicationMessage(registration, manifest, r)
	if err != nil { return err }
	for name, raw := range map[string][]byte{
		"registration.bin": registration, "manifest.json": manifest, "pk-a.bin": public.PKA, "pk-b.bin": public.PKB,
		"SYNTHETIC-ONLY-a.der": material.PKCS8A, "SYNTHETIC-ONLY-b.der": material.PKCS8B,
	} {
		if err := writeExclusive(filepath.Join(directory, name), raw); err != nil { return err }
	}
	for _, negative := range []struct { name, purpose string; n int }{
		{"valid-other-purpose.bin", "AUTH-PROTECTED-KEY-CALL", 1},
		{"valid-n2.bin", batch.ArtifactPublicationPurpose, 2},
	} {
		wire, err := signedMember(key, r, message, negative.purpose, negative.n)
		if err != nil { return err }
		if err = writeExclusive(filepath.Join(directory, negative.name), wire); err != nil { return err }
	}
	fmt.Println("YNX_ARTIFACT_CABI_SYNTHETIC_INPUT_READY no_authority=true private_upload=false")
	return nil
}

func verifier(r batch.ArtifactPublisherRegistration, purpose string) (*batch.Verifier, error) {
	// A narrowly named PUBLIC SYNTHETIC resolver exercises mathematics only.
	// It supplies no Auth Source, current ACL, registration, Main or Root proof.
	return batch.NewVerifier(batch.VerifierOptions{ChainID: r.NetworkID, Purpose: purpose, Optimized: true,
		ResolveTrustedOwner: func(request batch.TrustRequest) (batch.Registration, error) {
			if !bytes.Equal(request.ChainID, r.NetworkID) || request.Owner != r.SubjectOwner || request.Purpose != purpose || request.Height != 0 {
				return batch.Registration{}, errors.New("synthetic test binding differs")
			}
			return batch.Registration{AlgorithmVersion: batch.Version, ChainID: bytes.Clone(r.NetworkID), Owner: r.SubjectOwner,
				Purpose: purpose, PKA: bytes.Clone(r.PKA), PKB: bytes.Clone(r.PKB), PolicyRevision: "PUBLIC-SYNTHETIC-CABI-ONLY",
				Enabled: true, ActiveFrom: 0}, nil
		}})
}

type publicPin struct { Bytes int `json:"bytes"`; SHA256 string `json:"sha256"` }
func pin(raw []byte) publicPin { digest := sha256.Sum256(raw); return publicPin{len(raw), hex.EncodeToString(digest[:])} }
type checkedCase struct { Name string `json:"name"`; Rejected bool `json:"rejected"` }

func verify(input, output string) error {
	a, err := readBounded(filepath.Join(input, "pk-a.bin"), batch.PublicKeyASize)
	if err != nil { return err }
	b, err := readBounded(filepath.Join(input, "pk-b.bin"), batch.PublicKeyBSize)
	if err != nil { return err }
	r := publisher(a, b)
	registration, err := readBounded(filepath.Join(input, "registration.bin"), batch.MaxArtifactPublisherBytes)
	if err != nil { return err }
	wantedRegistration, err := batch.EncodeArtifactPublisherRegistration(r)
	if err != nil || !bytes.Equal(registration, wantedRegistration) { return errors.New("independent synthetic registration binding differs") }
	manifest, err := readBounded(filepath.Join(input, "manifest.json"), batch.MaxArtifactManifestBytes)
	if err != nil || !bytes.Equal(manifest, []byte(manifestText)) { return errors.New("original canonical synthetic manifest differs") }
	wire, err := readBounded(filepath.Join(output, "memberOriginal.bin"), batch.MaxMemberBytes)
	if err != nil { return err }
	wire2, err := readBounded(filepath.Join(output, "memberOriginal-second.bin"), batch.MaxMemberBytes)
	if err != nil { return err }
	v, err := verifier(r, batch.ArtifactPublicationPurpose)
	if err != nil { return err }
	for _, member := range [][]byte{wire, wire2} {
		if err := v.VerifyOne(member, 0); err != nil { return errors.New("actual C ABI dual AND verification failed") }
		if _, err := batch.InspectArtifactPublicationMember(member, r, manifest); err != nil { return errors.New("actual C ABI typed N1 inspection failed") }
	}
	if bytes.Equal(wire, wire2) { return errors.New("independent C calls reused an entire randomized batch") }
	cases := []checkedCase{}
	reject := func(name string, failure error) error {
		if failure == nil { return errors.New("negative unexpectedly accepted: " + name) }
		cases = append(cases, checkedCase{name, true})
		return nil
	}
	mutate := func(change func(*batch.Member)) ([]byte, error) {
		member, err := batch.DecodeMember(wire)
		if err != nil { return nil, err }
		change(&member)
		return batch.EncodeMember(member)
	}
	for _, branch := range []string{"A", "B"} {
		bad, err := mutate(func(m *batch.Member) { if branch == "A" { m.Certificate.SigmaA[0] ^= 1 } else { m.Certificate.SigmaB[0] ^= 1 } })
		if err != nil { return err }
		// Structural inspection intentionally does not claim signature validity.
		if _, err := batch.InspectArtifactPublicationMember(bad, r, manifest); err != nil { return err }
		if err := reject("tampered-signature-"+branch, v.VerifyOne(bad, 0)); err != nil { return err }
	}
	for _, purpose := range []string{"TX-BATCH", "AUTH-PROTECTED-KEY-CALL", "CONSENSUS-VOTE"} {
		bad, err := mutate(func(m *batch.Member) { m.Certificate.Purpose = purpose })
		if err != nil { return err }
		_, inspected := batch.InspectArtifactPublicationMember(bad, r, manifest)
		if err := reject("changed-purpose-"+purpose, inspected); err != nil { return err }
		if err := reject("changed-purpose-math-"+purpose, v.VerifyOne(bad, 0)); err != nil { return err }
	}
	for _, change := range []struct { name string; apply func(*batch.ArtifactPublisherRegistration) }{
		{"account", func(x *batch.ArtifactPublisherRegistration) { x.Account = "other-synthetic-owner" }},
		{"project", func(x *batch.ArtifactPublisherRegistration) { x.ProjectID = "other-project" }},
		{"publisher", func(x *batch.ArtifactPublisherRegistration) { x.PublisherID = "other-publisher" }},
		{"key-version", func(x *batch.ArtifactPublisherRegistration) { x.PublisherKeyVersion = "2" }},
		{"network", func(x *batch.ArtifactPublisherRegistration) { x.NetworkID[0] ^= 1 }},
		{"subject", func(x *batch.ArtifactPublisherRegistration) { x.SubjectOwner = "0x" + strings.Repeat("22", 20) }},
		{"pk-A", func(x *batch.ArtifactPublisherRegistration) { x.PKA[0] ^= 1 }},
		{"pk-B", func(x *batch.ArtifactPublisherRegistration) { x.PKB[0] ^= 1 }},
	} {
		other := publisher(a, b); change.apply(&other)
		_, inspected := batch.InspectArtifactPublicationMember(wire, other, manifest)
		if err := reject("expected-"+change.name, inspected); err != nil { return err }
	}
	changedManifest := []byte(strings.Replace(manifestText, `"testnet"`, `"other-environment"`, 1))
	_, inspected := batch.InspectArtifactPublicationMember(wire, r, changedManifest)
	if err := reject("changed-original-manifest", inspected); err != nil { return err }
	message, err := batch.BuildArtifactPublicationMessage(registration, changedManifest, r)
	if err != nil { return err }
	bad, err := mutate(func(m *batch.Member) { m.Message = message })
	if err != nil { return err }
	if err := reject("changed-manifest-math", v.VerifyOne(bad, 0)); err != nil { return err }
	for _, file := range []struct { name, purpose string }{
		{"valid-other-purpose.bin", "AUTH-PROTECTED-KEY-CALL"}, {"valid-n2.bin", batch.ArtifactPublicationPurpose},
	} {
		member, err := readBounded(filepath.Join(input, file.name), batch.MaxMemberBytes)
		if err != nil { return err }
		mathVerifier, err := verifier(r, file.purpose)
		if err != nil { return err }
		if err := mathVerifier.VerifyOne(member, 0); err != nil { return errors.New("valid negative fixture mathematics failed") }
		_, inspected := batch.InspectArtifactPublicationMember(member, r, manifest)
		if err := reject("valid-math-wrong-profile-"+file.name, inspected); err != nil { return err }
	}
	member, err := batch.DecodeMember(wire)
	if err != nil { return err }
	certificate, err := batch.EncodeCertificate(member.Certificate)
	if err != nil { return err }
	for _, proof := range []struct { name string; index uint32; paths [][]byte }{
		{"member-index-one", 1, nil}, {"nonempty-member-path", 0, [][]byte{make([]byte,64)}},
	} {
		pathA, err := batch.EncodeFields(proof.paths...)
		if err != nil { return err }
		empty, err := batch.EncodeFields()
		if err != nil { return err }
		proofRaw, err := batch.EncodeFields(batch.U32(proof.index), pathA, empty)
		if err != nil { return err }
		wrong, err := batch.EncodeFields([]byte(batch.Version+"/MEMBER"),certificate,member.Message,proofRaw)
		if err != nil { return err }
		_, inspected := batch.InspectArtifactPublicationMember(wrong, r, manifest)
		if err := reject(proof.name, inspected); err != nil { return err }
	}
	whole, err := batch.EncodeWhole(batch.Whole{Certificate: member.Certificate, Messages: [][]byte{member.Message}})
	if err != nil { return err }
	for _, malformed := range []struct { name string; raw []byte }{
		{"whole-is-not-member", whole}, {"trailing-member-byte", append(bytes.Clone(wire),0)}, {"truncated-member", wire[:len(wire)-1]},
	} {
		_, inspected := batch.InspectArtifactPublicationMember(malformed.raw, r, manifest)
		if err := reject(malformed.name, inspected); err != nil { return err }
	}
	cResult, err := readBounded(filepath.Join(output,"C-RESULT.json"), 65536)
	if err != nil { return err }
	var c struct { Version string `json:"version"`; Cases int `json:"cases"`; SyntheticOnly bool `json:"syntheticOnly"`; LogicalCleanupOnly bool `json:"logicalCleanupOnly"` }
	decoder := json.NewDecoder(bytes.NewReader(cResult)); decoder.DisallowUnknownFields()
	if err = decoder.Decode(&c); err != nil || c.Version != "YNX-ARTIFACT-RELEASE-CABI-C-RESULT/v1" || c.Cases != 41 || !c.SyntheticOnly || !c.LogicalCleanupOnly { return errors.New("actual C boundary controls missing") }
	encodePublic := func(name string, value any) error {
		raw, err := json.MarshalIndent(value,"","  ")
		if err != nil { return err }
		return writeExclusive(filepath.Join(output,name), append(raw,'\n'))
	}
	b64 := base64.StdEncoding.EncodeToString
	interop := map[string]any{"version":"YNX-ARTIFACT-RELEASE-CABI-PUBLIC-INTEROP/v1", "protocolVersion":batch.Version,"suite":batch.Suite,
		"purpose":batch.ArtifactPublicationPurpose,"n":1,"index":0,"registrationOriginalBase64":b64(registration),
		"manifestOriginalBase64":b64(manifest),"memberOriginalBase64":b64(wire),
		"expected":map[string]string{"networkIDBase64":b64(r.NetworkID),"subjectOwner":r.SubjectOwner,"account":r.Account,"projectID":r.ProjectID,
			"publisherID":r.PublisherID,"publisherKeyVersion":r.PublisherKeyVersion,"pkABase64":b64(r.PKA),"pkBBase64":b64(r.PKB)},
		"syntheticOnly":true,"actualCABI":true,"dualANDVerified":true,"typedN1Inspected":true,"publisherAuthorized":false,
		"nativeRootAuthorized":false,"rootGrant":false,"mainCustodyVerified":false,"physicalEraseClaimed":false}
	if err := encodePublic("PUBLIC-INTEROP.json",interop); err != nil { return err }
	receipt := map[string]any{"version":"YNX-ARTIFACT-RELEASE-CABI-PUBLIC-RECEIPT/v1","syntheticOnly":true,"actualCABI":true,
		"dualANDVerified":true,"typedN1Inspected":true,"cBoundaryCases":c.Cases,"negativeCases":cases,
		"publicPins":map[string]publicPin{"registration":pin(registration),"manifest":pin(manifest),"memberOriginal":pin(wire),"secondMember":pin(wire2)},
		"logicalCleanupOnly":true,"physicalEraseClaimed":false,"publisherAuthorized":false,"mainCustodyVerified":false,"rootGrant":false}
	if err := encodePublic("PUBLIC-RECEIPT.json",receipt); err != nil { return err }
	fmt.Printf("YNX_ARTIFACT_RELEASE_CABI_INTEROP_PASS cCases=%d goNegativeCases=%d syntheticOnly=true authority=false\n",c.Cases,len(cases))
	return nil
}

func main() {
	var err error
	if len(os.Args) == 3 && os.Args[1] == "generate" { err = generate(os.Args[2])
	} else if len(os.Args) == 4 && os.Args[1] == "verify" { err = verify(os.Args[2],os.Args[3])
	} else { err = errors.New("usage: fixture generate NEW_INPUT_DIR | fixture verify INPUT_DIR OUTPUT_DIR") }
	if err != nil { fmt.Fprintln(os.Stderr, "YNX_ARTIFACT_CABI_FIXTURE_REFUSED:",err); os.Exit(1) }
}
