package ynxbatch

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// PUBLIC SYNTHETIC DATA only. R13 reuses the original JS/Go public fixture;
// there is no key generation, signing, real Principal/Source or registration.
type publisherRegistrationFixture struct {
	pub               ArtifactPublisherRegistration
	custodian         PublisherRegistrationCustodianBinding
	p                 ProjectControlPrincipal
	c                 ProjectControlCommand
	b                 PublisherRegistrationBody
	r, pr, cr, br, pm []byte
}

// Independent SDK canonical(): sorted keys and literal UTF8/HTML strings.
func publisherRegistrationTestBody(b PublisherRegistrationBody) []byte {
	values := map[string]any{"account": b.Account, "callerIdentity": b.CallerIdentity,
		"commandSHA256": b.CommandSHA256, "custodyCurrentRef": b.CustodyCurrentRef,
		"expiresAtMs": b.ExpiresAtMS, "issuedAtMs": b.IssuedAtMS, "keyRole": b.KeyRole,
		"nonce": b.Nonce, "principalSHA256": b.PrincipalSHA256, "projectId": b.ProjectID,
		"publicSHA256": b.PublicSHA256, "publisherId": b.PublisherID,
		"publisherKeyVersion": b.PublisherKeyVersion, "registrationRef": b.RegistrationRef,
		"sourceCurrentRef": b.SourceCurrentRef, "version": b.Version}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var out strings.Builder
	quoted := func(s string) {
		out.WriteByte('"')
		for _, r := range s {
			if r == '"' || r == '\\' {
				out.WriteByte('\\')
			}
			if r < 0x20 {
				fmt.Fprintf(&out, `\u%04x`, r)
			} else {
				out.WriteRune(r)
			}
		}
		out.WriteByte('"')
	}
	out.WriteByte('{')
	for i, key := range keys {
		if i != 0 {
			out.WriteByte(',')
		}
		quoted(key)
		out.WriteByte(':')
		switch value := values[key].(type) {
		case string:
			quoted(value)
		case uint64:
			out.WriteString(strconv.FormatUint(value, 10))
		}
	}
	out.WriteByte('}')
	return []byte(out.String())
}

func publisherRegistrationTestFixture(t testing.TB) publisherRegistrationFixture {
	t.Helper()
	f := publisherRegistrationFixture{pub: artifactTestFixedPublisher(t)}
	var err error
	f.r, err = EncodeArtifactPublisherRegistration(f.pub)
	requireNoError(t, err)
	f.p = ProjectControlPrincipal{Account: "developer-principal", DeviceID: "device-alpha", SessionRef: "session-alpha", CurrentRef: "publisher-current",
		AccountGeneration: math.MaxUint64, SessionGeneration: 9007199254740993, ExpiresMS: 60000}
	f.c = ProjectControlCommand{RequestID: "publisher-request", Action: "project.publisher", ProjectID: f.pub.ProjectID,
		SubjectAccount: f.pub.Account, PublisherID: f.pub.PublisherID, ExpectedRevision: 7, GrantExpiresMS: 60000, ExpiresMS: 60000, PublicOriginalSHA256: artifactTestSHA(f.r)}
	f.pr, err = json.Marshal(f.p)
	requireNoError(t, err)
	f.cr, err = json.Marshal(f.c)
	requireNoError(t, err)
	f.b = PublisherRegistrationBody{Version: PublisherRegistrationBodyVersion, Account: f.pub.Account,
		ProjectID: f.pub.ProjectID, PublisherID: f.pub.PublisherID, PublisherKeyVersion: f.pub.PublisherKeyVersion,
		RegistrationRef: "publisher-registration", PrincipalSHA256: artifactTestSHA(f.pr), CommandSHA256: artifactTestSHA(f.cr), PublicSHA256: artifactTestSHA(f.r),
		KeyRole: ArtifactPublisherKeyRole, CallerIdentity: "original-native", SourceCurrentRef: f.p.CurrentRef, CustodyCurrentRef: "custodian-current",
		Nonce: base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32)), IssuedAtMS: 1000, ExpiresAtMS: 20000}
	f.br = publisherRegistrationTestBody(f.b)
	f.custodian = PublisherRegistrationCustodianBinding{NetworkID: clone(f.pub.NetworkID), Owner: "0x" + strings.Repeat("22", 20),
		KeyVersion: "18446744073709551615", ExecutionHeight: "18446744073709551615", CallerIdentity: f.b.CallerIdentity, SourceCurrentRef: f.b.CustodyCurrentRef,
		PKA: bytes.Repeat([]byte{0x53}, PublicKeyASize), PKB: bytes.Repeat([]byte{0x54}, PublicKeyBSize)}
	// The encoder only hashes bytes: this retained public Member deliberately
	// is NOT asserted to have the new PoP purpose or a new valid signature.
	f.pm = b64(t, fixture(t).Member)
	return f
}

func publisherRegistrationTestPoP(t testing.TB, f publisherRegistrationFixture) []byte {
	t.Helper()
	raw, err := BuildPublisherRegistrationPoPMessage(f.r, f.pr, f.cr, f.br, f.pub, 1001)
	requireNoError(t, err)
	return raw
}

func publisherRegistrationTestCustodian(t testing.TB, f publisherRegistrationFixture) []byte {
	t.Helper()
	raw, err := BuildPublisherRegistrationCustodianMessage(f.r, f.pr, f.cr, f.br, f.pm, f.pub, f.custodian, 1001)
	requireNoError(t, err)
	return raw
}

func TestPublisherRegistrationSDK42ExactPoP9AndCustodian12(t *testing.T) {
	f := publisherRegistrationTestFixture(t)
	pop := publisherRegistrationTestPoP(t, f)
	wantPoP := artifactTestFrame([]byte("YNX-IDE-PUBLISHER-REGISTRATION/v1"), []byte("YNX-BATCH/v0.1"),
		[]byte("ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512"), []byte("IDE-PUBLISHER-REGISTRATION"), f.pub.NetworkID,
		[]byte(f.pub.SubjectOwner), []byte("1"), f.r, f.br)
	same(t, pop, wantPoP)
	custody := publisherRegistrationTestCustodian(t, f)
	wantCustody := artifactTestFrame([]byte("YNX-AUTH-PROTECTED-PUBLISHER-REGISTRATION/v1"), []byte("YNX-BATCH/v0.1"),
		[]byte("ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512"), []byte("AUTH-PUBLISHER-REGISTRATION"), f.pub.NetworkID,
		[]byte(f.custodian.Owner), []byte("18446744073709551615"), []byte("18446744073709551615"), f.pr, f.cr, f.br, []byte(artifactTestSHA(f.pm)))
	same(t, custody, wantCustody)
	// Independently framed SDK42 source-contract vectors, not executed SDK or
	// new signed proofs. The older R13 public vector stays byte-for-byte intact.
	if len(pop) != 3920 || artifactTestSHA(pop) != "1be4e36a21f15b82f8aa08b9f2255cb35eafb06accef7dd0169036f2acbb0d23" ||
		len(custody) != 1705 || artifactTestSHA(custody) != "23353df7efa93d53d62494b7d8a303a63a39b53da4c74f70702fb284011f2d8b" ||
		len(f.br) != 715 || artifactTestSHA(f.br) != "71e6e8f66d343ac5b75f28fa0fbbc110da518b3dd7a25a2d30d44448f3cafd63" {
		t.Fatal("SDK42 fixed E9/E12 original bytes differ")
	}
	v, err := InspectPublisherRegistrationPoPMessage(pop, f.pub, f.r, f.pr, f.cr, f.br, 1001)
	requireNoError(t, err)
	if v.Principal.AccountGeneration != math.MaxUint64 || v.Principal.SessionGeneration != 9007199254740993 || v.Principal.Account != "developer-principal" || v.Command.Action != "project.publisher" {
		t.Fatal("original Principal/Command or independent developer identity changed")
	}
	c, err := InspectPublisherRegistrationCustodianMessage(custody, f.custodian, f.pub, f.r, f.pr, f.cr, f.br, f.pm, 1001)
	requireNoError(t, err)
	if c.PoPMemberSHA256 != "a84ea0f13eeffe8e60c40c917108e4313986e764a9da90a233eafba6d7134950" || c.Custodian.Owner == c.Publisher.SubjectOwner {
		t.Fatal("raw PoP hash or separate custodian context changed")
	}
	t.Logf("PUBLISHER_REGISTRATION_SDK42_PUBLIC_DATA popBytes=%d popSHA256=%s custodianBytes=%d custodianSHA256=%s authorityNotEstablished=true", len(pop), artifactTestSHA(pop), len(custody), artifactTestSHA(custody))
}

func TestPublisherRegistrationCanonicalBodyAndOriginalBindingRejects(t *testing.T) {
	cases := []struct {
		name string
		edit func(*publisherRegistrationFixture)
	}{
		{"body duplicate", func(f *publisherRegistrationFixture) { f.br = append([]byte(`{"account":"shadow",`), f.br[1:]...) }},
		{"body alias", func(f *publisherRegistrationFixture) {
			f.br = bytes.Replace(f.br, []byte(`"account":`), []byte(`"Account":`), 1)
		}},
		{"body order", func(f *publisherRegistrationFixture) {
			f.br = append([]byte(`{"version":"`+PublisherRegistrationBodyVersion+`",`), bytes.Replace(f.br[1:], []byte(`,"version":"`+PublisherRegistrationBodyVersion+`"`), nil, 1)...)
		}},
		{"body extra", func(f *publisherRegistrationFixture) {
			f.br = append(clone(f.br[:len(f.br)-1]), []byte(`,"approved":true}`)...)
		}},
		{"body trailing", func(f *publisherRegistrationFixture) { f.br = append(f.br, '\n') }},
		{"body number alias", func(f *publisherRegistrationFixture) {
			f.br = bytes.Replace(f.br, []byte(`"issuedAtMs":1000`), []byte(`"issuedAtMs":1e3`), 1)
		}},
		{"body null", func(f *publisherRegistrationFixture) {
			f.br = bytes.Replace(f.br, []byte(`"issuedAtMs":1000`), []byte(`"issuedAtMs":null`), 1)
		}},
		{"principal duplicate", func(f *publisherRegistrationFixture) { f.pr = append([]byte(`{"Account":"shadow",`), f.pr[1:]...) }},
		{"principal alias", func(f *publisherRegistrationFixture) {
			f.pr = bytes.Replace(f.pr, []byte(`"Account":`), []byte(`"account":`), 1)
		}},
		{"command trailing", func(f *publisherRegistrationFixture) { f.cr = append(f.cr, '\n') }},
		{"public original", func(f *publisherRegistrationFixture) { f.r[len(f.r)-1] ^= 1 }},
		{"expected pair", func(f *publisherRegistrationFixture) { f.pub.PKB[0] ^= 1 }},
		{"current", func(f *publisherRegistrationFixture) {
			f.b.SourceCurrentRef = "foreign-current"
			f.br = publisherRegistrationTestBody(f.b)
		}},
		{"public hash", func(f *publisherRegistrationFixture) {
			f.b.PublicSHA256 = strings.Repeat("a", 64)
			f.br = publisherRegistrationTestBody(f.b)
		}},
		{"role", func(f *publisherRegistrationFixture) {
			f.b.KeyRole = "project-control"
			f.br = publisherRegistrationTestBody(f.b)
		}},
		{"version overflow", func(f *publisherRegistrationFixture) {
			f.b.PublisherKeyVersion = "18446744073709551616"
			f.br = publisherRegistrationTestBody(f.b)
		}},
		{"nonce zero", func(f *publisherRegistrationFixture) {
			f.b.Nonce = base64.RawURLEncoding.EncodeToString(make([]byte, 32))
			f.br = publisherRegistrationTestBody(f.b)
		}},
		{"nonce padded", func(f *publisherRegistrationFixture) { f.b.Nonce += "="; f.br = publisherRegistrationTestBody(f.b) }},
		{"unsafe integer", func(f *publisherRegistrationFixture) {
			f.b.ExpiresAtMS = 1 << 53
			f.br = publisherRegistrationTestBody(f.b)
		}},
		{"long window", func(f *publisherRegistrationFixture) {
			f.b.ExpiresAtMS = 31001
			f.br = publisherRegistrationTestBody(f.b)
		}},
		{"expired", func(f *publisherRegistrationFixture) {
			f.b.ExpiresAtMS = 1001
			f.br = publisherRegistrationTestBody(f.b)
		}},
		{"revoke", func(f *publisherRegistrationFixture) {
			f.c.Revoke = true
			f.c.GrantExpiresMS = 0
			f.cr, _ = json.Marshal(f.c)
			f.b.CommandSHA256 = artifactTestSHA(f.cr)
			f.br = publisherRegistrationTestBody(f.b)
		}},
		{"subject", func(f *publisherRegistrationFixture) {
			f.c.SubjectAccount = "foreign-account"
			f.cr, _ = json.Marshal(f.c)
			f.b.CommandSHA256 = artifactTestSHA(f.cr)
			f.br = publisherRegistrationTestBody(f.b)
		}},
		{"grant expiry", func(f *publisherRegistrationFixture) {
			f.c.GrantExpiresMS = 10000
			f.cr, _ = json.Marshal(f.c)
			f.b.CommandSHA256 = artifactTestSHA(f.cr)
			f.br = publisherRegistrationTestBody(f.b)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := publisherRegistrationTestFixture(t)
			tc.edit(&f)
			_, err := BuildPublisherRegistrationPoPMessage(f.r, f.pr, f.cr, f.br, f.pub, 1001)
			requireError(t, err)
			_, err = BuildPublisherRegistrationCustodianMessage(f.r, f.pr, f.cr, f.br, f.pm, f.pub, f.custodian, 1001)
			requireError(t, err)
		})
	}
}

func TestPublisherRegistrationFrameIsolationOverflowAndTrailingRejects(t *testing.T) {
	f := publisherRegistrationTestFixture(t)
	pop, custody := publisherRegistrationTestPoP(t, f), publisherRegistrationTestCustodian(t, f)
	for _, kind := range []string{"pop", "custody"} {
		raw, count, maximum := pop, 9, MaxPublisherRegistrationPoPMessageBytes
		if kind == "custody" {
			raw, count, maximum = custody, 12, MaxPublisherRegistrationCustodianMessageBytes
		}
		parts, err := DecodeFields(raw, count, maximum)
		requireNoError(t, err)
		for _, change := range []string{"tag", "suite", "purpose", "order", "duplicate", "trailing", "overflow", "PoP hash"} {
			t.Run(kind+"/"+change, func(t *testing.T) {
				fields := copyMessages(parts)
				switch change {
				case "tag":
					fields[0] = []byte(ProjectControlMessageVersion)
				case "suite":
					fields[2] = []byte("ML-DSA-87/OR/SLH-DSA-SHA2-256f")
				case "purpose":
					fields[3] = []byte(ArtifactPublicationPurpose)
				case "order":
					fields[len(fields)-1], fields[len(fields)-2] = fields[len(fields)-2], fields[len(fields)-1]
				case "duplicate":
					fields = append(fields, fields[len(fields)-1])
				case "PoP hash":
					fields[len(fields)-1][0] ^= 1
				}
				changed, err := EncodeFields(fields...)
				requireNoError(t, err)
				if change == "trailing" {
					changed = append(changed, 0)
				}
				if change == "overflow" {
					binary.BigEndian.PutUint32(changed[4:8], math.MaxUint32)
				}
				if kind == "pop" {
					_, err = InspectPublisherRegistrationPoPMessage(changed, f.pub, f.r, f.pr, f.cr, f.br, 1001)
				} else {
					_, err = InspectPublisherRegistrationCustodianMessage(changed, f.custodian, f.pub, f.r, f.pr, f.cr, f.br, f.pm, 1001)
				}
				requireError(t, err)
			})
		}
	}
	_, err := InspectPublisherRegistrationPoPMessage(custody, f.pub, f.r, f.pr, f.cr, f.br, 1001)
	requireError(t, err)
	_, err = InspectPublisherRegistrationCustodianMessage(pop, f.custodian, f.pub, f.r, f.pr, f.cr, f.br, f.pm, 1001)
	requireError(t, err)
}

func TestPublisherRegistrationDetachedDataAndCustodianContext(t *testing.T) {
	f := publisherRegistrationTestFixture(t)
	raw := publisherRegistrationTestCustodian(t, f)
	v, err := InspectPublisherRegistrationCustodianMessage(raw, f.custodian, f.pub, f.r, f.pr, f.cr, f.br, f.pm, 1001)
	requireNoError(t, err)
	v.Publisher.PKA[0] ^= 1
	v.Publisher.PKB[0] ^= 1
	v.Publisher.NetworkID[0] ^= 1
	v.Custodian.PKA[0] ^= 1
	v.Custodian.PKB[0] ^= 1
	v.Custodian.NetworkID[0] ^= 1
	for _, b := range [][]byte{v.PublicOriginal, v.PrincipalOriginal, v.CommandOriginal, v.RegistrationOriginal, v.PoPMemberOriginal} {
		b[0] ^= 1
	}
	same(t, publisherRegistrationTestCustodian(t, f), raw)
	for _, change := range []string{"network", "caller", "current", "version", "height", "missing A", "missing B", "owner"} {
		t.Run(change, func(t *testing.T) {
			b := f.custodian
			b.NetworkID, b.PKA, b.PKB = clone(b.NetworkID), clone(b.PKA), clone(b.PKB)
			switch change {
			case "network":
				b.NetworkID[0] ^= 1
			case "caller":
				b.CallerIdentity = "foreign-native"
			case "current":
				b.SourceCurrentRef = "foreign-current"
			case "version":
				b.KeyVersion = "01"
			case "height":
				b.ExecutionHeight = "18446744073709551616"
			case "missing A":
				b.PKA = nil
			case "missing B":
				b.PKB = nil
			case "owner":
				b.Owner = "0x" + strings.Repeat("33", 20)
			}
			_, err := InspectPublisherRegistrationCustodianMessage(raw, b, f.pub, f.r, f.pr, f.cr, f.br, f.pm, 1001)
			requireError(t, err)
		})
	}
}

func TestPublisherRegistrationSDK42UnicodeAndBoundaryInputs(t *testing.T) {
	for _, r := range []rune{'\u2028', '\u2029', '\u0085', '\ufeff'} {
		t.Run(fmt.Sprintf("U%04X", r), func(t *testing.T) {
			f := publisherRegistrationTestFixture(t)
			middle := string(r)
			f.b.RegistrationRef = "registration" + middle + `<>&-\u2028` + "original"
			f.br = publisherRegistrationTestBody(f.b)
			_, err := ParsePublisherRegistrationBody(f.br)
			requireNoError(t, err)
			if !bytes.Contains(f.br, []byte(middle)) || !bytes.Contains(f.br, []byte(`<>&-\\u2028`)) {
				t.Fatal("SDK canonical literal Unicode/HTML/backslash changed")
			}
			_ = publisherRegistrationTestPoP(t, f)
			if r != '\ufeff' {
				f.b.RegistrationRef = middle + "registration"
				_, err = ParsePublisherRegistrationBody(publisherRegistrationTestBody(f.b))
				requireError(t, err)
			}
		})
	}
	f := publisherRegistrationTestFixture(t)
	for _, at := range []uint64{999, 20000, 1 << 53} {
		_, err := BuildPublisherRegistrationPoPMessage(f.r, f.pr, f.cr, f.br, f.pub, at)
		requireError(t, err)
	}
	for _, size := range []int{0, MaxPublisherRegistrationPoPMemberBytes, MaxPublisherRegistrationPoPMemberBytes + 1} {
		member := bytes.Repeat([]byte{1}, size)
		_, err := BuildPublisherRegistrationCustodianMessage(f.r, f.pr, f.cr, f.br, member, f.pub, f.custodian, 1001)
		if size == MaxPublisherRegistrationPoPMemberBytes {
			requireNoError(t, err) // Encoder hashes opaque raw bytes, not authority.
		} else {
			requireError(t, err)
		}
	}
	for _, operand := range []string{"public", "principal", "command", "registration"} {
		r, pr, cr, br := f.r, f.pr, f.cr, f.br
		switch operand {
		case "public":
			r = bytes.Repeat([]byte{'x'}, MaxPublisherRegistrationPublicBytes+1)
		case "principal":
			pr = bytes.Repeat([]byte{'x'}, MaxProjectControlPrincipalBytes+1)
		case "command":
			cr = bytes.Repeat([]byte{'x'}, MaxProjectControlCommandBytes+1)
		case "registration":
			br = bytes.Repeat([]byte{'x'}, MaxPublisherRegistrationBodyBytes+1)
		}
		_, err := BuildPublisherRegistrationPoPMessage(r, pr, cr, br, f.pub, 1001)
		requireError(t, err)
	}
}

func publisherRegistrationSignedMember(t testing.TB, key *PrivateKey, metadata Metadata, message []byte) (*Batch, []byte) {
	t.Helper()
	batch, err := BatchSign(key, metadata, [][]byte{message}, SignOptions{Optimized: true})
	requireNoError(t, err)
	t.Cleanup(batch.Discard)
	m, err := Extract(batch, 0)
	requireNoError(t, err)
	wire, err := EncodeMember(m)
	requireNoError(t, err)
	return batch, wire
}

// These real provider calls are CI test source, not a claim that local tests
// were run or that any genuine Source/custodian/Root authority was obtained.
func TestPublisherRegistrationSDK46N1ActualDualANDAndIndependentCustodian(t *testing.T) {
	publisherKey, publisherPair, err := KeyGen()
	requireNoError(t, err)
	defer publisherKey.Destroy()
	custodianKey, custodianPair, err := KeyGen()
	requireNoError(t, err)
	defer custodianKey.Destroy()
	f := publisherRegistrationTestFixture(t)
	f.pub.PKA, f.pub.PKB = clone(publisherPair.PKA), clone(publisherPair.PKB)
	f.r, err = EncodeArtifactPublisherRegistration(f.pub)
	requireNoError(t, err)
	f.c.PublicOriginalSHA256 = artifactTestSHA(f.r)
	f.cr, err = json.Marshal(f.c)
	requireNoError(t, err)
	f.b.CommandSHA256, f.b.PublicSHA256 = artifactTestSHA(f.cr), artifactTestSHA(f.r)
	f.br = publisherRegistrationTestBody(f.b)
	f.custodian.PKA, f.custodian.PKB = clone(custodianPair.PKA), clone(custodianPair.PKB)
	popMessage := publisherRegistrationTestPoP(t, f)
	popBatch, popWire := publisherRegistrationSignedMember(t, publisherKey,
		Metadata{ChainID: f.pub.NetworkID, Owner: f.pub.SubjectOwner, Purpose: PublisherRegistrationPoPPurpose}, popMessage)
	f.pm = clone(popWire)
	custodianMessage := publisherRegistrationTestCustodian(t, f)
	custodianBatch, custodianWire := publisherRegistrationSignedMember(t, custodianKey,
		Metadata{ChainID: f.custodian.NetworkID, Owner: f.custodian.Owner, Purpose: PublisherRegistrationCustodianPurpose}, custodianMessage)
	inspectPoP := func(raw []byte) error {
		_, err := InspectPublisherRegistrationPoPMember(raw, f.pub, f.r, f.pr, f.cr, f.br, 1001)
		return err
	}
	inspectCustodian := func(raw []byte) error {
		_, err := InspectPublisherRegistrationCustodianMember(raw, f.custodian, f.pub, f.r, f.pr, f.cr, f.br, f.pm, 1001)
		return err
	}
	// Public synthetic resolvers exercise only the existing dual-AND math.
	// Production must independently obtain genuine current Source/role/ACL.
	popRegistration := Registration{AlgorithmVersion: Version, ChainID: clone(f.pub.NetworkID), Owner: f.pub.SubjectOwner,
		Purpose: PublisherRegistrationPoPPurpose, PKA: clone(publisherPair.PKA), PKB: clone(publisherPair.PKB), PolicyRevision: f.pub.PublisherKeyVersion, Enabled: true}
	custodianRegistration := Registration{AlgorithmVersion: Version, ChainID: clone(f.custodian.NetworkID), Owner: f.custodian.Owner,
		Purpose: PublisherRegistrationCustodianPurpose, PKA: clone(custodianPair.PKA), PKB: clone(custodianPair.PKB), PolicyRevision: f.custodian.KeyVersion, Enabled: true}
	popVerifier := verifier(t, &popRegistration, 1, true)
	defer popVerifier.Clear()
	custodianVerifier := verifier(t, &custodianRegistration, 1, true)
	defer custodianVerifier.Clear()
	height, err := strconv.ParseUint(f.custodian.ExecutionHeight, 10, 64)
	requireNoError(t, err)
	profiles := []struct {
		name    string
		wire    []byte
		batch   *Batch
		inspect func([]byte) error
		v       *Verifier
		reg     *Registration
		height  uint64
	}{
		{"pop", popWire, popBatch, inspectPoP, popVerifier, &popRegistration, 0},
		{"custodian", custodianWire, custodianBatch, inspectCustodian, custodianVerifier, &custodianRegistration, height},
	}
	for _, profile := range profiles {
		t.Run(profile.name, func(t *testing.T) {
			requireNoError(t, profile.inspect(profile.wire))
			requireNoError(t, profile.v.VerifyOne(profile.wire, profile.height))
			for _, branch := range []string{"A", "B"} {
				bad, err := DecodeMember(profile.wire)
				requireNoError(t, err)
				if branch == "A" {
					bad.Certificate.SigmaA[0] ^= 1
				} else {
					bad.Certificate.SigmaB[0] ^= 1
				}
				wire, err := EncodeMember(bad)
				requireNoError(t, err)
				requireNoError(t, profile.inspect(wire)) // Structure does NOT authenticate signatures.
				requireError(t, profile.v.VerifyOne(wire, profile.height))
			}
			for _, purpose := range []string{ArtifactPublicationPurpose, ProjectControlPurpose, PublisherRegistrationPoPPurpose, PublisherRegistrationCustodianPurpose, "TX-BATCH", "AUTH-PROTECTED-KEY-CALL"} {
				if purpose == profile.reg.Purpose {
					continue
				}
				bad, err := DecodeMember(profile.wire)
				requireNoError(t, err)
				bad.Certificate.Purpose = purpose
				wire, err := EncodeMember(bad)
				requireNoError(t, err)
				requireError(t, profile.inspect(wire))
			}
			for _, change := range []string{"network", "owner", "pair A", "pair B", "N2"} {
				bad, err := DecodeMember(profile.wire)
				requireNoError(t, err)
				switch change {
				case "network":
					bad.Certificate.ChainID[0] ^= 1
				case "owner":
					bad.Certificate.Owner = "0x" + strings.Repeat("99", 20)
				case "pair A":
					bad.Certificate.PKA[0] ^= 1
				case "pair B":
					bad.Certificate.PKB[0] ^= 1
				case "N2":
					bad.Certificate.N = 2
					bad.PathA, bad.PathB = [][]byte{make([]byte, 64)}, [][]byte{make([]byte, 64)}
				}
				wire, err := EncodeMember(bad)
				requireNoError(t, err)
				requireError(t, profile.inspect(wire))
			}
			m, err := DecodeMember(profile.wire)
			requireNoError(t, err)
			cert, err := EncodeCertificate(m.Certificate)
			requireNoError(t, err)
			for _, proof := range [][]byte{
				artifactTestFrame(U32(1), artifactTestFrame(), artifactTestFrame()),
				artifactTestFrame(U32(0), artifactTestFrame(make([]byte, 64)), artifactTestFrame()),
			} {
				requireError(t, profile.inspect(artifactTestFrame([]byte(Version+"/MEMBER"), cert, m.Message, proof)))
			}
			whole, err := profile.batch.WholeWire()
			requireNoError(t, err)
			requireError(t, profile.inspect(whole))
			requireError(t, profile.inspect(cert))
			requireError(t, profile.inspect(append(clone(profile.wire), 0)))
			requireError(t, profile.inspect(bytes.Repeat([]byte{'x'}, MaxPublisherRegistrationPoPMemberBytes+1)))
			// Previously verified certificates cannot reuse a stale enabled flag
			// or either stale registered algorithm key, even with the other valid.
			original := *profile.reg
			for _, change := range []string{"disabled", "old A", "old B"} {
				*profile.reg = original
				switch change {
				case "disabled":
					profile.reg.Enabled = false
				case "old A":
					profile.reg.PKA = clone(profile.reg.PKA)
					profile.reg.PKA[0] ^= 1
				case "old B":
					profile.reg.PKB = clone(profile.reg.PKB)
					profile.reg.PKB[0] ^= 1
				}
				requireError(t, profile.v.VerifyOne(profile.wire, profile.height))
			}
			*profile.reg = original
			revokedAt := profile.height
			profile.reg.RevokedAt = &revokedAt
			requireError(t, profile.v.VerifyOne(profile.wire, profile.height))
			*profile.reg = original
			handle, err := profile.v.AuthenticateCertificate(cert, profile.height)
			requireNoError(t, err)
			profile.v.Clear()
			requireError(t, profile.v.VerifyMember(handle, m.Message, m.Proof, profile.height))
			if profile.v.Stats().CachedCertificates != 0 {
				t.Fatal("Clear retained authenticated publisher registration cache")
			}
		})
	}
	for _, branch := range []string{"A", "B", "both"} {
		independent := f.custodian
		bad, err := DecodeMember(custodianWire)
		requireNoError(t, err)
		if branch != "B" {
			independent.PKA, bad.Certificate.PKA = clone(f.pub.PKA), clone(f.pub.PKA)
		}
		if branch != "A" {
			independent.PKB, bad.Certificate.PKB = clone(f.pub.PKB), clone(f.pub.PKB)
		}
		wire, err := EncodeMember(bad)
		requireNoError(t, err)
		_, err = InspectPublisherRegistrationCustodianMember(wire, independent, f.pub, f.r, f.pr, f.cr, f.br, f.pm, 1001)
		requireError(t, err) // Different owner labels cannot rescue a shared algorithm key.
	}
	for _, change := range []string{"publisher version", "custodian version", "height", "caller", "current", "public", "principal", "command", "registration"} {
		pub, custodian := f.pub, f.custodian
		r, pr, cr, br := clone(f.r), clone(f.pr), clone(f.cr), clone(f.br)
		switch change {
		case "publisher version":
			pub.PublisherKeyVersion = "2"
		case "custodian version":
			custodian.KeyVersion = "1"
		case "height":
			custodian.ExecutionHeight = "0"
		case "caller":
			custodian.CallerIdentity = "other-caller"
		case "current":
			custodian.SourceCurrentRef = "other-current"
		case "public":
			r[len(r)-1] ^= 1
		case "principal":
			pr = bytes.Replace(pr, []byte("developer-principal"), []byte("different-principal"), 1)
		case "command":
			cr = bytes.Replace(cr, []byte("publisher-request"), []byte("different-request"), 1)
		case "registration":
			b := f.b
			b.RegistrationRef = "different-registration"
			br = publisherRegistrationTestBody(b)
		}
		_, err = InspectPublisherRegistrationCustodianMember(custodianWire, custodian, pub, r, pr, cr, br, f.pm, 1001)
		requireError(t, err)
		if change == "publisher version" || change == "public" || change == "principal" || change == "command" || change == "registration" {
			_, err = InspectPublisherRegistrationPoPMember(popWire, pub, r, pr, cr, br, 1001)
			requireError(t, err)
		}
	}
	// E12 hashes the ENTIRE original Member, including its certificate and
	// signatures. Hashes of a message/certificate/Whole cannot stand in for it.
	pop, err := DecodeMember(popWire)
	requireNoError(t, err)
	popCertificate, err := EncodeCertificate(pop.Certificate)
	requireNoError(t, err)
	whole, err := popBatch.WholeWire()
	requireNoError(t, err)
	parts, err := DecodeFields(custodianMessage, 12, MaxPublisherRegistrationCustodianMessageBytes)
	requireNoError(t, err)
	for _, original := range [][]byte{pop.Message, popCertificate, whole} {
		wrongParts := copyMessages(parts)
		wrongParts[11] = []byte(artifactTestSHA(original))
		wrongMessage, err := EncodeFields(wrongParts...)
		requireNoError(t, err)
		bad, err := DecodeMember(custodianWire)
		requireNoError(t, err)
		bad.Message = wrongMessage
		wire, err := EncodeMember(bad)
		requireNoError(t, err)
		requireError(t, inspectCustodian(wire))
	}
	changedPoPMember, err := DecodeMember(popWire)
	requireNoError(t, err)
	changedPoPMember.Certificate.SigmaA[0] ^= 1
	changedPoP, err := EncodeMember(changedPoPMember)
	requireNoError(t, err)
	requireNoError(t, inspectPoP(changedPoP)) // Still structurally exact, but a DIFFERENT whole raw Member.
	_, err = InspectPublisherRegistrationCustodianMember(custodianWire, f.custodian, f.pub, f.r, f.pr, f.cr, f.br, changedPoP, 1001)
	requireError(t, err)
	_, err = InspectPublisherRegistrationCustodianMember(custodianWire, f.custodian, f.pub, f.r, f.pr, f.cr, f.br, whole, 1001)
	requireError(t, err)
	// Returned public members are detached; caller mutations cannot rewrite the
	// retained raw originals, expected full pairs, or the next inspection.
	inspected, err := InspectPublisherRegistrationPoPMember(popWire, f.pub, f.r, f.pr, f.cr, f.br, 1001)
	requireNoError(t, err)
	inspected.Message[0] ^= 1
	inspected.Certificate.PKA[0] ^= 1
	inspected.Certificate.PKB[0] ^= 1
	requireNoError(t, inspectPoP(popWire))
	requireNoError(t, inspectCustodian(custodianWire))
	for _, batch := range []*Batch{popBatch, custodianBatch} {
		batch.Discard()
		batch.Discard()
		_, err = Extract(batch, 0)
		requireError(t, err)
		_, err = batch.WholeWire()
		requireError(t, err)
	}
	publisherKey.Destroy()
	custodianKey.Destroy()
	_, err = BatchSign(publisherKey, Metadata{ChainID: f.pub.NetworkID, Owner: f.pub.SubjectOwner, Purpose: PublisherRegistrationPoPPurpose}, [][]byte{popMessage}, SignOptions{})
	requireError(t, err)
	_, err = BatchSign(custodianKey, Metadata{ChainID: f.custodian.NetworkID, Owner: f.custodian.Owner, Purpose: PublisherRegistrationCustodianPurpose}, [][]byte{custodianMessage}, SignOptions{})
	requireError(t, err)
}
