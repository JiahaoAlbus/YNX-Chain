package ynxbatch

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

// Every value and key below is a PUBLIC SYNTHETIC FIXTURE. These tests do not
// create a Root, Native current Source, HTTP Principal, ACL or durable approval.
type projectControlFixture struct {
	binding    ProjectControlBinding
	p          ProjectControlPrincipal
	c          ProjectControlCommand
	d          ProjectControlDecision
	pr, cr, dr []byte
}

func projectControlTestSHA(raw []byte) string {
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:])
}

func projectControlTestDecisionRaw(t testing.TB, d ProjectControlDecision) []byte {
	t.Helper()
	values := map[string]any{"version": d.Version, "decision": d.Decision, "requestId": d.RequestID,
		"principalSHA256": d.PrincipalSHA256, "commandSHA256": d.CommandSHA256, "reviewId": d.ReviewID,
		"nonce": d.Nonce, "confirmationRef": d.ConfirmationRef, "revocationRef": d.RevocationRef,
		"issuedAtMs": d.IssuedAtMS, "expiresAtMs": d.ExpiresAtMS}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var out strings.Builder
	writeString := func(s string) {
		out.WriteByte('"')
		for _, r := range s {
			switch {
			case r == '"' || r == '\\':
				out.WriteByte('\\')
				out.WriteRune(r)
			case r < 0x20:
				fmt.Fprintf(&out, `\u%04x`, r)
			default:
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
		writeString(key)
		out.WriteByte(':')
		switch value := values[key].(type) {
		case string:
			writeString(value)
		case uint64:
			out.WriteString(strconv.FormatUint(value, 10))
		default:
			t.Fatal("unexpected public decision fixture type")
		}
	}
	out.WriteByte('}')
	return []byte(out.String())
}

func projectControlTestFixture(t testing.TB, public PublicKey) projectControlFixture {
	t.Helper()
	owner := "0x" + strings.Repeat("11", 20)
	account, err := accountaddress.Encode(owner)
	requireNoError(t, err)
	f := projectControlFixture{
		binding: ProjectControlBinding{NetworkID: bytes.Repeat([]byte{0x42}, 32), Owner: owner, KeyVersion: "18446744073709551615", ExecutionHeight: "18446744073709551615",
			CallerIdentity: "original-native", SourceCurrentRef: "original-current<>&", PKA: clone(public.PKA), PKB: clone(public.PKB)},
		p: ProjectControlPrincipal{Account: account, DeviceID: "device<>&", SessionRef: "original-session", CurrentRef: "original-current<>&",
			AccountGeneration: math.MaxUint64, SessionGeneration: 9007199254740993, ExpiresMS: 60000},
		c: ProjectControlCommand{RequestID: "original-request", Action: "project.create", ProjectID: "project<>&", ExpiresMS: 60000},
	}
	f.pr, err = json.Marshal(f.p)
	requireNoError(t, err)
	f.cr, err = json.Marshal(f.c)
	requireNoError(t, err)
	f.d = ProjectControlDecision{Version: ProjectControlDecisionVersion, Decision: "approve", RequestID: f.c.RequestID,
		PrincipalSHA256: projectControlTestSHA(f.pr), CommandSHA256: projectControlTestSHA(f.cr), ReviewID: "original-review<>&",
		Nonce: base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32)), ConfirmationRef: "original-confirmation", RevocationRef: "original-revocation", IssuedAtMS: 1000, ExpiresAtMS: 20000}
	// Independent literal R194 sorted JSON: '<>&' stay literal in Decision,
	// whereas the original Go Principal/Command escaped them above.
	f.dr = []byte(`{"commandSHA256":"` + f.d.CommandSHA256 + `","confirmationRef":"original-confirmation","decision":"approve","expiresAtMs":20000,"issuedAtMs":1000,"nonce":"` + f.d.Nonce + `","principalSHA256":"` + f.d.PrincipalSHA256 + `","requestId":"original-request","reviewId":"original-review<>&","revocationRef":"original-revocation","version":"YNX-IDE-PROJECT-CONTROL-DECISION/v1"}`)
	return f
}

func projectControlPublicFixture(t testing.TB) projectControlFixture {
	t.Helper()
	c, err := DecodeCertificate(b64(t, fixture(t).Certificate))
	requireNoError(t, err)
	return projectControlTestFixture(t, PublicKey{PKA: c.PKA, PKB: c.PKB})
}

func projectControlCopyBinding(b ProjectControlBinding) ProjectControlBinding {
	b.NetworkID, b.PKA, b.PKB = clone(b.NetworkID), clone(b.PKA), clone(b.PKB)
	return b
}

// Independent E framing, deliberately not production EncodeFields.
func projectControlTestFrame(fields ...[]byte) []byte {
	var out bytes.Buffer
	_ = binary.Write(&out, binary.BigEndian, uint32(len(fields)))
	for _, f := range fields {
		_ = binary.Write(&out, binary.BigEndian, uint32(len(f)))
		_, _ = out.Write(f)
	}
	return out.Bytes()
}

func TestProjectControlExactR197OriginalsAndE13(t *testing.T) {
	f := projectControlPublicFixture(t)
	message, err := BuildProjectControlMessage(f.pr, f.cr, f.dr, f.binding, 1001)
	requireNoError(t, err)
	want := projectControlTestFrame([]byte("YNX-IDE-PROJECT-CONTROL-APPROVAL/v1"), []byte("YNX-BATCH/v0.1"),
		[]byte("ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512"), []byte("IDE-PROJECT-CONTROL"), bytes.Repeat([]byte{0x42}, 32),
		[]byte(f.binding.Owner), []byte("18446744073709551615"), []byte("18446744073709551615"), []byte("original-native"), []byte("original-current<>&"), f.pr, f.cr, f.dr)
	same(t, message, want)
	if !bytes.Contains(f.pr, []byte(`"AccountGeneration":18446744073709551615,"SessionGeneration":9007199254740993`)) ||
		!bytes.Contains(f.pr, []byte(`device\u003c\u003e\u0026`)) || !bytes.Contains(f.cr, []byte(`project\u003c\u003e\u0026`)) ||
		!bytes.Contains(f.dr, []byte(`original-review<>&`)) {
		t.Fatal("original Go integer/escaping or Auth sorted decision bytes changed")
	}
	view, err := InspectProjectControlMessage(message, f.binding, f.pr, f.cr, f.dr, 1001)
	requireNoError(t, err)
	if view.Principal.AccountGeneration != math.MaxUint64 || view.Principal.SessionGeneration != 9007199254740993 || view.Decision.Decision != "approve" || view.Command.Action != "project.create" {
		t.Fatal("original public fields changed")
	}
	view.Binding.NetworkID[0] ^= 1
	view.Binding.PKA[0] ^= 1
	view.Binding.PKB[0] ^= 1
	view.PrincipalOriginal[0] ^= 1
	view.CommandOriginal[0] ^= 1
	view.DecisionOriginal[0] ^= 1
	_, err = InspectProjectControlMessage(message, f.binding, f.pr, f.cr, f.dr, 1001)
	requireNoError(t, err)
	same(t, message, want)
	f.d.Decision = "reject"
	f.dr = projectControlTestDecisionRaw(t, f.d)
	_, err = BuildProjectControlMessage(f.pr, f.cr, f.dr, f.binding, 1001)
	requireNoError(t, err) // Rejection is signed DATA, never an Approval.
	f.d.Decision = "cancel"
	f.dr = projectControlTestDecisionRaw(t, f.d)
	_, err = BuildProjectControlMessage(f.pr, f.cr, f.dr, f.binding, 1001)
	requireError(t, err)
	t.Logf("PROJECT_CONTROL_E13_PUBLIC_DATA messageBytes=%d messageSHA256=%s algorithms=AND n=1 authorityNotEstablished=true", len(message), projectControlTestSHA(message))
}

func TestProjectControlR197UnicodeOriginalsAndLiteralBackslash(t *testing.T) {
	for _, r := range []rune{'\u2028', '\u2029', '\u0085', '\ufeff'} {
		t.Run(fmt.Sprintf("U%04X", r), func(t *testing.T) {
			f := projectControlPublicFixture(t)
			middle := string(r)
			f.p.DeviceID, f.p.CurrentRef = "device"+middle+"original", "current"+middle+"original"
			f.c.RequestID, f.c.ProjectID = "request"+middle+"original", "project"+middle+"original"
			f.binding.SourceCurrentRef, f.binding.CallerIdentity = f.p.CurrentRef, "caller"+middle+"original"
			var err error
			f.pr, err = json.Marshal(f.p)
			requireNoError(t, err)
			f.cr, err = json.Marshal(f.c)
			requireNoError(t, err)
			f.d.PrincipalSHA256, f.d.CommandSHA256, f.d.RequestID = projectControlTestSHA(f.pr), projectControlTestSHA(f.cr), f.c.RequestID
			f.d.ReviewID, f.d.ConfirmationRef, f.d.RevocationRef = "review"+middle+"original", "confirmation"+middle+"original", "revocation"+middle+"original"
			f.dr = projectControlTestDecisionRaw(t, f.d)
			if !bytes.Contains(f.dr, []byte(middle)) {
				t.Fatal("canonical JS decision lost literal UTF8")
			}
			if r == '\u2028' || r == '\u2029' {
				if bytes.Contains(f.pr, []byte(middle)) || bytes.Contains(f.cr, []byte(middle)) ||
					!bytes.Contains(f.pr, []byte(fmt.Sprintf(`\u%04x`, r))) || !bytes.Contains(f.cr, []byte(fmt.Sprintf(`\u%04x`, r))) {
					t.Fatal("original Go P/C did not retain their original U2028/U2029 escaping")
				}
			}
			message, err := BuildProjectControlMessage(f.pr, f.cr, f.dr, f.binding, 1001)
			requireNoError(t, err)
			view, err := InspectProjectControlMessage(message, f.binding, f.pr, f.cr, f.dr, 1001)
			requireNoError(t, err)
			same(t, view.PrincipalOriginal, f.pr)
			same(t, view.CommandOriginal, f.cr)
			same(t, view.DecisionOriginal, f.dr)
			if view.Principal.AccountGeneration != math.MaxUint64 || view.Principal.SessionGeneration != 9007199254740993 {
				t.Fatal("Unicode changed large original generations")
			}
			escaped := bytes.Replace(f.dr, []byte(middle), []byte(fmt.Sprintf(`\u%04x`, r)), 1)
			_, err = BuildProjectControlMessage(f.pr, f.cr, escaped, f.binding, 1001)
			requireError(t, err) // Same decoded string is not the original canonical JS bytes.
			if r != '\ufeff' {
				f.binding.CallerIdentity = middle + "caller"
				_, err = BuildProjectControlMessage(f.pr, f.cr, f.dr, f.binding, 1001)
				requireError(t, err) // Unicode White_Space at an edge remains forbidden.
			}
		})
	}
	f := projectControlPublicFixture(t)
	f.d.ReviewID = `original-literal-\u2028-\u2029`
	f.dr = projectControlTestDecisionRaw(t, f.d)
	if !bytes.Contains(f.dr, []byte(`\\u2028`)) || bytes.Contains(f.dr, []byte("\u2028")) {
		t.Fatal("literal backslash fixture changed")
	}
	_, err := BuildProjectControlMessage(f.pr, f.cr, f.dr, f.binding, 1001)
	requireNoError(t, err)
}

func TestProjectControlExpectedContextAndFrameIsolation(t *testing.T) {
	f := projectControlPublicFixture(t)
	message, err := BuildProjectControlMessage(f.pr, f.cr, f.dr, f.binding, 1001)
	requireNoError(t, err)
	for _, tc := range []struct {
		name string
		edit func(*ProjectControlBinding)
	}{
		{"network", func(b *ProjectControlBinding) { b.NetworkID[0] ^= 1 }},
		{"owner", func(b *ProjectControlBinding) { b.Owner = "0x" + strings.Repeat("22", 20) }},
		{"version", func(b *ProjectControlBinding) { b.KeyVersion = "2" }},
		{"height", func(b *ProjectControlBinding) { b.ExecutionHeight = "2" }},
		{"caller", func(b *ProjectControlBinding) { b.CallerIdentity = "foreign-native" }},
		{"current", func(b *ProjectControlBinding) { b.SourceCurrentRef = "foreign-current" }},
		{"missing A", func(b *ProjectControlBinding) { b.PKA = nil }},
		{"missing B", func(b *ProjectControlBinding) { b.PKB = nil }},
		{"version zero", func(b *ProjectControlBinding) { b.KeyVersion = "0" }},
		{"version padding", func(b *ProjectControlBinding) { b.KeyVersion = "01" }},
		{"version overflow", func(b *ProjectControlBinding) { b.KeyVersion = "18446744073709551616" }},
		{"height negative", func(b *ProjectControlBinding) { b.ExecutionHeight = "-1" }},
		{"height exponent", func(b *ProjectControlBinding) { b.ExecutionHeight = "1e1" }},
		{"height padding", func(b *ProjectControlBinding) { b.ExecutionHeight = "00" }},
		{"owner uppercase", func(b *ProjectControlBinding) { b.Owner = "0X" + strings.Repeat("11", 20) }},
		{"caller whitespace", func(b *ProjectControlBinding) { b.CallerIdentity = "native identity" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			b := projectControlCopyBinding(f.binding)
			tc.edit(&b)
			_, err := InspectProjectControlMessage(message, b, f.pr, f.cr, f.dr, 1001)
			requireError(t, err)
		})
	}
	for _, index := range []int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12} {
		fields, err := DecodeFields(message, 13, MaxProjectControlMessageBytes)
		requireNoError(t, err)
		fields[index][0] ^= 1
		bad, err := EncodeFields(fields...)
		requireNoError(t, err)
		_, err = InspectProjectControlMessage(bad, f.binding, f.pr, f.cr, f.dr, 1001)
		requireError(t, err)
	}
	for _, bad := range [][]byte{message[:len(message)-1], append(clone(message), 0), bytes.Repeat([]byte{'x'}, MaxProjectControlMessageBytes+1)} {
		_, err := InspectProjectControlMessage(bad, f.binding, f.pr, f.cr, f.dr, 1001)
		requireError(t, err)
	}
}

func TestProjectControlOriginalJSONAndDecisionBindingRejects(t *testing.T) {
	f := projectControlPublicFixture(t)
	for _, tc := range []struct {
		name string
		edit func(*ProjectControlPrincipal)
	}{
		{"EVM alias", func(p *ProjectControlPrincipal) { p.Account = f.binding.Owner }},
		{"uppercase YNX alias", func(p *ProjectControlPrincipal) { p.Account = strings.ToUpper(p.Account) }},
		{"bad YNX checksum", func(p *ProjectControlPrincipal) { p.Account = p.Account[:41] + "!" }},
		{"zero account generation", func(p *ProjectControlPrincipal) { p.AccountGeneration = 0 }},
		{"zero session generation", func(p *ProjectControlPrincipal) { p.SessionGeneration = 0 }},
		{"principal expiration", func(p *ProjectControlPrincipal) { p.ExpiresMS = 1001 }},
		{"decision outlives principal", func(p *ProjectControlPrincipal) { p.ExpiresMS = 15000 }},
		{"foreign current", func(p *ProjectControlPrincipal) { p.CurrentRef = "foreign-current" }},
		{"control", func(p *ProjectControlPrincipal) { p.DeviceID = "device\x00" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := f.p
			tc.edit(&p)
			pr, err := json.Marshal(p)
			requireNoError(t, err)
			d := f.d
			d.PrincipalSHA256 = projectControlTestSHA(pr)
			_, err = BuildProjectControlMessage(pr, f.cr, projectControlTestDecisionRaw(t, d), f.binding, 1001)
			requireError(t, err)
		})
	}
	for _, tc := range []struct {
		name string
		edit func(*ProjectControlDecision)
	}{
		{"cancel", func(d *ProjectControlDecision) { d.Decision = "cancel" }},
		{"frame", func(d *ProjectControlDecision) { d.Version = "ARTIFACT-RELEASE" }},
		{"principal hash", func(d *ProjectControlDecision) { d.PrincipalSHA256 = strings.Repeat("a", 64) }},
		{"command hash", func(d *ProjectControlDecision) { d.CommandSHA256 = strings.Repeat("b", 64) }},
		{"request", func(d *ProjectControlDecision) { d.RequestID = "foreign-request" }},
		{"nonce zero", func(d *ProjectControlDecision) { d.Nonce = base64.RawURLEncoding.EncodeToString(make([]byte, 32)) }},
		{"nonce pad", func(d *ProjectControlDecision) { d.Nonce += "=" }},
		{"nonce noncanonical tail", func(d *ProjectControlDecision) { d.Nonce = d.Nonce[:42] + "B" }},
		{"empty review", func(d *ProjectControlDecision) { d.ReviewID = "" }},
		{"empty confirmation", func(d *ProjectControlDecision) { d.ConfirmationRef = "" }},
		{"empty revocation", func(d *ProjectControlDecision) { d.RevocationRef = "" }},
		{"future issue", func(d *ProjectControlDecision) { d.IssuedAtMS = 1002 }},
		{"expired", func(d *ProjectControlDecision) { d.ExpiresAtMS = 1001 }},
		{"over 30 seconds", func(d *ProjectControlDecision) { d.ExpiresAtMS = 31001 }},
		{"beyond command", func(d *ProjectControlDecision) { d.ExpiresAtMS = 60001 }},
		{"unsafe JS time", func(d *ProjectControlDecision) { d.IssuedAtMS = projectControlMaxSafeInteger + 1 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := f.d
			tc.edit(&d)
			_, err := BuildProjectControlMessage(f.pr, f.cr, projectControlTestDecisionRaw(t, d), f.binding, 1001)
			requireError(t, err)
		})
	}
	for _, original := range []struct {
		name  string
		raw   []byte
		limit int
	}{{"principal", f.pr, MaxProjectControlPrincipalBytes}, {"command", f.cr, MaxProjectControlCommandBytes}, {"decision", f.dr, MaxProjectControlDecisionBytes}} {
		for _, mutation := range []string{"null", "duplicate", "escaped field", "missing", "order", "unknown", "leading", "trailing", "invalid UTF8", "too long"} {
			t.Run(original.name+" "+mutation, func(t *testing.T) {
				bad := clone(original.raw)
				switch mutation {
				case "null":
					bad = []byte("null")
				case "duplicate":
					comma := bytes.IndexByte(bad, ',')
					bad = append(append(clone(bad[:comma]), ','), bad[1:]...)
				case "escaped field":
					bad = append(append(clone(bad[:2]), []byte(fmt.Sprintf(`\u%04x`, bad[2]))...), bad[3:]...)
				case "missing":
					bad = append([]byte{'{'}, bad[bytes.IndexByte(bad, ',')+1:]...)
				case "order":
					first := bytes.IndexByte(bad, ',')
					second := first + 1 + bytes.IndexByte(bad[first+1:], ',')
					x := append([]byte{'{'}, bad[first+1:second]...)
					x = append(x, ',')
					x = append(x, bad[1:first]...)
					bad = append(x, bad[second:]...)
				case "unknown":
					bad = append(append(clone(bad[:len(bad)-1]), []byte(`,"selfAuthorized":true`)...), '}')
				case "leading":
					bad = append([]byte{' '}, bad...)
				case "trailing":
					bad = append(bad, '\n')
				case "invalid UTF8":
					bad[5] = 0xff
				case "too long":
					bad = bytes.Repeat([]byte{'x'}, original.limit+1)
				}
				pr, cr, dr := f.pr, f.cr, f.dr
				switch original.name {
				case "principal":
					pr = bad
				case "command":
					cr = bad
				default:
					dr = bad
				}
				_, err := BuildProjectControlMessage(pr, cr, dr, f.binding, 1001)
				requireError(t, err)
			})
		}
	}
	// Explicit numeric type/rounding/zero forms, even where missing/unknown
	// values would otherwise decode as a Go zero value.
	for _, replacement := range []string{"null", "true", "0", "1.0", "1e0", `"1"`, "18446744073709551616"} {
		pr := bytes.Replace(f.pr, []byte("18446744073709551615"), []byte(replacement), 1)
		_, err := BuildProjectControlMessage(pr, f.cr, f.dr, f.binding, 1001)
		requireError(t, err)
	}
	for _, at := range []uint64{999, 20000, projectControlMaxSafeInteger + 1, math.MaxUint64} {
		_, err := BuildProjectControlMessage(f.pr, f.cr, f.dr, f.binding, at)
		requireError(t, err)
	}
	c := f.c
	c.ExpiresMS = 15000
	cr, err := json.Marshal(c)
	requireNoError(t, err)
	d := f.d
	d.CommandSHA256 = projectControlTestSHA(cr)
	_, err = BuildProjectControlMessage(f.pr, cr, projectControlTestDecisionRaw(t, d), f.binding, 1001)
	requireError(t, err) // A still-live command cannot be outlived by its decision.
}

func TestProjectControlOriginalCommandActionsAndWindows(t *testing.T) {
	f := projectControlPublicFixture(t)
	for _, action := range []string{"project.create", "team.create", "team.member", "project.member", "project.team", "project.origin", "project.revoke", "team.revoke", "project.publisher"} {
		t.Run(action, func(t *testing.T) {
			c := ProjectControlCommand{RequestID: "original-request", Action: action, ProjectID: "project", ExpiresMS: 60000}
			if strings.HasPrefix(action, "team.") {
				c.ProjectID, c.TeamID = "", "team"
			}
			switch action {
			case "team.member":
				c.SubjectAccount, c.GrantExpiresMS = "member", 60000
			case "project.member":
				c.SubjectAccount, c.GrantExpiresMS, c.Read = "member", 60000, true
			case "project.team":
				c.TeamID, c.GrantExpiresMS, c.Publish = "team", 60000, true
			case "project.origin":
				c.ExpectedRevision, c.RuntimeOrigin = 1, "https://example.test:8443"
			case "project.revoke", "team.revoke":
				c.ExpectedRevision, c.Revoke = 1, true
			case "project.publisher":
				c.SubjectAccount, c.PublisherID, c.PublicOriginalSHA256, c.GrantExpiresMS = "member", "publisher", strings.Repeat("a", 64), 60000
			}
			cr, err := json.Marshal(c)
			requireNoError(t, err)
			d := f.d
			d.CommandSHA256 = projectControlTestSHA(cr)
			_, err = BuildProjectControlMessage(f.pr, cr, projectControlTestDecisionRaw(t, d), f.binding, 1001)
			requireNoError(t, err)
			c.GrantExpiresMS = -1
			cr, err = json.Marshal(c)
			requireNoError(t, err)
			d.CommandSHA256 = projectControlTestSHA(cr)
			_, err = BuildProjectControlMessage(f.pr, cr, projectControlTestDecisionRaw(t, d), f.binding, 1001)
			requireError(t, err)
		})
	}
	for _, origin := range []string{"https://example.test", "https://127.0.0.1", "https://[::1]", "https://[::ffff:c000:280]:8443", "https://xn--bcher-kva.test", "https://example.test:0"} {
		if !projectControlOrigin(origin) {
			t.Fatal("canonical R194 HTTPS origin rejected", origin)
		}
	}
	for _, origin := range []string{"http://example.test", "https://example.test/", "https://example.test:443", "https://example.test:08443", "https://example.test:", "https://EXAMPLE.test", "https://user@example.test", "https://example.test?", "https://example.test#", "https://127.1", "https://0x7f000001", "https://99999999999999999999999999999", "https://[0:0:0:0:0:0:0:1]", "https://bücher.test"} {
		if projectControlOrigin(origin) {
			t.Fatal("noncanonical R194 HTTPS origin accepted", origin)
		}
	}
	// One bit beyond the original 2^62 revision cap, unknown action, expiry
	// beyond five minutes, non-Go number encodings and permission booleans fail.
	for _, cr := range [][]byte{
		bytes.Replace(f.cr, []byte(`"ExpectedRevision":0`), []byte(`"ExpectedRevision":4611686018427387905`), 1),
		bytes.Replace(f.cr, []byte(`project.create`), []byte(`project.admin`), 1),
		bytes.Replace(f.cr, []byte(`"ExpiresMS":60000`), []byte(`"ExpiresMS":301002`), 1),
		bytes.Replace(f.cr, []byte(`"Read":false`), []byte(`"Read":null`), 1),
		bytes.Replace(f.cr, []byte(`"ExpectedRevision":0`), []byte(`"ExpectedRevision":"0"`), 1),
	} {
		d := f.d
		d.CommandSHA256 = projectControlTestSHA(cr)
		_, err := BuildProjectControlMessage(f.pr, cr, projectControlTestDecisionRaw(t, d), f.binding, 1001)
		requireError(t, err)
	}
}

func TestProjectControlN1ActualDualANDAndFullRegisteredPair(t *testing.T) {
	key, public, err := KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	f := projectControlTestFixture(t, public)
	message, err := BuildProjectControlMessage(f.pr, f.cr, f.dr, f.binding, 1001)
	requireNoError(t, err)
	batch, err := BatchSign(key, Metadata{ChainID: f.binding.NetworkID, Owner: f.binding.Owner, Purpose: ProjectControlPurpose}, [][]byte{message}, SignOptions{Optimized: true})
	requireNoError(t, err)
	defer batch.Discard()
	m, err := Extract(batch, 0)
	requireNoError(t, err)
	wire, err := EncodeMember(m)
	requireNoError(t, err)
	_, err = InspectProjectControlMember(wire, f.binding, f.pr, f.cr, f.dr, 1001)
	requireNoError(t, err)
	height, err := strconv.ParseUint(f.binding.ExecutionHeight, 10, 64)
	requireNoError(t, err)
	// A public synthetic resolver only; this is the existing mathematical
	// verifier, not the actual external Auth registered/current authority.
	reg := Registration{AlgorithmVersion: Version, Owner: f.binding.Owner, Purpose: ProjectControlPurpose, ChainID: clone(f.binding.NetworkID),
		PKA: clone(public.PKA), PKB: clone(public.PKB), PolicyRevision: "PUBLIC-SYNTHETIC-CONTROL-ONLY", Enabled: true}
	v := verifier(t, &reg, 0, true)
	requireNoError(t, v.VerifyOne(wire, height))
	for _, branch := range []string{"A", "B"} {
		bad, err := DecodeMember(wire)
		requireNoError(t, err)
		if branch == "A" {
			bad.Certificate.SigmaA[0] ^= 1
		} else {
			bad.Certificate.SigmaB[0] ^= 1
		}
		badWire, err := EncodeMember(bad)
		requireNoError(t, err)
		_, err = InspectProjectControlMember(badWire, f.binding, f.pr, f.cr, f.dr, 1001)
		requireNoError(t, err) // Structural DATA must not pretend to verify a signature.
		requireError(t, v.VerifyOne(badWire, height))
	}
	for _, purpose := range []string{"ARTIFACT-RELEASE", "IDE-PUBLISHER-REGISTRATION", "TX-BATCH", "AUTH-PROTECTED-KEY-CALL"} {
		bad, err := DecodeMember(wire)
		requireNoError(t, err)
		bad.Certificate.Purpose = purpose
		badWire, err := EncodeMember(bad)
		requireNoError(t, err)
		_, err = InspectProjectControlMember(badWire, f.binding, f.pr, f.cr, f.dr, 1001)
		requireError(t, err)
	}
	for _, branch := range []string{"A", "B"} {
		b := projectControlCopyBinding(f.binding)
		if branch == "A" {
			b.PKA[0] ^= 1
		} else {
			b.PKB[0] ^= 1
		}
		_, err := InspectProjectControlMember(wire, b, f.pr, f.cr, f.dr, 1001)
		requireError(t, err)
	}
	outer, err := DecodeFields(wire, 4, MaxMemberBytes)
	requireNoError(t, err)
	proof, err := DecodeFields(outer[3], 3, MaxProofBytes)
	requireNoError(t, err)
	proof[0] = U32(1)
	outer[3], err = EncodeFields(proof...)
	requireNoError(t, err)
	badIndex, err := EncodeFields(outer...)
	requireNoError(t, err)
	_, err = InspectProjectControlMember(badIndex, f.binding, f.pr, f.cr, f.dr, 1001)
	requireError(t, err)
	m.Certificate.N = 2
	m.PathA, m.PathB = [][]byte{make([]byte, 64)}, [][]byte{make([]byte, 64)}
	badN, err := EncodeMember(m)
	requireNoError(t, err)
	_, err = InspectProjectControlMember(badN, f.binding, f.pr, f.cr, f.dr, 1001)
	requireError(t, err)
	_, err = InspectProjectControlMember(bytes.Repeat([]byte{'x'}, MaxProjectControlMemberBytes+1), f.binding, f.pr, f.cr, f.dr, 1001)
	requireError(t, err)
	reg.Enabled = false
	requireError(t, v.VerifyOne(wire, height)) // No cached certificate grants current authority.
}
