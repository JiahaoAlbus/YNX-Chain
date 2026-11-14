package securelink

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
)

// ProductSessionProofV4DATA permits exactly one original SDK V4 header value.
// It accepts no header map, destination, adjustable bound or Source callback.
// SDK/Auth still own proof parsing, session qualification and Source current.
type ProductSessionProofV4DATA struct{ HeaderValue string }

// Only the dedicated V4 constructor captures this snapshot. It binds the
// entire parsed header map to the SAME privately minted request, so neither a
// case alias nor an unrelated inserted field can change a held request.
type localCallerProductSessionProofV4 struct {
	header http.Header
	close  bool
}

func captureLocalCallerProductSessionProofV4(r *http.Request) (*localCallerProductSessionProofV4, error) {
	if !productSessionV4EmptyGET(r) {
		return nil, ErrDenied
	}
	count := 0
	for name, values := range r.Header {
		if strings.EqualFold(name, ProductSessionProofV4Header) {
			count++
			if count != 1 || len(values) != 1 {
				return nil, ErrDenied
			}
			if err := validateProductSessionProofV4Carrier(values[0]); err != nil {
				return nil, err
			}
		} else if strings.HasPrefix(strings.ToLower(name), "x-ynx-product-session-proof") {
			// A V4-required request cannot fall back to, mix with, or split its
			// carrier across another proof family, even with an empty value.
			return nil, ErrDenied
		}
	}
	if count != 1 {
		return nil, ErrDenied
	}
	return &localCallerProductSessionProofV4{header: r.Header.Clone(), close: r.Close}, nil
}

func (original *localCallerProductSessionProofV4) matches(r *http.Request) bool {
	if original == nil || !productSessionV4EmptyGET(r) || r.Body != http.NoBody || r.Close != original.close || len(r.Header) != len(original.header) {
		return false
	}
	for name, values := range original.header {
		current, ok := r.Header[name]
		if !ok || len(current) != len(values) {
			return false
		}
		for i := range values {
			if current[i] != values[i] {
				return false
			}
		}
	}
	return true
}

// The dedicated connection counts the actual first request bytes, including
// request line and all raw fields. net/http's parser slack cannot enlarge this
// fixed bound. No legacy connection uses this reader and it never consumes a
// byte beyond the remaining header budget before observing CRLFCRLF.
type localCallerProductSessionProofV4HeaderReader struct {
	bytes    int
	tail     uint32
	complete atomic.Bool
	first    error
}

func (h *localCallerProductSessionProofV4HeaderReader) read(r io.Reader, p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if h.first != nil {
		return 0, h.first
	}
	if h.complete.Load() {
		return r.Read(p)
	}
	remaining := MaxProductSessionProofV4RequestHeaderBytes - h.bytes
	if remaining <= 0 {
		h.first = ErrBounds
		return 0, h.first
	}
	if len(p) > remaining {
		p = p[:remaining]
	}
	n, err := r.Read(p)
	for _, b := range p[:n] {
		if b == '\n' && byte(h.tail) != '\r' || byte(h.tail) == '\r' && b != '\n' {
			// net/http accepts bare LF. This fixed profile does not: never
			// publish a chunk that could finish its parser before our raw
			// CRLFCRLF boundary (including startBackgroundRead's extra byte).
			h.first = ErrDenied
			return 0, h.first
		}
		h.bytes++
		h.tail = h.tail<<8 | uint32(b)
		if h.tail == 0x0d0a0d0a {
			// Publish the complete count before serveHTTP may inspect it.
			// Native Read remains unlocked; net/http serializes connection reads.
			h.complete.Store(true)
			break
		}
	}
	if !h.complete.Load() && h.bytes == MaxProductSessionProofV4RequestHeaderBytes {
		h.first = ErrBounds
		return n, h.first
	}
	return n, err
}

type originalLocalCallerProofV4RequestBuffer struct{ buffer bytes.Buffer }

func (b *originalLocalCallerProofV4RequestBuffer) Write(p []byte) (int, error) {
	if len(p) > MaxProductSessionProofV4RequestHeaderBytes-b.buffer.Len() {
		return 0, ErrBounds
	}
	return b.buffer.Write(p)
}

func (b *originalLocalCallerProofV4RequestBuffer) Bytes() []byte { return b.buffer.Bytes() }
