package ynxbatch

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"strconv"
	"unicode/utf8"
)

// These are the two fixed SDK46 messages, not ARTIFACT-RELEASE or CONTROL
// aliases. They encode public DATA only. In particular a matching R13, PoP,
// custodian context or digest does not establish Source/current/ACL/Root or
// consume a durable once-registration. Those checks remain with Main/Auth.
const (
	PublisherRegistrationPoPPurpose               = "IDE-PUBLISHER-REGISTRATION"
	PublisherRegistrationPoPVersion               = "YNX-IDE-PUBLISHER-REGISTRATION/v1"
	PublisherRegistrationCustodianPurpose         = "AUTH-PUBLISHER-REGISTRATION"
	PublisherRegistrationCustodianVersion         = "YNX-AUTH-PROTECTED-PUBLISHER-REGISTRATION/v1"
	PublisherRegistrationBodyVersion              = "YNX-IDE-PROTECTED-PUBLISHER-REGISTRATION/v1"
	MaxPublisherRegistrationPublicBytes           = 8192
	MaxPublisherRegistrationBodyBytes             = 16384
	MaxPublisherRegistrationPoPMemberBytes        = 262144
	MaxPublisherRegistrationCustodianMemberBytes  = 262144
	MaxPublisherRegistrationPoPMessageBytes       = 4 + 9*4 + len(PublisherRegistrationPoPVersion) + len(Version) + len(Suite) + len(PublisherRegistrationPoPPurpose) + 32 + 42 + 20 + MaxPublisherRegistrationPublicBytes + MaxPublisherRegistrationBodyBytes
	MaxPublisherRegistrationCustodianMessageBytes = 4 + 12*4 + len(PublisherRegistrationCustodianVersion) + len(Version) + len(Suite) + len(PublisherRegistrationCustodianPurpose) + 32 + 42 + 20 + 20 + MaxProjectControlPrincipalBytes + MaxProjectControlCommandBytes + MaxPublisherRegistrationBodyBytes + 64
)

// PublisherRegistrationBody is the exact canonical sorted sixteen-field JSON
// body. The two timestamps are safe JS integers; publisher versions remain
// canonical uint64 decimal strings. Principal/Command retain their original Go
// JSON bytes, including full-width integer tokens and original escaping.
type PublisherRegistrationBody struct {
	Account             string `json:"account"`
	CallerIdentity      string `json:"callerIdentity"`
	CommandSHA256       string `json:"commandSHA256"`
	CustodyCurrentRef   string `json:"custodyCurrentRef"`
	ExpiresAtMS         uint64 `json:"expiresAtMs"`
	IssuedAtMS          uint64 `json:"issuedAtMs"`
	KeyRole             string `json:"keyRole"`
	Nonce               string `json:"nonce"`
	PrincipalSHA256     string `json:"principalSHA256"`
	ProjectID           string `json:"projectId"`
	PublicSHA256        string `json:"publicSHA256"`
	PublisherID         string `json:"publisherId"`
	PublisherKeyVersion string `json:"publisherKeyVersion"`
	RegistrationRef     string `json:"registrationRef"`
	SourceCurrentRef    string `json:"sourceCurrentRef"`
	Version             string `json:"version"`
}

// This distinct type describes the independently selected custodian pair. It
// is not an account/CONTROL key selection, a registered/current assertion or a
// caller-selectable purpose. The SDK message does not put these public keys in
// E12: the ordinary registered AND verifier must independently bind its member
// certificate to this complete pair and check it is independent of R13.
type PublisherRegistrationCustodianBinding ProjectControlBinding

// PublisherRegistrationMessage returns detached observations only. The
// custodian-only fields are empty for PoP; no field claims signature validity,
// protected custody, registration or authority.
type PublisherRegistrationMessage struct {
	Publisher            ArtifactPublisherRegistration
	Principal            ProjectControlPrincipal
	Command              ProjectControlCommand
	Registration         PublisherRegistrationBody
	Custodian            PublisherRegistrationCustodianBinding
	PublicOriginal       []byte
	PrincipalOriginal    []byte
	CommandOriginal      []byte
	RegistrationOriginal []byte
	PoPMemberOriginal    []byte
	PoPMemberSHA256      string
}

func publisherRegistrationCanonicalBody(b PublisherRegistrationBody) []byte {
	out := artifactJSONString([]byte(`{"account":`), b.Account)
	out = artifactJSONString(append(out, `,"callerIdentity":`...), b.CallerIdentity)
	out = artifactJSONString(append(out, `,"commandSHA256":`...), b.CommandSHA256)
	out = artifactJSONString(append(out, `,"custodyCurrentRef":`...), b.CustodyCurrentRef)
	out = strconv.AppendUint(append(out, `,"expiresAtMs":`...), b.ExpiresAtMS, 10)
	out = strconv.AppendUint(append(out, `,"issuedAtMs":`...), b.IssuedAtMS, 10)
	out = artifactJSONString(append(out, `,"keyRole":`...), b.KeyRole)
	out = artifactJSONString(append(out, `,"nonce":`...), b.Nonce)
	out = artifactJSONString(append(out, `,"principalSHA256":`...), b.PrincipalSHA256)
	out = artifactJSONString(append(out, `,"projectId":`...), b.ProjectID)
	out = artifactJSONString(append(out, `,"publicSHA256":`...), b.PublicSHA256)
	out = artifactJSONString(append(out, `,"publisherId":`...), b.PublisherID)
	out = artifactJSONString(append(out, `,"publisherKeyVersion":`...), b.PublisherKeyVersion)
	out = artifactJSONString(append(out, `,"registrationRef":`...), b.RegistrationRef)
	out = artifactJSONString(append(out, `,"sourceCurrentRef":`...), b.SourceCurrentRef)
	out = artifactJSONString(append(out, `,"version":`...), b.Version)
	return append(out, '}')
}

// ParsePublisherRegistrationBody checks exact original canonical bytes, not
// just a decoded equivalent. It neither resolves a real registrationRef nor
// accepts a caller boolean about custodian ownership/current permission.
func ParsePublisherRegistrationBody(raw []byte) (PublisherRegistrationBody, error) {
	var b PublisherRegistrationBody
	if len(raw) == 0 || len(raw) > MaxPublisherRegistrationBodyBytes || !utf8.Valid(raw) {
		return b, invalid("publisher registration body bounds or UTF8")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&b) != nil || d.Decode(new(any)) != io.EOF {
		return b, invalid("publisher registration body fields or trailing data")
	}
	if b.Version != PublisherRegistrationBodyVersion || b.KeyRole != ArtifactPublisherKeyRole ||
		!artifactLowerHex(b.PrincipalSHA256, 32) || !artifactLowerHex(b.CommandSHA256, 32) || !artifactLowerHex(b.PublicSHA256, 32) ||
		!artifactCanonicalVersion(b.PublisherKeyVersion) {
		return b, invalid("publisher registration body tags or hashes")
	}
	for _, s := range []string{b.Account, b.ProjectID, b.PublisherID, b.RegistrationRef, b.CallerIdentity, b.SourceCurrentRef, b.CustodyCurrentRef} {
		if !artifactCatalogText(s) {
			return b, invalid("publisher registration body text")
		}
	}
	nonce, err := base64.RawURLEncoding.DecodeString(b.Nonce)
	if err != nil || len(nonce) != 32 || len(b.Nonce) != 43 || base64.RawURLEncoding.EncodeToString(nonce) != b.Nonce || bytes.Equal(nonce, make([]byte, 32)) {
		return b, invalid("publisher registration canonical nonzero nonce")
	}
	if b.IssuedAtMS > projectControlMaxSafeInteger || b.ExpiresAtMS > projectControlMaxSafeInteger || b.ExpiresAtMS <= b.IssuedAtMS || b.ExpiresAtMS-b.IssuedAtMS > 30000 {
		return b, invalid("publisher registration body time window")
	}
	if !bytes.Equal(raw, publisherRegistrationCanonicalBody(b)) {
		return b, invalid("publisher registration body canonical bytes")
	}
	return b, nil
}

func publisherRegistrationInputs(publicOriginal, principalOriginal, commandOriginal, registrationOriginal []byte, expected ArtifactPublisherRegistration, atMS uint64) (PublisherRegistrationMessage, error) {
	var result PublisherRegistrationMessage
	if len(publicOriginal) == 0 || len(publicOriginal) > MaxPublisherRegistrationPublicBytes || atMS > projectControlMaxSafeInteger {
		return result, invalid("publisher registration public original or time bound")
	}
	want, err := EncodeArtifactPublisherRegistration(expected)
	if err != nil || !bytes.Equal(want, publicOriginal) {
		return result, invalid("publisher registration independently expected R13")
	}
	pub, err := DecodeArtifactPublisherRegistration(publicOriginal)
	if err != nil {
		return result, err
	}
	var p ProjectControlPrincipal
	if err := decodeProjectControlOriginal(principalOriginal, MaxProjectControlPrincipalBytes, &p, false); err != nil {
		return result, err
	}
	// The SDK Principal7 serializer checks text/integers only. It does not bind
	// this developer's account to the purpose-isolated publisher/custodian owner.
	for _, s := range []string{p.Account, p.DeviceID, p.SessionRef, p.CurrentRef} {
		if !artifactCatalogText(s) {
			return result, invalid("publisher registration original principal text")
		}
	}
	if p.AccountGeneration == 0 || p.SessionGeneration == 0 || p.ExpiresMS <= 0 {
		return result, invalid("publisher registration original principal integers")
	}
	c, err := parseProjectControlCommand(commandOriginal, atMS)
	if err != nil {
		return result, err
	}
	b, err := ParsePublisherRegistrationBody(registrationOriginal)
	if err != nil {
		return result, err
	}
	if b.PrincipalSHA256 != projectControlSHA(principalOriginal) || b.CommandSHA256 != projectControlSHA(commandOriginal) || b.PublicSHA256 != projectControlSHA(publicOriginal) ||
		c.Action != "project.publisher" || c.Revoke || c.SubjectAccount != pub.Account || c.ProjectID != pub.ProjectID || c.PublisherID != pub.PublisherID || c.PublicOriginalSHA256 != b.PublicSHA256 ||
		b.Account != pub.Account || b.ProjectID != pub.ProjectID || b.PublisherID != pub.PublisherID || b.PublisherKeyVersion != pub.PublisherKeyVersion || b.SourceCurrentRef != p.CurrentRef {
		return result, invalid("publisher registration original binding")
	}
	if atMS < b.IssuedAtMS || atMS >= b.ExpiresAtMS || b.ExpiresAtMS > uint64(p.ExpiresMS) || b.ExpiresAtMS > uint64(c.ExpiresMS) || b.ExpiresAtMS > uint64(c.GrantExpiresMS) {
		return result, invalid("publisher registration original expiry")
	}
	return PublisherRegistrationMessage{Publisher: pub, Principal: p, Command: c, Registration: b,
		PublicOriginal: clone(publicOriginal), PrincipalOriginal: clone(principalOriginal), CommandOriginal: clone(commandOriginal), RegistrationOriginal: clone(registrationOriginal)}, nil
}

// BuildPublisherRegistrationPoPMessage is SDK46's exact E9. The original R13
// purpose stays ARTIFACT-RELEASE; only this enclosing proof's purpose is fixed
// IDE-PUBLISHER-REGISTRATION. Nothing here creates or signs a Member.
func BuildPublisherRegistrationPoPMessage(publicOriginal, principalOriginal, commandOriginal, registrationOriginal []byte, expected ArtifactPublisherRegistration, atMS uint64) ([]byte, error) {
	v, err := publisherRegistrationInputs(publicOriginal, principalOriginal, commandOriginal, registrationOriginal, expected, atMS)
	if err != nil {
		return nil, err
	}
	return EncodeFields([]byte(PublisherRegistrationPoPVersion), []byte(Version), []byte(Suite), []byte(PublisherRegistrationPoPPurpose),
		v.Publisher.NetworkID, []byte(v.Publisher.SubjectOwner), []byte(v.Publisher.PublisherKeyVersion), publicOriginal, registrationOriginal)
}

func InspectPublisherRegistrationPoPMessage(raw []byte, expected ArtifactPublisherRegistration, publicOriginal, principalOriginal, commandOriginal, registrationOriginal []byte, atMS uint64) (PublisherRegistrationMessage, error) {
	var result PublisherRegistrationMessage
	_, err := fields(raw, 9, MaxPublisherRegistrationPoPMessageBytes, len(PublisherRegistrationPoPVersion), len(Version), len(Suite), len(PublisherRegistrationPoPPurpose), 32, 42, 20, MaxPublisherRegistrationPublicBytes, MaxPublisherRegistrationBodyBytes)
	if err != nil {
		return result, err
	}
	want, err := BuildPublisherRegistrationPoPMessage(publicOriginal, principalOriginal, commandOriginal, registrationOriginal, expected, atMS)
	if err != nil {
		return result, err
	}
	if !bytes.Equal(raw, want) {
		return result, invalid("publisher registration exact PoP E9")
	}
	return publisherRegistrationInputs(publicOriginal, principalOriginal, commandOriginal, registrationOriginal, expected, atMS)
}

// InspectPublisherRegistrationPoPMember is structural DATA inspection only.
// It binds the N1/index0 proof to the complete independently expected publisher
// pair and exact E9 originals. The ordinary dual-AND Verifier must still check
// both signatures and membership. A self-contained PoP supplies no registered
// account, Source/current/ACL/Root, protected custody or registration authority.
func InspectPublisherRegistrationPoPMember(raw []byte, expected ArtifactPublisherRegistration, publicOriginal, principalOriginal, commandOriginal, registrationOriginal []byte, atMS uint64) (Member, error) {
	if len(raw) > MaxPublisherRegistrationPoPMemberBytes {
		return Member{}, invalid("publisher registration PoP member bound")
	}
	m, err := DecodeMember(raw)
	if err != nil {
		return Member{}, err
	}
	c := m.Certificate
	if c.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 || c.Purpose != PublisherRegistrationPoPPurpose || c.Owner != expected.SubjectOwner ||
		!bytes.Equal(c.ChainID, expected.NetworkID) || !bytes.Equal(c.PKA, expected.PKA) || !bytes.Equal(c.PKB, expected.PKB) {
		return Member{}, invalid("publisher registration PoP exact full-pair AND N1 context")
	}
	if _, err := InspectPublisherRegistrationPoPMessage(m.Message, expected, publicOriginal, principalOriginal, commandOriginal, registrationOriginal, atMS); err != nil {
		return Member{}, err
	}
	return m, nil
}

func publisherRegistrationCustodianInputs(publicOriginal, principalOriginal, commandOriginal, registrationOriginal, popMemberOriginal []byte, publisher ArtifactPublisherRegistration, expected PublisherRegistrationCustodianBinding, atMS uint64) (PublisherRegistrationMessage, error) {
	v, err := publisherRegistrationInputs(publicOriginal, principalOriginal, commandOriginal, registrationOriginal, publisher, atMS)
	if err != nil {
		return v, err
	}
	if err := validateProjectControlBinding(ProjectControlBinding(expected)); err != nil {
		return PublisherRegistrationMessage{}, err
	}
	if !bytes.Equal(expected.NetworkID, v.Publisher.NetworkID) || expected.CallerIdentity != v.Registration.CallerIdentity || expected.SourceCurrentRef != v.Registration.CustodyCurrentRef || len(popMemberOriginal) == 0 || len(popMemberOriginal) > MaxPublisherRegistrationPoPMemberBytes {
		return PublisherRegistrationMessage{}, invalid("publisher registration custodian original context or PoP bound")
	}
	// SDK46's encoder binds SHA256 of the exact decoded raw PoP Member. It
	// does not decode or authenticate that Member in the encoder. The genuine
	// registered verifier must still check both signatures, N1/index0, exact
	// purpose/context/message and the separate custodian pair before admission.
	v.Custodian = expected
	v.Custodian.NetworkID, v.Custodian.PKA, v.Custodian.PKB = clone(expected.NetworkID), clone(expected.PKA), clone(expected.PKB)
	v.PoPMemberOriginal, v.PoPMemberSHA256 = clone(popMemberOriginal), projectControlSHA(popMemberOriginal)
	return v, nil
}

// BuildPublisherRegistrationCustodianMessage is exactly the SDK's E12. PKA/B
// are required independent expected DATA for the following verifier; neither
// the caller's context nor this function asserts registered/current authority.
func BuildPublisherRegistrationCustodianMessage(publicOriginal, principalOriginal, commandOriginal, registrationOriginal, popMemberOriginal []byte, publisher ArtifactPublisherRegistration, expected PublisherRegistrationCustodianBinding, atMS uint64) ([]byte, error) {
	v, err := publisherRegistrationCustodianInputs(publicOriginal, principalOriginal, commandOriginal, registrationOriginal, popMemberOriginal, publisher, expected, atMS)
	if err != nil {
		return nil, err
	}
	return EncodeFields([]byte(PublisherRegistrationCustodianVersion), []byte(Version), []byte(Suite), []byte(PublisherRegistrationCustodianPurpose), expected.NetworkID,
		[]byte(expected.Owner), []byte(expected.KeyVersion), []byte(expected.ExecutionHeight), principalOriginal, commandOriginal, registrationOriginal, []byte(v.PoPMemberSHA256))
}

func InspectPublisherRegistrationCustodianMessage(raw []byte, expected PublisherRegistrationCustodianBinding, publisher ArtifactPublisherRegistration, publicOriginal, principalOriginal, commandOriginal, registrationOriginal, popMemberOriginal []byte, atMS uint64) (PublisherRegistrationMessage, error) {
	var result PublisherRegistrationMessage
	_, err := fields(raw, 12, MaxPublisherRegistrationCustodianMessageBytes, len(PublisherRegistrationCustodianVersion), len(Version), len(Suite), len(PublisherRegistrationCustodianPurpose), 32, 42, 20, 20, MaxProjectControlPrincipalBytes, MaxProjectControlCommandBytes, MaxPublisherRegistrationBodyBytes, 64)
	if err != nil {
		return result, err
	}
	want, err := BuildPublisherRegistrationCustodianMessage(publicOriginal, principalOriginal, commandOriginal, registrationOriginal, popMemberOriginal, publisher, expected, atMS)
	if err != nil {
		return result, err
	}
	if !bytes.Equal(raw, want) {
		return result, invalid("publisher registration exact custodian E12")
	}
	return publisherRegistrationCustodianInputs(publicOriginal, principalOriginal, commandOriginal, registrationOriginal, popMemberOriginal, publisher, expected, atMS)
}

// InspectPublisherRegistrationCustodianMember structurally binds both original
// N1 Members, the complete independent custodian pair, and the exact E12, whose
// final field hashes the entire original PoP Member rather than its message or
// certificate. It verifies no signatures or current registration/role. Callers
// must apply the original dual-AND Verifier separately to BOTH Members and keep
// Main/Auth's genuine Source/current/revoke/ACL/once admission before any effect.
func InspectPublisherRegistrationCustodianMember(raw []byte, expected PublisherRegistrationCustodianBinding, publisher ArtifactPublisherRegistration, publicOriginal, principalOriginal, commandOriginal, registrationOriginal, popMemberOriginal []byte, atMS uint64) (Member, error) {
	if len(raw) > MaxPublisherRegistrationCustodianMemberBytes {
		return Member{}, invalid("publisher registration custodian member bound")
	}
	// Matching either algorithm's publisher key defeats pair independence.
	// This is SDK46's explicit AND condition, not an owner-label comparison.
	if bytes.Equal(expected.PKA, publisher.PKA) || bytes.Equal(expected.PKB, publisher.PKB) {
		return Member{}, invalid("publisher registration custodian pair is not independent")
	}
	if _, err := InspectPublisherRegistrationPoPMember(popMemberOriginal, publisher, publicOriginal, principalOriginal, commandOriginal, registrationOriginal, atMS); err != nil {
		return Member{}, err
	}
	m, err := DecodeMember(raw)
	if err != nil {
		return Member{}, err
	}
	c := m.Certificate
	if c.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 || c.Purpose != PublisherRegistrationCustodianPurpose || c.Owner != expected.Owner ||
		!bytes.Equal(c.ChainID, expected.NetworkID) || !bytes.Equal(c.PKA, expected.PKA) || !bytes.Equal(c.PKB, expected.PKB) {
		return Member{}, invalid("publisher registration custodian exact full-pair AND N1 context")
	}
	if _, err := InspectPublisherRegistrationCustodianMessage(m.Message, expected, publisher, publicOriginal, principalOriginal, commandOriginal, registrationOriginal, popMemberOriginal, atMS); err != nil {
		return Member{}, err
	}
	return m, nil
}
