package ynxbatch

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// This new typed wrapper is not yet a production publisher integration. All
// exports below inspect public DATA only: no key handle, signer, registration
// issuer, Root, ACL, permission, account lookup or execution height is accepted.
const (
	ArtifactPublisherRegistrationVersion = "YNX-IDE-ARTIFACT-PUBLISHER/v1"
	ArtifactPublicationMessageVersion    = "YNX-IDE-ARTIFACT-RELEASE/v1"
	ArtifactPublicationPurpose           = "ARTIFACT-RELEASE"
	ArtifactPublisherKeyRole             = "ide-artifact-publisher"
	MaxArtifactPublisherBytes            = 65536 // Existing Auth R161 PublicOriginal limit.
	MaxArtifactManifestBytes             = 16384 // Existing Auth R159 invocation limit.
	MaxArtifactContentBytes              = 67108864
	MaxArtifactPublicationMessageBytes   = 4 + 3*4 + len(ArtifactPublicationMessageVersion) + MaxArtifactPublisherBytes + MaxArtifactManifestBytes
)

// ArtifactPublisherRegistration is the variable portion of the exact 13-field
// public registration R. Protocol version, suite, purpose and role are fixed by
// this codec, never caller-selected. Public keys are detached on decode.
//
// NetworkID/SubjectOwner are labels from the original independently admitted
// Auth Source. SubjectOwner is only the existing Batch context's ASCII label;
// it is NOT evidence that these separate publisher keys are asset account keys.
// Account, ProjectID and PublisherID must match the original Auth principal and
// current project publisher. PublisherKeyVersion belongs to the purpose-isolated
// publisher store, never the Auth identity keyVersion or catalog revision.
type ArtifactPublisherRegistration struct {
	NetworkID                       []byte
	SubjectOwner                    string
	Account, ProjectID, PublisherID string
	PublisherKeyVersion             string
	PKA, PKB                        []byte
}

// ArtifactPublicationManifest is the existing Auth R159 six-field manifest.
// The original canonical bytes, not a reserialized struct or manifest digest,
// are included in M. ContentDigest remains the original SHA256 content binding.
type ArtifactPublicationManifest struct {
	ProjectID         string
	Version           string
	ContentDigest     string
	PublishPurpose    string
	TargetEnvironment string
	ByteSize          uint64
}

// ArtifactPublicationMessage is detached public DATA, not an authorization
// capability. Mutating it cannot change any caller-owned original input.
type ArtifactPublicationMessage struct {
	Publisher            ArtifactPublisherRegistration
	Manifest             ArtifactPublicationManifest
	RegistrationOriginal []byte
	ManifestOriginal     []byte
}

func artifactCatalogText(s string) bool {
	if !utf8.ValidString(s) || len(s) < 1 || len(s) > 256 || strings.TrimSpace(s) != s {
		return false
	}
	for _, r := range s {
		if r < 33 || r == 127 { // Exact Auth R161 catalog text constraint.
			return false
		}
	}
	return true
}

func artifactManifestText(s string) bool {
	if !utf8.ValidString(s) || len(s) < 1 || len(s) > 256 || strings.TrimSpace(s) != s {
		return false
	}
	for _, r := range s {
		// NSCharacterSet.controlCharacterSet includes control and format chars.
		if unicode.IsControl(r) || unicode.In(r, unicode.Cf) {
			return false
		}
	}
	return true
}

func artifactCanonicalVersion(s string) bool {
	n, err := strconv.ParseUint(s, 10, 64)
	return err == nil && n > 0 && strconv.FormatUint(n, 10) == s
}

func artifactLowerHex(s string, size int) bool {
	if len(s) != size*2 {
		return false
	}
	for _, c := range []byte(s) {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func validateArtifactPublisher(r ArtifactPublisherRegistration) error {
	if len(r.NetworkID) != 32 || len(r.SubjectOwner) != 42 || !strings.HasPrefix(r.SubjectOwner, "0x") || !artifactLowerHex(r.SubjectOwner[2:], 20) ||
		!artifactCatalogText(r.Account) || !artifactCatalogText(r.ProjectID) || !artifactCatalogText(r.PublisherID) || !artifactCanonicalVersion(r.PublisherKeyVersion) ||
		len(r.PKA) != PublicKeyASize || len(r.PKB) != PublicKeyBSize {
		return invalid("artifact publisher fields")
	}
	return nil
}

// EncodeArtifactPublisherRegistration is the sole public registration wire:
// E(tag, Version, Suite, purpose, role, network32, subjectOwner, account,
//
//	projectId, publisherId, publisherKeyVersion, fullPKA, fullPKB).
//
// R161 stores these exact bytes as PublicOriginal and SHA256(R) as PublicSHA256.
// RegistrationRef is NOT derived here: R161 requires a separate real original
// protected registration reference (its text type is not necessarily a hash).
func EncodeArtifactPublisherRegistration(r ArtifactPublisherRegistration) ([]byte, error) {
	if err := validateArtifactPublisher(r); err != nil {
		return nil, err
	}
	return EncodeFields([]byte(ArtifactPublisherRegistrationVersion), []byte(Version), []byte(Suite), []byte(ArtifactPublicationPurpose), []byte(ArtifactPublisherKeyRole),
		r.NetworkID, []byte(r.SubjectOwner), []byte(r.Account), []byte(r.ProjectID), []byte(r.PublisherID), []byte(r.PublisherKeyVersion), r.PKA, r.PKB)
}

func DecodeArtifactPublisherRegistration(raw []byte) (ArtifactPublisherRegistration, error) {
	var r ArtifactPublisherRegistration
	f, err := fields(raw, 13, MaxArtifactPublisherBytes, 64, 64, 64, 64, 64, 32, 42, 256, 256, 256, 20, PublicKeyASize, PublicKeyBSize)
	if err != nil {
		return r, err
	}
	if string(f[0]) != ArtifactPublisherRegistrationVersion || string(f[1]) != Version || string(f[2]) != Suite || string(f[3]) != ArtifactPublicationPurpose || string(f[4]) != ArtifactPublisherKeyRole {
		return r, invalid("artifact publisher tag, suite, purpose or role")
	}
	r = ArtifactPublisherRegistration{NetworkID: clone(f[5]), SubjectOwner: string(f[6]), Account: string(f[7]), ProjectID: string(f[8]), PublisherID: string(f[9]),
		PublisherKeyVersion: string(f[10]), PKA: clone(f[11]), PKB: clone(f[12])}
	return r, validateArtifactPublisher(r)
}

// ArtifactPublisherPublicSHA256 only identifies structurally valid public R.
// Its output is neither RegistrationRef nor a publisher qualification/grant.
func ArtifactPublisherPublicSHA256(raw []byte) (string, error) {
	if _, err := DecodeArtifactPublisherRegistration(raw); err != nil {
		return "", err
	}
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:]), nil
}

// artifactJSONString writes the existing Foundation compact JSON string form:
// no slash/HTML/U+2028 escaping; only quote and backslash need escaping because
// the original R159 ordinary-text validator has already rejected controls.
func artifactJSONString(out []byte, s string) []byte {
	out = append(out, '"')
	for i := 0; i < len(s); i++ {
		if s[i] == '"' || s[i] == '\\' {
			out = append(out, '\\')
		}
		out = append(out, s[i])
	}
	return append(out, '"')
}

func artifactCanonicalManifest(m ArtifactPublicationManifest) []byte {
	out := []byte(`{"byteSize":` + strconv.FormatUint(m.ByteSize, 10) + `,"contentDigest":`)
	out = artifactJSONString(out, m.ContentDigest)
	out = append(out, `,"projectId":`...)
	out = artifactJSONString(out, m.ProjectID)
	out = append(out, `,"publishPurpose":`...)
	out = artifactJSONString(out, m.PublishPurpose)
	out = append(out, `,"targetEnvironment":`...)
	out = artifactJSONString(out, m.TargetEnvironment)
	out = append(out, `,"version":`...)
	out = artifactJSONString(out, m.Version)
	return append(out, '}')
}

// ParseArtifactPublicationManifest accepts only the exact original Auth R159
// canonical six-field UTF8 JSON. Duplicate, unknown, escaped duplicate, bool,
// float, exponent, noncanonical encoding and trailing data all fail closed.
// Parsing alone does not check the actual artifact, ACL, approval or signature.
func ParseArtifactPublicationManifest(raw []byte) (ArtifactPublicationManifest, error) {
	var m ArtifactPublicationManifest
	if len(raw) < 1 || len(raw) > MaxArtifactManifestBytes || !utf8.Valid(raw) {
		return m, invalid("artifact manifest bounds or UTF8")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	start, err := d.Token()
	if err != nil || start != json.Delim('{') {
		return m, invalid("artifact manifest object")
	}
	seen := make(map[string]bool, 6)
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] || len(seen) == 6 {
			return m, invalid("artifact manifest duplicate or fields")
		}
		seen[key] = true
		var into any
		switch key {
		case "projectId":
			into = &m.ProjectID
		case "version":
			into = &m.Version
		case "contentDigest":
			into = &m.ContentDigest
		case "publishPurpose":
			into = &m.PublishPurpose
		case "targetEnvironment":
			into = &m.TargetEnvironment
		case "byteSize":
			into = &m.ByteSize
		default:
			return m, invalid("artifact manifest unknown field")
		}
		if err := d.Decode(into); err != nil {
			return m, invalid("artifact manifest field type")
		}
	}
	end, err := d.Token()
	if err != nil || end != json.Delim('}') || len(seen) != 6 {
		return m, invalid("artifact manifest field count")
	}
	if _, err := d.Token(); err != io.EOF {
		return m, invalid("artifact manifest trailing data")
	}
	if m.ByteSize < 1 || m.ByteSize > MaxArtifactContentBytes || !artifactLowerHex(m.ContentDigest, 32) ||
		!artifactManifestText(m.ProjectID) || !artifactManifestText(m.Version) || !artifactManifestText(m.PublishPurpose) || !artifactManifestText(m.TargetEnvironment) {
		return m, invalid("artifact manifest value")
	}
	if !bytes.Equal(raw, artifactCanonicalManifest(m)) {
		return m, invalid("artifact manifest canonical bytes")
	}
	return m, nil
}

func artifactPublicationInputs(registrationOriginal, manifestOriginal []byte, expected ArtifactPublisherRegistration) (ArtifactPublicationMessage, error) {
	var result ArtifactPublicationMessage
	expectedRaw, err := EncodeArtifactPublisherRegistration(expected)
	if err != nil {
		return result, err
	}
	if !bytes.Equal(registrationOriginal, expectedRaw) {
		return result, invalid("artifact publisher expected binding")
	}
	r, err := DecodeArtifactPublisherRegistration(registrationOriginal)
	if err != nil {
		return result, err
	}
	m, err := ParseArtifactPublicationManifest(manifestOriginal)
	if err != nil {
		return result, err
	}
	if m.ProjectID != r.ProjectID {
		return result, invalid("artifact publication project binding")
	}
	return ArtifactPublicationMessage{Publisher: r, Manifest: m, RegistrationOriginal: clone(registrationOriginal), ManifestOriginal: clone(manifestOriginal)}, nil
}

// BuildArtifactPublicationMessage uses the independently selected expected
// complete public binding. The caller must obtain real Source/current/approval;
// passing matching DATA cannot manufacture any of those facts.
func BuildArtifactPublicationMessage(registrationOriginal, manifestOriginal []byte, expected ArtifactPublisherRegistration) ([]byte, error) {
	inputs, err := artifactPublicationInputs(registrationOriginal, manifestOriginal, expected)
	if err != nil {
		return nil, err
	}
	return EncodeFields([]byte(ArtifactPublicationMessageVersion), inputs.RegistrationOriginal, inputs.ManifestOriginal)
}

func InspectArtifactPublicationMessage(raw []byte, expected ArtifactPublisherRegistration, expectedManifestOriginal []byte) (ArtifactPublicationMessage, error) {
	var result ArtifactPublicationMessage
	f, err := fields(raw, 3, MaxArtifactPublicationMessageBytes, 64, MaxArtifactPublisherBytes, MaxArtifactManifestBytes)
	if err != nil {
		return result, err
	}
	if string(f[0]) != ArtifactPublicationMessageVersion || !bytes.Equal(f[2], expectedManifestOriginal) {
		return result, invalid("artifact publication tag or original manifest")
	}
	return artifactPublicationInputs(f[1], f[2], expected)
}

// InspectArtifactPublicationMember is structural DATA inspection, NOT signature
// verification. It fences the exact N=1/index=0/empty-path publication profile
// before the existing dual-AND mathematical verifier is invoked. A future SDK
// typed adapter must separately supply original publisher trust; never use an
// asset account registration resolver or treat a public pair as an issuer.
func InspectArtifactPublicationMember(raw []byte, expected ArtifactPublisherRegistration, expectedManifestOriginal []byte) (Member, error) {
	m, err := DecodeMember(raw)
	if err != nil {
		return Member{}, err
	}
	c := m.Certificate
	if c.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 || c.Purpose != ArtifactPublicationPurpose || c.Owner != expected.SubjectOwner ||
		!bytes.Equal(c.ChainID, expected.NetworkID) || !bytes.Equal(c.PKA, expected.PKA) || !bytes.Equal(c.PKB, expected.PKB) {
		return Member{}, invalid("artifact publication N1 or context binding")
	}
	if _, err := InspectArtifactPublicationMessage(m.Message, expected, expectedManifestOriginal); err != nil {
		return Member{}, err
	}
	return m, nil
}
