package ynxbatch

// This is the fixed SDK a7bfd7800 DATA profile, not a Source, issuer,
// registration, approval, deployment operation or chain transaction.
import (
	"bytes"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/binary"
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	DeploymentManifestV2Domain   = "YNX-CLOUD-DEPLOYMENT-MANIFEST/v2"
	DeploymentManifestV2Purpose  = "CLOUD-DEPLOYMENT-MANIFEST-V2"
	DeploymentManifestV2MaxBytes = 16384
	DeploymentArtifactV2MaxBytes = 67108864
	DeploymentV2BindBytes        = 152
)

type DeploymentV2Bind struct {
	Bytes    string `json:"bytes"`
	SHA3_512 string `json:"sha3_512"`
	SHA512   string `json:"sha512"`
}
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

func deploymentV2U64(s string) ([]byte, error) {
	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil || strconv.FormatUint(n, 10) != s {
		return nil, invalid("deployment v2 canonical U64")
	}
	out := make([]byte, 8)
	binary.BigEndian.PutUint64(out, n)
	return out, nil
}
func deploymentV2ReadU64(raw []byte) (string, error) {
	if len(raw) != 8 {
		return "", invalid("deployment v2 U64 width")
	}
	return strconv.FormatUint(binary.BigEndian.Uint64(raw), 10), nil
}
func deploymentV2Text(s string) ([]byte, error) {
	if len(s) < 1 || len(s) > 256 || !utf8.ValidString(s) {
		return nil, invalid("deployment v2 strict UTF8 text")
	}
	return []byte(s), nil
}
func deploymentV2Control(s string) bool {
	for _, r := range s {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

func BindDeploymentV2Bytes(actual []byte) (DeploymentV2Bind, error) {
	if len(actual) > DeploymentArtifactV2MaxBytes {
		return DeploymentV2Bind{}, invalid("deployment v2 artifact size")
	}
	// One detached capture supplies both digests; caller must not concurrently
	// mutate the input. No key is instantiated or authorization inferred.
	body := bytes.Clone(actual)
	a, b := sha3.Sum512(body), sha512.Sum512(body)
	return DeploymentV2Bind{strconv.Itoa(len(body)), hex.EncodeToString(a[:]), hex.EncodeToString(b[:])}, nil
}
func EncodeDeploymentV2Bind(b DeploymentV2Bind) ([]byte, error) {
	n, err := deploymentV2U64(b.Bytes)
	if err != nil {
		return nil, err
	}
	if len(b.SHA3_512) != 128 || len(b.SHA512) != 128 || strings.ToLower(b.SHA3_512) != b.SHA3_512 || strings.ToLower(b.SHA512) != b.SHA512 {
		return nil, invalid("deployment v2 digest text")
	}
	a, ea := hex.DecodeString(b.SHA3_512)
	z, ez := hex.DecodeString(b.SHA512)
	if ea != nil || ez != nil {
		return nil, invalid("deployment v2 digest hex")
	}
	return EncodeFields(n, a, z)
}
func DecodeDeploymentV2Bind(raw []byte) (DeploymentV2Bind, error) {
	f, err := DecodeFields(raw, 3, DeploymentV2BindBytes)
	if err != nil {
		return DeploymentV2Bind{}, err
	}
	n, err := deploymentV2ReadU64(f[0])
	if err != nil || len(f[1]) != 64 || len(f[2]) != 64 {
		return DeploymentV2Bind{}, invalid("deployment v2 bind width")
	}
	return DeploymentV2Bind{n, hex.EncodeToString(f[1]), hex.EncodeToString(f[2])}, nil
}
func AssertDeploymentV2BytesBinding(actual []byte, expected DeploymentV2Bind) (DeploymentV2Bind, error) {
	if _, err := EncodeDeploymentV2Bind(expected); err != nil {
		return DeploymentV2Bind{}, err
	}
	got, err := BindDeploymentV2Bytes(actual)
	if err != nil {
		return got, err
	}
	if got != expected {
		return got, invalid("deployment v2 actual bytes bind")
	}
	return got, nil
}
func deploymentV2RefWire(r DeploymentV2Ref) ([]byte, error) {
	f := make([][]byte, 5)
	var err error
	for i, s := range []string{r.Realm, r.Tenant, r.Kind, r.ID} {
		f[i], err = deploymentV2Text(s)
		if err != nil {
			return nil, err
		}
	}
	f[4], err = deploymentV2U64(r.Rev)
	if err != nil {
		return nil, err
	}
	return EncodeFields(f...)
}
func deploymentV2ReadRef(raw []byte) (DeploymentV2Ref, error) {
	f, err := DecodeFields(raw, 5, DeploymentManifestV2MaxBytes)
	if err != nil {
		return DeploymentV2Ref{}, err
	}
	s := make([]string, 4)
	for i := range s {
		s[i] = string(f[i])
		if _, err = deploymentV2Text(s[i]); err != nil {
			return DeploymentV2Ref{}, err
		}
	}
	rev, err := deploymentV2ReadU64(f[4])
	return DeploymentV2Ref{s[0], s[1], s[2], s[3], rev}, err
}

var deploymentV2URL = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.-]*://`)

func deploymentV2FileWire(a DeploymentV2FileObj) ([]byte, error) {
	r, err := deploymentV2RefWire(a.Ref)
	if err != nil {
		return nil, err
	}
	content, err := EncodeDeploymentV2Bind(a.Content)
	if err != nil {
		return nil, err
	}
	size, err := deploymentV2U64(a.Size)
	if err != nil || a.Size != a.Content.Bytes {
		return nil, invalid("deployment v2 artifact size bind")
	}
	if binary.BigEndian.Uint64(size) > DeploymentArtifactV2MaxBytes {
		return nil, invalid("deployment v2 artifact budget")
	}
	mime, err := deploymentV2Text(a.MIME)
	if err != nil {
		return nil, err
	}
	for _, c := range mime {
		if c < 32 || c > 126 {
			return nil, invalid("deployment v2 MIME")
		}
	}
	key, err := deploymentV2Text(a.ObjectKey)
	if err != nil || deploymentV2Control(a.ObjectKey) || strings.HasPrefix(a.ObjectKey, "//") || deploymentV2URL.MatchString(a.ObjectKey) {
		return nil, invalid("deployment v2 object key")
	}
	return EncodeFields(r, content, size, mime, key)
}
func deploymentV2ReadFile(raw []byte) (a DeploymentV2FileObj, err error) {
	f, err := DecodeFields(raw, 5, DeploymentManifestV2MaxBytes)
	if err != nil {
		return a, err
	}
	if a.Ref, err = deploymentV2ReadRef(f[0]); err != nil {
		return a, err
	}
	if a.Content, err = DecodeDeploymentV2Bind(f[1]); err != nil {
		return a, err
	}
	if a.Size, err = deploymentV2ReadU64(f[2]); err != nil {
		return a, err
	}
	a.MIME, a.ObjectKey = string(f[3]), string(f[4])
	return a, nil
}
func deploymentV2Payload(m DeploymentManifestV2) ([]byte, error) {
	for _, r := range []DeploymentV2Ref{m.Project, m.Artifact.Ref, m.Publisher} {
		if r.Realm != m.Realm || r.Tenant != m.Tenant {
			return nil, invalid("deployment v2 scope")
		}
	}
	f := make([][]byte, 11)
	f[0] = []byte(DeploymentManifestV2Domain)
	var err error
	if f[1], err = deploymentV2Text(m.Realm); err != nil {
		return nil, err
	}
	if f[2], err = deploymentV2Text(m.Tenant); err != nil {
		return nil, err
	}
	if f[3], err = deploymentV2RefWire(m.Project); err != nil {
		return nil, err
	}
	if f[4], err = deploymentV2U64(m.Version); err != nil {
		return nil, err
	}
	if f[5], err = deploymentV2FileWire(m.Artifact); err != nil {
		return nil, err
	}
	if f[6], err = deploymentV2Text(m.Env); err != nil || strings.TrimSpace(strings.Trim(m.Env, "\ufeff")) != m.Env || deploymentV2Control(m.Env) {
		return nil, invalid("deployment v2 exact environment")
	}
	if f[7], err = deploymentV2RefWire(m.Publisher); err != nil {
		return nil, err
	}
	if f[8], err = deploymentV2U64(m.PublisherEpoch); err != nil {
		return nil, err
	}
	// Issuer scope and both epochs are explicit. No equality, default, Ref.rev
	// derivation, account lookup or trust is inferred for this independent issuer.
	if f[9], err = deploymentV2RefWire(m.Issuer); err != nil {
		return nil, err
	}
	if f[10], err = deploymentV2U64(m.IssuerEpoch); err != nil {
		return nil, err
	}
	w, err := EncodeFields(f...)
	if err != nil {
		return nil, err
	}
	if len(w) > DeploymentManifestV2MaxBytes {
		return nil, invalid("deployment v2 manifest budget")
	}
	return w, nil
}
func CreateDeploymentManifestV2DATA(m DeploymentManifestV2, actual []byte) (DeploymentManifestV2DATA, error) {
	w, err := deploymentV2Payload(m)
	if err != nil {
		return DeploymentManifestV2DATA{}, err
	}
	if _, err = AssertDeploymentV2BytesBinding(actual, m.Artifact.Content); err != nil {
		return DeploymentManifestV2DATA{}, err
	}
	b, err := BindDeploymentV2Bytes(w)
	return DeploymentManifestV2DATA{w, b}, err
}
func DecodeDeploymentManifestV2DATA(raw []byte, expected *DeploymentV2Bind) (m DeploymentManifestV2, err error) {
	f, err := DecodeFields(raw, 11, DeploymentManifestV2MaxBytes)
	if err != nil {
		return m, err
	}
	if string(f[0]) != DeploymentManifestV2Domain {
		return m, invalid("deployment v2 domain")
	}
	m.Realm, m.Tenant = string(f[1]), string(f[2])
	if m.Project, err = deploymentV2ReadRef(f[3]); err != nil {
		return m, err
	}
	if m.Version, err = deploymentV2ReadU64(f[4]); err != nil {
		return m, err
	}
	if m.Artifact, err = deploymentV2ReadFile(f[5]); err != nil {
		return m, err
	}
	m.Env = string(f[6])
	if m.Publisher, err = deploymentV2ReadRef(f[7]); err != nil {
		return m, err
	}
	if m.PublisherEpoch, err = deploymentV2ReadU64(f[8]); err != nil {
		return m, err
	}
	if m.Issuer, err = deploymentV2ReadRef(f[9]); err != nil {
		return m, err
	}
	if m.IssuerEpoch, err = deploymentV2ReadU64(f[10]); err != nil {
		return m, err
	}
	canonical, err := deploymentV2Payload(m)
	if err != nil {
		return m, err
	}
	if !bytes.Equal(canonical, raw) {
		return m, invalid("deployment v2 canonical original")
	}
	if expected != nil {
		if _, err = AssertDeploymentV2BytesBinding(raw, *expected); err != nil {
			return m, err
		}
	}
	return m, nil
}
func AssertDeploymentArtifactV2DATA(raw, actual []byte) (DeploymentV2Bind, error) {
	m, err := DecodeDeploymentManifestV2DATA(raw, nil)
	if err != nil {
		return DeploymentV2Bind{}, err
	}
	return AssertDeploymentV2BytesBinding(actual, m.Artifact.Content)
}

// SigningBinding is supplied by the ORIGINAL independently admitted Auth path.
// PayloadOriginal is its exact selected E11 including ALL fullRefs and epochs.
// NetworkID/SubjectOwner are existing batch math labels, not asset identities.
// This DATA type does not supply Source/currentness/approval or key-role proof.
type DeploymentManifestV2SigningBinding struct {
	NetworkID                 []byte
	SubjectOwner              string
	PKA, PKB                  []byte
	PayloadOriginal           []byte
	PayloadBind, ArtifactBind DeploymentV2Bind
}

func validateDeploymentManifestV2SigningPayload(raw []byte, b DeploymentManifestV2SigningBinding) (DeploymentManifestV2, error) {
	if _, err := EncodeContext(Context{ChainID: b.NetworkID, Owner: b.SubjectOwner, PKA: b.PKA, PKB: b.PKB, BatchID: make([]byte, 16), Purpose: DeploymentManifestV2Purpose}); err != nil {
		return DeploymentManifestV2{}, err
	}
	expected, err := DecodeDeploymentManifestV2DATA(b.PayloadOriginal, &b.PayloadBind)
	if err != nil {
		return DeploymentManifestV2{}, err
	}
	m, err := DecodeDeploymentManifestV2DATA(raw, &b.PayloadBind)
	if err != nil {
		return m, err
	}
	if !bytes.Equal(raw, b.PayloadOriginal) || m != expected || m.Artifact.Content != b.ArtifactBind {
		return m, invalid("deployment v2 independently expected full binding")
	}
	if _, err = EncodeDeploymentV2Bind(b.ArtifactBind); err != nil {
		return m, err
	}
	return m, nil
}

// Prepare validates public DATA and actual held bytes before any private import.
func PrepareDeploymentManifestV2Signing(raw, actual []byte, b DeploymentManifestV2SigningBinding) (DeploymentManifestV2, error) {
	m, err := validateDeploymentManifestV2SigningPayload(raw, b)
	if err != nil {
		return m, err
	}
	if _, err = AssertDeploymentV2BytesBinding(actual, b.ArtifactBind); err != nil {
		return m, err
	}
	return m, nil
}

// Inspect is structural only. Only Verify below checks BOTH original signatures.
func InspectDeploymentManifestV2Member(raw []byte, b DeploymentManifestV2SigningBinding) (Member, error) {
	m, err := DecodeMember(raw)
	if err != nil {
		return m, err
	}
	c := m.Certificate
	if c.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 || c.Purpose != DeploymentManifestV2Purpose || c.Owner != b.SubjectOwner || !bytes.Equal(c.ChainID, b.NetworkID) || !bytes.Equal(c.PKA, b.PKA) || !bytes.Equal(c.PKB, b.PKB) {
		return m, invalid("deployment v2 N1 fixed purpose/public labels")
	}
	_, err = validateDeploymentManifestV2SigningPayload(m.Message, b)
	return m, err
}

// Verify performs mathematics for the independently selected public pair. Its
// local resolver establishes no Auth registration, Source or current authority.
func VerifyDeploymentManifestV2Member(raw []byte, b DeploymentManifestV2SigningBinding) error {
	m, err := InspectDeploymentManifestV2Member(raw, b)
	if err != nil {
		return err
	}
	manifest, err := DecodeDeploymentManifestV2DATA(m.Message, &b.PayloadBind)
	if err != nil {
		return err
	}
	v, err := NewVerifier(VerifierOptions{ChainID: b.NetworkID, Purpose: DeploymentManifestV2Purpose, Optimized: true,
		ResolveTrustedOwner: func(TrustRequest) (Registration, error) {
			return Registration{AlgorithmVersion: Version, Owner: b.SubjectOwner, Purpose: DeploymentManifestV2Purpose, PolicyRevision: "publisher-epoch/" + manifest.PublisherEpoch, ChainID: clone(b.NetworkID), PKA: clone(b.PKA), PKB: clone(b.PKB), Enabled: true}, nil
		}})
	if err != nil {
		return err
	}
	defer v.Clear()
	return v.VerifyOne(raw, 0)
}
