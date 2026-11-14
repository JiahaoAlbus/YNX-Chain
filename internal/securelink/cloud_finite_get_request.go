package securelink

import (
	"net/http"
	"strings"
	"time"
)

// Match the seven fixed IDE deployment reads in the SDK Finite GET V4
// contract and Auth's captureFiniteHTTPRequest. This is a transport boundary
// for those requests, not a router or a Source/nonce decision.
func originalCloudFiniteGETRequest(r *http.Request) bool {
	if !productSessionV4EmptyGET(r) || r.Body != nil && r.Body != http.NoBody || r.URL == nil {
		return false
	}
	u := r.URL
	if u.Scheme != "" || u.Host != "" || u.User != nil || u.RawQuery != "" || u.ForceQuery ||
		u.Fragment != "" || u.RawFragment != "" || u.Opaque != "" || u.RawPath != "" ||
		u.EscapedPath() != u.Path || r.RequestURI != u.Path || len(r.RequestURI) > 256 ||
		strings.ContainsAny(r.RequestURI, "%\\\x00\r\n?#") ||
		r.Host == "" || strings.ContainsAny(r.Host, "/@?#\\\x00\r\n") {
		return false
	}
	const prefix = "/api/v1/ide/deployments/"
	path, ok := strings.CutPrefix(r.RequestURI, prefix)
	if !ok {
		return false
	}
	operation, suffix, hasSuffix := strings.Cut(path, "/")
	if len(operation) < 16 || len(operation) > 128 {
		return false
	}
	for i := 0; i < len(operation); i++ {
		c := operation[i]
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
			return false
		}
	}
	if hasSuffix {
		switch suffix {
		case "logs", "runtime", "usage", "usage/records":
		default:
			period, billing := strings.CutPrefix(suffix, "billing/")
			if !billing {
				return false
			}
			day, tail, hasTail := strings.Cut(period, "/")
			if hasTail && tail != "native-intent" {
				return false
			}
			const layout = "2006-01-02"
			parsed, err := time.Parse(layout, day)
			if err != nil || parsed.Format(layout) != day {
				return false
			}
		}
	}
	// Auth's same parsed-header bound. The actual native listener still
	// enforces its own HTTP read limit and the shared getter checks the V4 value.
	remaining := MaxProductSessionProofV4RequestHeaderBytes
	for name, values := range r.Header {
		if strings.ContainsAny(name, "\x00\r\n") {
			return false
		}
		for _, value := range values {
			remaining -= len(name) + len(value) + 4
			if remaining < 0 || strings.ContainsAny(value, "\x00\r\n") {
				return false
			}
		}
	}
	return true
}
