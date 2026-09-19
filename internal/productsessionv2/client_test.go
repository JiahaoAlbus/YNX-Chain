package productsessionv2

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type vector struct {
	Now            string
	RequiredScopes []string
	ProofHeader    string
	Session        Session
	Response       struct {
		Status  int
		Headers map[string]string
		Body    string
	}
	Replay struct {
		Status  int
		Headers map[string]string
		Body    string
	}
}

func fixture(t *testing.T) vector {
	t.Helper()
	b, e := os.ReadFile("testdata/finance-v2.json")
	if e != nil {
		t.Fatal(e)
	}
	var v vector
	if e = json.Unmarshal(b, &v); e != nil {
		t.Fatal(e)
	}
	return v
}
func policy(v vector) Policy {
	return Policy{ProductID: v.Session.ProductID, ClientID: v.Session.ClientID, ApplicationID: v.Session.ApplicationID, Platform: v.Session.Platform, Origin: v.Session.Origin, Callback: v.Session.Callback, AllowedScopes: v.Session.Scopes}
}
func request(v vector) *http.Request {
	r := httptest.NewRequest("POST", "https://finance.ynxweb4.com/api/portfolio", nil)
	r.Header.Set(ProofHeader, v.ProofHeader)
	r.Header.Set("Origin", v.Session.Origin)
	return r
}
func responseFor(t *testing.T, v vector, r *http.Request, replay bool) *http.Response {
	t.Helper()
	status, body := v.Response.Status, v.Response.Body
	if replay {
		status, body = v.Replay.Status, v.Replay.Body
	}
	payload, e := canonicalObject([]byte(body))
	if e != nil {
		t.Fatal(e)
	}
	payload["requestId"] = r.Header.Get("X-Request-Id")
	encoded, _ := canonical(payload)
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json; charset=utf-8"}, "Cache-Control": []string{"no-store"}, "X-Request-Id": []string{r.Header.Get("X-Request-Id")}}, Body: io.NopCloser(strings.NewReader(string(encoded))), ContentLength: int64(len(encoded)), Request: r}
}
func clientFor(t *testing.T, v vector, rt roundTrip) *Client {
	t.Helper()
	c, e := NewClient("https://wallet-auth.ynxweb4.com", policy(v), rt)
	if e != nil {
		t.Fatal(e)
	}
	now, e := protocolTime(v.Now)
	if e != nil {
		t.Fatal(e)
	}
	c.clock = func() time.Time { return now }
	return c
}
func assertCode(t *testing.T, err error, code string) {
	t.Helper()
	var typed *Error
	if !errors.As(err, &typed) || typed.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}

func TestSDKVectorAndRemoteReplay(t *testing.T) {
	v := fixture(t)
	calls := 0
	c := clientFor(t, v, func(r *http.Request) (*http.Response, error) {
		calls++
		body, _ := io.ReadAll(r.Body)
		if string(body) != `{"requiredScopes":["finance.pay.read"]}` || r.URL.String() != "https://wallet-auth.ynxweb4.com"+introspectionPath || r.Method != "POST" || r.Header.Get(ProofHeader) != v.ProofHeader || r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			t.Fatal("unexpected authority request")
		}
		return responseFor(t, v, r, calls > 1), nil
	})
	s, e := c.Authorize(context.Background(), request(v), v.RequiredScopes)
	if e != nil || s.Account != v.Session.Account {
		t.Fatalf("SDK vector rejected: %v", e)
	}
	_, e = c.Authorize(context.Background(), request(v), v.RequiredScopes)
	assertCode(t, e, "REPLAY")
	if calls != 2 {
		t.Fatal("decisions must not be cached/retried")
	}
}

func TestInvalidRequestsNeverContactAuthority(t *testing.T) {
	v := fixture(t)
	tests := []struct {
		name, code string
		mutate     func(*http.Request)
		scopes     []string
	}{
		{"origin", "ORIGIN_MISMATCH", func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") }, v.RequiredScopes},
		{"legacy", "PROOF_REQUIRED", func(r *http.Request) {
			r.Header.Del(ProofHeader)
			r.Header.Set("X-YNX-Product-Session-Proof", v.ProofHeader)
		}, v.RequiredScopes},
		{"duplicate", "PROOF_REQUIRED", func(r *http.Request) { r.Header.Add(ProofHeader, v.ProofHeader) }, v.RequiredScopes},
		{"scope", "INTROSPECTION_BINDING_MISMATCH", func(*http.Request) {}, []string{"finance.portfolio.read"}},
		{"empty_scope", "INVALID_ROUTE_POLICY", func(*http.Request) {}, nil},
		{"foreign_scope", "INVALID_ROUTE_POLICY", func(*http.Request) {}, []string{"other:admin"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := clientFor(t, v, func(*http.Request) (*http.Response, error) { t.Fatal("unexpected network"); return nil, nil })
			r := request(v)
			tt.mutate(r)
			_, e := c.Authorize(context.Background(), r, tt.scopes)
			assertCode(t, e, tt.code)
		})
	}
}

func TestProofCannotCrossProductOrOutliveTime(t *testing.T) {
	v := fixture(t)
	for _, kind := range []string{"productId", "account", "issuedAt", "expiresAt", "duplicateJSON"} {
		t.Run(kind, func(t *testing.T) {
			b, _ := base64.RawURLEncoding.DecodeString(v.ProofHeader)
			p, _ := canonicalObject(b)
			code := "INVALID_PROOF"
			switch kind {
			case "productId":
				p[kind] = "social"
				code = "CROSS_PRODUCT_SESSION"
			case "account":
				p[kind] = "0x111"
			case "issuedAt":
				p[kind] = "2026-09-12T09:00:01.000Z"
				code = "PROOF_EXPIRED"
			case "expiresAt":
				p[kind] = v.Now
				code = "PROOF_EXPIRED"
			}
			b, _ = canonical(p)
			if kind == "duplicateJSON" {
				b = []byte(strings.Replace(string(b), `"version":"2"`, `"version":"2","version":"2"`, 1))
			}
			r := request(v)
			r.Header.Set(ProofHeader, base64.RawURLEncoding.EncodeToString(b))
			c := clientFor(t, v, func(*http.Request) (*http.Response, error) { t.Fatal("unexpected network"); return nil, nil })
			_, e := c.Authorize(context.Background(), r, v.RequiredScopes)
			assertCode(t, e, code)
		})
	}
}

func TestResponseBindingsAndUnavailable(t *testing.T) {
	v := fixture(t)
	for _, kind := range []string{"network", "redirect", "cache", "requestId", "account", "scope", "expiry", "oversize", "noncanonical"} {
		t.Run(kind, func(t *testing.T) {
			code := "INVALID_AUTHORITY_RESPONSE"
			c := clientFor(t, v, func(r *http.Request) (*http.Response, error) {
				if kind == "network" {
					code = "AUTHORITY_UNAVAILABLE"
					return nil, errors.New("offline")
				}
				res := responseFor(t, v, r, false)
				switch kind {
				case "redirect":
					code = "AUTHORITY_REDIRECT"
					res.StatusCode = 302
					res.Header.Set("Location", "https://untrusted.example")
				case "cache":
					res.Header.Del("Cache-Control")
				case "requestId":
					res.Header.Set("X-Request-Id", "wrong")
				case "oversize":
					res.ContentLength = maxResponseBytes + 1
				case "noncanonical":
					body, _ := io.ReadAll(res.Body)
					res.Body = io.NopCloser(strings.NewReader(string(body) + " "))
				default:
					body, _ := io.ReadAll(res.Body)
					p, _ := canonicalObject(body)
					session := p["result"].(map[string]any)["session"].(map[string]any)
					switch kind {
					case "account":
						session["account"] = "ynx1" + strings.Repeat("a", 38)
						code = "SESSION_BINDING_MISMATCH"
					case "scope":
						session["scopes"] = []string{"finance.portfolio.read"}
						code = "SCOPE_WIDENING"
					case "expiry":
						session["expiresAt"] = v.Now
						code = "SESSION_EXPIRED"
					}
					encoded, _ := canonical(p)
					res.Body = io.NopCloser(strings.NewReader(string(encoded)))
				}
				return res, nil
			})
			_, e := c.Authorize(context.Background(), request(v), v.RequiredScopes)
			assertCode(t, e, code)
		})
	}
}

func TestFixedHTTPSAuthorityAndPolicyCopy(t *testing.T) {
	v := fixture(t)
	for _, endpoint := range []string{"http://wallet-auth.ynxweb4.com", "https://wallet-auth.ynxweb4.com/", "https://wallet-auth.ynxweb4.com:443", "https://user:pass@wallet-auth.ynxweb4.com", "https://wallet-auth.ynxweb4.com?x=1"} {
		if _, e := NewClient(endpoint, policy(v), nil); e == nil {
			t.Fatalf("accepted %s", endpoint)
		}
	}
	p := policy(v)
	c, e := NewClient("https://wallet-auth.ynxweb4.com", p, nil)
	if e != nil {
		t.Fatal(e)
	}
	p.AllowedScopes[0] = "other:scope"
	if c.policy.AllowedScopes[0] == p.AllowedScopes[0] {
		t.Fatal("policy is mutable")
	}
}
