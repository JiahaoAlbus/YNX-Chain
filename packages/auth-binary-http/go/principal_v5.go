package binaryhttpsource

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"
)

const originalPrincipalV5Endpoint = "https://wallet-auth.ynxweb4.com/v5/developer/original-http-principal"
const maxPrincipalV5RelayBytes = 92274688

var ErrOriginalBinaryV5AuthorityUnavailable = errNotSupplied

type OriginalDeviceExpectedV5 struct {
	NetworkID          string  `json:"networkId"`
	CanonicalOwner     string  `json:"canonicalOwner"`
	Account            string  `json:"account"`
	SessionBinding     string  `json:"sessionBinding"`
	ProductID          string  `json:"productId"`
	ClientID           string  `json:"clientId"`
	Platform           string  `json:"platform"`
	ApplicationID      string  `json:"applicationId"`
	BundleID           *string `json:"bundleId"`
	PackageID          *string `json:"packageId"`
	Origin             string  `json:"origin"`
	Callback           string  `json:"callback"`
	DeviceID           string  `json:"deviceId"`
	Generation         string  `json:"generation"`
	RegistrationID     string  `json:"registrationId"`
	Revision           string  `json:"revision"`
	RegistrationDigest string  `json:"registrationDigest"`
}
type BinaryPrincipalDATAV5 struct {
	Account, DeviceID, SessionRef, CurrentRef string
	AccountGeneration, SessionGeneration      uint64
	ExpiresMS                                 int64
}
type binaryRootReleaseV5 struct {
	SPKI, ProfileDigest, CaptureDirectory string
	Expected                              OriginalDeviceExpectedV5
}

// Independently admitted Root selections only; no setter/ENV/caller config.
func binaryRootReleasesV5() []binaryRootReleaseV5 { return []binaryRootReleaseV5{} }

func selectedBinaryRootV5() (binaryRootReleaseV5, error) {
	entries := binaryRootReleasesV5()
	if len(entries) != 1 {
		return binaryRootReleaseV5{}, errNotSupplied
	}
	r := entries[0]
	if len(r.SPKI) != 64 || len(r.ProfileDigest) != 64 || r.Expected.ProductID != "developer" || r.Expected.Account == "" || r.Expected.SessionBinding == "" {
		return r, errNotSupplied
	}
	return r, nil
}
func OpenOriginalBinaryV5Store() (*Store, error) {
	r, e := selectedBinaryRootV5()
	if e != nil {
		return nil, e
	}
	return OpenStore(r.CaptureDirectory)
}

type originalBinaryPrincipalV5 struct {
	floor                          int64
	mu                             sync.Mutex
	client                         *http.Client
	transport                      *http.Transport
	endpoint                       string
	release                        binaryRootReleaseV5
	capture                        *Capture
	request                        *http.Request
	body                           []byte
	binding                        BodyBindingDATA
	digest, contentType, requestID string
	principal                      BinaryPrincipalDATAV5
	profile                        string
	raw, current                   []byte
	publicPartials                 [][]byte
	expires                        int64
	started                        time.Time
	first, closeResult             error
	closed                         bool
	loans                          map[*PrincipalBorrowV5]bool
}

func (*originalBinaryPrincipalV5) String() string {
	return "OriginalBinaryPrincipalV5{opaque Root custody redacted}"
}
func newOriginalBinaryPrincipalV5(release binaryRootReleaseV5) *originalBinaryPrincipalV5 {
	t := &http.Transport{Proxy: nil, DisableKeepAlives: true, TLSHandshakeTimeout: 2 * time.Second, ResponseHeaderTimeout: 6 * time.Second, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, ServerName: "wallet-auth.ynxweb4.com", VerifyConnection: func(s tls.ConnectionState) error {
		if len(s.PeerCertificates) == 0 || len(s.VerifiedChains) == 0 {
			return errRequest
		}
		sum := sha256.Sum256(s.PeerCertificates[0].RawSubjectPublicKeyInfo)
		if hex.EncodeToString(sum[:]) != release.SPKI {
			return errRequest
		}
		return nil
	}}}
	return &originalBinaryPrincipalV5{transport: t, client: &http.Client{Transport: t, Timeout: 7 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, endpoint: originalPrincipalV5Endpoint, release: release, started: time.Now(), loans: map[*PrincipalBorrowV5]bool{}}
}
func strictV5JSON(raw []byte, keys map[string]any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	t, e := d.Token()
	if e != nil || t != json.Delim('{') {
		return errRequest
	}
	seen := map[string]bool{}
	for d.More() {
		t, e = d.Token()
		k, ok := t.(string)
		v, found := keys[k]
		if e != nil || !ok || !found || seen[k] {
			return errRequest
		}
		seen[k] = true
		if d.Decode(v) != nil {
			return errRequest
		}
	}
	t, e = d.Token()
	if e != nil || t != json.Delim('}') || len(seen) != len(keys) {
		return errRequest
	}
	if _, e = d.Token(); e != io.EOF {
		return errRequest
	}
	return nil
}
func shaV5(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func (o *originalBinaryPrincipalV5) exchange(ctx context.Context, operation string) error {
	if ctx == nil || ctx.Err() != nil || o.closed || o.first != nil {
		return errClosed
	}
	if len(o.publicPartials) >= 64 {
		return errUnknown
	}
	wire, e := canonicalV5Transport(map[string]any{"version": "5", "operation": operation, "requestId": o.requestID, "method": "POST", "path": OriginalBinaryHTTPPath, "bodyOriginal": base64.RawURLEncoding.EncodeToString(o.body), "contentType": o.contentType, "proofHeader": o.capture.snapshot.ProofHeader, "expected": o.release.Expected})
	if e != nil || len(wire) > maxPrincipalV5RelayBytes {
		return errLimit
	}
	req, e := http.NewRequestWithContext(ctx, "POST", o.endpoint, bytes.NewReader(wire))
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/json")
	res, e := o.client.Do(req)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	raw, e := io.ReadAll(io.LimitReader(res.Body, 1048577))
	o.raw = bytes.Clone(raw)
	o.publicPartials = append(o.publicPartials, bytes.Clone(raw)) // retain each original before interpreting a late error
	if e != nil || res.StatusCode != 200 || len(raw) > 1048576 || res.Header.Get("Content-Type") != "application/json" {
		return errUnknown
	}
	var version, original, digest, profile, current, method, path, bodyDigest, contentType string
	var binding BodyBindingDATA
	var bindingRaw json.RawMessage
	var expires int64
	var data, authorized, native bool
	if strictV5JSON(raw, map[string]any{"version": &version, "principalOriginal": &original, "principalSHA256": &digest, "profileDigest": &profile, "currentRaw": &current, "method": &method, "path": &path, "bodyDigest": &bodyDigest, "contentType": &contentType, "bodyBinding": &bindingRaw, "expiresAtMs": &expires, "dataOnly": &data, "authorized": &authorized, "nativeAdmission": &native}) != nil || strictV5JSON(bindingRaw, map[string]any{"bytes": &binding.Bytes, "sha3_512": &binding.SHA3_512, "sha512": &binding.SHA512}) != nil || version != "YNX-ORIGINAL-DEVELOPER-HTTP-PRINCIPAL/v5" || !data || authorized || native || shaV5([]byte(original)) != digest || profile != o.release.ProfileDigest || len(current) == 0 || len(current) > 393216 || method != "POST" || path != OriginalBinaryHTTPPath || bodyDigest != o.digest || contentType != o.contentType || binding != o.binding {
		return errUnknown
	}
	var p BinaryPrincipalDATAV5
	if strictV5JSON([]byte(original), map[string]any{"Account": &p.Account, "DeviceID": &p.DeviceID, "SessionRef": &p.SessionRef, "CurrentRef": &p.CurrentRef, "AccountGeneration": &p.AccountGeneration, "SessionGeneration": &p.SessionGeneration, "ExpiresMS": &p.ExpiresMS}) != nil {
		return errUnknown
	}
	inner, e := json.Marshal(p)
	now := time.Now().UnixMilli()
	if now < o.floor {
		return errChanged
	}
	o.floor = now
	if e != nil || !bytes.Equal(inner, []byte(original)) || p.Account != o.release.Expected.Account || p.DeviceID != o.release.Expected.DeviceID || p.SessionRef != o.release.Expected.SessionBinding || p.CurrentRef == "" || p.AccountGeneration == 0 || p.SessionGeneration == 0 || p.ExpiresMS <= now || expires <= now || expires > p.ExpiresMS || expires-now > 30000 || ctx.Err() != nil {
		return errUnknown
	}
	if operation == "recheck" && (p != o.principal || profile != o.profile || expires > o.expires) {
		return errUnknown
	}
	o.principal = p
	o.profile = profile
	o.current = []byte(current)
	o.expires = expires
	return nil
}

// Public transport evidence only, including malformed/late replies. This
// cannot restore a credential, Principal, grant, current owner or Root selection.
func (c *Capture) OriginalPrincipalPartialsV5DATA() [][]byte {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.self != c || c.verified == nil || c.verified.original == nil {
		return nil
	}
	o := c.verified.original
	o.mu.Lock()
	defer o.mu.Unlock()
	out := make([][]byte, len(o.publicPartials))
	for i, b := range o.publicPartials {
		out[i] = bytes.Clone(b)
	}
	return out
}
func verifyOriginalSDKBinaryBodyAndPSPrincipal(ctx context.Context, r *http.Request, c *Capture) (*verifiedBinaryPrincipal, error) {
	release, e := selectedBinaryRootV5()
	if e != nil {
		return nil, e
	}
	owner := newOriginalBinaryPrincipalV5(release)
	return verifyWithOriginalBinaryV5Owner(ctx, r, c, owner)
}
func verifyWithOriginalBinaryV5Owner(ctx context.Context, r *http.Request, c *Capture, owner *originalBinaryPrincipalV5) (*verifiedBinaryPrincipal, error) {
	verified := &verifiedBinaryPrincipal{original: owner}
	owner.capture = c
	owner.request = r
	c.mu.Lock()
	if e := c.checkOriginalLocked(r); e != nil {
		c.mu.Unlock()
		return verified, e
	}
	owner.body = make([]byte, c.size)
	n, e := io.ReadFull(io.NewSectionReader(c.body.file, 0, c.size), owner.body)
	owner.binding = BodyBindingDATA{strconv.FormatInt(c.size, 10), hex.EncodeToString(c.sha3Digest[:]), hex.EncodeToString(c.sha512Digest[:])}
	owner.digest = hex.EncodeToString(c.digest[:])
	owner.contentType = c.snapshot.ContentType
	owner.requestID = c.snapshot.RequestID
	if e == nil && int64(n) != c.size {
		e = errChanged
	}
	if e == nil {
		e = c.checkOriginalLocked(r)
	}
	c.mu.Unlock()
	if e != nil {
		return verified, e
	}
	owner.mu.Lock()
	e = owner.exchange(ctx, "authenticate")
	if e != nil {
		owner.first = e
	}
	owner.mu.Unlock()
	if e != nil {
		return verified, e
	}
	c.mu.Lock()
	e = c.checkOriginalLocked(r)
	c.mu.Unlock()
	if e != nil {
		return verified, e
	}
	return verified, nil
}
func (o *originalBinaryPrincipalV5) assertOriginalBinaryRequestCurrent(ctx context.Context, r *http.Request, c *Capture) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	now := time.Now().UnixMilli()
	if now < o.floor {
		return errChanged
	}
	o.floor = now
	if o.capture != c || o.request != r || o.closed || o.first != nil || ctx == nil || ctx.Err() != nil || o.expires <= now || time.Since(o.started) >= time.Duration(o.expires-o.started.UnixMilli())*time.Millisecond {
		return errChanged
	}
	return nil
}
func (o *originalBinaryPrincipalV5) revalidate(ctx context.Context, r *http.Request, c *Capture) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.capture != c || o.request != r || o.closed || o.first != nil {
		return errClosed
	}
	if e := o.exchange(ctx, "recheck"); e != nil {
		o.first = e
		return e
	}
	return nil
}
func (o *originalBinaryPrincipalV5) closeOriginalBinaryRequestOnce() (bool, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.closed {
		o.closed = true
		clear(o.body)
		o.body = nil
		o.transport.CloseIdleConnections()
		o.closeResult = o.first
	}
	return true, o.closeResult
}
func (o *originalBinaryPrincipalV5) drainOriginalBinaryRequestPartial() (bool, error) {
	return o.closeOriginalBinaryRequestOnce()
}

type PrincipalBorrowV5 struct {
	owner   *originalBinaryPrincipalV5
	capture *Capture
	request *http.Request
	closed  bool
}

func (*PrincipalBorrowV5) String() string {
	return "OriginalBinaryPrincipalBorrowV5{opaque current identity}"
}
func (c *Capture) BorrowOriginalPrincipalV5(ctx context.Context, r *http.Request) (*PrincipalBorrowV5, error) {
	if c == nil {
		return nil, errRequest
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.verified == nil || c.verified.original == nil {
		return nil, errNotSupplied
	}
	if e := c.checkOriginalLocked(r); e != nil {
		return nil, c.fail(e)
	}
	o := c.verified.original
	if e := o.revalidate(ctx, r, c); e != nil {
		return nil, c.fail(e)
	}
	p := &PrincipalBorrowV5{owner: o, capture: c, request: r}
	o.mu.Lock()
	o.loans[p] = true
	o.mu.Unlock()
	if e := c.checkOriginalLocked(r); e != nil {
		return p, c.fail(e)
	}
	return p, nil
}
func (p *PrincipalBorrowV5) AssertCurrent(ctx context.Context, r *http.Request) error {
	if p == nil || p.owner == nil || p.capture == nil {
		return errRequest
	}
	c := p.capture
	c.mu.Lock()
	defer c.mu.Unlock()
	o := p.owner
	o.mu.Lock()
	ok := o.loans[p] && !p.closed && p.request == r
	o.mu.Unlock()
	if !ok {
		return errChanged
	}
	if e := c.checkOriginalLocked(r); e != nil {
		return c.fail(e)
	}
	if e := o.revalidate(ctx, r, c); e != nil {
		return c.fail(e)
	}
	if e := c.checkOriginalLocked(r); e != nil {
		return c.fail(e)
	}
	return o.assertOriginalBinaryRequestCurrent(ctx, r, c)
}

// Observation only; a DTO cannot be restored as a borrowed original.
func (p *PrincipalBorrowV5) ViewOriginalDATA() BinaryPrincipalDATAV5 {
	if p == nil || p.owner == nil {
		return BinaryPrincipalDATAV5{}
	}
	o := p.owner
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.loans[p] || p.closed || o.closed || o.first != nil || time.Now().UnixMilli() >= o.expires {
		return BinaryPrincipalDATAV5{}
	}
	return o.principal
}

// Same private Root TLS identity as the existing Source13 release selection.
// This checks a retained original, never accepts a caller Principal DTO.
func (p *PrincipalBorrowV5) AssertOriginalRootSPKI(spki string) error {
	if p == nil || p.owner == nil {
		return errRequest
	}
	o := p.owner
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.loans[p] || p.closed || o.closed || o.first != nil || o.release.SPKI != spki {
		return errChanged
	}
	return nil
}
func (p *PrincipalBorrowV5) Close() error {
	if p == nil || p.owner == nil {
		return errClosed
	}
	o := p.owner
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.loans[p] {
		return errChanged
	}
	p.closed = true
	return o.first
}
