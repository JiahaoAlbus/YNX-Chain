package developerauthority

// Actual normal Go identity adapter to the SAME original Auth Host's PS
// authority+Root-selected Principal callee. TLS identity is independently
// release-admitted; DATA/JSON alone is never the trust boundary. This implements
// two genuine methods, NOT an always-deny Source13 facade.
import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const originalHTTPPrincipalEndpoint = "https://wallet-auth.ynxweb4.com/v1/developer/original-http-principal"
const originalHTTPProofHeader = "x-ynx-product-session-proof-v2"

var originalHTTPRequestID = regexp.MustCompile(`^req_[A-Za-z0-9_-]{12,80}$`)

type OriginalDeveloperHTTPAuthorityConfig struct{ SPKISHA256 string }

func (OriginalDeveloperHTTPAuthorityConfig) String() string {
	return "OriginalDeveloperHTTPAuthorityConfig{release pin redacted}"
}
func (c OriginalDeveloperHTTPAuthorityConfig) GoString() string { return c.String() }

type originalHTTPPrincipalInput struct {
	Operation   string `json:"operation"`
	RequestID   string `json:"requestId"`
	Method      string `json:"method"`
	Path        string `json:"path"`
	Body        string `json:"body"`
	ProofHeader string `json:"proofHeader"`
}
type originalBodyRestore struct {
	io.Reader
	io.Closer
}

func (originalHTTPPrincipalInput) String() string {
	return "OriginalHTTPPrincipalInput{credential/body redacted}"
}
func (v originalHTTPPrincipalInput) GoString() string { return v.String() }

func originalSingleHeader(h http.Header, name string) (string, bool) {
	var found []string
	for k, v := range h {
		if strings.EqualFold(k, name) {
			found = append(found, v...)
		}
	}
	return strings.Join(found, ""), len(found) == 1
}
func captureOriginalHTTPRequest(r *http.Request) (originalHTTPPrincipalInput, error) {
	if r == nil || r.URL == nil || r.URL.RawQuery != "" || r.URL.Fragment != "" || r.URL.Opaque != "" {
		return originalHTTPPrincipalInput{}, ErrDenied
	}
	if r.Method != "GET" && r.Method != "POST" && r.Method != "PUT" && r.Method != "PATCH" && r.Method != "DELETE" {
		return originalHTTPPrincipalInput{}, ErrDenied
	}
	id, ok := originalSingleHeader(r.Header, "x-request-id")
	proof, pok := originalSingleHeader(r.Header, originalHTTPProofHeader)
	if !ok || !pok || !originalHTTPRequestID.MatchString(id) || len(proof) == 0 || len(proof) > 16384 {
		return originalHTTPPrincipalInput{}, ErrDenied
	}
	var raw []byte
	var e error
	if r.Body != nil {
		old := r.Body
		raw, e = io.ReadAll(io.LimitReader(old, 1048577))
		r.Body = &originalBodyRestore{io.MultiReader(bytes.NewReader(raw), old), old}
	}
	if e != nil || len(raw) > 1048576 || !utf8.Valid(raw) {
		return originalHTTPPrincipalInput{}, ErrDenied
	}
	// Root validates original HTTP proof path grammar/body bytes. Reject query
	// stripping or path rewriting here rather than weakening its signed context.
	p := r.URL.EscapedPath()
	if p == "" || len(p) > 256 || strings.Contains(p, "//") {
		return originalHTTPPrincipalInput{}, ErrDenied
	}
	return originalHTTPPrincipalInput{"authenticate", id, r.Method, p, string(raw), proof}, nil
}

type originalHTTPPrincipalRecord struct {
	input     originalHTTPPrincipalInput
	phase     string
	principal Principal
	profile   string
	expires   int64
	raw       []byte // private bounded originals, never logs/public errors
	cause     error
	cancel    context.CancelFunc
}

func (*originalHTTPPrincipalRecord) String() string {
	return "OriginalHTTPPrincipalRecord{originals retained privately}"
}
func (v *originalHTTPPrincipalRecord) GoString() string { return v.String() }

type OriginalDeveloperHTTPAuthority struct {
	mu          sync.Mutex
	client      *http.Client
	transport   *http.Transport
	endpoint    string // private fixed production value; hermetic tests bind their own TLS server
	records     map[string]*originalHTTPPrincipalRecord
	closed      bool
	wg          sync.WaitGroup
	closeOnce   sync.Once
	closeResult error
}

func (*OriginalDeveloperHTTPAuthority) String() string {
	return "OriginalDeveloperHTTPAuthority{original credential custody redacted}"
}
func (o *OriginalDeveloperHTTPAuthority) GoString() string { return o.String() }

func OpenOriginalDeveloperHTTPAuthority(c OriginalDeveloperHTTPAuthorityConfig) (*OriginalDeveloperHTTPAuthority, error) {
	if !approvalHex.MatchString(c.SPKISHA256) {
		return nil, ErrDenied
	}
	t := &http.Transport{Proxy: nil, DisableKeepAlives: true, TLSHandshakeTimeout: 2 * time.Second, ResponseHeaderTimeout: 6 * time.Second, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, ServerName: "wallet-auth.ynxweb4.com", VerifyConnection: func(s tls.ConnectionState) error {
		if len(s.PeerCertificates) == 0 || len(s.VerifiedChains) == 0 || hash(s.PeerCertificates[0].RawSubjectPublicKeyInfo) != c.SPKISHA256 {
			return ErrDenied
		}
		return nil
	}}}
	return &OriginalDeveloperHTTPAuthority{client: &http.Client{Transport: t, Timeout: 7 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, transport: t, endpoint: originalHTTPPrincipalEndpoint, records: make(map[string]*originalHTTPPrincipalRecord)}, nil
}

func (o *OriginalDeveloperHTTPAuthority) exchange(ctx context.Context, record *originalHTTPPrincipalRecord, operation string) (Principal, error) {
	in := record.input
	in.Operation = operation
	wire, e := json.Marshal(in)
	if e != nil {
		return Principal{}, ErrDenied
	}
	req, e := http.NewRequestWithContext(ctx, "POST", o.endpoint, bytes.NewReader(wire))
	if e != nil {
		return Principal{}, ErrDenied
	}
	req.Header.Set("Content-Type", "application/json")
	res, e := o.client.Do(req)
	if e != nil {
		return Principal{}, e
	}
	defer res.Body.Close()
	raw, e := io.ReadAll(io.LimitReader(res.Body, 1048577))
	o.mu.Lock()
	record.raw = append([]byte(nil), raw...)
	o.mu.Unlock()
	if e != nil || res.StatusCode != 200 || len(raw) > 1048576 || !strings.HasPrefix(res.Header.Get("Content-Type"), "application/json") {
		return Principal{}, ErrUnknown
	}
	var version, original, digest, profile, current, method, path, bodyDigest string
	var expires int64
	var data, authorized, admission bool
	if decodeExactObject(raw, 1048576, map[string]any{"version": &version, "principalOriginal": &original, "principalSHA256": &digest, "profileDigest": &profile, "currentRaw": &current, "method": &method, "path": &path, "bodyDigest": &bodyDigest, "expiresAtMs": &expires, "dataOnly": &data, "authorized": &authorized, "nativeAdmission": &admission}) != nil || version != "YNX-ORIGINAL-DEVELOPER-HTTP-PRINCIPAL/v1" || !data || authorized || admission || !approvalHex.MatchString(profile) || hash([]byte(original)) != digest || len(current) == 0 || len(current) > 393216 || method != in.Method || path != in.Path || bodyDigest != hash([]byte(in.Body)) {
		return Principal{}, ErrUnknown
	}
	var p Principal
	if decodeExactObject([]byte(original), 4096, map[string]any{"Account": &p.Account, "DeviceID": &p.DeviceID, "SessionRef": &p.SessionRef, "CurrentRef": &p.CurrentRef, "AccountGeneration": &p.AccountGeneration, "SessionGeneration": &p.SessionGeneration, "ExpiresMS": &p.ExpiresMS}) != nil {
		return Principal{}, ErrUnknown
	}
	canonical, e := json.Marshal(p)
	now := time.Now().UnixMilli()
	if e != nil || !bytes.Equal(canonical, []byte(original)) || !principalValid(p, now) || expires <= now || expires > p.ExpiresMS || expires-now > 30000 || ctx.Err() != nil {
		return Principal{}, ErrUnknown
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed || operation == "recheck" && (p != record.principal || profile != record.profile || expires > record.expires) {
		return Principal{}, ErrUnknown
	}
	if operation == "authenticate" {
		record.principal = p
		record.profile = profile
		record.expires = expires
	}
	return p, nil
}

func (o *OriginalDeveloperHTTPAuthority) CurrentExistingPrincipal(ctx context.Context, r *http.Request) (Principal, error) {
	if o == nil || ctx == nil || ctx.Err() != nil {
		return Principal{}, ErrDenied
	}
	in, e := captureOriginalHTTPRequest(r)
	if e != nil {
		return Principal{}, e
	}
	key := objectHash(in)
	o.mu.Lock()
	if o.closed {
		o.mu.Unlock()
		return Principal{}, ErrDenied
	}
	if _, exists := o.records[key]; exists {
		o.mu.Unlock()
		return Principal{}, ErrConflict
	}
	for k, v := range o.records {
		if v.phase == "verified" && v.expires <= time.Now().UnixMilli() {
			delete(o.records, k)
		}
	}
	if len(o.records) >= 32 {
		o.mu.Unlock()
		return Principal{}, ErrConflict
	}
	bounded, cancel := context.WithTimeout(ctx, 7*time.Second)
	record := &originalHTTPPrincipalRecord{input: in, phase: "selected", cancel: cancel}
	o.records[key] = record
	o.wg.Add(1)
	o.mu.Unlock()
	defer o.wg.Done()
	defer cancel()
	p, e := o.exchange(bounded, record, "authenticate")
	o.mu.Lock()
	defer o.mu.Unlock()
	if e != nil {
		record.phase = "unknown"
		record.cause = e
		return Principal{}, ErrUnknown
	}
	record.phase = "verified"
	return p, nil
}

func (o *OriginalDeveloperHTTPAuthority) AssertPrincipalCurrent(ctx context.Context, p Principal) error {
	if o == nil || ctx == nil || ctx.Err() != nil {
		return ErrDenied
	}
	o.mu.Lock()
	if o.closed {
		o.mu.Unlock()
		return ErrDenied
	}
	var record *originalHTTPPrincipalRecord
	for _, r := range o.records {
		if r.phase == "verified" && r.principal == p && r.expires > time.Now().UnixMilli() {
			record = r
			break
		}
	}
	if record == nil {
		o.mu.Unlock()
		return ErrDenied
	}
	record.phase = "rechecking"
	bounded, cancel := context.WithTimeout(ctx, 7*time.Second)
	record.cancel = cancel
	o.wg.Add(1)
	o.mu.Unlock()
	defer o.wg.Done()
	defer cancel()
	_, e := o.exchange(bounded, record, "recheck")
	o.mu.Lock()
	defer o.mu.Unlock()
	if e != nil {
		record.phase = "unknown"
		record.cause = e
		return ErrUnknown
	}
	record.phase = "verified"
	return nil
}

func (o *OriginalDeveloperHTTPAuthority) Close() error {
	if o == nil {
		return nil
	}
	o.closeOnce.Do(func() {
		o.mu.Lock()
		o.closed = true
		for _, r := range o.records {
			if r.phase != "verified" {
				o.closeResult = ErrUnknown
			}
			if r.cancel != nil {
				r.cancel()
			}
		}
		o.mu.Unlock()
		o.transport.CloseIdleConnections()
		o.wg.Wait()
	})
	return o.closeResult
}

// Actual Auth identity only. This does not implement project/control ACL,
// publisher registration, or any additional Source methods by default.
var _ interface {
	CurrentExistingPrincipal(context.Context, *http.Request) (Principal, error)
	AssertPrincipalCurrent(context.Context, Principal) error
} = (*OriginalDeveloperHTTPAuthority)(nil)
