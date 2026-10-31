package ynxbatch

import (
	"bytes"
	"crypto/sha256"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"io"
	"regexp"
	"strconv"
	"unicode/utf8"
)

const (
	ProductSessionHTTPV5MessageVersion      = "YNX-PRODUCT-SESSION-HTTP-PROOF/v5"
	ProductSessionHTTPV5Path                = "/api/v1/ide/deployments"
	MaxProductSessionHTTPV5BodyBytes        = 68288512
	MaxProductSessionHTTPV5ContentTypeBytes = 99
	MaxProductSessionHTTPV5MessageBytes     = 16384
	MaxProductSessionHTTPV5MemberBytes      = 98304
)

var productSessionHTTPV5ContentType = regexp.MustCompile(`^multipart/form-data; boundary=[A-Za-z0-9_-]{1,70}$`)

type productSessionHTTPV5Unsigned struct {
	productSessionHTTPUnsigned
	ContentType string           `json:"contentType"`
	BodyBinding DeploymentV2Bind `json:"bodyBinding"`
}

// The original 21-field grammar is shared, not the V4 signature domain. This
// function never signs, normalizes a submitted original or authorizes an effect.
func productSessionHTTPV5Canonical(u productSessionHTTPV5Unsigned) []byte {
	old := productSessionHTTPCanonical(u.productSessionHTTPUnsigned)
	// Both insertion points are fixed original object keys, never value text.
	binding := []byte(`,"bodyBinding":{"bytes":`)
	binding = artifactJSONString(binding, u.BodyBinding.Bytes)
	binding = append(binding, `,"sha3_512":`...)
	binding = artifactJSONString(binding, u.BodyBinding.SHA3_512)
	binding = append(binding, `,"sha512":`...)
	binding = artifactJSONString(binding, u.BodyBinding.SHA512)
	binding = append(binding, '}')
	old = bytes.Replace(old, []byte(`,"bodyDigest":`), append(binding, []byte(`,"bodyDigest":`)...), 1)
	content := artifactJSONString([]byte(`,"contentType":`), u.ContentType)
	return bytes.Replace(old, []byte(`,"deviceId":`), append(content, []byte(`,"deviceId":`)...), 1)
}

func productSessionHTTPV5UnsignedOriginal(raw []byte, b ProductSessionHTTPBinding) (productSessionHTTPV5Unsigned, []byte, error) {
	var u productSessionHTTPV5Unsigned
	if len(raw) == 0 || len(raw) > MaxProductSessionHTTPV5MessageBytes || !utf8.Valid(raw) {
		return u, nil, invalid("HTTP V5 unsigned original bounds or UTF8")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&u); err != nil {
		return u, nil, invalid("HTTP V5 unsigned23 fields or types")
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return u, nil, invalid("HTTP V5 trailing data")
	}
	if u.Version != "5" || u.Method != "POST" || u.Path != ProductSessionHTTPV5Path || !productSessionHTTPV5ContentType.MatchString(u.ContentType) {
		return u, nil, invalid("HTTP V5 fixed version method path or content type")
	}
	n, err := strconv.ParseUint(u.BodyBinding.Bytes, 10, 64)
	if err != nil || n == 0 || n > MaxProductSessionHTTPV5BodyBytes || strconv.FormatUint(n, 10) != u.BodyBinding.Bytes {
		return u, nil, invalid("HTTP V5 body length")
	}
	bind, err := EncodeDeploymentV2Bind(u.BodyBinding)
	if err != nil {
		return u, nil, err
	}
	grammar := u.productSessionHTTPUnsigned
	grammar.Version = "4"
	if err := productSessionHTTPUnsignedOriginal(productSessionHTTPCanonical(grammar), b); err != nil {
		return u, nil, err
	}
	// Exact comparison also rejects duplicates, omitted nullable keys, escaped
	// spellings, noncanonical ordering, and case-insensitive JSON field aliases.
	if !bytes.Equal(raw, productSessionHTTPV5Canonical(u)) {
		return u, nil, invalid("HTTP V5 noncanonical unsigned23 original")
	}
	return u, bind, nil
}

// BuildProductSessionHTTPV5Message hashes the independently captured complete
// binary body (including multipart delimiters) and compares all three digests
// and the actual content type. Inputs must remain immutable for this call.
// It neither parses multipart parts nor acquires Auth/Source/once/HTTP approval.
func BuildProductSessionHTTPV5Message(unsignedOriginal, actualBody []byte, actualContentType string, b ProductSessionHTTPBinding) ([]byte, error) {
	if len(actualBody) == 0 || len(actualBody) > MaxProductSessionHTTPV5BodyBytes || !productSessionHTTPV5ContentType.MatchString(actualContentType) {
		return nil, invalid("HTTP V5 actual body or content type bounds")
	}
	if _, err := productSessionHTTPBinding(b); err != nil {
		return nil, err
	}
	u, bind, err := productSessionHTTPV5UnsignedOriginal(unsignedOriginal, b)
	if err != nil {
		return nil, err
	}
	if u.ContentType != actualContentType || u.BodyBinding.Bytes != strconv.Itoa(len(actualBody)) {
		return nil, invalid("HTTP V5 actual length or content type mismatch")
	}
	d := sha256.Sum256(actualBody)
	a := sha3.Sum512(actualBody)
	z := sha512.Sum512(actualBody)
	if u.BodyDigest != hex.EncodeToString(d[:]) || u.BodyBinding.SHA3_512 != hex.EncodeToString(a[:]) || u.BodyBinding.SHA512 != hex.EncodeToString(z[:]) {
		return nil, invalid("HTTP V5 actual complete body digest mismatch")
	}
	wire, err := EncodeFields([]byte(ProductSessionHTTPV5MessageVersion), U32(5), b.NetworkID, []byte(b.Owner), unsignedOriginal, bind)
	if err != nil {
		return nil, err
	}
	if len(wire) > MaxProductSessionHTTPV5MessageBytes {
		return nil, invalid("HTTP V5 E6 bound")
	}
	return wire, nil
}

// InspectProductSessionHTTPV5Message checks a DATA statement's exact typed E6.
// For actual-body comparison, callers must first use Build... with their own
// immutable captured body/content type and compare the returned message bytes.
func InspectProductSessionHTTPV5Message(message []byte, b ProductSessionHTTPBinding) (ProductSessionHTTPMessage, error) {
	var result ProductSessionHTTPMessage
	bound, err := productSessionHTTPBinding(b)
	if err != nil {
		return result, err
	}
	f, err := fields(message, 6, MaxProductSessionHTTPV5MessageBytes, len(ProductSessionHTTPV5MessageVersion), 4, 32, 42, MaxProductSessionHTTPV5MessageBytes, DeploymentV2BindBytes)
	if err != nil {
		return result, err
	}
	if !bytes.Equal(f[0], []byte(ProductSessionHTTPV5MessageVersion)) || !bytes.Equal(f[1], U32(5)) || !bytes.Equal(f[2], bound.NetworkID) || string(f[3]) != bound.Owner {
		return result, invalid("HTTP V5 exact E6 domain and binding")
	}
	_, bind, err := productSessionHTTPV5UnsignedOriginal(f[4], bound)
	if err != nil {
		return result, err
	}
	if !bytes.Equal(f[5], bind) {
		return result, invalid("HTTP V5 signed E3 differs from unsigned body binding")
	}
	return ProductSessionHTTPMessage{Binding: bound, UnsignedOriginal: clone(f[4]), MessageOriginal: clone(message)}, nil
}

// InspectProductSessionHTTPV5Member verifies the real AND and both roots for
// one exact independently supplied E6 original. This is mathematical DATA,
// not a trusted registration, current revision/clock, durable once or permit.
func InspectProductSessionHTTPV5Member(member []byte, b ProductSessionHTTPBinding, expectedMessage []byte) (ProductSessionHTTPMessage, error) {
	var result ProductSessionHTTPMessage
	if len(member) == 0 || len(member) > MaxProductSessionHTTPV5MemberBytes {
		return result, invalid("HTTP V5 member bound")
	}
	result, err := InspectProductSessionHTTPV5Message(expectedMessage, b)
	if err != nil {
		return ProductSessionHTTPMessage{}, err
	}
	bound := result.Binding
	m, err := DecodeMember(member)
	if err != nil {
		return ProductSessionHTTPMessage{}, err
	}
	c := m.Certificate
	if c.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 || c.Purpose != ProductSessionHTTPPurpose || c.Owner != bound.Owner ||
		!bytes.Equal(c.ChainID, bound.NetworkID) || !bytes.Equal(c.PKA, bound.PKA) || !bytes.Equal(c.PKB, bound.PKB) || !bytes.Equal(m.Message, expectedMessage) {
		return ProductSessionHTTPMessage{}, invalid("HTTP V5 exact full-pair AND N1 original")
	}
	v, err := NewVerifier(VerifierOptions{ChainID: bound.NetworkID, Purpose: ProductSessionHTTPPurpose, CacheEntries: 0,
		ResolveTrustedOwner: func(r TrustRequest) (Registration, error) {
			if r.Height != 0 || r.Owner != bound.Owner || r.Purpose != ProductSessionHTTPPurpose || !bytes.Equal(r.ChainID, bound.NetworkID) {
				return Registration{}, ErrUntrusted
			}
			return Registration{Enabled: true, AlgorithmVersion: Version, Owner: bound.Owner, Purpose: ProductSessionHTTPPurpose,
				ChainID: clone(bound.NetworkID), PKA: clone(bound.PKA), PKB: clone(bound.PKB), PolicyRevision: "http-v5-data-only", ActiveFrom: 0}, nil
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
