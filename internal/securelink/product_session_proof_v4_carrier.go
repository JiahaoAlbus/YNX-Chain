package securelink

import (
	"net/http"
	"strings"
)

const (
	ProductSessionProofV4Header                = "X-YNX-Product-Session-Proof-V4"
	MaxProductSessionProofV4HeaderBytes        = 196608
	MaxProductSessionProofV4RequestHeaderBytes = 262144
)

func validateProductSessionProofV4Carrier(value string) error {
	if len(value) < 2 {
		return ErrDenied
	}
	if len(value) > MaxProductSessionProofV4HeaderBytes {
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

func productSessionV4EmptyGET(r *http.Request) bool {
	if r == nil || r.Method != http.MethodGet || r.ContentLength != 0 || len(r.TransferEncoding) != 0 || len(r.Trailer) != 0 || r.GetBody != nil {
		return false
	}
	for name := range r.Header {
		if strings.EqualFold(name, "Content-Type") || strings.EqualFold(name, "Transfer-Encoding") || strings.EqualFold(name, "Trailer") {
			return false
		}
	}
	return true
}
