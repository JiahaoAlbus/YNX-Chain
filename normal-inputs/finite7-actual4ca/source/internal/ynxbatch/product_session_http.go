package ynxbatch

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"golang.org/x/net/idna"
)

// SDK49's existing HTTP device-proof E5 is public DATA. These helpers neither
// select a device nor establish registration, current, Root, once or permission.
const (
	ProductSessionHTTPPurpose         = "PRODUCT-SESSION-HTTP-PROOF"
	ProductSessionHTTPMessageVersion  = "YNX-PRODUCT-SESSION-HTTP-PROOF/v4"
	MaxProductSessionHTTPMessageBytes = 16384
	MaxProductSessionHTTPMemberBytes  = 98304
)

// ProductSessionHTTPBinding is independently selected public expected DATA.
// The complete pair is required even when constructing the unsigned message;
// neither its presence nor successful mathematics admits a device registration.
type ProductSessionHTTPBinding struct {
	NetworkID []byte
	Owner     string
	PKA, PKB  []byte
}

// ProductSessionHTTPMessage contains detached public originals and expected
// binding only. It is not a device, approval, current lease or replay token.
type ProductSessionHTTPMessage struct {
	Binding          ProductSessionHTTPBinding
	UnsignedOriginal []byte
	MessageOriginal  []byte
}

// The declaration order is SDK canonicalJSON's sorted order. The two nullable
// fields must be present as either null or the exact applicationId string.
type productSessionHTTPUnsigned struct {
	Account                    string  `json:"account"`
	ApplicationID              string  `json:"applicationId"`
	BodyDigest                 string  `json:"bodyDigest"`
	BundleID                   *string `json:"bundleId"`
	Callback                   string  `json:"callback"`
	CanonicalOwner             string  `json:"canonicalOwner"`
	ClientID                   string  `json:"clientId"`
	DeviceID                   string  `json:"deviceId"`
	DeviceRegistrationDigest   string  `json:"deviceRegistrationDigest"`
	DeviceRegistrationID       string  `json:"deviceRegistrationId"`
	DeviceRegistrationRevision string  `json:"deviceRegistrationRevision"`
	ExpiresAt                  string  `json:"expiresAt"`
	IssuedAt                   string  `json:"issuedAt"`
	Method                     string  `json:"method"`
	Nonce                      string  `json:"nonce"`
	Origin                     string  `json:"origin"`
	PackageID                  *string `json:"packageId"`
	Path                       string  `json:"path"`
	ProductID                  string  `json:"productId"`
	SessionBinding             string  `json:"sessionBinding"`
	Version                    string  `json:"version"`
}

var (
	productSessionHTTPDigest   = regexp.MustCompile(`^[0-9a-f]{64}$`)
	productSessionHTTPIdentity = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9.-]{2,131}$`)
	productSessionHTTPOpaque   = regexp.MustCompile(`^[A-Za-z0-9._:-]{8,128}$`)
	productSessionHTTPProduct  = regexp.MustCompile(`^[a-z][a-z0-9-]{1,31}$`)
	productSessionHTTPClient   = regexp.MustCompile(`^[a-z][a-z0-9._-]{2,63}$`)
	productSessionHTTPAccount  = regexp.MustCompile(`^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$`)
	productSessionHTTPNonce    = regexp.MustCompile(`^[A-Za-z0-9_-]{32,64}$`)
	productSessionHTTPPath     = regexp.MustCompile(`^/[A-Za-z0-9._~!$&'()*+,;=:@/-]{1,255}$`)
	productSessionHTTPScheme   = regexp.MustCompile(`^[a-z][a-z0-9+.-]*$`)
	productSessionHTTPTime     = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$`)
	// WHATWG non-transitional domain-to-ASCII with beStrict=false. Domain
	// spelling is then compared with the original, rather than normalized.
	productSessionHTTPIDNA = idna.New(idna.MapForLookup(), idna.Transitional(false), idna.StrictDomainName(false),
		idna.CheckHyphens(false), idna.CheckJoiners(true), idna.BidiRule(), idna.VerifyDNSLength(false))
)

func productSessionHTTPBinding(b ProductSessionHTTPBinding) (ProductSessionHTTPBinding, error) {
	if len(b.NetworkID) != 32 || !accountaddress.IsCanonical(b.Owner) || len(b.PKA) != PublicKeyASize || len(b.PKB) != PublicKeyBSize {
		return ProductSessionHTTPBinding{}, invalid("HTTP proof complete expected full-pair binding")
	}
	return ProductSessionHTTPBinding{NetworkID: clone(b.NetworkID), Owner: b.Owner, PKA: clone(b.PKA), PKB: clone(b.PKB)}, nil
}

// Only URL fields can contain non-ASCII in the SDK grammar. URL serialization
// rewrites special hosts through IDNA and opaque hosts/paths through UTF8
// percent-encoding, so none can survive the SDK's exact toString/origin equality.
// Controls, whitespace and fragment/query delimiters likewise cannot survive.
// A custom path may retain a backslash.
func productSessionHTTPURL(s string, origin bool) bool {
	if len(s) > 2048 {
		return false
	}
	scheme, rest, ok := strings.Cut(s, "://")
	if !ok || !productSessionHTTPScheme.MatchString(scheme) || rest == "" {
		return false
	}
	switch scheme {
	case "http", "file", "javascript", "data":
		return false
	}
	for i := range s {
		if s[i] <= 32 || s[i] >= 127 || strings.ContainsRune("#?", rune(s[i])) {
			return false
		}
	}
	defaultPort, special := map[string]string{"https": "443", "wss": "443", "ws": "80", "ftp": "21"}[scheme]
	host, path, _ := strings.Cut(rest, "/")
	if len(host) < len(rest) {
		path = "/" + path
	}
	if special && (host == "" || strings.Contains(s, "\\")) || origin && scheme == "https" && path != "" ||
		!productSessionHTTPHost(host, special, defaultPort) {
		return false
	}
	// Special URLs always serialize their empty path as '/'. An HTTPS origin
	// uses URL.origin instead; all other origins use URL.toString, just like
	// callbacks. Custom URLs keep an empty path empty.
	if special && path == "" && !(origin && scheme == "https") {
		return false
	}
	for i := range path {
		if strings.ContainsRune("\"<>^`{}", rune(path[i])) {
			return false // WHATWG path percent-encode set (query/# rejected above).
		}
	}
	for _, segment := range strings.Split(path, "/") {
		switch strings.ToLower(segment) {
		case ".", "..", "%2e", ".%2e", "%2e.", "%2e%2e":
			return false // URL parsing would remove this dot segment.
		}
	}
	return true
}

func productSessionHTTPHost(authority string, special bool, defaultPort string) bool {
	if authority == "" {
		return !special
	}
	host, port, hasPort := authority, "", false
	if strings.HasPrefix(authority, "[") {
		end := strings.IndexByte(authority, ']')
		if end < 0 {
			return false
		}
		host = authority[:end+1]
		if end+1 < len(authority) {
			if authority[end+1] != ':' {
				return false
			}
			port, hasPort = authority[end+2:], true
		}
		ip := net.ParseIP(host[1 : len(host)-1])
		if ip == nil || !strings.Contains(host, ":") || "["+projectControlIPv6(ip.To16())+"]" != host {
			return false
		}
	} else {
		if strings.Contains(authority, ":") {
			host, port, _ = strings.Cut(authority, ":")
			hasPort = true
		}
		if host == "" || strings.ContainsAny(host, "\x00\t\n\r #/:<>?@[\\]^|") {
			return false
		}
		if special {
			if strings.Contains(host, "%") {
				return false // Special hosts percent-decode before serialization.
			}
			ascii, err := productSessionHTTPIDNA.ToASCII(host)
			if err != nil || ascii == "" || ascii != host {
				return false
			}
			if productSessionHTTPIPv4Ending(host) {
				ip := net.ParseIP(host)
				if ip == nil || ip.To4() == nil || ip.String() != host {
					return false
				}
			}
		}
	}
	if hasPort {
		n, err := strconv.ParseUint(port, 10, 16)
		if err != nil || strconv.FormatUint(n, 10) != port || port == defaultPort {
			return false
		}
	}
	return true
}

// WHATWG's ends-in-a-number test includes legacy hexadecimal/octal forms. Only
// already serialized dotted-decimal IPv4 can pass the caller's equality check.
func productSessionHTTPIPv4Ending(host string) bool {
	labels := strings.Split(strings.TrimSuffix(host, "."), ".")
	last := labels[len(labels)-1]
	if last == "" {
		return false
	}
	digits := true
	for _, c := range last {
		if c < '0' || c > '9' {
			digits = false
		}
	}
	if digits {
		return true
	}
	if strings.HasPrefix(last, "0x") {
		for _, c := range last[2:] {
			if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
				return false
			}
		}
		return true
	}
	return false
}

func productSessionHTTPCanonical(u productSessionHTTPUnsigned) []byte {
	// All scalar text has already passed its closed grammar/URL checks, which
	// exclude controls. This primitive equals JSON.stringify for that text,
	// including literal slash/HTML/backslash and literal U+2028/U+2029 behavior.
	var out []byte
	appendString := func(key, value string) {
		if len(out) == 0 {
			out = append(out, '{')
		} else {
			out = append(out, ',')
		}
		out = artifactJSONString(out, key)
		out = artifactJSONString(append(out, ':'), value)
	}
	appendNullable := func(key string, value *string) {
		if value != nil {
			appendString(key, *value)
			return
		}
		out = artifactJSONString(append(out, ','), key)
		out = append(out, ":null"...)
	}
	appendString("account", u.Account)
	appendString("applicationId", u.ApplicationID)
	appendString("bodyDigest", u.BodyDigest)
	appendNullable("bundleId", u.BundleID)
	appendString("callback", u.Callback)
	appendString("canonicalOwner", u.CanonicalOwner)
	appendString("clientId", u.ClientID)
	appendString("deviceId", u.DeviceID)
	appendString("deviceRegistrationDigest", u.DeviceRegistrationDigest)
	appendString("deviceRegistrationId", u.DeviceRegistrationID)
	appendString("deviceRegistrationRevision", u.DeviceRegistrationRevision)
	appendString("expiresAt", u.ExpiresAt)
	appendString("issuedAt", u.IssuedAt)
	appendString("method", u.Method)
	appendString("nonce", u.Nonce)
	appendString("origin", u.Origin)
	appendNullable("packageId", u.PackageID)
	appendString("path", u.Path)
	appendString("productId", u.ProductID)
	appendString("sessionBinding", u.SessionBinding)
	appendString("version", u.Version)
	return append(out, '}')
}

func productSessionHTTPUnsignedOriginal(raw []byte, b ProductSessionHTTPBinding) error {
	if len(raw) == 0 || len(raw) > MaxProductSessionHTTPMessageBytes || !utf8.Valid(raw) {
		return invalid("HTTP proof unsigned original bounds or UTF8")
	}
	var u productSessionHTTPUnsigned
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&u); err != nil {
		return invalid("HTTP proof unsigned21 fields or types")
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return invalid("HTTP proof unsigned original trailing data")
	}
	if u.Version != "4" || !productSessionHTTPDigest.MatchString(u.SessionBinding) || !productSessionHTTPProduct.MatchString(u.ProductID) ||
		!productSessionHTTPClient.MatchString(u.ClientID) || !productSessionHTTPIdentity.MatchString(u.ApplicationID) ||
		u.BundleID != nil && (!productSessionHTTPIdentity.MatchString(*u.BundleID) || *u.BundleID != u.ApplicationID) ||
		u.PackageID != nil && (!productSessionHTTPIdentity.MatchString(*u.PackageID) || *u.PackageID != u.ApplicationID) ||
		u.BundleID != nil && u.PackageID != nil || !productSessionHTTPURL(u.Origin, true) || !productSessionHTTPURL(u.Callback, false) ||
		!productSessionHTTPAccount.MatchString(u.Account) || !accountaddress.IsCanonical(u.CanonicalOwner) || u.CanonicalOwner != b.Owner ||
		!productSessionHTTPOpaque.MatchString(u.DeviceID) || !productSessionHTTPOpaque.MatchString(u.DeviceRegistrationID) ||
		!projectControlDecimal(u.DeviceRegistrationRevision, true) || !productSessionHTTPDigest.MatchString(u.DeviceRegistrationDigest) ||
		!productSessionHTTPDigest.MatchString(u.BodyDigest) || !productSessionHTTPNonce.MatchString(u.Nonce) || !productSessionHTTPPath.MatchString(u.Path) {
		return invalid("HTTP proof unsigned21 exact values")
	}
	owner, err := accountaddress.Decode(u.Account)
	if err != nil || owner != u.CanonicalOwner {
		return invalid("HTTP proof checksummed YNX account and canonical owner")
	}
	switch u.Method {
	case "DELETE", "GET", "PATCH", "POST", "PUT":
	default:
		return invalid("HTTP proof method")
	}
	if u.Method == "GET" && u.BodyDigest != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ||
		strings.Contains(u.Path, "//") || strings.HasSuffix(u.Path, "/") {
		return invalid("HTTP proof GET body or canonical request path")
	}
	for _, segment := range strings.Split(u.Path, "/") {
		if segment == "." || segment == ".." {
			return invalid("HTTP proof request path dot segments")
		}
	}
	const layout = "2006-01-02T15:04:05.000Z"
	issued, issueErr := time.Parse(layout, u.IssuedAt)
	expires, expireErr := time.Parse(layout, u.ExpiresAt)
	if !productSessionHTTPTime.MatchString(u.IssuedAt) || !productSessionHTTPTime.MatchString(u.ExpiresAt) || issueErr != nil || expireErr != nil ||
		issued.Format(layout) != u.IssuedAt || expires.Format(layout) != u.ExpiresAt || !expires.After(issued) || expires.Sub(issued) > 30*time.Second {
		return invalid("HTTP proof exact ISO milliseconds or expiry window")
	}
	if !bytes.Equal(raw, productSessionHTTPCanonical(u)) {
		return invalid("HTTP proof noncanonical unsigned21 original")
	}
	return nil
}

// BuildProductSessionHTTPMessage returns the existing SDK E5 bytes only. It
// requires exact canonical unsigned21 bytes and never generates/normalizes data.
func BuildProductSessionHTTPMessage(unsignedOriginal []byte, b ProductSessionHTTPBinding) ([]byte, error) {
	if _, err := productSessionHTTPBinding(b); err != nil {
		return nil, err
	}
	if err := productSessionHTTPUnsignedOriginal(unsignedOriginal, b); err != nil {
		return nil, err
	}
	wire, err := EncodeFields([]byte(ProductSessionHTTPMessageVersion), U32(4), b.NetworkID, []byte(b.Owner), unsignedOriginal)
	if err != nil {
		return nil, err
	}
	if len(wire) > MaxProductSessionHTTPMessageBytes {
		return nil, invalid("HTTP proof E5 bound")
	}
	return wire, nil
}

func InspectProductSessionHTTPMessage(message []byte, b ProductSessionHTTPBinding, unsignedOriginal []byte) (ProductSessionHTTPMessage, error) {
	var result ProductSessionHTTPMessage
	if _, err := fields(message, 5, MaxProductSessionHTTPMessageBytes, len(ProductSessionHTTPMessageVersion), 4, 32, 42, MaxProductSessionHTTPMessageBytes); err != nil {
		return result, err
	}
	want, err := BuildProductSessionHTTPMessage(unsignedOriginal, b)
	if err != nil {
		return result, err
	}
	if !bytes.Equal(message, want) {
		return result, invalid("HTTP proof exact E5 original and expected binding")
	}
	bound, err := productSessionHTTPBinding(b)
	if err != nil {
		return result, err
	}
	return ProductSessionHTTPMessage{Binding: bound, UnsignedOriginal: clone(unsignedOriginal), MessageOriginal: clone(message)}, nil
}

// InspectProductSessionHTTPMember verifies both real signature branches and
// both trees against the independently supplied full pair, at the SDK's DATA
// height zero. Its local resolver is deliberately not a live registration or
// Auth/current/Root source; its result carries no admission or effect permit.
func InspectProductSessionHTTPMember(member []byte, b ProductSessionHTTPBinding, unsignedOriginal []byte) (ProductSessionHTTPMessage, error) {
	var result ProductSessionHTTPMessage
	if len(member) == 0 || len(member) > MaxProductSessionHTTPMemberBytes {
		return result, invalid("HTTP proof member bound")
	}
	bound, err := productSessionHTTPBinding(b)
	if err != nil {
		return result, err
	}
	m, err := DecodeMember(member)
	if err != nil {
		return result, err
	}
	c := m.Certificate
	if c.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 || c.Purpose != ProductSessionHTTPPurpose || c.Owner != bound.Owner ||
		!bytes.Equal(c.ChainID, bound.NetworkID) || !bytes.Equal(c.PKA, bound.PKA) || !bytes.Equal(c.PKB, bound.PKB) {
		return result, invalid("HTTP proof exact full-pair AND N1 context")
	}
	result, err = InspectProductSessionHTTPMessage(m.Message, bound, unsignedOriginal)
	if err != nil {
		return ProductSessionHTTPMessage{}, err
	}
	v, err := NewVerifier(VerifierOptions{ChainID: bound.NetworkID, Purpose: ProductSessionHTTPPurpose, CacheEntries: 0,
		ResolveTrustedOwner: func(r TrustRequest) (Registration, error) {
			if r.Height != 0 || r.Owner != bound.Owner || r.Purpose != ProductSessionHTTPPurpose || !bytes.Equal(r.ChainID, bound.NetworkID) {
				return Registration{}, ErrUntrusted
			}
			return Registration{Enabled: true, AlgorithmVersion: Version, Owner: bound.Owner, Purpose: ProductSessionHTTPPurpose,
				ChainID: clone(bound.NetworkID), PKA: clone(bound.PKA), PKB: clone(bound.PKB), PolicyRevision: "http-v4-data-only", ActiveFrom: 0}, nil
		}})
	if err != nil {
		return ProductSessionHTTPMessage{}, err
	}
	defer v.Clear()
	if err := v.VerifyOne(member, 0); err != nil {
		return ProductSessionHTTPMessage{}, err
	}
	return result, nil
}
