// Package governanceview reads only the original public governance registry.
// Reported registry data is never native voting eligibility or chain finality.
package governanceview

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const ProjectionVersion = "YNX-NETWORK-GOVERNANCE-READ/v1"
const OriginalSource = "ynx-governance-authoritative-state"
const OriginalVersion = "ynx-governance-api/v1"
const MaxResponseBytes = 512 << 10
const MaxProposalBytes = 128 << 10
const MaxBodyBytes = 4 << 20
const ListLimit = 50

type Metadata struct {
	ProjectionVersion string  `json:"projectionVersion"`
	Code              string  `json:"code"`
	Classification    string  `json:"classification"`
	ReportKind        string  `json:"reportKind"`
	Authority         bool    `json:"authority"`
	WalletApproval    bool    `json:"walletApproval"`
	NativeEligibility bool    `json:"nativeEligibility"`
	ChainFinality     bool    `json:"chainFinality"`
	Source            *string `json:"source"`
	Version           *string `json:"version"`
	AsOf              *string `json:"asOf"`
	ObservedAt        string  `json:"observedAt"`
	Endpoint          *string `json:"endpoint"`
	ResponseSHA256    *string `json:"responseSHA256"`
	NumericEncoding   string  `json:"numericEncoding"`
}
type List struct {
	Metadata
	Proposals     []json.RawMessage `json:"proposals"`
	ReportedCount *string           `json:"reportedCount"`
	ReturnedCount string            `json:"returnedCount"`
	Limit         string            `json:"limit"`
	Truncated     bool              `json:"truncated"`
}
type Detail struct {
	Metadata
	Proposal json.RawMessage `json:"proposal"`
}

type Reader struct {
	base   string
	client *http.Client
	slots  chan struct{}
}

// New is trusted host configuration, never a browser-selected URL. It permits
// only canonical HTTPS bases or explicit numeric loopback HTTP test sources.
// The reader has no initializer, account, write, signer, discovery or fallback.
func New(source string, client *http.Client) (*Reader, error) {
	u, err := url.Parse(source)
	if err != nil || len(source)+len("/governance/proposals/")+64 > 2048 || u.Host == "" || u.Opaque != "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawPath != "" || strings.Contains(u.Path, "\\") || strings.Contains(u.Path, "//") || u.Path != "" && u.Path != "/" && path.Clean(u.Path) != strings.TrimSuffix(u.Path, "/") {
		return nil, errors.New("fixed canonical governance source required")
	}
	if u.Scheme != "https" {
		ip := net.ParseIP(u.Hostname())
		if u.Scheme != "http" || ip == nil || !ip.IsLoopback() {
			return nil, errors.New("governance source requires HTTPS or numeric loopback HTTP")
		}
	}
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true, DisableCompression: true, MaxResponseHeaderBytes: 8192, MaxConnsPerHost: 2, TLSHandshakeTimeout: 3 * time.Second, ResponseHeaderTimeout: 5 * time.Second, DialContext: (&net.Dialer{Timeout: 3 * time.Second}).DialContext}
	c := http.Client{Transport: transport, Timeout: 8 * time.Second}
	if client != nil {
		c = *client
	}
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	c.Jar = nil
	if c.Timeout == 0 || c.Timeout > 8*time.Second {
		c.Timeout = 8 * time.Second
	}
	return &Reader{base: strings.TrimRight(u.String(), "/"), client: &c, slots: make(chan struct{}, 2)}, nil
}

func metadata(endpoint *string, code string) Metadata {
	return Metadata{ProjectionVersion: ProjectionVersion, Code: code, Classification: "RPC_ONLY", ReportKind: "governance-registry", ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Endpoint: endpoint, NumericEncoding: "decimal-strings"}
}
func emptyList(m Metadata) List {
	return List{Metadata: m, Proposals: []json.RawMessage{}, ReturnedCount: "0", Limit: "50"}
}

// ListProposals preserves original order and records any truncation. It never
// drops an invalid item and calls the remaining list an authoritative success.
func (r *Reader) ListProposals(ctx context.Context) List {
	if r == nil {
		return emptyList(metadata(nil, "NOT_CONFIGURED"))
	}
	ctx, release, ok := r.begin(ctx)
	if !ok {
		endpoint := r.base + "/governance/proposals"
		return emptyList(metadata(&endpoint, "UNAVAILABLE"))
	}
	defer release()
	doc, m := r.read(ctx, "/governance/proposals", false)
	out := emptyList(m)
	if m.Code != "REPORTED" {
		return out
	}
	data, ok := doc.(map[string]any)
	if !ok || len(data) != 2 {
		out.Metadata = metadata(m.Endpoint, "INVALID_RESPONSE")
		return out
	}
	items, ok := data["proposals"].([]any)
	if !ok || !validStateMachine(data["stateMachine"]) {
		out.Metadata = metadata(m.Endpoint, "INVALID_RESPONSE")
		return out
	}
	seen := make(map[string]bool)
	for i, item := range items {
		projected, id, err := projectProposal(item, "")
		if err != nil || seen[id] {
			return emptyList(metadata(m.Endpoint, "INVALID_RESPONSE"))
		}
		seen[id] = true
		if i < ListLimit && !out.Truncated {
			out.Proposals = append(out.Proposals, projected)
			count := strconv.Itoa(len(items))
			out.ReportedCount = &count
			out.ReturnedCount = strconv.Itoa(len(out.Proposals))
			out.Truncated = len(out.Proposals) < len(items)
			raw, err := json.Marshal(out)
			if err != nil || len(raw) > MaxResponseBytes {
				out.Proposals = out.Proposals[:len(out.Proposals)-1]
				out.ReturnedCount = strconv.Itoa(len(out.Proposals))
				out.Truncated = true
			} else {
				out.Truncated = false
			}
		}
	}
	count := strconv.Itoa(len(items))
	out.ReportedCount = &count
	out.Truncated = len(out.Proposals) < len(items)
	if len(items) == 0 {
		out.Code = "EMPTY"
	} else if len(out.Proposals) == 0 {
		return emptyList(metadata(m.Endpoint, "INVALID_RESPONSE"))
	}
	if ctx.Err() != nil {
		return emptyList(metadata(m.Endpoint, "UNAVAILABLE"))
	}
	return out
}

func (r *Reader) Proposal(ctx context.Context, id string) Detail {
	if !ValidID(id) {
		return Detail{Metadata: metadata(nil, "INVALID_RESPONSE")}
	}
	if r == nil {
		return Detail{Metadata: metadata(nil, "NOT_CONFIGURED")}
	}
	ctx, release, ok := r.begin(ctx)
	if !ok {
		endpoint := r.base + "/governance/proposals/" + id
		return Detail{Metadata: metadata(&endpoint, "UNAVAILABLE")}
	}
	defer release()
	doc, m := r.read(ctx, "/governance/proposals/"+id, true)
	out := Detail{Metadata: m}
	if m.Code != "REPORTED" {
		return out
	}
	projected, _, err := projectProposal(doc, id)
	if err != nil {
		return Detail{Metadata: metadata(m.Endpoint, "INVALID_RESPONSE")}
	}
	out.Proposal = projected
	if raw, err := json.Marshal(out); err != nil || len(raw) > MaxResponseBytes {
		return Detail{Metadata: metadata(m.Endpoint, "INVALID_RESPONSE")}
	}
	if ctx.Err() != nil {
		return Detail{Metadata: metadata(m.Endpoint, "UNAVAILABLE")}
	}
	return out
}

func (r *Reader) begin(ctx context.Context) (context.Context, func(), bool) {
	if ctx == nil {
		return nil, nil, false
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	select {
	case r.slots <- struct{}{}:
		return ctx, func() { <-r.slots; cancel() }, true
	case <-ctx.Done():
		cancel()
		return nil, nil, false
	}
}

func (r *Reader) read(ctx context.Context, route string, detail bool) (any, Metadata) {
	endpoint := r.base + route
	fail := func(code string) (any, Metadata) { return nil, metadata(&endpoint, code) }
	if ctx == nil {
		return fail("UNAVAILABLE")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fail("UNAVAILABLE")
	}
	request.Header.Set("Accept", "application/json")
	response, err := r.client.Do(request)
	if err != nil {
		return fail("UNAVAILABLE")
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, MaxBodyBytes+1))
	if err != nil {
		return fail("UNAVAILABLE")
	}
	if len(raw) > MaxBodyBytes {
		return fail("INVALID_RESPONSE")
	}
	if ctx.Err() != nil {
		return fail("UNAVAILABLE")
	}
	unsupported := response.StatusCode == 404 || response.StatusCode == 405 || response.StatusCode == 501
	if response.StatusCode != 200 && !unsupported {
		return fail("UNAVAILABLE")
	}
	if !utf8.Valid(raw) || response.Header.Get("Content-Encoding") != "" {
		if unsupported {
			return fail("UNSUPPORTED")
		}
		return fail("INVALID_RESPONSE")
	}
	doc, err := decodeDocument(raw)
	if err != nil {
		if unsupported {
			return fail("UNSUPPORTED")
		}
		return fail("INVALID_RESPONSE")
	}
	envelope, ok := doc.(map[string]any)
	if !ok || len(envelope) != 4 || envelope["source"] != OriginalSource || envelope["version"] != OriginalVersion {
		if unsupported {
			return fail("UNSUPPORTED")
		}
		return fail("INVALID_RESPONSE")
	}
	asOf, ok := envelope["asOf"].(string)
	parsed, timeErr := time.Parse(time.RFC3339Nano, asOf)
	if !ok || len(asOf) > 40 || timeErr != nil || parsed.IsZero() {
		if unsupported {
			return fail("UNSUPPORTED")
		}
		return fail("INVALID_RESPONSE")
	}
	data, ok := envelope["data"]
	if !ok || data == nil {
		return fail("INVALID_RESPONSE")
	}
	if unsupported {
		if detail && response.StatusCode == 404 && originalNotFound(data) {
			return fail("NOT_FOUND")
		}
		return fail("UNSUPPORTED")
	}
	source, version := OriginalSource, OriginalVersion
	sum := sha256.Sum256(raw)
	digest := hex.EncodeToString(sum[:])
	m := metadata(&endpoint, "REPORTED")
	m.Source, m.Version, m.AsOf, m.ResponseSHA256 = &source, &version, &asOf, &digest
	return data, m
}

func originalNotFound(data any) bool {
	object, ok := data.(map[string]any)
	if !ok || len(object) != 3 || object["status"] != "failed" {
		return false
	}
	message, ok := object["error"].(string)
	if !ok || message == "" || len(message) > 4096 {
		return false
	}
	id, ok := object["errorId"].(string)
	return ok && len(id) > 0 && len(id) <= 128
}

func ValidID(id string) bool {
	if len(id) != 64 {
		return false
	}
	decoded, err := hex.DecodeString(id)
	return err == nil && hex.EncodeToString(decoded) == id
}
