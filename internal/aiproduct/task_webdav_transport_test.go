package aiproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// PUBLIC loopback DAV behavior fixture only: real HTTP PUT/GET, explicit
// synthetic credentials/current, no Auth Source or Nextcloud deployment claim.
// The parent owns durable attempt reservation and encrypted recovery records.
type p08DAVFixture struct {
	mu           sync.Mutex
	body         []byte
	exists       bool
	methods      []string
	paths        []string
	lostACK      bool
	status       int
	getBody      []byte
	getOverride  bool
	chunked      bool
	etag         string
	encoding     string
	afterRequest func(string)
	revoked      atomic.Bool
	currentCalls atomic.Int32
	server       *httptest.Server
	cfg          TaskWebDAVConfig
	cause        error
}

func newP08DAVFixture(t *testing.T) *p08DAVFixture {
	t.Helper()
	f := &p08DAVFixture{etag: `"PUBLIC-etag-is-not-identity"`, cause: errors.New("PUBLIC current revoked")}
	f.cfg = TaskWebDAVConfig{ProfileID: "PUBLIC-nextcloud", User: "alice", Password: "PUBLIC-no-real-password", Root: "/remote.php/dav/files/alice/Approved", Object: "原始 order.txt", MaxBytes: 1024, PublicLoopback: true}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		f.mu.Lock()
		defer f.mu.Unlock()
		defer func() {
			if f.afterRequest != nil {
				f.afterRequest(r.Method)
			}
		}()
		f.methods = append(f.methods, r.Method)
		f.paths = append(f.paths, r.URL.EscapedPath())
		u, p, ok := r.BasicAuth()
		if !ok || u != f.cfg.User || p != f.cfg.Password || r.URL.Path != f.cfg.Root+"/"+f.cfg.Object || r.URL.RawQuery != "" {
			t.Error("fixed DAV user/root/object or credential changed")
			w.WriteHeader(403)
			return
		}
		if r.Header.Get("Accept-Encoding") != "identity" || r.Header.Get("Cache-Control") == "" {
			t.Error("GET may transform/cache bytes")
		}
		if f.status != 0 {
			w.WriteHeader(f.status)
			return
		}
		switch r.Method {
		case http.MethodPut:
			if r.Header.Get("If-None-Match") != "*" || r.Header.Get("Content-Type") != "application/octet-stream" {
				t.Error("PUT lost conditional exact bytes")
			}
			raw, err := io.ReadAll(io.LimitReader(r.Body, 2048))
			if err != nil {
				t.Error(err)
				return
			}
			if f.exists {
				w.WriteHeader(http.StatusPreconditionFailed)
				return
			}
			f.body, f.exists = bytes.Clone(raw), true
			if f.lostACK {
				conn, _, err := w.(http.Hijacker).Hijack()
				if err != nil {
					t.Error(err)
					return
				}
				conn.Close()
				return
			}
			w.WriteHeader(http.StatusCreated)
		case http.MethodGet:
			if !f.exists {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.Header().Set("ETag", f.etag)
			if f.encoding != "" {
				w.Header().Set("Content-Encoding", f.encoding)
			}
			body := f.body
			if f.getOverride {
				body = f.getBody
			}
			if f.chunked {
				w.(http.Flusher).Flush()
			} else {
				w.Header().Set("Content-Length", strconv.Itoa(len(body)))
			}
			_, _ = w.Write(body)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	f.cfg.Origin = f.server.URL
	t.Cleanup(f.server.Close)
	return f
}
func (f *p08DAVFixture) current(ctx context.Context) error {
	f.currentCalls.Add(1)
	if f.revoked.Load() {
		return f.cause
	}
	return ctx.Err()
}
func (f *p08DAVFixture) prepare(t *testing.T) *TaskWebDAVTransport {
	t.Helper()
	transport, err := PrepareTaskWebDAVTransport(context.Background(), f.cfg, f.current)
	if err != nil {
		t.Fatal(err)
	}
	return transport
}
func (f *p08DAVFixture) requests() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return strings.Join(f.methods, ",")
}

func TestP08WebDAVTransportConditionalPutIndependentGet(t *testing.T) {
	f := newP08DAVFixture(t)
	transport := f.prepare(t)
	body := []byte("exact\x00bytes\r\n原始\n")
	result, err := transport.PutIfAbsentAndVerify(context.Background(), body)
	digest := sha256.Sum256(body)
	if err != nil || result.State != "CONTENT_PRESENT" || !result.PutAttempted || !result.WriteAcknowledged || result.RemoteID != f.cfg.Object || result.ProfileID != f.cfg.ProfileID || result.Bytes != int64(len(body)) || result.SHA256 != hex.EncodeToString(digest[:]) || result.ETag != f.etag || !bytes.Equal(result.Content, body) || f.requests() != "PUT,GET" {
		t.Fatalf("exact PUT/GET observation: %+v %v requests=%s", result, err, f.requests())
	}
	if len(f.paths) != 2 || f.paths[0] != f.paths[1] || !strings.Contains(f.paths[0], "%20") {
		t.Fatal("fixed object escaped differently between PUT and GET")
	}
	// Returned content cannot change the fixed target or the bytes served by
	// a later independent GET.
	result.Content[0] = '!'
	query, err := transport.QueryContent(context.Background(), body)
	if err != nil || query.PutAttempted || query.WriteAcknowledged || !bytes.Equal(query.Content, body) {
		t.Fatalf("query invented authorship/mutated bytes: %+v %v", query, err)
	}
	if _, err := transport.PutIfAbsentAndVerify(context.Background(), body); !errors.Is(err, ErrTaskWebDAVAlreadyAttempted) || f.requests() != "PUT,GET,GET" {
		t.Fatal("same instance issued a second PUT")
	}
	encoded, _ := json.Marshal(f.cfg)
	if bytes.Contains(encoded, []byte(f.cfg.Password)) {
		t.Fatal("config JSON exposed explicit credential")
	}
}

func TestP08WebDAVTransportPreexistingContentIsNotAuthorship(t *testing.T) {
	for _, same := range []bool{true, false} {
		t.Run(strconv.FormatBool(same), func(t *testing.T) {
			f := newP08DAVFixture(t)
			f.exists = true
			f.body = []byte("original")
			transport := f.prepare(t)
			expected := []byte("original")
			if !same {
				expected = []byte("replacement")
			}
			result, err := transport.PutIfAbsentAndVerify(context.Background(), expected)
			if result.WriteAcknowledged || !result.PutAttempted || f.requests() != "PUT,GET" || string(f.body) != "original" {
				t.Fatal("412 overwrote bytes or became author evidence")
			}
			if same {
				if err != nil || result.State != "CONTENT_PRESENT" {
					t.Fatalf("preexisting content: %+v %v", result, err)
				}
			} else if !errors.Is(err, ErrTaskWebDAVMismatch) || result.State != "UNKNOWN" || len(result.Content) != 0 {
				t.Fatal("ETag/precondition accepted mismatched content")
			}
		})
	}
}

func TestP08WebDAVTransportLostACKOriginalObjectQueryOnly(t *testing.T) {
	f := newP08DAVFixture(t)
	f.lostACK = true
	transport := f.prepare(t)
	body := []byte("persisted before ACK loss")
	result, err := transport.PutIfAbsentAndVerify(context.Background(), body)
	if !errors.Is(err, ErrTaskWebDAVUnknown) || result.State != "UNKNOWN" || !result.PutAttempted || result.WriteAcknowledged || len(result.Content) != 0 || f.requests() != "PUT" {
		t.Fatalf("lost ACK invented success/retried: %+v %v %s", result, err, f.requests())
	}
	if _, err := transport.PutIfAbsentAndVerify(context.Background(), body); !errors.Is(err, ErrTaskWebDAVAlreadyAttempted) {
		t.Fatal("lost ACK retried PUT")
	}
	// A reconstructed adapter represents restart; parent's durable attempted
	// record selects QUERY, even though the new adapter has no local flag.
	restored := f.prepare(t)
	result, err = restored.QueryContent(context.Background(), body)
	if err != nil || result.State != "CONTENT_PRESENT" || result.WriteAcknowledged || result.PutAttempted || !bytes.Equal(result.Content, body) || f.requests() != "PUT,GET" {
		t.Fatalf("original object recovery: %+v %v %s", result, err, f.requests())
	}
	missing := newP08DAVFixture(t)
	absent, err := missing.prepare(t).QueryContent(context.Background(), body)
	if err != nil || absent.State != "ABSENT" || len(absent.Content) != 0 || missing.requests() != "GET" {
		t.Fatal("404 recovery issued PUT or invented content")
	}
}

func TestP08WebDAVTransportCurrentBeforeEachRequestAndReturn(t *testing.T) {
	for _, stage := range []string{"prepare", "before-put", "between-put-get", "during-get", "before-query"} {
		t.Run(stage, func(t *testing.T) {
			f := newP08DAVFixture(t)
			if stage == "prepare" {
				f.revoked.Store(true)
				if _, err := PrepareTaskWebDAVTransport(context.Background(), f.cfg, f.current); !errors.Is(err, f.cause) || f.requests() != "" {
					t.Fatal("unavailable current prepared runtime")
				}
				return
			}
			transport := f.prepare(t)
			f.mu.Lock()
			f.afterRequest = func(method string) {
				if stage == "between-put-get" && method == "PUT" || stage == "during-get" && method == "GET" {
					f.revoked.Store(true)
				}
			}
			f.mu.Unlock()
			var result TaskWebDAVResult
			var err error
			switch stage {
			case "before-put":
				f.revoked.Store(true)
				result, err = transport.PutIfAbsentAndVerify(context.Background(), []byte("value"))
			case "before-query":
				f.revoked.Store(true)
				result, err = transport.QueryContent(context.Background(), []byte("value"))
			default:
				result, err = transport.PutIfAbsentAndVerify(context.Background(), []byte("value"))
			}
			if !errors.Is(err, f.cause) || result.State != "UNKNOWN" || len(result.Content) != 0 {
				t.Fatalf("revoked source released content: %+v %v", result, err)
			}
			if stage == "between-put-get" && f.requests() != "PUT" || (stage == "before-put" || stage == "before-query") && f.requests() != "" {
				t.Fatal("new request issued after current revoked")
			}
		})
	}
}

func TestP08WebDAVTransportBoundedExactResponseFailures(t *testing.T) {
	for _, mode := range []string{"length-bound", "chunked-bound", "mismatch", "encoding", "partial-status", "unauthorized", "async-put", "etag-bound", "empty"} {
		t.Run(mode, func(t *testing.T) {
			f := newP08DAVFixture(t)
			f.exists = true
			f.body = []byte("exact")
			want := []byte("exact")
			var expectedError error
			switch mode {
			case "length-bound":
				f.getOverride = true
				f.getBody = bytes.Repeat([]byte{'x'}, 1025)
				expectedError = ErrTaskWebDAVBounds
			case "chunked-bound":
				f.getOverride = true
				f.getBody = bytes.Repeat([]byte{'x'}, 1025)
				f.chunked = true
				expectedError = ErrTaskWebDAVBounds
			case "mismatch":
				f.getOverride = true
				f.getBody = []byte("EXACT")
				expectedError = ErrTaskWebDAVMismatch
			case "encoding":
				f.encoding = "gzip"
				expectedError = ErrTaskWebDAVUnknown
			case "partial-status":
				f.status = 206
				expectedError = ErrTaskWebDAVUnknown
			case "unauthorized":
				f.status = 401
				expectedError = ErrTaskWebDAVUnknown
			case "async-put":
				f.status = 202
				expectedError = ErrTaskWebDAVUnknown
			case "etag-bound":
				f.etag = strings.Repeat("x", 4097)
				expectedError = ErrTaskWebDAVBounds
			case "empty":
				f.body = nil
				want = nil
			}
			transport := f.prepare(t)
			var result TaskWebDAVResult
			var err error
			if mode == "async-put" {
				result, err = transport.PutIfAbsentAndVerify(context.Background(), want)
			} else {
				result, err = transport.QueryContent(context.Background(), want)
			}
			if expectedError == nil {
				if err != nil || result.State != "CONTENT_PRESENT" || result.Bytes != 0 {
					t.Fatalf("empty bytes: %+v %v", result, err)
				}
			} else if !errors.Is(err, expectedError) || result.State != "UNKNOWN" || len(result.Content) != 0 || result.SHA256 != "" {
				t.Fatalf("unsafe response accepted %s: %+v %v", mode, result, err)
			}
			if mode == "async-put" && f.requests() != "PUT" {
				t.Fatal("202 became success or automatic GET/retry")
			}
		})
	}
}

func TestP08WebDAVTransportRedirectAndProxyNeverFollowed(t *testing.T) {
	for _, method := range []string{"PUT", "GET"} {
		for _, status := range []int{301, 302, 303, 307, 308} {
			t.Run(method+strconv.Itoa(status), func(t *testing.T) {
				var leaked atomic.Int32
				sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked.Add(1); w.WriteHeader(204) }))
				defer sink.Close()
				origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Location", sink.URL+"/credentials-must-not-arrive")
					w.WriteHeader(status)
				}))
				defer origin.Close()
				f := newP08DAVFixture(t)
				f.cfg.Origin = origin.URL
				// The adapter must ignore host environment proxy configuration.
				t.Setenv("HTTP_PROXY", sink.URL)
				t.Setenv("HTTPS_PROXY", sink.URL)
				t.Setenv("ALL_PROXY", sink.URL)
				t.Setenv("NO_PROXY", "")
				transport := f.prepare(t)
				var result TaskWebDAVResult
				var err error
				if method == "PUT" {
					result, err = transport.PutIfAbsentAndVerify(context.Background(), []byte("private"))
				} else {
					result, err = transport.QueryContent(context.Background(), []byte("private"))
				}
				if !errors.Is(err, ErrTaskWebDAVUnknown) || result.State != "UNKNOWN" || result.HTTPStatus != status || leaked.Load() != 0 {
					t.Fatalf("redirect/proxy accepted: %+v %v leaked=%d", result, err, leaked.Load())
				}
			})
		}
	}
}

func TestP08WebDAVTransportClosedConfigurationAndDestinations(t *testing.T) {
	f := newP08DAVFixture(t)
	for _, mode := range []string{"no-profile", "no-user", "no-password", "userinfo", "query", "fragment", "origin-path", "http-production", "localhost-fixture", "lan-fixture", "private-production", "metadata-production", "mapped-loopback", "dot-object", "slash-object", "encoded-object", "backslash-object", "dot-root", "double-root", "relative-root", "wrong-user", "overbound"} {
		t.Run(mode, func(t *testing.T) {
			cfg := f.cfg
			switch mode {
			case "no-profile":
				cfg.ProfileID = ""
			case "no-user":
				cfg.User = ""
			case "no-password":
				cfg.Password = ""
			case "userinfo":
				cfg.Origin = "http://alice:secret@127.0.0.1"
			case "query":
				cfg.Origin += "?target=other"
			case "fragment":
				cfg.Origin += "#other"
			case "origin-path":
				cfg.Origin += "/other"
			case "http-production":
				cfg.PublicLoopback = false
			case "localhost-fixture":
				cfg.Origin = "http://localhost:1234"
			case "lan-fixture":
				cfg.Origin = "http://192.168.1.1"
			case "private-production":
				cfg.Origin = "https://10.0.0.1"
				cfg.PublicLoopback = false
			case "metadata-production":
				cfg.Origin = "https://169.254.169.254"
				cfg.PublicLoopback = false
			case "mapped-loopback":
				cfg.Origin = "https://[::ffff:127.0.0.1]"
				cfg.PublicLoopback = false
			case "dot-object":
				cfg.Object = ".."
			case "slash-object":
				cfg.Object = "a/b"
			case "encoded-object":
				cfg.Object = "%2e%2e"
			case "backslash-object":
				cfg.Object = `a\b`
			case "dot-root":
				cfg.Root = "/a/../b"
			case "double-root":
				cfg.Root = "/a//b"
			case "relative-root":
				cfg.Root = "relative"
			case "wrong-user":
				cfg.User = "bob"
			case "overbound":
				cfg.MaxBytes = taskWebDAVMaxBytes + 1
			}
			if transport, err := PrepareTaskWebDAVTransport(context.Background(), cfg, f.current); err == nil || transport != nil {
				t.Fatal("unclosed configuration accepted")
			}
		})
	}
	if f.requests() != "" {
		t.Fatal("constructor made a network request")
	}
	if _, err := PrepareTaskWebDAVTransport(context.Background(), f.cfg, nil); !errors.Is(err, ErrTaskWebDAVUnavailable) {
		t.Fatal("nil current admitted")
	}
	if _, err := PrepareTaskWebDAVTransport(nil, f.cfg, f.current); !errors.Is(err, ErrTaskWebDAVUnavailable) {
		t.Fatal("nil context admitted")
	}
	for _, raw := range []string{"127.0.0.1", "::1", "::ffff:10.0.0.1", "100.100.100.200", "169.254.169.254", "fc00::1", "fe80::1", "2001:db8::1", "2002:a00:1::", "64:ff9b::a00:1", "198.18.0.1", "192.0.2.1", "224.0.0.1", "0.0.0.0"} {
		if taskWebDAVPublicIP(netip.MustParseAddr(raw)) {
			t.Fatalf("nonpublic dial address accepted: %s", raw)
		}
	}
	for _, raw := range []string{"8.8.8.8", "2606:4700:4700::1111"} {
		if !taskWebDAVPublicIP(netip.MustParseAddr(raw)) {
			t.Fatalf("public address rejected: %s", raw)
		}
	}
}

func TestP08WebDAVTransportOneAttemptBoundsAndCancellation(t *testing.T) {
	f := newP08DAVFixture(t)
	transport := f.prepare(t)
	if _, err := transport.PutIfAbsentAndVerify(context.Background(), bytes.Repeat([]byte{'x'}, 1025)); !errors.Is(err, ErrTaskWebDAVBounds) || f.requests() != "" {
		t.Fatal("oversized outgoing request sent")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := transport.PutIfAbsentAndVerify(ctx, []byte("same")); !errors.Is(err, context.Canceled) || f.requests() != "" {
		t.Fatal("canceled request sent")
	}
	var wg sync.WaitGroup
	var won atomic.Int32
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := transport.PutIfAbsentAndVerify(context.Background(), []byte("same"))
			if err == nil && result.State == "CONTENT_PRESENT" {
				won.Add(1)
			} else if !errors.Is(err, ErrTaskWebDAVAlreadyAttempted) {
				t.Errorf("unexpected competing attempt: %v", err)
			}
		}()
	}
	wg.Wait()
	if won.Load() != 1 || f.requests() != "PUT,GET" {
		t.Fatalf("competing conditional attempts: winners=%d %s", won.Load(), f.requests())
	}
	var zero TaskWebDAVTransport
	if _, err := zero.QueryContent(context.Background(), nil); !errors.Is(err, ErrTaskWebDAVUnavailable) {
		t.Fatal("zero adapter admitted")
	}
}

func TestP08WebDAVTransportRevokeAtDialHandoffSendsNoRequest(t *testing.T) {
	for _, method := range []string{http.MethodPut, http.MethodGet} {
		t.Run(method, func(t *testing.T) {
			f := newP08DAVFixture(t)
			transport := f.prepare(t)
			var connected atomic.Int32
			// Actual net.Dialer calls ConnectDone before returning its real TCP
			// connection. Revocation here deterministically exercises the same
			// post-DNS/TCP handoff gate without a fake resolver/dialer or sleep.
			ctx := httptrace.WithClientTrace(context.Background(), &httptrace.ClientTrace{
				ConnectDone: func(_, _ string, err error) {
					if err == nil {
						connected.Add(1)
						f.revoked.Store(true)
					}
				},
			})
			var result TaskWebDAVResult
			var err error
			if method == http.MethodPut {
				result, err = transport.PutIfAbsentAndVerify(ctx, []byte("private body"))
			} else {
				result, err = transport.QueryContent(ctx, []byte("private body"))
			}
			if connected.Load() != 1 || !errors.Is(err, f.cause) || !errors.Is(err, ErrTaskWebDAVUnknown) || result.State != "UNKNOWN" || len(result.Content) != 0 || result.WriteAcknowledged || f.requests() != "" {
				t.Fatalf("dial handoff released revoked request: connected=%d result=%+v err=%v requests=%s", connected.Load(), result, err, f.requests())
			}
			if method == http.MethodPut {
				if !result.PutAttempted {
					t.Fatal("conservative original attempt reservation lost")
				}
				f.revoked.Store(false)
				if _, err := transport.PutIfAbsentAndVerify(context.Background(), []byte("private body")); !errors.Is(err, ErrTaskWebDAVAlreadyAttempted) || connected.Load() != 1 || f.requests() != "" {
					t.Fatal("rejected dial handoff made PUT runnable again")
				}
			}
		})
	}
}
