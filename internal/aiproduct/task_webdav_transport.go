package aiproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const taskWebDAVMaxBytes int64 = 1 << 20

var (
	ErrTaskWebDAVConfig           = errors.New("invalid fixed WebDAV configuration")
	ErrTaskWebDAVUnavailable      = errors.New("WebDAV current authority unavailable")
	ErrTaskWebDAVBounds           = errors.New("WebDAV content exceeds configured bound")
	ErrTaskWebDAVUnknown          = errors.New("WebDAV outcome unknown; query the original object only")
	ErrTaskWebDAVMismatch         = errors.New("WebDAV original object content differs")
	ErrTaskWebDAVAlreadyAttempted = errors.New("WebDAV PUT already attempted; query the original object only")
	ErrTaskWebDAVDestination      = errors.New("WebDAV destination is not permitted")
)

// TaskWebDAVConfig is supplied by trusted local composition, never model/tool
// arguments. Root is a decoded absolute collection path (no trailing slash,
// except /); Object is one decoded filename. No URL/path is accepted by an
// operation. Password is an explicit DAV credential, not a Source or Grant.
type TaskWebDAVConfig struct {
	ProfileID string
	Origin    string
	User      string
	Password  string `json:"-"`
	Root      string
	Object    string
	MaxBytes  int64
	// PUBLIC local interoperability only. Requires a numeric loopback origin;
	// it cannot enable arbitrary HTTP, private LAN or hostname destinations.
	PublicLoopback bool
}

// TaskWebDAVResult describes observed bytes, never authorship, an Auth receipt
// or a resource-side strong fence. ETag and HTTP acknowledgments are not identity.
// UNKNOWN may accompany an error after dispatch. ABSENT is a GET 404 only;
// CONTENT_PRESENT requires an independent GET exactly matching expected bytes.
type TaskWebDAVResult struct {
	ProfileID         string
	RemoteID          string
	ETag              string
	SHA256            string
	Bytes             int64
	State             string
	Content           []byte
	PutAttempted      bool
	WriteAcknowledged bool
	HTTPStatus        int
}

// TaskWebDAVTransport owns one fixed origin/user/root/object and no Store.
// The parent MUST durably reserve its attempt before PutIfAbsentAndVerify and
// retain that immutable destination and expected bytes for restart recovery.
// A fresh process/instance is not evidence that an earlier PUT did not happen.
type TaskWebDAVTransport struct {
	client            *http.Client
	transport         *http.Transport
	url               string
	profileID, object string
	user, password    string
	limit             int64
	current           func(context.Context) error
	mu                sync.Mutex
	attempted         bool
}

// Carry a current-check failure through net/http's URL error without exposing
// destination or credential-bearing transport details in the returned error.
type taskWebDAVCurrentFailure struct{ cause error }

func (e *taskWebDAVCurrentFailure) Error() string { return ErrTaskWebDAVUnavailable.Error() }
func (e *taskWebDAVCurrentFailure) Unwrap() error { return e.cause }

func taskWebDAVText(s string, max int) bool {
	return len(s) > 0 && len(s) <= max && utf8.ValidString(s) && strings.IndexFunc(s, unicode.IsControl) < 0
}
func taskWebDAVSegment(s string) bool {
	return taskWebDAVText(s, 1024) && s != "." && s != ".." && !strings.ContainsAny(s, "/\\%?#")
}

// Production rejects non-public addresses both for IP literals and after DNS
// resolution at the actual dial. ProxyFromEnvironment and redirect following
// are deliberately absent. Checking the dialed IP prevents DNS-rebinding into
// a private/metadata service while preserving HTTPS hostname verification.
func taskWebDAVPublicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
		return false
	}
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return false
	}
	for _, cidr := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20"} {
		if netip.MustParsePrefix(cidr).Contains(ip) {
			return false
		}
	}
	return true
}

func PrepareTaskWebDAVTransport(ctx context.Context, cfg TaskWebDAVConfig, current func(context.Context) error) (*TaskWebDAVTransport, error) {
	if ctx == nil || current == nil {
		return nil, ErrTaskWebDAVUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !taskWebDAVText(cfg.ProfileID, 256) || !taskWebDAVText(cfg.User, 256) || strings.ContainsAny(cfg.User, ":/\\%?#") || !taskWebDAVText(cfg.Password, 4096) || !taskWebDAVSegment(cfg.Object) {
		return nil, ErrTaskWebDAVConfig
	}
	if len(cfg.Root) > 4096 || !strings.HasPrefix(cfg.Root, "/") || (cfg.Root != "/" && strings.HasSuffix(cfg.Root, "/")) {
		return nil, ErrTaskWebDAVConfig
	}
	if cfg.Root != "/" {
		for _, segment := range strings.Split(cfg.Root[1:], "/") {
			if !taskWebDAVSegment(segment) {
				return nil, ErrTaskWebDAVConfig
			}
		}
	}
	// Nextcloud's user namespace is explicit, not guessed from a header or a
	// model argument. Generic DAV roots remain fixed trusted configuration.
	const nextcloudPrefix = "/remote.php/dav/files/"
	if cfg.Root == strings.TrimSuffix(nextcloudPrefix, "/") {
		return nil, ErrTaskWebDAVConfig
	}
	if strings.HasPrefix(cfg.Root, nextcloudPrefix) {
		owner := strings.Split(strings.TrimPrefix(cfg.Root, nextcloudPrefix), "/")[0]
		if owner != cfg.User {
			return nil, ErrTaskWebDAVConfig
		}
	}
	if cfg.MaxBytes == 0 {
		cfg.MaxBytes = taskWebDAVMaxBytes
	}
	if cfg.MaxBytes < 1 || cfg.MaxBytes > taskWebDAVMaxBytes {
		return nil, ErrTaskWebDAVBounds
	}
	u, err := url.Parse(cfg.Origin)
	if err != nil || u.Host == "" || u.User != nil || u.Opaque != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawFragment != "" || (u.Path != "" && u.Path != "/") || u.RawPath != "" || strings.ContainsAny(cfg.Origin, "?#") || strings.HasSuffix(u.Host, ":") || !taskWebDAVText(cfg.Origin, 2048) {
		return nil, ErrTaskWebDAVConfig
	}
	if u.Scheme != "https" && !(cfg.PublicLoopback && u.Scheme == "http") {
		return nil, ErrTaskWebDAVDestination
	}
	host := u.Hostname()
	if host == "" || strings.ContainsAny(host, "%\\") || strings.HasSuffix(host, ".") {
		return nil, ErrTaskWebDAVDestination
	}
	if port := u.Port(); port != "" {
		p, e := strconv.Atoi(port)
		if e != nil || p < 1 || p > 65535 {
			return nil, ErrTaskWebDAVConfig
		}
	}
	literal, ipErr := netip.ParseAddr(host)
	if cfg.PublicLoopback {
		if ipErr != nil || !literal.IsLoopback() {
			return nil, ErrTaskWebDAVDestination
		}
	} else if ipErr == nil && !taskWebDAVPublicIP(literal) {
		return nil, ErrTaskWebDAVDestination
	}
	u.Path = strings.TrimSuffix(cfg.Root, "/") + "/" + cfg.Object
	u.RawPath = ""
	fixedURL := u.String()
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := &http.Transport{Proxy: nil, DisableCompression: true, DisableKeepAlives: true, MaxResponseHeaderBytes: 16 << 10, ResponseHeaderTimeout: 10 * time.Second, TLSHandshakeTimeout: 10 * time.Second}
	transport.DialContext = func(dialCtx context.Context, network, address string) (net.Conn, error) {
		actualHost, port, e := net.SplitHostPort(address)
		if e != nil || !strings.EqualFold(actualHost, host) {
			return nil, ErrTaskWebDAVDestination
		}
		ips, e := net.DefaultResolver.LookupNetIP(dialCtx, "ip", host)
		if e != nil || len(ips) == 0 {
			return nil, ErrTaskWebDAVDestination
		}
		// Reject mixed public/private resolutions rather than choosing a safe
		// member and silently accepting a changed or ambiguous destination.
		for _, ip := range ips {
			if cfg.PublicLoopback {
				if !ip.IsLoopback() {
					return nil, ErrTaskWebDAVDestination
				}
			} else if !taskWebDAVPublicIP(ip) {
				return nil, ErrTaskWebDAVDestination
			}
		}
		var last error
		for _, ip := range ips {
			conn, e := dialer.DialContext(dialCtx, network, net.JoinHostPort(ip.String(), port))
			if e == nil {
				// DNS/TCP may have waited since request's initial Current check.
				// Never hand the HTTP/TLS writer a connection after observing
				// revocation. This is a client pre-send check, not a target fence;
				// revocation after this check remains an external in-flight race.
				checkErr := dialCtx.Err()
				if checkErr == nil {
					checkErr = current(dialCtx)
				}
				if checkErr == nil {
					checkErr = dialCtx.Err()
				}
				if checkErr != nil {
					_ = conn.Close()
					return nil, &taskWebDAVCurrentFailure{cause: checkErr}
				}
				return conn, nil
			}
			last = e
		}
		return nil, last
	}
	t := &TaskWebDAVTransport{transport: transport, url: fixedURL, profileID: cfg.ProfileID, object: cfg.Object, user: cfg.User, password: cfg.Password, limit: cfg.MaxBytes, current: current}
	t.client = &http.Client{Transport: transport, Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if err := t.check(ctx); err != nil {
		return nil, err
	}
	return t, nil
}

func (t *TaskWebDAVTransport) check(ctx context.Context) error {
	if t == nil || ctx == nil || t.client == nil || t.current == nil {
		return ErrTaskWebDAVUnavailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := t.current(ctx); err != nil {
		return err
	}
	return ctx.Err()
}

// request never follows redirects, retries PUT, sends cookies or delegates to
// an environment proxy. Keepalives are off; PUT GetBody is nil, preventing the
// net/http automatic rewind/retry path even if a connection fails after send.
func (t *TaskWebDAVTransport) request(ctx context.Context, method string, body []byte) (*http.Response, error) {
	if err := t.check(ctx); err != nil {
		return nil, err
	}
	var reader io.Reader
	if method == http.MethodPut {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, t.url, reader)
	if err != nil {
		return nil, ErrTaskWebDAVConfig
	}
	req.GetBody = nil
	req.SetBasicAuth(t.user, t.password)
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("Cache-Control", "no-cache, no-store, no-transform")
	if method == http.MethodPut {
		req.Header.Set("If-None-Match", "*")
		req.Header.Set("Content-Type", "application/octet-stream")
	}
	response, err := t.client.Do(req)
	if err != nil {
		var currentFailure *taskWebDAVCurrentFailure
		if errors.As(err, &currentFailure) {
			return nil, errors.Join(ErrTaskWebDAVUnknown, currentFailure.cause, ctx.Err())
		}
		return nil, errors.Join(ErrTaskWebDAVUnknown, ctx.Err())
	}
	return response, nil
}

func (t *TaskWebDAVTransport) expected(body []byte) ([]byte, error) {
	if t == nil || t.limit < 1 {
		return nil, ErrTaskWebDAVUnavailable
	}
	if int64(len(body)) > t.limit {
		return nil, ErrTaskWebDAVBounds
	}
	return bytes.Clone(body), nil
}

func (t *TaskWebDAVTransport) observation() TaskWebDAVResult {
	out := TaskWebDAVResult{State: "UNKNOWN"}
	if t != nil {
		out.ProfileID, out.RemoteID = t.profileID, t.object
	}
	return out
}

// PutIfAbsentAndVerify makes at most one conditional PUT per instance, then an
// independent GET. A 412 is not write acknowledgment; matching preexisting
// bytes still mean CONTENT_PRESENT only. A lost ACK returns UNKNOWN immediately;
// only QueryContent may recover it. Parent durability enforces this across
// instances/restarts. No author evidence is derived from PUT, ETag or equality.
func (t *TaskWebDAVTransport) PutIfAbsentAndVerify(ctx context.Context, body []byte) (TaskWebDAVResult, error) {
	out := t.observation()
	owned, err := t.expected(body)
	if err != nil {
		return out, err
	}
	if err = t.check(ctx); err != nil {
		return out, err
	}
	t.mu.Lock()
	if t.attempted {
		t.mu.Unlock()
		return out, ErrTaskWebDAVAlreadyAttempted
	}
	t.attempted = true
	t.mu.Unlock()
	out.PutAttempted = true
	response, err := t.request(ctx, http.MethodPut, owned)
	if err != nil {
		return out, err
	}
	out.HTTPStatus = response.StatusCode
	// A PUT response payload carries no outcome authority; close without
	// buffering an arbitrary remote body. GET supplies the actual content.
	response.Body.Close()
	switch response.StatusCode {
	case http.StatusOK, http.StatusCreated, http.StatusNoContent:
		out.WriteAcknowledged = true
	case http.StatusPreconditionFailed:
	default:
		return out, ErrTaskWebDAVUnknown
	}
	read, err := t.QueryContent(ctx, owned)
	read.PutAttempted, read.WriteAcknowledged = true, out.WriteAcknowledged
	return read, err
}

// QueryContent performs only GET of the fixed original object. It never PUTs,
// follows a Location, parses remote XML/JSON or treats an ETag as author proof.
// The exact expected bytes and destination must come from the parent's durable
// original operation; callers must not substitute model-generated recovery data.
func (t *TaskWebDAVTransport) QueryContent(ctx context.Context, expected []byte) (TaskWebDAVResult, error) {
	out := t.observation()
	owned, err := t.expected(expected)
	if err != nil {
		return out, err
	}
	response, err := t.request(ctx, http.MethodGet, nil)
	if err != nil {
		return out, err
	}
	defer response.Body.Close()
	out.HTTPStatus = response.StatusCode
	if response.StatusCode == http.StatusNotFound {
		if err := t.check(ctx); err != nil {
			return out, err
		}
		out.State = "ABSENT"
		return out, nil
	}
	if response.StatusCode != http.StatusOK {
		return out, ErrTaskWebDAVUnknown
	}
	if response.ContentLength > t.limit {
		return out, ErrTaskWebDAVBounds
	}
	etag := response.Header.Get("ETag")
	if len(etag) > 4096 || (etag != "" && !taskWebDAVText(etag, 4096)) {
		return out, ErrTaskWebDAVBounds
	}
	if encoding := response.Header.Get("Content-Encoding"); encoding != "" && !strings.EqualFold(encoding, "identity") {
		return out, ErrTaskWebDAVUnknown
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, t.limit+1))
	if err != nil {
		return out, ErrTaskWebDAVUnknown
	}
	if int64(len(raw)) > t.limit {
		return out, ErrTaskWebDAVBounds
	}
	if !bytes.Equal(raw, owned) {
		return out, ErrTaskWebDAVMismatch
	}
	// Recheck after network wait before releasing observed private content.
	if err = t.check(ctx); err != nil {
		return out, err
	}
	out.State, out.Content = "CONTENT_PRESENT", raw
	digest := sha256.Sum256(raw)
	out.SHA256, out.Bytes, out.ETag = hex.EncodeToString(digest[:]), int64(len(raw)), etag
	return out, nil
}
