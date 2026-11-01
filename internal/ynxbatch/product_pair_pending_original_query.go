package ynxbatch

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

// This is a separate, read-only original-operation proof. It is not a V4
// session proof, registration, active-session lookup or Source admission.
const (
	ProductPairPendingOriginalQueryDomain          = "YNX/PRODUCT-PAIR/PENDING-ORIGINAL-QUERY/V1"
	ProductPairPendingOriginalQueryPurpose         = "product-device-pending-original-query-v1"
	ProductPairPendingOriginalQueryMethod          = "POST"
	ProductPairPendingOriginalQueryPath            = "/v4/product-pairs/original-query"
	MaxProductPairPendingOriginalQueryMessageBytes = 16384
	MaxProductPairPendingOriginalQueryMemberBytes  = 98304
	MaxProductPairPendingOriginalBodyBytes         = 393216
)

// Independent expected DATA must come from the original Auth device/operation
// owner. A matching pair or original hash does not grant account permissions.
type ProductPairPendingOriginalQueryBinding struct {
	NetworkID                                       []byte
	Owner                                           string
	PKA, PKB                                        []byte
	ActorDigest, Origin, Nonce, IssuedAt, ExpiresAt string
	// Independent original Auth observation, not signed self-asserted clocks.
	// Source bounds cannot be extended by a new query. The owner must recheck
	// the same Source after signing/verification and before disclosing a row.
	AtMS, SourceIssuedAtMS, SourceExpiresAtMS uint64
}

type ProductPairPendingOriginalQueryMessage struct {
	Binding                                              ProductPairPendingOriginalQueryBinding
	QueryOriginal, RegistrationOriginal, MessageOriginal []byte
}

// These three fields are the original Auth query body, in canonical key order.
type productPairPendingQuery struct {
	OperationID               string `json:"operationId"`
	OriginalRequestBodyDigest string `json:"originalRequestBodyDigest"`
	Version                   string `json:"version"`
}

// Exact actor grammar from productPairSessionV4ActorDATA. No session binding,
// challenge RNG/time, account approval or live state is inferred from this hash.
type productPairPendingActor struct {
	ApplicationID  string  `json:"applicationId"`
	BundleID       *string `json:"bundleId"`
	Callback       string  `json:"callback"`
	CanonicalOwner string  `json:"canonicalOwner"`
	ClientID       string  `json:"clientId"`
	DeviceID       string  `json:"deviceId"`
	NetworkID      string  `json:"networkId"`
	Origin         string  `json:"origin"`
	PackageID      *string `json:"packageId"`
	Platform       string  `json:"platform"`
	ProductID      string  `json:"productId"`
}

func productPairPendingBinding(b ProductPairPendingOriginalQueryBinding) (ProductPairPendingOriginalQueryBinding, error) {
	if _, err := productDeviceV4Binding(ProductSessionDeviceV4Binding{b.NetworkID, b.Owner, b.PKA, b.PKB}); err != nil {
		return ProductPairPendingOriginalQueryBinding{}, err
	}
	issued, iok := productDeviceV4Time(b.IssuedAt)
	expires, eok := productDeviceV4Time(b.ExpiresAt)
	if !productDeviceV4Hex(b.ActorDigest, 32) || !strings.HasPrefix(b.Origin, "https://") || !productSessionHTTPURL(b.Origin, true) ||
		!productSessionHTTPNonce.MatchString(b.Nonce) || !iok || !eok || !expires.After(issued) || expires.Sub(issued) > 30*time.Second {
		return ProductPairPendingOriginalQueryBinding{}, invalid("pending query independent actor origin nonce or window")
	}
	const maxSafeInteger = 1<<53 - 1
	if issued.UnixMilli() < 0 || expires.UnixMilli() < 0 || b.AtMS > maxSafeInteger || b.SourceIssuedAtMS > maxSafeInteger || b.SourceExpiresAtMS > maxSafeInteger ||
		b.SourceExpiresAtMS <= b.SourceIssuedAtMS || b.AtMS < uint64(issued.UnixMilli()) || b.AtMS >= uint64(expires.UnixMilli()) ||
		uint64(issued.UnixMilli()) < b.SourceIssuedAtMS || uint64(expires.UnixMilli()) > b.SourceExpiresAtMS {
		return ProductPairPendingOriginalQueryBinding{}, invalid("pending query current observation and original Source window")
	}
	b.NetworkID, b.PKA, b.PKB = clone(b.NetworkID), clone(b.PKA), clone(b.PKB)
	return b, nil
}

// Build constructs only the fixed query E13. The original request body is
// hashed, never included in the returned proof or used to repeat that request.
// The caller authenticates the Source, service origin and current clock before
// and after entry. Past result expiry must not be mistaken for a new session.
func BuildProductPairPendingOriginalQueryMessage(query, registration, originalPair []byte, b ProductPairPendingOriginalQueryBinding) ([]byte, error) {
	bound, err := productPairPendingBinding(b)
	if err != nil {
		return nil, err
	}
	var q productPairPendingQuery
	if err = productDeviceV4OriginalBounded(query, &q, 1024); err != nil {
		return nil, err
	}
	if q.Version != "1" || !productDeviceV4Hex(q.OperationID, 32) || !productDeviceV4Hex(q.OriginalRequestBodyDigest, 32) {
		return nil, invalid("pending query exact body3")
	}
	r, err := productDeviceV4Registration(registration, ProductSessionDeviceV4Binding{bound.NetworkID, bound.Owner, bound.PKA, bound.PKB})
	if err != nil {
		return nil, err
	}
	if r.RevokedAt != nil || bound.IssuedAt < r.RegisteredAt || bound.ExpiresAt > r.ExpiresAt {
		return nil, invalid("pending query original registration window or revocation")
	}
	actor := productPairPendingActor{r.ApplicationID, r.BundleID, r.Callback, r.CanonicalOwner, r.ClientID, r.DeviceID, r.NetworkID, r.Origin, r.PackageID, r.Platform, r.ProductID}
	digest := sha256.Sum256(productDeviceV4Canonical(actor))
	if hex.EncodeToString(digest[:]) != bound.ActorDigest {
		return nil, invalid("pending query exact original actor")
	}
	actual, err := productPairPendingOriginalBody(originalPair, registration, q.OperationID)
	if err != nil {
		return nil, err
	}
	if actual != q.OriginalRequestBodyDigest {
		return nil, invalid("pending query complete original POST digest")
	}
	wire, err := EncodeFields([]byte(ProductPairPendingOriginalQueryDomain), U32(1), bound.NetworkID, []byte(bound.Owner), digest[:], []byte(bound.Origin),
		[]byte(ProductPairPendingOriginalQueryMethod), []byte(ProductPairPendingOriginalQueryPath), []byte(bound.Nonce), []byte(bound.IssuedAt), []byte(bound.ExpiresAt), query, registration)
	if err != nil {
		return nil, err
	}
	if len(wire) > MaxProductPairPendingOriginalQueryMessageBytes {
		return nil, invalid("pending query E13 bounds")
	}
	return wire, nil
}

func InspectProductPairPendingOriginalQueryMessage(message, query, registration, originalPair []byte, b ProductPairPendingOriginalQueryBinding) (ProductPairPendingOriginalQueryMessage, error) {
	var empty ProductPairPendingOriginalQueryMessage
	if _, err := fields(message, 13, MaxProductPairPendingOriginalQueryMessageBytes, len(ProductPairPendingOriginalQueryDomain), 4, 32, 42, 32, 2048, 4, len(ProductPairPendingOriginalQueryPath), 64, 24, 24, 1024, MaxProductSessionDeviceV4MessageBytes); err != nil {
		return empty, err
	}
	want, err := BuildProductPairPendingOriginalQueryMessage(query, registration, originalPair, b)
	if err != nil {
		return empty, err
	}
	if !bytes.Equal(message, want) {
		return empty, invalid("pending query exact E13 original binding")
	}
	bound, err := productPairPendingBinding(b)
	if err != nil {
		return empty, err
	}
	return ProductPairPendingOriginalQueryMessage{bound, clone(query), clone(registration), clone(message)}, nil
}

// Inspect verifies both mathematical branches against the caller's independent
// original device pair. The local DATA resolver is not a real registry, login,
// current Source, HTTP grant or operation record; no store or session is read.
func InspectProductPairPendingOriginalQueryMember(member, query, registration, originalPair []byte, b ProductPairPendingOriginalQueryBinding) (ProductPairPendingOriginalQueryMessage, error) {
	var empty ProductPairPendingOriginalQueryMessage
	if len(member) == 0 || len(member) > MaxProductPairPendingOriginalQueryMemberBytes {
		return empty, invalid("pending query Member bound")
	}
	bound, err := productPairPendingBinding(b)
	if err != nil {
		return empty, err
	}
	m, err := DecodeMember(member)
	if err != nil {
		return empty, err
	}
	c := m.Certificate
	if c.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 || c.Purpose != ProductPairPendingOriginalQueryPurpose || c.Owner != bound.Owner ||
		!bytes.Equal(c.ChainID, bound.NetworkID) || !bytes.Equal(c.PKA, bound.PKA) || !bytes.Equal(c.PKB, bound.PKB) {
		return empty, invalid("pending query exact AND N1 full pair")
	}
	result, err := InspectProductPairPendingOriginalQueryMessage(m.Message, query, registration, originalPair, bound)
	if err != nil {
		return empty, err
	}
	v, err := NewVerifier(VerifierOptions{ChainID: bound.NetworkID, Purpose: ProductPairPendingOriginalQueryPurpose, CacheEntries: 0, ResolveTrustedOwner: func(r TrustRequest) (Registration, error) {
		if r.Height != 0 || r.Owner != bound.Owner || r.Purpose != ProductPairPendingOriginalQueryPurpose || !bytes.Equal(r.ChainID, bound.NetworkID) {
			return Registration{}, ErrUntrusted
		}
		return Registration{Enabled: true, AlgorithmVersion: Version, Owner: bound.Owner, Purpose: ProductPairPendingOriginalQueryPurpose, ChainID: clone(bound.NetworkID), PKA: clone(bound.PKA), PKB: clone(bound.PKB), PolicyRevision: "pending-original-query-data-only", ActiveFrom: 0}, nil
	}})
	if err != nil {
		return empty, err
	}
	defer v.Clear()
	if err = v.VerifyOne(member, 0); err != nil {
		return empty, err
	}
	return result, nil
}

// Only the already existing PAIR envelope is decoded here. Request and approval
// remain exact public originals; this is not a second account approval parser.
type productPairOriginalBody struct {
	Approval             json.RawMessage `json:"approval"`
	OperationID          string          `json:"operationId"`
	RegistrationMember   string          `json:"registrationMember"`
	RegistrationOriginal string          `json:"registrationOriginal"`
	Request              json.RawMessage `json:"request"`
}

func productPairPendingOriginalBody(raw, registration []byte, pendingID string) (string, error) {
	if len(raw) == 0 || len(raw) > MaxProductPairPendingOriginalBodyBytes || !utf8.Valid(raw) || !productDeviceV4Hex(pendingID, 32) || !productPairPendingCanonicalJSON(raw) {
		return "", invalid("pending query original PAIR bounds or identifier")
	}
	var body productPairOriginalBody
	if err := productDeviceV4OriginalBounded(raw, &body, MaxProductPairPendingOriginalBodyBytes); err != nil {
		return "", err
	}
	if body.OperationID != pendingID || body.RegistrationOriginal != string(registration) || len(body.RegistrationMember) == 0 ||
		len(body.Approval) == 0 || body.Approval[0] != '{' || len(body.Request) == 0 || body.Request[0] != '{' {
		return "", invalid("pending query exact original PAIR envelope")
	}
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:]), nil
}

// The bounded form keeps the original strict canonical grammar without
// changing the device V4 parser's smaller bound or the original PAIR bytes.
func productDeviceV4OriginalBounded(raw []byte, into any, maximum int) error {
	if len(raw) == 0 || len(raw) > maximum || !utf8.Valid(raw) {
		return invalid("pending query original bounds or UTF8")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(into); err != nil || !bytes.Equal(raw, productDeviceV4Canonical(into)) {
		return invalid("pending query exact original canonical JSON")
	}
	return nil
}

// Match the original issuer's canonicalJSON(JSON.parse(raw)) == raw rule.
// Validation retains the exact bytes and handles JS UTF-16 key ordering, lone
// surrogate escapes, JSON.stringify string spelling and safe integer numbers.
// json.Valid bounds syntax/depth first; no private data reaches this parser.
func productPairPendingCanonicalJSON(raw []byte) bool {
	if !json.Valid(raw) {
		return false
	}
	at := 0
	var value func() bool
	text := func() ([]uint16, bool) {
		if at >= len(raw) || raw[at] != '"' {
			return nil, false
		}
		at++
		var units []uint16
		for at < len(raw) && raw[at] != '"' {
			if raw[at] != '\\' {
				r, n := utf8.DecodeRune(raw[at:])
				at += n
				units = append(units, utf16.Encode([]rune{r})...)
				continue
			}
			at++
			ch := raw[at]
			at++
			switch ch {
			case '"', '\\':
				units = append(units, uint16(ch))
			case 'b':
				units = append(units, 8)
			case 't':
				units = append(units, 9)
			case 'n':
				units = append(units, 10)
			case 'f':
				units = append(units, 12)
			case 'r':
				units = append(units, 13)
			case 'u':
				hex := string(raw[at : at+4])
				at += 4
				n, err := strconv.ParseUint(hex, 16, 16)
				if err != nil || hex != strings.ToLower(hex) {
					return nil, false
				}
				if n < 32 {
					if n == 8 || n == 9 || n == 10 || n == 12 || n == 13 {
						return nil, false
					}
				} else if n < 0xd800 || n > 0xdfff {
					return nil, false
				}
				if n >= 0xd800 && n <= 0xdbff && at+6 <= len(raw) && string(raw[at:at+2]) == `\u` {
					low, err := strconv.ParseUint(string(raw[at+2:at+6]), 16, 16)
					if err == nil && low >= 0xdc00 && low <= 0xdfff {
						return nil, false
					}
				}
				units = append(units, uint16(n))
			default:
				return nil, false
			}
		}
		at++
		return units, true
	}
	value = func() bool {
		if at >= len(raw) {
			return false
		}
		switch raw[at] {
		case '"':
			_, ok := text()
			return ok
		case '{':
			at++
			if raw[at] == '}' {
				at++
				return true
			}
			var previous []uint16
			first := true
			for {
				key, ok := text()
				if !ok || (!first && slices.Compare(previous, key) >= 0) {
					return false
				}
				previous, first = key, false
				if at >= len(raw) || raw[at] != ':' {
					return false
				}
				at++
				if !value() || at >= len(raw) {
					return false
				}
				if raw[at] == '}' {
					at++
					return true
				}
				if raw[at] != ',' {
					return false
				}
				at++
			}
		case '[':
			at++
			if raw[at] == ']' {
				at++
				return true
			}
			for {
				if !value() || at >= len(raw) {
					return false
				}
				if raw[at] == ']' {
					at++
					return true
				}
				if raw[at] != ',' {
					return false
				}
				at++
			}
		case 't':
			at += 4
			return true
		case 'f':
			at += 5
			return true
		case 'n':
			at += 4
			return true
		default:
			start := at
			if raw[at] == '-' {
				at++
			}
			for at < len(raw) && raw[at] >= '0' && raw[at] <= '9' {
				at++
			}
			n, err := strconv.ParseInt(string(raw[start:at]), 10, 64)
			return err == nil && n >= -(1<<53-1) && n <= 1<<53-1 && strconv.FormatInt(n, 10) == string(raw[start:at])
		}
	}
	return value() && at == len(raw)
}
