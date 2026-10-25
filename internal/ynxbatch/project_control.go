package ynxbatch

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

// Dedicated Auth R192/R197 CONTROL DATA grammar. This is neither the
// ARTIFACT-RELEASE role nor a current/ACL/Root assertion or signing API.
const (
	ProjectControlPurpose           = "IDE-PROJECT-CONTROL"
	ProjectControlMessageVersion    = "YNX-IDE-PROJECT-CONTROL-APPROVAL/v1"
	ProjectControlDecisionVersion   = "YNX-IDE-PROJECT-CONTROL-DECISION/v1"
	MaxProjectControlPrincipalBytes = 8192
	MaxProjectControlCommandBytes   = 8192
	MaxProjectControlDecisionBytes  = 4096
	MaxProjectControlMemberBytes    = 98304
	MaxProjectControlMessageBytes   = 4 + 13*4 + len(ProjectControlMessageVersion) + len(Version) + len(Suite) + len(ProjectControlPurpose) + 32 + 42 + 20 + 20 + 256 + 256 + MaxProjectControlPrincipalBytes + MaxProjectControlCommandBytes + MaxProjectControlDecisionBytes
	projectControlMaxSafeInteger    = uint64(1<<53 - 1)
)

// ProjectControlBinding is independently supplied public expected DATA. The
// complete registered pair, version, actual execution height, original caller
// and current reference must all be supplied explicitly. Matching them here
// does not establish that the source is current, admitted or authorized.
type ProjectControlBinding struct {
	NetworkID        []byte
	Owner            string
	KeyVersion       string
	ExecutionHeight  string
	CallerIdentity   string
	SourceCurrentRef string
	PKA, PKB         []byte
}

// Field order and numeric types are the original Go Principal7/Command15
// serialization, including encoding/json's default HTML escaping. Decimal
// generations/revisions are never converted through floating point.
type ProjectControlPrincipal struct {
	Account           string
	DeviceID          string
	SessionRef        string
	CurrentRef        string
	AccountGeneration uint64
	SessionGeneration uint64
	ExpiresMS         int64
}

type ProjectControlCommand struct {
	RequestID            string
	Action               string
	ProjectID            string
	TeamID               string
	SubjectAccount       string
	PublisherID          string
	RuntimeOrigin        string
	ExpectedRevision     uint64
	GrantExpiresMS       int64
	Read                 bool
	Publish              bool
	Runtime              bool
	Revoke               bool
	ExpiresMS            int64
	PublicOriginalSHA256 string
}

// Decision fields are declared in Auth canonical sorted-key order. Only
// approve/reject have signed messages; cancellation has no proof in this codec.
type ProjectControlDecision struct {
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
}

// Inspectors return detached DATA, not an Approval, replay/once token, native
// admission, registry issuer, ACL result or permission to perform an effect.
type ProjectControlMessage struct {
	Binding           ProjectControlBinding
	Principal         ProjectControlPrincipal
	Command           ProjectControlCommand
	Decision          ProjectControlDecision
	PrincipalOriginal []byte
	CommandOriginal   []byte
	DecisionOriginal  []byte
}

func projectControlText(s string, empty bool) bool {
	// R197 aligns the existing original Go text: ASCII controls/spaces are
	// forbidden throughout, Unicode White_Space only at the edges. Interior
	// U+2028/U+2029/U+0085 and FEFF are data; FEFF is not White_Space.
	return empty && s == "" || artifactCatalogText(s)
}

// Auth canonical() keeps literal UTF8 U+2028/U+2029. Go's JSON Encoder still
// escapes them with EscapeHTML=false, so build this exact closed sorted D11
// grammar directly. The common scalar primitive preserves literal backslash-u
// text correctly; no replacement of escaped byte sequences is performed.
func projectControlCanonicalDecision(d ProjectControlDecision) []byte {
	out := artifactJSONString([]byte(`{"commandSHA256":`), d.CommandSHA256)
	out = artifactJSONString(append(out, `,"confirmationRef":`...), d.ConfirmationRef)
	out = artifactJSONString(append(out, `,"decision":`...), d.Decision)
	out = strconv.AppendUint(append(out, `,"expiresAtMs":`...), d.ExpiresAtMS, 10)
	out = strconv.AppendUint(append(out, `,"issuedAtMs":`...), d.IssuedAtMS, 10)
	out = artifactJSONString(append(out, `,"nonce":`...), d.Nonce)
	out = artifactJSONString(append(out, `,"principalSHA256":`...), d.PrincipalSHA256)
	out = artifactJSONString(append(out, `,"requestId":`...), d.RequestID)
	out = artifactJSONString(append(out, `,"reviewId":`...), d.ReviewID)
	out = artifactJSONString(append(out, `,"revocationRef":`...), d.RevocationRef)
	out = artifactJSONString(append(out, `,"version":`...), d.Version)
	return append(out, '}')
}

func projectControlDecimal(s string, positive bool) bool {
	n, err := strconv.ParseUint(s, 10, 64)
	return err == nil && (!positive || n != 0) && strconv.FormatUint(n, 10) == s
}

func validateProjectControlBinding(b ProjectControlBinding) error {
	if len(b.NetworkID) != 32 || !accountaddress.IsCanonical(b.Owner) || !projectControlDecimal(b.KeyVersion, true) ||
		!projectControlDecimal(b.ExecutionHeight, false) || !projectControlText(b.CallerIdentity, false) ||
		!projectControlText(b.SourceCurrentRef, false) || len(b.PKA) != PublicKeyASize || len(b.PKB) != PublicKeyBSize {
		return invalid("project control complete expected binding")
	}
	return nil
}

// A byte equality with the unique full struct encoding rejects missing, null,
// duplicate, escaped duplicate, reordered, padded and trailing JSON as well as
// unknown fields. Decode remains bounded before any allocation by the caller.
func decodeProjectControlOriginal(raw []byte, maximum int, into any, decision bool) error {
	if len(raw) == 0 || len(raw) > maximum || !utf8.Valid(raw) {
		return invalid("project control original JSON bounds or UTF8")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(into); err != nil {
		return invalid("project control original JSON fields or types")
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return invalid("project control original JSON trailing data")
	}
	var canonical []byte
	if decision {
		d, ok := into.(*ProjectControlDecision)
		if !ok {
			return invalid("project control decision type")
		}
		canonical = projectControlCanonicalDecision(*d)
	} else {
		var err error
		canonical, err = json.Marshal(into)
		if err != nil {
			return err
		}
	}
	if !bytes.Equal(raw, canonical) {
		return invalid("project control noncanonical original JSON")
	}
	return nil
}

func parseProjectControlPrincipal(raw []byte) (ProjectControlPrincipal, error) {
	var p ProjectControlPrincipal
	if err := decodeProjectControlOriginal(raw, MaxProjectControlPrincipalBytes, &p, false); err != nil {
		return p, err
	}
	for _, s := range []string{p.Account, p.DeviceID, p.SessionRef, p.CurrentRef} {
		if !artifactCatalogText(s) { // Exact R194 Principal text, distinct from Command.
			return p, invalid("project control original principal text")
		}
	}
	if p.AccountGeneration == 0 || p.SessionGeneration == 0 || p.ExpiresMS <= 0 ||
		!strings.HasPrefix(p.Account, "ynx1") || p.Account != strings.ToLower(p.Account) || len(p.Account) != 42 {
		return p, invalid("project control original principal generations, expiry or YNX account")
	}
	if _, err := accountaddress.Decode(p.Account); err != nil {
		return p, invalid("project control original principal YNX checksum")
	}
	return p, nil
}

// WHATWG serializes IPv6 as lowercase hexadecimal groups, including mapped
// IPv4 addresses, using the first longest zero run. net.IP.String alone would
// turn a mapped address into dotted IPv4, which is not URL.origin's spelling.
func projectControlIPv6(ip net.IP) string {
	var groups [8]uint16
	for i := range groups {
		groups[i] = binary.BigEndian.Uint16(ip[2*i : 2*i+2])
	}
	best, length := -1, 1
	for i := 0; i < 8; {
		if groups[i] != 0 {
			i++
			continue
		}
		j := i
		for j < 8 && groups[j] == 0 {
			j++
		}
		if j-i > length {
			best, length = i, j-i
		}
		i = j
	}
	parts := make([]string, 8)
	for i, v := range groups {
		parts[i] = strconv.FormatUint(uint64(v), 16)
	}
	if best < 0 {
		return strings.Join(parts, ":")
	}
	return strings.Join(parts[:best], ":") + "::" + strings.Join(parts[best+length:], ":")
}

func projectControlOrigin(s string) bool {
	u, err := url.Parse(s)
	if err != nil || u.Scheme != "https" || u.Opaque != "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawFragment != "" || u.Host == "" || strings.ContainsAny(s, "\\%#?") {
		return false
	}
	host, port := u.Hostname(), u.Port()
	if host == "" || host != strings.ToLower(host) {
		return false
	}
	for _, r := range host {
		if r > 127 {
			return false // WHATWG would replace non-ASCII input with punycode.
		}
	}
	canonicalHost := host
	if strings.Contains(host, ":") {
		ip := net.ParseIP(host)
		if ip == nil {
			return false
		}
		canonicalHost = "[" + projectControlIPv6(ip.To16()) + "]"
	} else {
		labels := strings.Split(strings.TrimSuffix(host, "."), ".")
		last := labels[len(labels)-1]
		numeric := last != ""
		for _, r := range last {
			if r < '0' || r > '9' {
				numeric = false
			}
		}
		if numeric || strings.HasPrefix(last, "0x") {
			ip := net.ParseIP(host)
			if ip == nil || ip.To4() == nil || ip.String() != host {
				return false
			}
		}
	}
	if port != "" {
		n, err := strconv.ParseUint(port, 10, 16)
		if err != nil || n == 443 || strconv.FormatUint(n, 10) != port {
			return false
		}
		canonicalHost += ":" + port
	}
	return s == "https://"+canonicalHost
}

func parseProjectControlCommand(raw []byte, atMS uint64) (ProjectControlCommand, error) {
	var c ProjectControlCommand
	if err := decodeProjectControlOriginal(raw, MaxProjectControlCommandBytes, &c, false); err != nil {
		return c, err
	}
	for _, s := range []string{c.RequestID, c.Action} {
		if !projectControlText(s, false) {
			return c, invalid("project control original command text")
		}
	}
	for _, s := range []string{c.ProjectID, c.TeamID, c.SubjectAccount, c.PublisherID, c.RuntimeOrigin, c.PublicOriginalSHA256} {
		if !projectControlText(s, true) {
			return c, invalid("project control original command text")
		}
	}
	if atMS > projectControlMaxSafeInteger || c.ExpectedRevision > 1<<62 || c.ExpiresMS <= 0 || uint64(c.ExpiresMS) <= atMS || uint64(c.ExpiresMS)-atMS > 300000 {
		return c, invalid("project control command time or revision")
	}
	target := c.ProjectID
	if strings.HasPrefix(c.Action, "team.") {
		target = c.TeamID
	}
	if target == "" {
		return c, invalid("project control command target")
	}
	grantAction := c.Action == "team.member" || c.Action == "project.member" || c.Action == "project.team" || c.Action == "project.publisher"
	if grantAction && !c.Revoke {
		if c.GrantExpiresMS <= 0 || uint64(c.GrantExpiresMS) <= atMS {
			return c, invalid("project control original grant window")
		}
	} else if c.GrantExpiresMS != 0 {
		return c, invalid("project control unexpected grant window")
	}
	empty := func(ss ...string) bool {
		for _, s := range ss {
			if s != "" {
				return false
			}
		}
		return true
	}
	rights, ok := c.Read || c.Publish || c.Runtime, false
	switch c.Action {
	case "project.create":
		ok = c.ExpectedRevision == 0 && empty(c.TeamID, c.SubjectAccount, c.PublisherID, c.RuntimeOrigin, c.PublicOriginalSHA256) && !rights && !c.Revoke
	case "team.create":
		ok = c.ExpectedRevision == 0 && empty(c.ProjectID, c.SubjectAccount, c.PublisherID, c.RuntimeOrigin, c.PublicOriginalSHA256) && !rights && !c.Revoke
	case "team.member":
		ok = c.SubjectAccount != "" && empty(c.ProjectID, c.PublisherID, c.RuntimeOrigin, c.PublicOriginalSHA256) && !rights
	case "project.member":
		ok = c.SubjectAccount != "" && empty(c.TeamID, c.PublisherID, c.RuntimeOrigin, c.PublicOriginalSHA256) && (c.Revoke || rights)
	case "project.team":
		ok = c.TeamID != "" && empty(c.SubjectAccount, c.PublisherID, c.RuntimeOrigin, c.PublicOriginalSHA256) && (c.Revoke || rights)
	case "project.origin":
		ok = c.ExpectedRevision > 0 && projectControlOrigin(c.RuntimeOrigin) && empty(c.TeamID, c.SubjectAccount, c.PublisherID, c.PublicOriginalSHA256) && !rights && !c.Revoke
	case "project.revoke":
		ok = c.ExpectedRevision > 0 && c.Revoke && !rights && empty(c.TeamID, c.SubjectAccount, c.PublisherID, c.RuntimeOrigin, c.PublicOriginalSHA256)
	case "team.revoke":
		ok = c.ExpectedRevision > 0 && c.Revoke && !rights && empty(c.ProjectID, c.SubjectAccount, c.PublisherID, c.RuntimeOrigin, c.PublicOriginalSHA256)
	case "project.publisher":
		ok = c.SubjectAccount != "" && c.PublisherID != "" && artifactLowerHex(c.PublicOriginalSHA256, 32) && empty(c.TeamID, c.RuntimeOrigin) && !rights
	}
	if !ok {
		return c, invalid("project control original command action")
	}
	return c, nil
}

func projectControlSHA(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func parseProjectControlDecision(raw, principalOriginal, commandOriginal []byte, p ProjectControlPrincipal, c ProjectControlCommand, atMS uint64) (ProjectControlDecision, error) {
	var d ProjectControlDecision
	if err := decodeProjectControlOriginal(raw, MaxProjectControlDecisionBytes, &d, true); err != nil {
		return d, err
	}
	if d.Version != ProjectControlDecisionVersion || d.Decision != "approve" && d.Decision != "reject" || d.RequestID != c.RequestID ||
		d.PrincipalSHA256 != projectControlSHA(principalOriginal) || d.CommandSHA256 != projectControlSHA(commandOriginal) {
		return d, invalid("project control original decision binding")
	}
	for _, s := range []string{d.ReviewID, d.ConfirmationRef, d.RevocationRef} {
		if !projectControlText(s, false) {
			return d, invalid("project control original decision reference")
		}
	}
	nonce, err := base64.RawURLEncoding.DecodeString(d.Nonce)
	if err != nil || len(d.Nonce) != 43 || len(nonce) != 32 || base64.RawURLEncoding.EncodeToString(nonce) != d.Nonce || bytes.Equal(nonce, make([]byte, 32)) {
		return d, invalid("project control canonical nonzero nonce")
	}
	if atMS > projectControlMaxSafeInteger || d.IssuedAtMS > projectControlMaxSafeInteger || d.ExpiresAtMS > projectControlMaxSafeInteger ||
		atMS < d.IssuedAtMS || atMS >= d.ExpiresAtMS || d.ExpiresAtMS <= d.IssuedAtMS || d.ExpiresAtMS-d.IssuedAtMS > 30000 ||
		d.ExpiresAtMS > uint64(p.ExpiresMS) || d.ExpiresAtMS > uint64(c.ExpiresMS) {
		return d, invalid("project control original decision time window")
	}
	// Auth also validates the command as captured at the decision's issue time,
	// independently of this later inspection time.
	if _, err := parseProjectControlCommand(commandOriginal, d.IssuedAtMS); err != nil {
		return d, err
	}
	return d, nil
}

func projectControlInputs(principalOriginal, commandOriginal, decisionOriginal []byte, expected ProjectControlBinding, atMS uint64) (ProjectControlMessage, error) {
	var result ProjectControlMessage
	if err := validateProjectControlBinding(expected); err != nil {
		return result, err
	}
	p, err := parseProjectControlPrincipal(principalOriginal)
	if err != nil {
		return result, err
	}
	c, err := parseProjectControlCommand(commandOriginal, atMS)
	if err != nil {
		return result, err
	}
	d, err := parseProjectControlDecision(decisionOriginal, principalOriginal, commandOriginal, p, c, atMS)
	if err != nil {
		return result, err
	}
	owner, err := accountaddress.Decode(p.Account)
	if err != nil || owner != expected.Owner || p.CurrentRef != expected.SourceCurrentRef {
		return result, invalid("project control original principal owner or current binding")
	}
	b := expected
	b.NetworkID, b.PKA, b.PKB = clone(b.NetworkID), clone(b.PKA), clone(b.PKB)
	return ProjectControlMessage{Binding: b, Principal: p, Command: c, Decision: d,
		PrincipalOriginal: clone(principalOriginal), CommandOriginal: clone(commandOriginal), DecisionOriginal: clone(decisionOriginal)}, nil
}

// BuildProjectControlMessage returns only E13 DATA. Full public expected keys
// are checked structurally here and against the existing certificate below;
// no private keys, clock defaults, generated nonce or implicit sender are used.
func BuildProjectControlMessage(principalOriginal, commandOriginal, decisionOriginal []byte, expected ProjectControlBinding, atMS uint64) ([]byte, error) {
	if _, err := projectControlInputs(principalOriginal, commandOriginal, decisionOriginal, expected, atMS); err != nil {
		return nil, err
	}
	return EncodeFields([]byte(ProjectControlMessageVersion), []byte(Version), []byte(Suite), []byte(ProjectControlPurpose), expected.NetworkID,
		[]byte(expected.Owner), []byte(expected.KeyVersion), []byte(expected.ExecutionHeight), []byte(expected.CallerIdentity), []byte(expected.SourceCurrentRef),
		principalOriginal, commandOriginal, decisionOriginal)
}

func InspectProjectControlMessage(raw []byte, expected ProjectControlBinding, principalOriginal, commandOriginal, decisionOriginal []byte, atMS uint64) (ProjectControlMessage, error) {
	var result ProjectControlMessage
	f, err := fields(raw, 13, MaxProjectControlMessageBytes, len(ProjectControlMessageVersion), len(Version), len(Suite), len(ProjectControlPurpose), 32, 42, 20, 20, 256, 256, MaxProjectControlPrincipalBytes, MaxProjectControlCommandBytes, MaxProjectControlDecisionBytes)
	if err != nil {
		return result, err
	}
	want, err := BuildProjectControlMessage(principalOriginal, commandOriginal, decisionOriginal, expected, atMS)
	if err != nil {
		return result, err
	}
	if !bytes.Equal(raw, want) {
		return result, invalid("project control exact original E13 or expected binding")
	}
	return projectControlInputs(f[10], f[11], f[12], expected, atMS)
}

// InspectProjectControlMember is structural inspection, not signature validity
// or current permission. The ordinary dual-AND Verifier must still verify both
// signature branches with the actual registered current pair. Main/Auth alone
// consume nonce/confirmation and establish current/ACL/Root before any effect.
func InspectProjectControlMember(raw []byte, expected ProjectControlBinding, principalOriginal, commandOriginal, decisionOriginal []byte, atMS uint64) (Member, error) {
	if len(raw) > MaxProjectControlMemberBytes {
		return Member{}, invalid("project control member bound")
	}
	m, err := DecodeMember(raw)
	if err != nil {
		return Member{}, err
	}
	c := m.Certificate
	if c.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 || c.Purpose != ProjectControlPurpose || c.Owner != expected.Owner ||
		!bytes.Equal(c.ChainID, expected.NetworkID) || !bytes.Equal(c.PKA, expected.PKA) || !bytes.Equal(c.PKB, expected.PKB) {
		return Member{}, invalid("project control exact full-pair AND N1 context")
	}
	if _, err := InspectProjectControlMessage(m.Message, expected, principalOriginal, commandOriginal, decisionOriginal, atMS); err != nil {
		return Member{}, err
	}
	return m, nil
}
