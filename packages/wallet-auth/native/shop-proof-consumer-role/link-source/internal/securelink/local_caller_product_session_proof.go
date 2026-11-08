package securelink

import (
	"net/http"
	"strings"
)

const (
	// ProductSessionProofV2Header is the sole SDK-defined HTTP field carried by
	// CallOriginalShopGETOwned. The value is opaque DATA, never a Source/permit.
	ProductSessionProofV2Header         = "X-YNX-Product-Session-Proof-V2"
	MaxProductSessionProofV2HeaderBytes = 16 << 10
	// The new empty-GET carrier also bounds its complete serialized request
	// headers, including the request line and fixed HTTP transport fields.
	MaxProductSessionProofV2RequestHeaderBytes = 64 << 10
)

// ProductSessionProofV2DATA carries one original SDK-produced header value.
// It cannot choose headers, a URL, a peer or a Source callback. SDK/Auth retain
// ownership of proof parsing, issuer/session qualification and Source current.
type ProductSessionProofV2DATA struct {
	HeaderValue string
}

func validateProductSessionProofV2Carrier(value string) error {
	if len(value) < 2 {
		return ErrDenied
	}
	if len(value) > MaxProductSessionProofV2HeaderBytes {
		return ErrBounds
	}
	for i := 0; i < len(value); i++ {
		c := value[i]
		if !('A' <= c && c <= 'Z' || 'a' <= c && c <= 'z' || '0' <= c && c <= '9' || c == '_' || c == '-') {
			return ErrDenied
		}
	}
	return nil
}

// This binding is private to the real accepted request. Neither the value nor
// its presence is exposed in LocalCallerMaterial, diagnostics or a new brand.
type localCallerProductSessionProofV2 struct {
	present bool
	value   string
}

func readLocalCallerProductSessionProofV2(header http.Header) (present bool, value string, err error) {
	for name, values := range header {
		if !strings.EqualFold(name, ProductSessionProofV2Header) {
			continue
		}
		// Header.Values canonicalizes its lookup, which would miss a second
		// differently cased map key inserted after HTTP parsing. Scan all keys.
		if present || len(values) != 1 {
			return false, "", ErrDenied
		}
		present, value = true, values[0]
	}
	return present, value, nil
}

func captureLocalCallerProductSessionProofV2(header http.Header) (localCallerProductSessionProofV2, error) {
	present, value, err := readLocalCallerProductSessionProofV2(header)
	if err != nil {
		return localCallerProductSessionProofV2{}, err
	}
	if present {
		if err = validateProductSessionProofV2Carrier(value); err != nil {
			return localCallerProductSessionProofV2{}, err
		}
	}
	return localCallerProductSessionProofV2{present: present, value: strings.Clone(value)}, nil
}

func (original localCallerProductSessionProofV2) matches(header http.Header) bool {
	present, value, err := readLocalCallerProductSessionProofV2(header)
	return err == nil && present == original.present && value == original.value
}
