package ynxbatch

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"slices"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

const (
	ProductSessionApprovalV4Purpose         = "PRODUCT-SESSION-APPROVAL"
	ProductSessionApprovalV4MessageVersion  = "YNX-PRODUCT-SESSION-APPROVAL/v4"
	MaxProductSessionApprovalV4MessageBytes = 16384
	MaxProductSessionApprovalV4MemberBytes  = 98304
)

// Independently selected ACCOUNT expected DATA. This does not authenticate an
// account policy, reviewed plan, product registry, Source, current or once token.
type ProductSessionApprovalV4Binding struct {
	NetworkID   []byte
	Owner       string
	PKA, PKB    []byte
	KeyRevision string
}

var approvalV4RequestFields = strings.Fields("applicationId bundleId callback chainId clientId deviceAlgorithm deviceId deviceRegistrationDigest deviceRegistrationId deviceRegistrationRevision expiresAt issuedAt nonce origin packageId platform productId purpose scopes state version")
var approvalV4AuthorizationFields = strings.Fields("activeFrom algorithmVersion canonicalOwner networkId pkA pkB policyVersion registeredAt revision")

// Preserve sole canonical scalar spellings (including Unicode and escaped lone
// UTF16 surrogates in human purpose text). No JSON reserialization can change
// the original message. The shared canonical checker rejects duplicates,
// unordered/unknown encodings, whitespace and noncanonical numeric spellings.
func approvalV4Object(raw []byte, fields []string) (map[string]json.RawMessage, error) {
	if !utf8.Valid(raw) || !productPairPendingCanonicalJSON(raw) {
		return nil, invalid("approval v4 canonical original")
	}
	var out map[string]json.RawMessage
	if json.Unmarshal(raw, &out) != nil || len(out) != len(fields) {
		return nil, invalid("approval v4 exact fields")
	}
	for _, name := range fields {
		if _, ok := out[name]; !ok {
			return nil, invalid("approval v4 required field")
		}
	}
	return out, nil
}
func approvalV4String(v map[string]json.RawMessage, name string) string {
	var out string
	if json.Unmarshal(v[name], &out) != nil || bytes.Equal(v[name], []byte("null")) {
		return ""
	}
	return out
}
func approvalV4TextEdge(r rune) bool {
	return r >= 9 && r <= 13 || r == 32 || r == 0xa0 || r == 0x1680 || r >= 0x2000 && r <= 0x200a || r == 0x2028 || r == 0x2029 || r == 0x202f || r == 0x205f || r == 0x3000 || r == 0xfeff
}
func approvalV4Nullable(raw json.RawMessage, present bool, application string) bool {
	if !present {
		return bytes.Equal(raw, []byte("null"))
	}
	var s string
	return json.Unmarshal(raw, &s) == nil && s == application
}

// ValidateProductSessionApprovalV4Message accepts only the sole SDK fixed E5
// and reconstructs it after strict typed validation. It is not a generic raw
// signing parser. Actual registry membership, device registration/current,
// approval clock and account policy authority remain with the held caller.
func ValidateProductSessionApprovalV4Message(e5 []byte, expected ProductSessionApprovalV4Binding) ([]byte, error) {
	if len(e5) == 0 || len(e5) > MaxProductSessionApprovalV4MessageBytes || len(expected.NetworkID) != 32 ||
		!accountaddress.IsCanonical(expected.Owner) || len(expected.PKA) != PublicKeyASize || len(expected.PKB) != PublicKeyBSize ||
		!projectControlDecimal(expected.KeyRevision, true) {
		return nil, invalid("approval v4 expected binding or bound")
	}
	f, err := DecodeFields(e5, 5, MaxProductSessionApprovalV4MessageBytes)
	if err != nil || string(f[0]) != ProductSessionApprovalV4MessageVersion || !bytes.Equal(f[1], U32(4)) ||
		!bytes.Equal(f[2], expected.NetworkID) || string(f[3]) != expected.Owner {
		return nil, invalid("approval v4 fixed E5")
	}
	body, err := approvalV4Object(f[4], []string{"approval", "request"})
	if err != nil {
		return nil, err
	}
	r, err := approvalV4Object(body["request"], approvalV4RequestFields)
	if err != nil {
		return nil, err
	}
	af := make([]string, 0, len(approvalV4RequestFields)+3)
	for _, k := range approvalV4RequestFields {
		if k != "purpose" {
			af = append(af, k)
		}
	}
	af = append(af, "account", "accountAuthorization", "requestDigest", "result")
	a, err := approvalV4Object(body["approval"], af)
	if err != nil {
		return nil, err
	}
	for _, k := range approvalV4RequestFields {
		if k != "purpose" && k != "issuedAt" && k != "expiresAt" && !bytes.Equal(r[k], a[k]) {
			return nil, invalid("approval v4 request binding")
		}
	}
	get := func(k string) string { return approvalV4String(r, k) }
	application, platform := get("applicationId"), get("platform")
	purpose := get("purpose")
	if get("version") != "4" || get("chainId") != "ynx_6423-1" || get("deviceAlgorithm") != Suite ||
		!productSessionHTTPProduct.MatchString(get("productId")) || !productSessionHTTPClient.MatchString(get("clientId")) ||
		!productDeviceV4Platform(platform) || !productSessionHTTPIdentity.MatchString(application) ||
		!approvalV4Nullable(r["bundleId"], platform == "ios" || platform == "macos", application) ||
		!approvalV4Nullable(r["packageId"], platform == "android" || platform == "linux" || platform == "windows", application) ||
		!productDeviceV4ChallengeOrigin(get("origin")) || len(get("callback")) < 8 || len(get("callback")) > 512 || !productSessionHTTPURL(get("callback"), false) ||
		!productSessionHTTPOpaque.MatchString(get("deviceId")) || !productDeviceV4RegistrationID.MatchString(get("deviceRegistrationId")) ||
		!projectControlDecimal(get("deviceRegistrationRevision"), true) || !productSessionHTTPDigest.MatchString(get("deviceRegistrationDigest")) ||
		!productSessionHTTPNonce.MatchString(get("nonce")) || !productSessionHTTPNonce.MatchString(get("state")) ||
		len(utf16.Encode([]rune(purpose))) < 1 || len(utf16.Encode([]rune(purpose))) > 180 || strings.TrimFunc(purpose, approvalV4TextEdge) != purpose {
		return nil, invalid("approval v4 request grammar")
	}
	var scopes []string
	if json.Unmarshal(r["scopes"], &scopes) != nil || len(scopes) < 1 || len(scopes) > 8 || !slices.IsSorted(scopes) {
		return nil, invalid("approval v4 scopes")
	}
	for i, s := range scopes {
		if !productDeviceV4Scope.MatchString(s) || i > 0 && scopes[i-1] == s {
			return nil, invalid("approval v4 scope grammar")
		}
	}
	ri, okRI := productDeviceV4Time(get("issuedAt"))
	re, okRE := productDeviceV4Time(get("expiresAt"))
	ai, okAI := productDeviceV4Time(approvalV4String(a, "issuedAt"))
	ae, okAE := productDeviceV4Time(approvalV4String(a, "expiresAt"))
	if !okRI || !okRE || !okAI || !okAE || !re.After(ri) || re.Sub(ri) > 5*time.Minute || ri.After(ai.Add(30*time.Second)) ||
		!re.After(ai) || !ae.After(ai) || ae.After(re) || approvalV4String(a, "result") != "approved" {
		return nil, invalid("approval v4 original time or result")
	}
	requestDigest := sha256.Sum256(append([]byte("YNX_PRODUCT_SESSION_REQUEST_V4\n"), body["request"]...))
	if approvalV4String(a, "requestDigest") != hex.EncodeToString(requestDigest[:]) {
		return nil, invalid("approval v4 request digest")
	}
	account := approvalV4String(a, "account")
	owner, err := accountaddress.Decode(account)
	if err != nil || !productSessionHTTPAccount.MatchString(account) || owner != expected.Owner {
		return nil, invalid("approval v4 account owner")
	}
	auth, err := approvalV4Object(a["accountAuthorization"], approvalV4AuthorizationFields)
	if err != nil {
		return nil, err
	}
	ag := func(k string) string { return approvalV4String(auth, k) }
	if ag("policyVersion") != "YNX-ACCOUNT-POLICY/v1" || ag("algorithmVersion") != Version || ag("canonicalOwner") != expected.Owner ||
		ag("networkId") != hex.EncodeToString(expected.NetworkID) || ag("pkA") != hex.EncodeToString(expected.PKA) || ag("pkB") != hex.EncodeToString(expected.PKB) ||
		ag("revision") != expected.KeyRevision || !projectControlDecimal(ag("registeredAt"), false) || !projectControlDecimal(ag("activeFrom"), false) {
		return nil, invalid("approval v4 complete account policy tuple")
	}
	registered, active := ag("registeredAt"), ag("activeFrom")
	if len(registered) > len(active) || len(registered) == len(active) && registered >= active {
		return nil, invalid("approval v4 registration/activation order")
	}
	rebuiltBody := append([]byte(`{"approval":`), body["approval"]...)
	rebuiltBody = append(rebuiltBody, `,"request":`...)
	rebuiltBody = append(rebuiltBody, body["request"]...)
	rebuiltBody = append(rebuiltBody, '}')
	rebuilt, err := EncodeFields([][]byte{[]byte(ProductSessionApprovalV4MessageVersion), U32(4), expected.NetworkID, []byte(expected.Owner), rebuiltBody}...)
	if err != nil || !bytes.Equal(rebuilt, e5) {
		return nil, invalid("approval v4 exact reconstructed E5")
	}
	return rebuilt, nil
}

// Structural inspection alone is not AND verification or account admission.
func InspectProductSessionApprovalV4Member(raw, e5 []byte, expected ProductSessionApprovalV4Binding) (Member, error) {
	message, err := ValidateProductSessionApprovalV4Message(e5, expected)
	if err != nil {
		return Member{}, err
	}
	if len(raw) == 0 || len(raw) > MaxProductSessionApprovalV4MemberBytes {
		return Member{}, invalid("approval v4 member bound")
	}
	m, err := DecodeMember(raw)
	if err != nil {
		return Member{}, err
	}
	c := m.Certificate
	if c.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 || c.Purpose != ProductSessionApprovalV4Purpose || c.Owner != expected.Owner ||
		!bytes.Equal(c.ChainID, expected.NetworkID) || !bytes.Equal(c.PKA, expected.PKA) || !bytes.Equal(c.PKB, expected.PKB) || !bytes.Equal(m.Message, message) {
		return Member{}, invalid("approval v4 exact full-account N1")
	}
	return m, nil
}
