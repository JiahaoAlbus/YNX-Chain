package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// Original sole-SDK PUBLIC capacity artifacts. No key generation, private
// material, registration issuer, Source schema or Root admission is exercised.
const sourceV2CapacityFixture = "testdata/source_v2_capacity"

type sourceV2CapacityFile struct {
	Path   string `json:"path"`
	Bytes  int    `json:"bytes"`
	SHA256 string `json:"sha256"`
}

func sourceV2CapacityRead(t *testing.T, root string, file sourceV2CapacityFile) []byte {
	t.Helper()
	if filepath.Base(file.Path) != file.Path || file.Bytes < 1 || file.Bytes > 393216 {
		t.Fatal("capacity fixture path/size is not a closed public file")
	}
	raw, err := os.ReadFile(filepath.Join(root, file.Path))
	requireNoError(t, err)
	sum := sha256.Sum256(raw)
	if len(raw) != file.Bytes || hex.EncodeToString(sum[:]) != file.SHA256 {
		t.Fatalf("sole SDK original public pin changed: %s", file.Path)
	}
	return raw
}

func sourceV2CapacityRole(t *testing.T, name string) ynxbatch.AuthSourceStatementV2Role {
	t.Helper()
	switch name {
	case "enrollment":
		return ynxbatch.AuthSourceEnrollmentV2
	case "profile":
		return ynxbatch.AuthSourceProfileV2
	case "current":
		return ynxbatch.AuthSourceCurrentV2
	}
	t.Fatal("capacity fixture role is not fixed")
	return 0
}

func sourceV2CapacityU64(t *testing.T, value string) uint64 {
	t.Helper()
	n, err := strconv.ParseUint(value, 10, 64)
	requireNoError(t, err)
	if strconv.FormatUint(n, 10) != value {
		t.Fatal("capacity decimal is not canonical")
	}
	return n
}

func sourceV2CapacityHex(t *testing.T, value string) []byte {
	t.Helper()
	raw, err := hex.DecodeString(value)
	requireNoError(t, err)
	if hex.EncodeToString(raw) != value {
		t.Fatal("capacity hex is not canonical")
	}
	return raw
}

func TestAuthSourceStatementV2CapacitySoleUnsignedE8(t *testing.T) {
	raw := sourceV2CapacityRead(t, sourceV2CapacityFixture, sourceV2CapacityFile{"CONTRACT.json", 1998, "d6782befdf221a9fe93d57055272b3d57907b06f9d584a7f590f2859f31b2931"})
	var contract struct {
		Schema, SoleFunction, Domain                      string
		Framing                                           struct{ Count, CountPrefixBytes, LengthPrefixBytes, TotalFramingBytes int }
		MaxFieldUTF8Bytes                                 map[string]int
		RoleMaxEncodedBytes                               map[string]int
		MemberRawMaxBytes, OuterCanonicalEnvelopeMaxBytes int
		OuterEnvelopeIsAdditionalJointBound               bool
		GenericABIUnchanged                               struct{ Member, Message int }
		Rows                                              []struct {
			Role, Path, SHA256, Purpose                 string
			FrameUTF8Bytes, BodyUTF8Bytes, EncodedBytes int
			MessageOnly, RegistrationAndN1NotSupplied   bool
		}
		CallerSuppliedMaxAllowed, NewAlgorithms, RootAdmission, SourceAdmission, NativeAdmission bool
	}
	requireNoError(t, json.Unmarshal(raw, &contract))
	if contract.Schema != "SOLE_SOURCE_V2_FIXED_CAPACITY_SUCCESSOR_V1" || contract.SoleFunction != "encodeOriginalAuthSourceStatementV2" || contract.Domain != ynxbatch.AuthSourceStatementV2Domain || len(contract.Domain) != 27 ||
		contract.Framing.Count != 8 || contract.Framing.CountPrefixBytes != 4 || contract.Framing.LengthPrefixBytes != 4 || contract.Framing.TotalFramingBytes != 36 ||
		contract.MemberRawMaxBytes != 262144 || contract.OuterCanonicalEnvelopeMaxBytes != 393216 || !contract.OuterEnvelopeIsAdditionalJointBound ||
		contract.GenericABIUnchanged.Member != registeredN1MemberMaximum || contract.GenericABIUnchanged.Message != registeredN1MessageMaximum ||
		contract.CallerSuppliedMaxAllowed || contract.NewAlgorithms || contract.RootAdmission || contract.SourceAdmission || contract.NativeAdmission || len(contract.Rows) != 3 {
		t.Fatal("sole machine capacity/authority contract changed")
	}
	for name, value := range map[string]int{"domain": 27, "frame": 512, "network": 64, "owner": 42, "keyVersion": 20, "executionHeight": 20, "body": 65536} {
		if contract.MaxFieldUTF8Bytes[name] != value {
			t.Fatal("sole field bound changed", name)
		}
	}
	seen := map[string]bool{}
	for _, row := range contract.Rows {
		role := sourceV2CapacityRole(t, row.Role)
		want := 66264
		if role == ynxbatch.AuthSourceEnrollmentV2 {
			want = 66267
		}
		if seen[row.Role] || row.EncodedBytes != want || contract.RoleMaxEncodedBytes[row.Role] != want || row.FrameUTF8Bytes != 512 || row.BodyUTF8Bytes != 65536 || !row.MessageOnly || !row.RegistrationAndN1NotSupplied {
			t.Fatal("unsigned boundary record mislabeled or changed")
		}
		seen[row.Role] = true
		message := sourceV2CapacityRead(t, sourceV2CapacityFixture, sourceV2CapacityFile{row.Path, row.EncodedBytes, row.SHA256})
		fields, err := ynxbatch.DecodeFields(message, 8, ynxbatch.AuthSourceStatementV2MessageMaximum)
		requireNoError(t, err)
		if binary.BigEndian.Uint32(message[:4]) != 8 || len(fields[0]) != 27 || len(fields[2]) != 512 || len(fields[3]) != 64 || len(fields[4]) != 42 || len(fields[5]) != 20 || len(fields[6]) != 20 || len(fields[7]) != 65536 || string(fields[1]) != row.Role {
			t.Fatal("original E8 boundary field layout differs")
		}
		b := ynxbatch.AuthSourceStatementV2Binding{Role: role, Frame: string(fields[2]), NetworkID: sourceV2CapacityHex(t, string(fields[3])), Owner: string(fields[4]), KeyVersion: sourceV2CapacityU64(t, string(fields[5])), IssuedHeight: sourceV2CapacityU64(t, string(fields[6]))}
		if b.KeyVersion != math.MaxUint64 || b.IssuedHeight != math.MaxUint64 {
			t.Fatal("20-digit maximum u64 not exercised")
		}
		built, err := ynxbatch.BuildAuthSourceStatementV2(fields[7], b)
		requireNoError(t, err)
		if !bytes.Equal(built, message) {
			t.Fatal("Go bytes differ from sole SDK maximum E8")
		}
		purpose, err := ynxbatch.AuthSourceStatementV2Purpose(role)
		requireNoError(t, err)
		if purpose != row.Purpose {
			t.Fatal("fixed Source purpose changed")
		}
	}
	t.Log("PUBLIC capacity message-only originals: E8 66267/66264/66264; no signature or registration success inferred")
}

type sourceV2CapacityBinding struct {
	NetworkID                          string `json:"networkId"`
	Owner, KeyVersion, ExecutionHeight string
}

type sourceV2CapacitySignedRow struct {
	Role, Purpose, Frame   string
	Binding                sourceV2CapacityBinding
	ExpectedRegisteredPair struct {
		PKA, PKB, ActiveFrom string
		Enabled              bool
		RevokedAt            *string
	}
	Files                                                                                                 map[string]sourceV2CapacityFile
	DirectRegisteredPairN1Math, ActualRegistrationSnapshotSupplied, Generic65536MessageRejectedByCapacity bool
	DataOnly, SourceSchemaVerified, RootAdmission, SourceAdmission, NativeAdmission                       bool
}

func sourceV2CapacitySignedRows(t *testing.T) []sourceV2CapacitySignedRow {
	t.Helper()
	raw := sourceV2CapacityRead(t, filepath.Join(sourceV2CapacityFixture, "signed-public"), sourceV2CapacityFile{"PUBLIC-GOLDEN.json", 22437, "1fe14987f3fd71a0135de07ba0c5a74fbdebb65f3b78cd24cb4fe00127b572ba"})
	var golden struct {
		Schema                                         string
		Rows                                           []sourceV2CapacitySignedRow
		PrivateKeysWritten, RealRegistration, RealRoot bool
	}
	requireNoError(t, json.Unmarshal(raw, &golden))
	if len(golden.Rows) != 3 || golden.PrivateKeysWritten || golden.RealRegistration || golden.RealRoot {
		t.Fatal("signed capacity fixture is not public synthetic DATA")
	}
	return golden.Rows
}

func sourceV2CapacityInputs(t *testing.T, row sourceV2CapacitySignedRow) (sourceStatementV2Inputs, []byte, []byte) {
	t.Helper()
	root := filepath.Join(sourceV2CapacityFixture, "signed-public")
	for _, name := range []string{"message", "member", "body", "envelope"} {
		if row.Files[name].Path != row.Role+"."+name+".bin" {
			t.Fatal("signed fixture original path differs")
		}
	}
	body := sourceV2CapacityRead(t, root, row.Files["body"])
	message := sourceV2CapacityRead(t, root, row.Files["message"])
	member := sourceV2CapacityRead(t, root, row.Files["member"])
	envelope := sourceV2CapacityRead(t, root, row.Files["envelope"])
	if !row.DataOnly || !row.DirectRegisteredPairN1Math || row.ActualRegistrationSnapshotSupplied || !row.Generic65536MessageRejectedByCapacity || row.SourceSchemaVerified || row.RootAdmission || row.SourceAdmission || row.NativeAdmission || !row.ExpectedRegisteredPair.Enabled || row.ExpectedRegisteredPair.RevokedAt != nil {
		t.Fatal("DATA mathematics fixture claimed authority or an unexpected binding")
	}
	in := sourceStatementV2Inputs{body: body, frame: row.Frame, role: sourceV2CapacityRole(t, row.Role), issuedHeight: sourceV2CapacityU64(t, row.Binding.ExecutionHeight), registration: registeredN1Inputs{
		member: member, network: sourceV2CapacityHex(t, row.Binding.NetworkID), owner: row.Binding.Owner,
		pkA: sourceV2CapacityHex(t, row.ExpectedRegisteredPair.PKA), pkB: sourceV2CapacityHex(t, row.ExpectedRegisteredPair.PKB),
		policyRevision: sourceV2CapacityU64(t, row.Binding.KeyVersion), observedHeight: sourceV2CapacityU64(t, row.Binding.ExecutionHeight), activeFrom: sourceV2CapacityU64(t, row.ExpectedRegisteredPair.ActiveFrom), enabled: 1,
	}}
	if len(in.frame) != 512 || !utf8.ValidString(in.frame) || utf8.RuneCountInString(in.frame) == 512 || len(in.body) != 65536 || in.issuedHeight != math.MaxUint64 || in.registration.policyRevision != math.MaxUint64 {
		t.Fatal("full UTF8-byte frame/body/u64 simultaneous boundary not exercised")
	}
	return in, message, envelope
}

// The sole SDK owns this transport and its joint outer bound. Reconstruct only
// the PUBLIC fixed fixture envelope bytes here to prove the real raw-member,
// body and E8 maxima coexist; do not add an alternative production parser.
func sourceV2CapacityEnvelope(t *testing.T, row sourceV2CapacitySignedRow, in sourceStatementV2Inputs, original []byte) {
	t.Helper()
	type envelope struct {
		AlgorithmVersion string `json:"algorithmVersion"`
		Body             string `json:"body"`
		ExecutionHeight  string `json:"executionHeight"`
		KeyVersion       string `json:"keyVersion"`
		Member           string `json:"member"`
		NetworkID        string `json:"networkId"`
		Owner            string `json:"owner"`
		Role             string `json:"role"`
		Version          int    `json:"version"`
	}
	e := envelope{ynxbatch.Version, base64.RawURLEncoding.EncodeToString(in.body), row.Binding.ExecutionHeight, row.Binding.KeyVersion, base64.RawURLEncoding.EncodeToString(in.registration.member), row.Binding.NetworkID, row.Binding.Owner, row.Role, 2}
	built, err := json.Marshal(e)
	requireNoError(t, err)
	if !bytes.Equal(built, original) || len(in.registration.member) > 262144 || len(original) > 393216 {
		t.Fatal("sole canonical outer envelope or joint bounds changed")
	}
	// The two caps are not independent promises of simultaneous maximality.
	// This arithmetic is NOT a signed-member or Source admission test.
	e.Member = ""
	empty, err := json.Marshal(e)
	requireNoError(t, err)
	if len(empty)+base64.RawURLEncoding.EncodedLen(262144) <= 393216 {
		t.Fatal("joint outer bound was incorrectly treated as redundant")
	}
}

func TestAuthSourceStatementV2CapacitySignedSoleActualCAND(t *testing.T) {
	seen := map[string]bool{}
	for _, row := range sourceV2CapacitySignedRows(t) {
		row := row
		t.Run(row.Role, func(t *testing.T) {
			if seen[row.Role] {
				t.Fatal("duplicate signed role")
			}
			seen[row.Role] = true
			in, message, envelope := sourceV2CapacityInputs(t, row)
			built, err := ynxbatch.BuildAuthSourceStatementV2(in.body, ynxbatch.AuthSourceStatementV2Binding{Role: in.role, Frame: in.frame, NetworkID: in.registration.network, Owner: in.registration.owner, KeyVersion: in.registration.policyRevision, IssuedHeight: in.issuedHeight})
			requireNoError(t, err)
			if !bytes.Equal(built, message) {
				t.Fatal("signed sole maximum E8 differs from Go codec")
			}
			purpose, err := ynxbatch.AuthSourceStatementV2Purpose(in.role)
			requireNoError(t, err)
			if purpose != row.Purpose {
				t.Fatal("signed role purpose differs")
			}
			decoded, err := ynxbatch.DecodeMember(in.registration.member)
			requireNoError(t, err)
			if decoded.Certificate.N != 1 || decoded.Index != 0 || len(decoded.PathA) != 0 || len(decoded.PathB) != 0 || !bytes.Equal(decoded.Message, message) {
				t.Fatal("actual signed original is not exact N1 maximum message")
			}
			if code := verifySourceStatementV2(in); code != registeredN1OK {
				t.Fatalf("maximum original AND failed: %d", code)
			}
			// Actual compiled C caller -> hand header -> 18th export -> same
			// registered AND math. Includes null/layout/alias/result-reset and
			// raw body+1/member+1/frame+1 controls; no archive is rebuilt.
			if control := sourceStatementV2ForeignControls(in); control != 0 {
				t.Fatalf("maximum original actual C boundary control failed: %d", control)
			}
			sourceV2CapacityEnvelope(t, row, in, envelope)
			generic := in.registration
			generic.message, generic.purpose = message, purpose
			if registeredN1MemberMaximum != 98304 || registeredN1MessageMaximum != 65536 || verifyRegisteredANDMemberN1(generic) != registeredN1Argument {
				t.Fatal("generic ABI admitted dedicated Source-v2 maximum")
			}
			generic.member = []byte{1}
			if verifyRegisteredANDMemberN1(generic) != registeredN1Argument {
				t.Fatal("generic message-only upper bound widened")
			}
			generic.member, generic.message = in.registration.member, nil
			if verifyRegisteredANDMemberN1(generic) != registeredN1Argument {
				t.Fatal("generic member-only upper bound widened")
			}
			t.Logf("PUBLIC_SOURCE_V2_CAPACITY role=%s message=%d rawMember=%d outer=%d actualC=true AND=true genericRejected=true RootAdmission=false SourceAdmission=false NativeAdmission=false", row.Role, len(message), len(in.registration.member), len(envelope))
		})
	}
}

func TestAuthSourceStatementV2CapacitySignedRejectsSubstitution(t *testing.T) {
	for _, row := range sourceV2CapacitySignedRows(t) {
		in, _, _ := sourceV2CapacityInputs(t, row)
		for _, name := range []string{"frame-plus-one", "body-plus-one", "member-plus-one", "independent-policy-frame", "role", "disabled", "revoked-current", "revision", "network", "owner", "fullpair-A", "fullpair-B", "purpose", "signature-A", "signature-B", "root-A", "root-B"} {
			t.Run(row.Role+"/"+name, func(t *testing.T) {
				bad := in
				want := registeredN1TrustDenied
				switch name {
				case "frame-plus-one":
					bad.frame += "x"
					want = registeredN1Argument
				case "body-plus-one":
					bad.body = append(bytes.Clone(in.body), ' ')
					want = registeredN1Argument
				case "member-plus-one":
					bad.registration.member = make([]byte, 262145)
					want = registeredN1Argument
				case "independent-policy-frame":
					bad.frame = "INDEPENDENT-ROOT-RELEASE-FRAME-DOES-NOT-MATCH"
					want = registeredN1MathInvalid
				case "role":
					bad.role = ynxbatch.AuthSourceEnrollmentV2
					if in.role == bad.role {
						bad.role = ynxbatch.AuthSourceCurrentV2
					}
				case "disabled":
					bad.registration.enabled = 0
				case "revoked-current":
					bad.registration.hasRevokedAt = 1
					bad.registration.revokedAt = math.MaxUint64
				case "revision":
					bad.registration.policyRevision--
					want = registeredN1MathInvalid
				case "network":
					bad.registration.network = bytes.Clone(in.registration.network)
					bad.registration.network[0] ^= 1
				case "owner":
					bad.registration.owner = "0x" + strings.Repeat("11", 20)
				case "fullpair-A":
					bad.registration.pkA = bytes.Clone(in.registration.pkA)
					bad.registration.pkA[0] ^= 1
				case "fullpair-B":
					bad.registration.pkB = bytes.Clone(in.registration.pkB)
					bad.registration.pkB[0] ^= 1
				default:
					member, err := ynxbatch.DecodeMember(in.registration.member)
					requireNoError(t, err)
					want = registeredN1MathInvalid
					switch name {
					case "purpose":
						member.Certificate.Purpose = "TX-BATCH"
						want = registeredN1TrustDenied
					case "signature-A":
						member.Certificate.SigmaA[0] ^= 1
					case "signature-B":
						member.Certificate.SigmaB[0] ^= 1
					case "root-A":
						member.Certificate.RootA[0] ^= 1
					case "root-B":
						member.Certificate.RootB[0] ^= 1
					}
					bad.registration.member, err = ynxbatch.EncodeMember(member)
					requireNoError(t, err)
				}
				if got := verifySourceStatementV2(bad); got != want {
					t.Fatalf("exact capacity refusal changed: got %d want %d", got, want)
				}
				// The same C caller's first check requires verified success; it
				// must stop at 1 for each rejected independent input/original.
				if got := sourceStatementV2ForeignControls(bad); got != 1 {
					t.Fatalf("actual C accepted substituted capacity original: %d", got)
				}
			})
		}
	}
}
