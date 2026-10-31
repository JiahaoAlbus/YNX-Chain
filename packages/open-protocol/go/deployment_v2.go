package openprotocol

import (
	"bytes"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// DeploymentV2Bind is DATA about actual held bytes, never an approval.
type DeploymentV2Bind struct {
	Bytes    string `json:"bytes"`
	SHA3_512 string `json:"sha3_512"`
	SHA512   string `json:"sha512"`
}

func BindDeploymentV2Bytes(actual []byte) (DeploymentV2Bind, error) {
	if len(actual) > 64*1024*1024 {
		return DeploymentV2Bind{}, ErrBounds
	}
	body := append([]byte(nil), actual...)
	a, b := sha3.Sum512(body), sha512.Sum512(body)
	return DeploymentV2Bind{strconv.Itoa(len(body)), hex.EncodeToString(a[:]), hex.EncodeToString(b[:])}, nil
}
func EncodeDeploymentV2Bind(b DeploymentV2Bind) ([]byte, error) {
	return bgBind(GrantBindV1{Bytes: b.Bytes, SHA3_512: b.SHA3_512, SHA512: b.SHA512})
}
func DecodeDeploymentV2Bind(wire []byte) (DeploymentV2Bind, error) {
	b, e := bgReadBind(wire)
	if e != nil {
		return DeploymentV2Bind{}, e
	}
	out := DeploymentV2Bind{b.Bytes, b.SHA3_512, b.SHA512}
	_, e = EncodeDeploymentV2Bind(out)
	return out, e
}
func AssertDeploymentV2BytesBinding(actual []byte, expected DeploymentV2Bind) (DeploymentV2Bind, error) {
	got, e := BindDeploymentV2Bytes(actual)
	if e != nil {
		return got, e
	}
	if _, e = EncodeDeploymentV2Bind(expected); e != nil {
		return got, e
	}
	if got != expected {
		return got, ErrInvalid
	}
	return got, nil
}

const DeploymentManifestV2Domain = "YNX-CLOUD-DEPLOYMENT-MANIFEST/v2"
const DeploymentManifestV2MaxBytes = 16384
const DeploymentArtifactV2MaxBytes = 67108864

type DeploymentV2Ref struct {
	Realm  string `json:"realm"`
	Tenant string `json:"tenant"`
	Kind   string `json:"kind"`
	ID     string `json:"id"`
	Rev    string `json:"rev"`
}
type DeploymentV2FileObj struct {
	Ref       DeploymentV2Ref  `json:"ref"`
	Content   DeploymentV2Bind `json:"content"`
	Size      string           `json:"size"`
	MIME      string           `json:"mime"`
	ObjectKey string           `json:"objectKey"`
}
type DeploymentManifestV2 struct {
	Realm          string              `json:"realm"`
	Tenant         string              `json:"tenant"`
	Project        DeploymentV2Ref     `json:"project"`
	Version        string              `json:"version"`
	Artifact       DeploymentV2FileObj `json:"artifact"`
	Env            string              `json:"env"`
	Publisher      DeploymentV2Ref     `json:"publisher"`
	PublisherEpoch string              `json:"publisherEpoch"`
	Issuer         DeploymentV2Ref     `json:"issuer"`
	IssuerEpoch    string              `json:"issuerEpoch"`
}
type DeploymentManifestV2DATA struct {
	PayloadOriginal []byte
	Binding         DeploymentV2Bind
}

func dvText(s string) ([]byte, error) {
	if len(s) < 1 || len(s) > 256 || !utf8.ValidString(s) {
		return nil, ErrInvalid
	}
	return []byte(s), nil
}
func dvReadText(b []byte) (string, error) { s := string(b); _, e := dvText(s); return s, e }
func dvRef(r DeploymentV2Ref) ([]byte, error) {
	rows := make([][]byte, 5)
	var e error
	for i, s := range []string{r.Realm, r.Tenant, r.Kind, r.ID} {
		rows[i], e = dvText(s)
		if e != nil {
			return nil, e
		}
	}
	rows[4], e = bgU64(r.Rev)
	if e != nil {
		return nil, e
	}
	return EncodeFields(rows...)
}
func dvReadRef(w []byte) (DeploymentV2Ref, error) {
	f, e := DecodeFields(w, 5)
	if e != nil {
		return DeploymentV2Ref{}, e
	}
	s := make([]string, 4)
	for i := range s {
		s[i], e = dvReadText(f[i])
		if e != nil {
			return DeploymentV2Ref{}, e
		}
	}
	rev, e := bgRead64(f[4])
	return DeploymentV2Ref{s[0], s[1], s[2], s[3], rev}, e
}
func dvControl(s string) bool {
	for _, r := range s {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}
func dvEnv(s string) ([]byte, error) {
	b, e := dvText(s)
	if e != nil || strings.TrimSpace(strings.Trim(s, "\ufeff")) != s || dvControl(s) {
		return nil, ErrInvalid
	}
	return b, nil
}
func dvMIME(s string) ([]byte, error) {
	b, e := dvText(s)
	if e != nil {
		return nil, e
	}
	for _, c := range b {
		if c < 32 || c > 126 {
			return nil, ErrInvalid
		}
	}
	return b, nil
}
func dvObjectKey(s string) ([]byte, error) {
	b, e := dvText(s)
	if e != nil || dvControl(s) || strings.HasPrefix(s, "//") || dvURL.MatchString(s) {
		return nil, ErrInvalid
	}
	return b, nil
}

var dvURL = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.-]*://`)

func dvFile(a DeploymentV2FileObj) ([]byte, error) {
	r, e := dvRef(a.Ref)
	if e != nil {
		return nil, e
	}
	content, e := EncodeDeploymentV2Bind(a.Content)
	if e != nil {
		return nil, e
	}
	size, e := bgU64(a.Size)
	if e != nil || a.Size != a.Content.Bytes {
		return nil, ErrInvalid
	}
	n, _ := strconv.ParseUint(a.Size, 10, 64)
	if n > DeploymentArtifactV2MaxBytes {
		return nil, ErrBounds
	}
	mime, e := dvMIME(a.MIME)
	if e != nil {
		return nil, e
	}
	key, e := dvObjectKey(a.ObjectKey)
	if e != nil {
		return nil, e
	}
	return EncodeFields(r, content, size, mime, key)
}
func dvReadFile(w []byte) (DeploymentV2FileObj, error) {
	var a DeploymentV2FileObj
	f, e := DecodeFields(w, 5)
	if e != nil {
		return a, e
	}
	if a.Ref, e = dvReadRef(f[0]); e != nil {
		return a, e
	}
	if a.Content, e = DecodeDeploymentV2Bind(f[1]); e != nil {
		return a, e
	}
	if a.Size, e = bgRead64(f[2]); e != nil {
		return a, e
	}
	if a.MIME, e = dvReadText(f[3]); e != nil {
		return a, e
	}
	a.ObjectKey, e = dvReadText(f[4])
	return a, e
}
func dvPayload(m DeploymentManifestV2) ([]byte, error) {
	for _, r := range []DeploymentV2Ref{m.Project, m.Artifact.Ref, m.Publisher} {
		if r.Realm != m.Realm || r.Tenant != m.Tenant {
			return nil, ErrInvalid
		}
	}
	rows := make([][]byte, 11)
	rows[0] = []byte(DeploymentManifestV2Domain)
	var e error
	if rows[1], e = dvText(m.Realm); e != nil {
		return nil, e
	}
	if rows[2], e = dvText(m.Tenant); e != nil {
		return nil, e
	}
	if rows[3], e = dvRef(m.Project); e != nil {
		return nil, e
	}
	if rows[4], e = bgU64(m.Version); e != nil {
		return nil, e
	}
	if rows[5], e = dvFile(m.Artifact); e != nil {
		return nil, e
	}
	if rows[6], e = dvEnv(m.Env); e != nil {
		return nil, e
	}
	if rows[7], e = dvRef(m.Publisher); e != nil {
		return nil, e
	}
	if rows[8], e = bgU64(m.PublisherEpoch); e != nil {
		return nil, e
	}
	if rows[9], e = dvRef(m.Issuer); e != nil {
		return nil, e
	}
	if rows[10], e = bgU64(m.IssuerEpoch); e != nil {
		return nil, e
	}
	w, e := EncodeFields(rows...)
	if e != nil {
		return nil, e
	}
	if len(w) > DeploymentManifestV2MaxBytes {
		return nil, ErrBounds
	}
	return w, nil
}

// CreateDeploymentManifestV2DATA captures and checks actual bytes. It is not a signer.
func CreateDeploymentManifestV2DATA(m DeploymentManifestV2, actual []byte) (DeploymentManifestV2DATA, error) {
	w, e := dvPayload(m)
	if e != nil {
		return DeploymentManifestV2DATA{}, e
	}
	if _, e = AssertDeploymentV2BytesBinding(actual, m.Artifact.Content); e != nil {
		return DeploymentManifestV2DATA{}, e
	}
	b, e := BindDeploymentV2Bytes(w)
	return DeploymentManifestV2DATA{w, b}, e
}
func DecodeDeploymentManifestV2DATA(input []byte, expected *DeploymentV2Bind) (DeploymentManifestV2, error) {
	var m DeploymentManifestV2
	if len(input) > DeploymentManifestV2MaxBytes {
		return m, ErrBounds
	}
	w := append([]byte(nil), input...)
	f, e := DecodeFields(w, 11)
	if e != nil {
		return m, e
	}
	if string(f[0]) != DeploymentManifestV2Domain {
		return m, ErrInvalid
	}
	if m.Realm, e = dvReadText(f[1]); e != nil {
		return m, e
	}
	if m.Tenant, e = dvReadText(f[2]); e != nil {
		return m, e
	}
	if m.Project, e = dvReadRef(f[3]); e != nil {
		return m, e
	}
	if m.Version, e = bgRead64(f[4]); e != nil {
		return m, e
	}
	if m.Artifact, e = dvReadFile(f[5]); e != nil {
		return m, e
	}
	if m.Env, e = dvReadText(f[6]); e != nil {
		return m, e
	}
	if m.Publisher, e = dvReadRef(f[7]); e != nil {
		return m, e
	}
	if m.PublisherEpoch, e = bgRead64(f[8]); e != nil {
		return m, e
	}
	if m.Issuer, e = dvReadRef(f[9]); e != nil {
		return m, e
	}
	if m.IssuerEpoch, e = bgRead64(f[10]); e != nil {
		return m, e
	}
	canonical, e := dvPayload(m)
	if e != nil {
		return m, e
	}
	if !bytes.Equal(canonical, w) {
		return m, ErrInvalid
	}
	if expected != nil {
		if _, e = AssertDeploymentV2BytesBinding(w, *expected); e != nil {
			return m, e
		}
	}
	return m, nil
}
func AssertDeploymentArtifactV2DATA(wire, actual []byte) (DeploymentV2Bind, error) {
	m, e := DecodeDeploymentManifestV2DATA(wire, nil)
	if e != nil {
		return DeploymentV2Bind{}, e
	}
	return AssertDeploymentV2BytesBinding(actual, m.Artifact.Content)
}
