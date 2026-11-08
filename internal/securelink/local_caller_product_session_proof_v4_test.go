package securelink

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestOriginalLocalCallerShopProofV4CarrierBounds(t *testing.T) {
	for _, size := range []int{2, MaxProductSessionProofV4HeaderBytes} {
		if err := validateProductSessionProofV4Carrier(strings.Repeat("A", size)); err != nil {
			t.Fatal(size, err)
		}
	}
	for _, value := range []string{"", "A", "Aa=", "Aa,Bb", "Aa Bb", "Aa\r\nInjected: x", "Aa\x00", "Aaé"} {
		if err := validateProductSessionProofV4Carrier(value); !errors.Is(err, ErrDenied) {
			t.Fatalf("accepted invalid opaque carrier %q: %v", value, err)
		}
	}
	if err := validateProductSessionProofV4Carrier(strings.Repeat("A", MaxProductSessionProofV4HeaderBytes+1)); !errors.Is(err, ErrBounds) {
		t.Fatal("V4 value bound", err)
	}
	if err := validateProductSessionProofV2Carrier(strings.Repeat("A", MaxProductSessionProofV2HeaderBytes+1)); !errors.Is(err, ErrBounds) {
		t.Fatal("V2 bound changed", err)
	}
	var wire originalLocalCallerProofV4RequestBuffer
	if n, err := wire.Write(bytes.Repeat([]byte{'A'}, MaxProductSessionProofV4RequestHeaderBytes)); n != MaxProductSessionProofV4RequestHeaderBytes || err != nil {
		t.Fatal(n, err)
	}
	if n, err := wire.Write([]byte{'B'}); n != 0 || !errors.Is(err, ErrBounds) || len(wire.Bytes()) != MaxProductSessionProofV4RequestHeaderBytes {
		t.Fatal("serialized V4 bound enlarged", n, err)
	}
}

type publicV4HeaderFragments struct {
	source   *bytes.Reader
	fragment int
}

func (r publicV4HeaderFragments) Read(p []byte) (int, error) {
	if len(p) > r.fragment {
		p = p[:r.fragment]
	}
	return r.source.Read(p)
}

func TestOriginalLocalCallerShopProofV4RawHeaderReader(t *testing.T) {
	for _, fragment := range []int{1, 3, 4096, 65536} {
		for _, extra := range []int{0, 1} {
			// This is the actual raw count, not net/http's normalized header or
			// MaxHeaderBytes+4096 parser allowance. The terminator crosses reads.
			raw := append(bytes.Repeat([]byte{'a'}, MaxProductSessionProofV4RequestHeaderBytes-4+extra), []byte("\r\n\r\n")...)
			underlying := bytes.NewReader(raw)
			source := publicV4HeaderFragments{underlying, fragment}
			counter := &localCallerProductSessionProofV4HeaderReader{}
			buffer := make([]byte, 8192)
			for {
				_, err := counter.read(source, buffer)
				if err != nil {
					if extra == 0 && !errors.Is(err, io.EOF) || extra == 1 && !errors.Is(err, ErrBounds) {
						t.Fatal(fragment, extra, err)
					}
					break
				}
			}
			if counter.bytes != MaxProductSessionProofV4RequestHeaderBytes || counter.complete.Load() != (extra == 0) || underlying.Len() != extra {
				t.Fatalf("raw budget consumed extra byte: fragment=%d extra=%d bytes=%d complete=%v remaining=%d", fragment, extra, counter.bytes, counter.complete.Load(), underlying.Len())
			}
		}
	}
	for name, raw := range map[string]string{
		"bare-LF":  "GET / HTTP/1.1\nHost: PUBLIC\n\n",
		"mixed-LF": "GET / HTTP/1.1\r\nHost: PUBLIC\n\r\n",
		"bare-CR":  "GET / HTTP/1.1\rHost: PUBLIC\r\n\r\n",
	} {
		t.Run(name, func(t *testing.T) {
			for _, fragment := range []int{1, 4096} {
				counter := &localCallerProductSessionProofV4HeaderReader{}
				source := publicV4HeaderFragments{bytes.NewReader([]byte(raw)), fragment}
				buffer := make([]byte, 8192)
				for {
					_, err := counter.read(source, buffer)
					if err != nil {
						if !errors.Is(err, ErrDenied) || counter.complete.Load() {
							t.Fatal("non-CRLF header became complete", name, fragment, err)
						}
						break
					}
				}
			}
		})
	}
	t.Run("LF-parser-finish-before-background-terminator", func(t *testing.T) {
		// Old net/http could finish the LF-only request, then read the final
		// LF in startBackgroundRead while serveHTTP read plain complete.
		prefix := "GET / HTTP/1.1\nHost: PUBLIC\n\n\r\n\r"
		underlying := bytes.NewReader([]byte(prefix + "\n"))
		source := publicV4HeaderFragments{underlying, len(prefix)}
		counter := &localCallerProductSessionProofV4HeaderReader{}
		buffer := make([]byte, 8192)
		if n, err := counter.read(source, buffer); n != 0 || !errors.Is(err, ErrDenied) || counter.complete.Load() || underlying.Len() != 1 {
			t.Fatal("LF-only prefix reached parser or completion", n, err, underlying.Len())
		}
		if n, err := counter.read(source, buffer); n != 0 || !errors.Is(err, ErrDenied) || counter.complete.Load() || underlying.Len() != 1 {
			t.Fatal("background LF rearmed refused header", n, err, underlying.Len())
		}
	})
}
