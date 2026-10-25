// CI-only C -> original shared archive -> independent Go math verifier.
// Ephemeral synthetic DER files never enter the public delivery or authority.
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
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	batch "github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	controlPurpose = "IDE-PROJECT-CONTROL"
	controlFrame   = "YNX-IDE-PROJECT-CONTROL-APPROVAL/v1"
	controlAtMS    = uint64(1760000000000)
	controlHeight  = uint64(9007199254740993)
	memberCapacity = 98304
	boundaryCases  = 44
)

func binding(a, b []byte) batch.ProjectControlBinding {
	return batch.ProjectControlBinding{NetworkID: bytes.Repeat([]byte{0x42}, 32), Owner: "0x" + strings.Repeat("11", 20),
		KeyVersion: "1", ExecutionHeight: "9007199254740993", CallerIdentity: "PUBLIC-native-caller", SourceCurrentRef: "PUBLIC-current",
		PKA: bytes.Clone(a), PKB: bytes.Clone(b)}
}

// Struct order is the original Go Principal7 and Command15 order. Public
// integers are encoded directly as uint64 tokens, including values >2^53.
func originals() (principal, command, decision []byte, err error) {
	account, err := accountaddress.Encode("0x" + strings.Repeat("11", 20))
	if err != nil {
		return nil, nil, nil, err
	}
	subject, err := accountaddress.Encode("0x" + strings.Repeat("22", 20))
	if err != nil {
		return nil, nil, nil, err
	}
	p := struct {
		Account, DeviceID, SessionRef, CurrentRef string
		AccountGeneration, SessionGeneration      uint64
		ExpiresMS                                 int64
	}{account, "PUBLIC-device", "PUBLIC-session", "PUBLIC-current", 9007199254740993, ^uint64(0), int64(controlAtMS + 60000)}
	principal, err = json.Marshal(p)
	if err != nil {
		return nil, nil, nil, err
	}
	c := struct {
		RequestID, Action, ProjectID, TeamID, SubjectAccount, PublisherID, RuntimeOrigin string
		ExpectedRevision                                                                 uint64
		GrantExpiresMS                                                                   int64
		Read, Publish, Runtime, Revoke                                                   bool
		ExpiresMS                                                                        int64
		PublicOriginalSHA256                                                             string
	}{"PUBLIC-request", "project.member", "PUBLIC-project", "", subject, "", "", 9007199254740993, int64(controlAtMS + 60000), true, false, false, false, int64(controlAtMS + 30000), ""}
	command, err = json.Marshal(c)
	if err != nil {
		return nil, nil, nil, err
	}
	ph, ch := sha256.Sum256(principal), sha256.Sum256(command)
	// Alphabetic field order is Auth's canonical sorted-key decision JSON.
	d := struct {
		CommandSHA256   string `json:"commandSHA256"`
		ConfirmationRef string `json:"confirmationRef"`
		Decision        string `json:"decision"`
		ExpiresAtMS     uint64 `json:"expiresAtMs"`
		IssuedAtMS      uint64 `json:"issuedAtMs"`
		Nonce           string `json:"nonce"`
		PrincipalSHA256 string `json:"principalSHA256"`
		RequestID       string `json:"requestId"`
		ReviewID        string `json:"reviewId"`
		RevocationRef   string `json:"revocationRef"`
		Version         string `json:"version"`
	}{hex.EncodeToString(ch[:]), "PUBLIC-confirm", "approve", controlAtMS + 20000, controlAtMS,
		base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{8}, 32)), hex.EncodeToString(ph[:]), "PUBLIC-request", "PUBLIC-review", "PUBLIC-revocation", "YNX-IDE-PROJECT-CONTROL-DECISION/v1"}
	decision, err = json.Marshal(d)
	return principal, command, decision, err
}

func writeExclusive(path string, raw []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	if n, err := f.Write(raw); err != nil {
		return err
	} else if n != len(raw) {
		return io.ErrShortWrite
	}
	if err := f.Sync(); err != nil {
		return err
	}
	parent, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer parent.Close()
	return parent.Sync()
}

func readBounded(path string, maximum int) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > int64(maximum) {
		return nil, errors.New("one bounded original synthetic fixture file required")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(info, after) || after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) || len(raw) != int(info.Size()) {
		return nil, errors.New("synthetic fixture input changed")
	}
	return raw, nil
}

func generate(directory string) error {
	if err := os.Mkdir(directory, 0700); err != nil {
		return err
	}
	key, public, err := batch.KeyGen()
	if err != nil {
		return err
	}
	defer key.Destroy()
	material, err := batch.ExportKeyMaterial(key)
	if err != nil {
		return err
	}
	defer material.Clear()
	p, c, d, err := originals()
	if err != nil {
		return err
	}
	// Public preflight, with no extra successful Go signature generation.
	if _, err := batch.BuildProjectControlMessage(p, c, d, binding(public.PKA, public.PKB), controlAtMS); err != nil {
		return err
	}
	for name, raw := range map[string][]byte{"principal.json": p, "command.json": c, "decision.json": d,
		"pk-a.bin": public.PKA, "pk-b.bin": public.PKB, "SYNTHETIC-ONLY-a.der": material.PKCS8A, "SYNTHETIC-ONLY-b.der": material.PKCS8B} {
		if err := writeExclusive(filepath.Join(directory, name), raw); err != nil {
			return err
		}
	}
	fmt.Println("YNX_CONTROL_CABI_SYNTHETIC_INPUT_READY no_authority=true private_upload=false")
	return nil
}

func verifier(expected batch.ProjectControlBinding) (*batch.Verifier, error) {
	// This PUBLIC SYNTHETIC resolver checks math only. It is not an Auth Source,
	// current registry, consent, original key custody, ACL or admitted Root.
	return batch.NewVerifier(batch.VerifierOptions{ChainID: expected.NetworkID, Purpose: controlPurpose, Optimized: true,
		ResolveTrustedOwner: func(request batch.TrustRequest) (batch.Registration, error) {
			if !bytes.Equal(request.ChainID, expected.NetworkID) || request.Owner != expected.Owner || request.Purpose != controlPurpose || request.Height != controlHeight {
				return batch.Registration{}, errors.New("public synthetic binding differs")
			}
			return batch.Registration{AlgorithmVersion: batch.Version, ChainID: bytes.Clone(expected.NetworkID), Owner: expected.Owner, Purpose: controlPurpose,
				PKA: bytes.Clone(expected.PKA), PKB: bytes.Clone(expected.PKB), PolicyRevision: expected.KeyVersion, Enabled: true, ActiveFrom: controlHeight}, nil
		}})
}

type publicPin struct {
	Bytes  int    `json:"bytes"`
	SHA256 string `json:"sha256"`
}

func pin(raw []byte) publicPin {
	digest := sha256.Sum256(raw)
	return publicPin{len(raw), hex.EncodeToString(digest[:])}
}

type checkedCase struct {
	Name     string `json:"name"`
	Rejected bool   `json:"rejected"`
}

func verify(input, output string) error {
	a, err := readBounded(filepath.Join(input, "pk-a.bin"), batch.PublicKeyASize)
	if err != nil {
		return err
	}
	b, err := readBounded(filepath.Join(input, "pk-b.bin"), batch.PublicKeyBSize)
	if err != nil {
		return err
	}
	expected := binding(a, b)
	p, c, d, err := originals()
	if err != nil {
		return err
	}
	for _, original := range []struct {
		name    string
		want    []byte
		maximum int
	}{{"principal.json", p, 8192}, {"command.json", c, 8192}, {"decision.json", d, 4096}} {
		actual, err := readBounded(filepath.Join(input, original.name), original.maximum)
		if err != nil || !bytes.Equal(actual, original.want) {
			return errors.New("original public synthetic Go7/Go15/decision11 fixture changed")
		}
	}
	if !bytes.Contains(p, []byte(`"AccountGeneration":9007199254740993`)) || !bytes.Contains(p, []byte(`"SessionGeneration":18446744073709551615`)) || !bytes.Contains(c, []byte(`"ExpectedRevision":9007199254740993`)) {
		return errors.New("original integer tokens were rounded or quoted")
	}
	message, err := batch.BuildProjectControlMessage(p, c, d, expected, controlAtMS)
	if err != nil {
		return err
	}
	// Independently enumerate Auth R197's fixed E13 order. This is not a
	// caller-selected signing blob or a second authority implementation.
	wantMessage, err := batch.EncodeFields([]byte(controlFrame), []byte(batch.Version), []byte(batch.Suite), []byte(controlPurpose), expected.NetworkID,
		[]byte(expected.Owner), []byte(expected.KeyVersion), []byte(expected.ExecutionHeight), []byte(expected.CallerIdentity), []byte(expected.SourceCurrentRef), p, c, d)
	if err != nil || !bytes.Equal(message, wantMessage) {
		return errors.New("normal CONTROL message differs from exact Auth E13")
	}
	wire, err := readBounded(filepath.Join(output, "memberOriginal.bin"), memberCapacity)
	if err != nil {
		return err
	}
	second, err := readBounded(filepath.Join(output, "memberOriginal-second.bin"), memberCapacity)
	if err != nil {
		return err
	}
	v, err := verifier(expected)
	if err != nil {
		return err
	}
	for _, raw := range [][]byte{wire, second} {
		if err := v.VerifyOne(raw, controlHeight); err != nil {
			return errors.New("actual C CONTROL member dual AND verification failed")
		}
		if _, err := batch.InspectProjectControlMember(raw, expected, p, c, d, controlAtMS); err != nil {
			return errors.New("actual C CONTROL typed N1 inspection failed")
		}
	}
	if bytes.Equal(wire, second) {
		return errors.New("independent C calls reused the complete randomized batch")
	}
	cases := []checkedCase{}
	reject := func(name string, failure error) error {
		if failure == nil {
			return errors.New("negative unexpectedly accepted: " + name)
		}
		cases = append(cases, checkedCase{name, true})
		return nil
	}
	mutate := func(change func(*batch.Member)) ([]byte, error) {
		member, err := batch.DecodeMember(wire)
		if err != nil {
			return nil, err
		}
		change(&member)
		return batch.EncodeMember(member)
	}
	if err := reject("independent-registration-wrong-height", v.VerifyOne(wire, controlHeight+1)); err != nil {
		return err
	}
	for _, branch := range []string{"A", "B"} {
		bad, err := mutate(func(m *batch.Member) {
			if branch == "A" {
				m.Certificate.SigmaA[0] ^= 1
			} else {
				m.Certificate.SigmaB[0] ^= 1
			}
		})
		if err != nil {
			return err
		}
		// Typed inspection alone does not claim mathematical verification.
		if _, err := batch.InspectProjectControlMember(bad, expected, p, c, d, controlAtMS); err != nil {
			return err
		}
		if err := reject("actual-signature-tamper-"+branch, v.VerifyOne(bad, controlHeight)); err != nil {
			return err
		}
	}
	for _, purpose := range []string{"ARTIFACT-RELEASE", "TX-BATCH", "AUTH-SOURCE-CURRENT"} {
		bad, err := mutate(func(m *batch.Member) { m.Certificate.Purpose = purpose })
		if err != nil {
			return err
		}
		_, inspected := batch.InspectProjectControlMember(bad, expected, p, c, d, controlAtMS)
		if err := reject("changed-purpose-"+purpose, inspected); err != nil {
			return err
		}
		if err := reject("changed-purpose-math-"+purpose, v.VerifyOne(bad, controlHeight)); err != nil {
			return err
		}
	}
	for _, change := range []struct {
		name  string
		apply func(*batch.ProjectControlBinding)
	}{
		{"network", func(x *batch.ProjectControlBinding) { x.NetworkID[0] ^= 1 }},
		{"owner", func(x *batch.ProjectControlBinding) { x.Owner = "0x" + strings.Repeat("22", 20) }},
		{"key-version", func(x *batch.ProjectControlBinding) { x.KeyVersion = "2" }},
		{"execution-height", func(x *batch.ProjectControlBinding) { x.ExecutionHeight = "9007199254740994" }},
		{"caller", func(x *batch.ProjectControlBinding) { x.CallerIdentity = "PUBLIC-other-native" }},
		{"current", func(x *batch.ProjectControlBinding) { x.SourceCurrentRef = "PUBLIC-other-current" }},
		{"pk-A", func(x *batch.ProjectControlBinding) { x.PKA[0] ^= 1 }},
		{"pk-B", func(x *batch.ProjectControlBinding) { x.PKB[0] ^= 1 }},
	} {
		other := binding(a, b)
		change.apply(&other)
		_, inspected := batch.InspectProjectControlMember(wire, other, p, c, d, controlAtMS)
		if err := reject("independent-binding-"+change.name, inspected); err != nil {
			return err
		}
	}
	for _, change := range []struct {
		name    string
		p, c, d []byte
	}{
		{"principal", bytes.Replace(p, []byte("PUBLIC-device"), []byte("PUBLIC-other-device"), 1), c, d},
		{"command", p, bytes.Replace(c, []byte("PUBLIC-project"), []byte("PUBLIC-other-project"), 1), d},
		{"decision", p, c, bytes.Replace(d, []byte("PUBLIC-confirm"), []byte("PUBLIC-other-confirm"), 1)},
	} {
		_, inspected := batch.InspectProjectControlMember(wire, expected, change.p, change.c, change.d, controlAtMS)
		if err := reject("changed-original-"+change.name, inspected); err != nil {
			return err
		}
	}
	_, inspected := batch.InspectProjectControlMember(wire, expected, p, c, d, controlAtMS+20000)
	if err := reject("actual-clock-expired", inspected); err != nil {
		return err
	}
	member, err := batch.DecodeMember(wire)
	if err != nil {
		return err
	}
	for _, variant := range []struct {
		name  string
		n     uint32
		index uint32
		pathA [][]byte
	}{
		{"mutated-N2-profile-not-valid-math", 2, 0, nil},
		{"index-one", 1, 1, nil},
		{"nonempty-N1-path", 1, 0, [][]byte{make([]byte, 64)}},
	} {
		certificate := member.Certificate
		certificate.N = variant.n
		cert, err := batch.EncodeCertificate(certificate)
		if err != nil {
			return err
		}
		pathA, err := batch.EncodeFields(variant.pathA...)
		if err != nil {
			return err
		}
		empty, err := batch.EncodeFields()
		if err != nil {
			return err
		}
		proof, err := batch.EncodeFields(batch.U32(variant.index), pathA, empty)
		if err != nil {
			return err
		}
		bad, err := batch.EncodeFields([]byte(batch.Version+"/MEMBER"), cert, member.Message, proof)
		if err != nil {
			return err
		}
		_, inspected := batch.InspectProjectControlMember(bad, expected, p, c, d, controlAtMS)
		if err := reject(variant.name, inspected); err != nil {
			return err
		}
	}
	for _, malformed := range []struct {
		name string
		raw  []byte
	}{{"trailing-member", append(bytes.Clone(wire), 0)}, {"truncated-member", wire[:len(wire)-1]}} {
		_, inspected := batch.InspectProjectControlMember(malformed.raw, expected, p, c, d, controlAtMS)
		if err := reject(malformed.name, inspected); err != nil {
			return err
		}
	}
	cResult, err := readBounded(filepath.Join(output, "C-RESULT.json"), 65536)
	if err != nil {
		return err
	}
	var boundary struct {
		Version            string `json:"version"`
		Cases              int    `json:"cases"`
		SyntheticOnly      bool   `json:"syntheticOnly"`
		LogicalCleanupOnly bool   `json:"logicalCleanupOnly"`
	}
	decoder := json.NewDecoder(bytes.NewReader(cResult))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&boundary); err != nil || boundary.Version != "YNX-PROJECT-CONTROL-CABI-C-RESULT/v1" || boundary.Cases != boundaryCases || !boundary.SyntheticOnly || !boundary.LogicalCleanupOnly {
		return errors.New("actual C boundary controls incomplete")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("C result contains trailing data")
	}
	encodePublic := func(name string, value any) error {
		raw, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return err
		}
		return writeExclusive(filepath.Join(output, name), append(raw, '\n'))
	}
	b64 := base64.StdEncoding.EncodeToString
	interop := map[string]any{"version": "YNX-PROJECT-CONTROL-CABI-PUBLIC-INTEROP/v1", "protocolVersion": batch.Version, "suite": batch.Suite,
		"purpose": controlPurpose, "frame": controlFrame, "sourcePurpose": "ide-project-control-authority-v1", "n": 1, "index": 0,
		"principalOriginalBase64": b64(p), "commandOriginalBase64": b64(c), "decisionOriginalBase64": b64(d), "messageOriginalBase64": b64(message),
		"memberOriginalBase64Url": base64.RawURLEncoding.EncodeToString(wire), "observedAtMs": "1760000000000",
		"binding": map[string]string{"networkId": hex.EncodeToString(expected.NetworkID), "owner": expected.Owner, "keyVersion": expected.KeyVersion,
			"executionHeight": expected.ExecutionHeight, "callerIdentity": expected.CallerIdentity, "sourceCurrentRef": expected.SourceCurrentRef,
			"pkABase64": b64(a), "pkBBase64": b64(b)},
		"syntheticOnly": true, "actualCABI": true, "dualANDVerified": true, "typedN1Inspected": true, "sourceVerified": false,
		"realUserConsent": false, "mainCustodyVerified": false, "nativeRootAuthorized": false, "rootGrant": false, "physicalEraseClaimed": false}
	if err := encodePublic("PUBLIC-INTEROP.json", interop); err != nil {
		return err
	}
	receipt := map[string]any{"version": "YNX-PROJECT-CONTROL-CABI-PUBLIC-RECEIPT/v1", "syntheticOnly": true, "actualCABI": true,
		"dualANDVerified": true, "typedN1Inspected": true, "actualCABISuccesses": 2, "cBoundaryCases": boundary.Cases, "negativeCases": cases,
		"publicPins":         map[string]publicPin{"principal": pin(p), "command": pin(c), "decision": pin(d), "message": pin(message), "memberOriginal": pin(wire), "secondMember": pin(second)},
		"logicalCleanupOnly": true, "physicalEraseClaimed": false, "sourceVerified": false, "realUserConsent": false, "mainCustodyVerified": false, "rootGrant": false}
	if err := encodePublic("PUBLIC-RECEIPT.json", receipt); err != nil {
		return err
	}
	fmt.Printf("YNX_PROJECT_CONTROL_CABI_INTEROP_PASS cCases=%d goNegativeCases=%d syntheticOnly=true authority=false\n", boundary.Cases, len(cases))
	return nil
}

func main() {
	var err error
	if len(os.Args) == 3 && os.Args[1] == "generate" {
		err = generate(os.Args[2])
	} else if len(os.Args) == 4 && os.Args[1] == "verify" {
		err = verify(os.Args[2], os.Args[3])
	} else {
		err = errors.New("usage: fixture generate NEW_INPUT_DIR | fixture verify INPUT_DIR OUTPUT_DIR")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "YNX_CONTROL_CABI_FIXTURE_REFUSED:", err)
		os.Exit(1)
	}
}
