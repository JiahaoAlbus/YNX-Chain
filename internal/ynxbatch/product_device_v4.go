package ynxbatch

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/url"
	"regexp"
	"slices"
	"time"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

// These two SDK49 E5 codecs are public DATA, not an Auth registration, current
// observation, approval, custody handle or replay/once capability. In particular
// the account authorization pair in a challenge is separate from its device pair.
const (
	ProductSessionDeviceRegistrationPurpose        = "PRODUCT-SESSION-DEVICE-REGISTRATION"
	ProductSessionDeviceChallengePurpose           = "PRODUCT-SESSION-DEVICE-CHALLENGE"
	ProductSessionDeviceRegistrationMessageVersion = "YNX-PRODUCT-SESSION-DEVICE-REGISTRATION/v4"
	ProductSessionDeviceChallengeMessageVersion    = "YNX-PRODUCT-SESSION-DEVICE-CHALLENGE/v4"
	MaxProductSessionDeviceV4MessageBytes          = 16384
	MaxProductSessionDeviceV4MemberBytes           = 98304
)

// ProductSessionDeviceV4Binding is independently selected expected public DATA.
// Matching it cannot authenticate the registration's origin or current status.
type ProductSessionDeviceV4Binding struct {
	NetworkID []byte
	Owner     string
	PKA, PKB  []byte
}

// Declarations follow SDK canonicalJSON's sorted key order. Required nullable
// fields remain present; originals are accepted only on exact re-encoding.
type productDeviceRegistrationV4 struct {
	ApplicationID  string  `json:"applicationId"`
	BundleID       *string `json:"bundleId"`
	Callback       string  `json:"callback"`
	CanonicalOwner string  `json:"canonicalOwner"`
	ClientID       string  `json:"clientId"`
	DeviceID       string  `json:"deviceId"`
	ExpiresAt      string  `json:"expiresAt"`
	Generation     string  `json:"generation"`
	NetworkID      string  `json:"networkId"`
	Origin         string  `json:"origin"`
	PackageID      *string `json:"packageId"`
	PKA            string  `json:"pkA"`
	PKB            string  `json:"pkB"`
	Platform       string  `json:"platform"`
	ProductID      string  `json:"productId"`
	RegisteredAt   string  `json:"registeredAt"`
	RegistrationID string  `json:"registrationId"`
	Revision       string  `json:"revision"`
	RevokedAt      *string `json:"revokedAt"`
	Version        string  `json:"version"`
}

type productDeviceAccountAuthorizationV4 struct {
	ActiveFrom       string `json:"activeFrom"`
	AlgorithmVersion string `json:"algorithmVersion"`
	CanonicalOwner   string `json:"canonicalOwner"`
	NetworkID        string `json:"networkId"`
	PKA              string `json:"pkA"`
	PKB              string `json:"pkB"`
	PolicyVersion    string `json:"policyVersion"`
	RegisteredAt     string `json:"registeredAt"`
	Revision         string `json:"revision"`
}

type productDeviceChallengeV4 struct {
	Account                    string                              `json:"account"`
	AccountAuthorization       productDeviceAccountAuthorizationV4 `json:"accountAuthorization"`
	ApplicationID              string                              `json:"applicationId"`
	ApprovalDigest             string                              `json:"approvalDigest"`
	BundleID                   *string                             `json:"bundleId"`
	Callback                   string                              `json:"callback"`
	ChainID                    string                              `json:"chainId"`
	Challenge                  string                              `json:"challenge"`
	ClientID                   string                              `json:"clientId"`
	DeviceAlgorithm            string                              `json:"deviceAlgorithm"`
	DeviceID                   string                              `json:"deviceId"`
	DeviceRegistrationDigest   string                              `json:"deviceRegistrationDigest"`
	DeviceRegistrationID       string                              `json:"deviceRegistrationId"`
	DeviceRegistrationRevision string                              `json:"deviceRegistrationRevision"`
	ExpiresAt                  string                              `json:"expiresAt"`
	IssuedAt                   string                              `json:"issuedAt"`
	Nonce                      string                              `json:"nonce"`
	Origin                     string                              `json:"origin"`
	PackageID                  *string                             `json:"packageId"`
	Platform                   string                              `json:"platform"`
	ProductID                  string                              `json:"productId"`
	RequestDigest              string                              `json:"requestDigest"`
	Scopes                     []string                            `json:"scopes"`
	SessionExpiresAt           string                              `json:"sessionExpiresAt"`
	State                      string                              `json:"state"`
	Version                    string                              `json:"version"`
}

var (
	productDeviceV4RegistrationID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	productDeviceV4Scope          = regexp.MustCompile(`^[a-z][a-z0-9._:-]{1,63}$`)
	productDeviceV4NativeOrigin   = regexp.MustCompile(`^app://(android|ios|linux|macos|windows)/[A-Za-z][A-Za-z0-9.-]{2,127}$`)
)

func productDeviceV4Binding(b ProductSessionDeviceV4Binding) (ProductSessionDeviceV4Binding, error) {
	if len(b.NetworkID) != 32 || !accountaddress.IsCanonical(b.Owner) || len(b.PKA) != PublicKeyASize || len(b.PKB) != PublicKeyBSize {
		return ProductSessionDeviceV4Binding{}, invalid("device v4 complete expected full-pair binding")
	}
	return ProductSessionDeviceV4Binding{clone(b.NetworkID), b.Owner, clone(b.PKA), clone(b.PKB)}, nil
}

func productDeviceV4Canonical(v any) []byte {
	// All accepted scalar text is ASCII with no controls. Disable HTML escaping
	// to match JSON.stringify, including '&' in an exact canonical URL.
	var out bytes.Buffer
	e := json.NewEncoder(&out)
	e.SetEscapeHTML(false)
	if err := e.Encode(v); err != nil {
		return nil
	}
	return bytes.TrimSuffix(out.Bytes(), []byte{'\n'})
}

func productDeviceV4Original(raw []byte, into any) error {
	if len(raw) == 0 || len(raw) > MaxProductSessionDeviceV4MessageBytes || !utf8.Valid(raw) {
		return invalid("device v4 original bounds or UTF8")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(into); err != nil {
		return invalid("device v4 exact original fields or types")
	}
	var tail any
	if err := d.Decode(&tail); err != io.EOF {
		return invalid("device v4 original trailing data")
	}
	// This also rejects duplicate/escaped/case-aliased keys, missing nullable
	// fields, null scalars, padding, reordered keys and alternative spellings.
	if !bytes.Equal(raw, productDeviceV4Canonical(into)) {
		return invalid("device v4 original canonical JSON")
	}
	return nil
}

func productDeviceV4Time(s string) (time.Time, bool) {
	if !productSessionHTTPTime.MatchString(s) {
		return time.Time{}, false
	}
	t, err := time.Parse("2006-01-02T15:04:05.000Z", s)
	return t, err == nil && t.Format("2006-01-02T15:04:05.000Z") == s
}

func productDeviceV4Hex(s string, size int) bool {
	if len(s) != size*2 {
		return false
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func productDeviceV4Platform(s string) bool {
	switch s {
	case "android", "ios", "linux", "macos", "web", "windows":
		return true
	}
	return false
}

func productDeviceV4NullableEqual(a, b *string) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}

func productDeviceV4Registration(raw []byte, b ProductSessionDeviceV4Binding) (productDeviceRegistrationV4, error) {
	var r productDeviceRegistrationV4
	if err := productDeviceV4Original(raw, &r); err != nil {
		return r, err
	}
	_, registered := productDeviceV4Time(r.RegisteredAt)
	_, expires := productDeviceV4Time(r.ExpiresAt)
	if r.Version != "4" || !productDeviceV4RegistrationID.MatchString(r.RegistrationID) || !productDeviceV4Hex(r.NetworkID, 32) ||
		r.NetworkID != hex.EncodeToString(b.NetworkID) || r.CanonicalOwner != b.Owner ||
		!productSessionHTTPProduct.MatchString(r.ProductID) || !productSessionHTTPClient.MatchString(r.ClientID) || !productDeviceV4Platform(r.Platform) ||
		!productSessionHTTPIdentity.MatchString(r.ApplicationID) || !productSessionHTTPURL(r.Origin, true) || !productSessionHTTPURL(r.Callback, false) ||
		!productSessionHTTPOpaque.MatchString(r.DeviceID) || !projectControlDecimal(r.Generation, true) || !projectControlDecimal(r.Revision, true) ||
		r.PKA != hex.EncodeToString(b.PKA) || r.PKB != hex.EncodeToString(b.PKB) || !registered || !expires || r.ExpiresAt <= r.RegisteredAt ||
		r.BundleID != nil && (!productSessionHTTPIdentity.MatchString(*r.BundleID) || *r.BundleID != r.ApplicationID) ||
		r.PackageID != nil && (!productSessionHTTPIdentity.MatchString(*r.PackageID) || *r.PackageID != r.ApplicationID) || r.BundleID != nil && r.PackageID != nil {
		return r, invalid("device v4 registration20 exact values and full pair")
	}
	if r.RevokedAt != nil {
		if _, ok := productDeviceV4Time(*r.RevokedAt); !ok || *r.RevokedAt < r.RegisteredAt {
			return r, invalid("device v4 registration revocation time")
		}
	}
	return r, nil
}

func productDeviceV4ChallengeOrigin(s string) bool {
	if len(s) < 8 || len(s) > 512 || !productSessionHTTPURL(s, true) {
		return false
	}
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "https" && u.Port() == "" || productDeviceV4NativeOrigin.MatchString(s))
}

func productDeviceV4Challenge(raw, registrationOriginal []byte, r productDeviceRegistrationV4) error {
	var c productDeviceChallengeV4
	if err := productDeviceV4Original(raw, &c); err != nil {
		return err
	}
	owner, err := accountaddress.Decode(c.Account)
	a := c.AccountAuthorization
	issuedAt, issued := productDeviceV4Time(c.IssuedAt)
	expiresAt, expires := productDeviceV4Time(c.ExpiresAt)
	sessionExpiresAt, sessionExpires := productDeviceV4Time(c.SessionExpiresAt)
	digest := sha256.Sum256(registrationOriginal)
	if c.Version != "4" || c.ChainID != "ynx_6423-1" || c.DeviceAlgorithm != Suite || !productSessionHTTPAccount.MatchString(c.Account) ||
		err != nil || owner != r.CanonicalOwner || !productSessionHTTPNonce.MatchString(c.Challenge) || !productSessionHTTPNonce.MatchString(c.Nonce) ||
		!productSessionHTTPNonce.MatchString(c.State) || !productSessionHTTPDigest.MatchString(c.RequestDigest) || !productSessionHTTPDigest.MatchString(c.ApprovalDigest) ||
		c.ProductID != r.ProductID || c.ClientID != r.ClientID || c.Platform != r.Platform || c.ApplicationID != r.ApplicationID ||
		!productDeviceV4NullableEqual(c.BundleID, r.BundleID) || !productDeviceV4NullableEqual(c.PackageID, r.PackageID) ||
		c.Origin != r.Origin || c.Callback != r.Callback || c.DeviceID != r.DeviceID || !productDeviceV4ChallengeOrigin(c.Origin) ||
		len(c.Callback) < 8 || len(c.Callback) > 512 || !productSessionHTTPURL(c.Callback, false) ||
		c.DeviceRegistrationID != r.RegistrationID || c.DeviceRegistrationRevision != r.Revision || c.DeviceRegistrationDigest != hex.EncodeToString(digest[:]) ||
		r.RevokedAt != nil || r.RegisteredAt > c.IssuedAt || r.ExpiresAt <= c.IssuedAt || c.ExpiresAt > r.ExpiresAt || c.SessionExpiresAt > r.ExpiresAt ||
		!issued || !expires || !sessionExpires || !expiresAt.After(issuedAt) || expiresAt.Sub(issuedAt) > time.Minute ||
		sessionExpiresAt.Before(expiresAt) || sessionExpiresAt.Sub(issuedAt) > 5*time.Minute ||
		a.PolicyVersion != "YNX-ACCOUNT-POLICY/v1" || a.AlgorithmVersion != Version || a.NetworkID != r.NetworkID || a.CanonicalOwner != owner ||
		!productDeviceV4Hex(a.PKA, PublicKeyASize) || !productDeviceV4Hex(a.PKB, PublicKeyBSize) ||
		!projectControlDecimal(a.Revision, true) || !projectControlDecimal(a.RegisteredAt, false) || !projectControlDecimal(a.ActiveFrom, false) {
		return invalid("device v4 challenge26 exact registration and account tuple")
	}
	// Compare canonical decimal strings by length then bytes, without passing
	// uint64 heights through JavaScript/Go floating point.
	if len(a.RegisteredAt) > len(a.ActiveFrom) || len(a.RegisteredAt) == len(a.ActiveFrom) && a.RegisteredAt >= a.ActiveFrom {
		return invalid("device v4 account registration must precede activation")
	}
	wantsBundle := c.Platform == "ios" || c.Platform == "macos"
	wantsPackage := c.Platform == "android" || c.Platform == "linux" || c.Platform == "windows"
	if (c.BundleID != nil) != wantsBundle || (c.PackageID != nil) != wantsPackage || len(c.Scopes) < 1 || len(c.Scopes) > 8 || !slices.IsSorted(c.Scopes) {
		return invalid("device v4 challenge platform or scopes")
	}
	for i, scope := range c.Scopes {
		if !productDeviceV4Scope.MatchString(scope) || i > 0 && c.Scopes[i-1] == scope {
			return invalid("device v4 challenge sorted unique scopes")
		}
	}
	return nil
}

func productDeviceV4Message(domain string, body []byte, b ProductSessionDeviceV4Binding) ([]byte, error) {
	raw, err := EncodeFields([]byte(domain), U32(4), b.NetworkID, []byte(b.Owner), body)
	if err != nil {
		return nil, err
	}
	if len(raw) > MaxProductSessionDeviceV4MessageBytes {
		return nil, invalid("device v4 E5 message bound")
	}
	return raw, nil
}

// BuildProductSessionDeviceRegistrationV4Message constructs the sole fixed E5.
// Time/current/revoke/once authorization is Auth-owned; this codec uses no clock.
func BuildProductSessionDeviceRegistrationV4Message(registrationOriginal []byte, expected ProductSessionDeviceV4Binding) ([]byte, error) {
	b, err := productDeviceV4Binding(expected)
	if err != nil {
		return nil, err
	}
	if len(registrationOriginal) == 0 || len(registrationOriginal) > MaxProductSessionDeviceV4MessageBytes {
		return nil, invalid("device v4 registration original bound")
	}
	raw := clone(registrationOriginal)
	if _, err := productDeviceV4Registration(raw, b); err != nil {
		return nil, err
	}
	return productDeviceV4Message(ProductSessionDeviceRegistrationMessageVersion, raw, b)
}

// BuildProductSessionDeviceChallengeV4Message binds the exact original pair of
// canonical objects. The issued-time structural checks are not a current lease,
// proof of issuance by Auth, account-policy observation or permission to sign.
func BuildProductSessionDeviceChallengeV4Message(challengeOriginal, registrationOriginal []byte, expected ProductSessionDeviceV4Binding) ([]byte, error) {
	b, err := productDeviceV4Binding(expected)
	if err != nil {
		return nil, err
	}
	if len(registrationOriginal) == 0 || len(registrationOriginal) > MaxProductSessionDeviceV4MessageBytes || len(challengeOriginal) == 0 || len(challengeOriginal) > MaxProductSessionDeviceV4MessageBytes {
		return nil, invalid("device v4 challenge originals bound")
	}
	registration, challenge := clone(registrationOriginal), clone(challengeOriginal)
	r, err := productDeviceV4Registration(registration, b)
	if err != nil {
		return nil, err
	}
	if err := productDeviceV4Challenge(challenge, registration, r); err != nil {
		return nil, err
	}
	body := append([]byte(`{"challenge":`), challenge...)
	body = append(body, `,"registration":`...)
	body = append(body, registration...)
	body = append(body, '}')
	return productDeviceV4Message(ProductSessionDeviceChallengeMessageVersion, body, b)
}

func inspectProductDeviceV4Member(raw, message []byte, expected ProductSessionDeviceV4Binding, purpose string) (Member, error) {
	if len(raw) == 0 || len(raw) > MaxProductSessionDeviceV4MemberBytes {
		return Member{}, invalid("device v4 member bound")
	}
	m, err := DecodeMember(raw)
	if err != nil {
		return Member{}, err
	}
	c := m.Certificate
	if c.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 || c.Purpose != purpose || c.Owner != expected.Owner ||
		!bytes.Equal(c.ChainID, expected.NetworkID) || !bytes.Equal(c.PKA, expected.PKA) || !bytes.Equal(c.PKB, expected.PKB) || !bytes.Equal(m.Message, message) {
		return Member{}, invalid("device v4 exact full-pair N1 and E5 context")
	}
	return m, nil
}

// InspectProductSessionDeviceRegistrationV4Member is strict typed inspection,
// not signature validity or current authorization. The caller must still use
// the normal full-AND Verifier and Auth's independent current/once checks.
func InspectProductSessionDeviceRegistrationV4Member(raw, registrationOriginal []byte, expected ProductSessionDeviceV4Binding) (Member, error) {
	bound, err := productDeviceV4Binding(expected)
	if err != nil {
		return Member{}, err
	}
	message, err := BuildProductSessionDeviceRegistrationV4Message(registrationOriginal, bound)
	if err != nil {
		return Member{}, err
	}
	return inspectProductDeviceV4Member(raw, message, bound, ProductSessionDeviceRegistrationPurpose)
}

// InspectProductSessionDeviceChallengeV4Member has the same DATA-only boundary;
// it cannot issue or complete a session or consume a pending device operation.
func InspectProductSessionDeviceChallengeV4Member(raw, challengeOriginal, registrationOriginal []byte, expected ProductSessionDeviceV4Binding) (Member, error) {
	bound, err := productDeviceV4Binding(expected)
	if err != nil {
		return Member{}, err
	}
	message, err := BuildProductSessionDeviceChallengeV4Message(challengeOriginal, registrationOriginal, bound)
	if err != nil {
		return Member{}, err
	}
	return inspectProductDeviceV4Member(raw, message, bound, ProductSessionDeviceChallengePurpose)
}
