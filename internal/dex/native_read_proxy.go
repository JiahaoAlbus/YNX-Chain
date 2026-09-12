package dex

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

const (
	nativeReadSource        = "authoritative chain-native YNX Testnet state"
	nativeSnapshotPath      = "/v1/native-snapshot"
	nativeTransactionPrefix = "/v1/native-transactions/"
	nativeReadTimeout       = 5 * time.Second
	nativeSnapshotMaxBytes  = 4 << 20
	nativeReceiptMaxBytes   = 1 << 20
	nativeReadConcurrency   = 16
)

var nativeReadHash = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
var nativeReadHostname = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$`)

// NativeReadProxy is a stateless, operator-pinned reader of the existing Core
// ledger. It does not use the EVM indexer's store, authenticate wallets, cache
// account results, or submit/retry any transaction. The Core v1 contract is the
// authority; valid response bytes are never decoded into floating-point values
// or re-encoded. Frontends retain their full ledger/coverage validation.
type NativeReadProxy struct {
	origin *url.URL
	client *http.Client
	slots  chan struct{}
}

// NewNativeReadProxy accepts an origin only (not an RPC path). An empty origin
// deliberately leaves the two native routes unavailable. HTTPS uses system
// trust; cleartext is allowed only to a literal loopback address. Credentials,
// URL paths, queries, fragments, environment HTTP proxies and redirects are not
// supported. Invalid configuration errors never echo the supplied URL.
func NewNativeReadProxy(origin string) (*NativeReadProxy, error) {
	p := &NativeReadProxy{slots: make(chan struct{}, nativeReadConcurrency)}
	if origin == "" {
		return p, nil
	}
	u, err := url.Parse(origin)
	invalid := errors.New("native Core URL must be a canonical HTTPS origin or literal-loopback HTTP origin without credentials, path, query or fragment")
	if err != nil || u.Opaque != "" || u.User != nil || u.Path != "" || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.ContainsAny(origin, "#?\\\r\n\t ") || u.Host == "" || u.String() != origin {
		return nil, invalid
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	if host != strings.ToLower(host) || (ip == nil && (!nativeReadHostname.MatchString(host) || strings.Contains(host, ".."))) || (u.Scheme != "https" && !(u.Scheme == "http" && ip != nil && ip.IsLoopback())) {
		return nil, invalid
	}
	// Reject ambiguous authority syntax, empty/noncanonical/out-of-range ports.
	if u.Port() != "" {
		port, err := strconv.Atoi(u.Port())
		if err != nil || port < 1 || port > 65535 || !regexp.MustCompile(`^[1-9][0-9]{0,4}$`).MatchString(u.Port()) {
			return nil, invalid
		}
	} else if strings.HasSuffix(u.Host, ":") {
		return nil, invalid
	}
	p.origin = u
	p.client = &http.Client{
		Timeout:       nativeReadTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Transport: &http.Transport{
			Proxy:                  nil,
			DialContext:            (&net.Dialer{Timeout: 2 * time.Second}).DialContext,
			TLSClientConfig:        &tls.Config{MinVersion: tls.VersionTLS12},
			TLSHandshakeTimeout:    2 * time.Second,
			ResponseHeaderTimeout:  3 * time.Second,
			MaxResponseHeaderBytes: 16 << 10,
			DisableCompression:     true,
			// A fresh connection also prevents net/http's implicit retry on a
			// failed reused connection. There is one upstream GET, never retry.
			DisableKeepAlives: true,
		},
	}
	return p, nil
}

// isNativeReadPath runs before ServeMux canonical redirects so encoded, nested,
// trailing-slash and traversal variants fail closed instead of navigating.
func isNativeReadPath(value string) bool {
	for _, candidate := range []string{value, path.Clean(value)} {
		if strings.HasPrefix(candidate, nativeSnapshotPath) || strings.HasPrefix(candidate, strings.TrimSuffix(nativeTransactionPrefix, "/")) {
			return true
		}
	}
	return false
}

func nativeReadFailure(w http.ResponseWriter, code int, reason string) {
	writeJSON(w, code, map[string]any{"status": "unknown", "code": reason, "scope": "native-core-read", "coverage": map[string]bool{"complete": false}})
}

func (p *NativeReadProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		nativeReadFailure(w, http.StatusMethodNotAllowed, "NATIVE_READ_GET_REQUIRED")
		return
	}
	// Nothing supplied by a client may select an origin, a secondary path, or
	// upstream headers. GET bodies are not consumed or forwarded.
	if r.URL.IsAbs() || r.URL.Opaque != "" || r.URL.RawPath != "" || r.URL.Fragment != "" || r.URL.ForceQuery || r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
		nativeReadFailure(w, 400, "INVALID_NATIVE_READ_REQUEST")
		return
	}
	account, hash := "", ""
	if r.URL.Path == nativeSnapshotPath {
		if r.URL.RawQuery != "" {
			if !strings.HasPrefix(r.URL.RawQuery, "account=") {
				nativeReadFailure(w, 400, "INVALID_NATIVE_ACCOUNT")
				return
			}
			input := strings.TrimPrefix(r.URL.RawQuery, "account=")
			var err error
			account, err = accountaddress.Normalize(input)
			alias, _ := accountaddress.Encode(account)
			if err != nil || (input != account && input != alias) || account == "" {
				nativeReadFailure(w, 400, "INVALID_NATIVE_ACCOUNT")
				return
			}
		}
	} else if strings.HasPrefix(r.URL.Path, nativeTransactionPrefix) {
		hash = strings.TrimPrefix(r.URL.Path, nativeTransactionPrefix)
		if !nativeReadHash.MatchString(hash) || r.URL.RawQuery != "" {
			nativeReadFailure(w, 400, "INVALID_NATIVE_TRANSACTION_HASH")
			return
		}
	} else {
		nativeReadFailure(w, 400, "INVALID_NATIVE_READ_PATH")
		return
	}
	if p == nil || p.origin == nil {
		nativeReadFailure(w, 503, "NATIVE_CORE_UNCONFIGURED")
		return
	}
	select {
	case p.slots <- struct{}{}:
		defer func() { <-p.slots }()
	default:
		nativeReadFailure(w, 503, "NATIVE_CORE_BUSY")
		return
	}
	upstream := *p.origin
	upstream.Path = r.URL.Path
	if account != "" {
		upstream.RawQuery = "account=" + account
	}
	ctx, cancel := context.WithTimeout(r.Context(), nativeReadTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, upstream.String(), nil)
	if err != nil {
		nativeReadFailure(w, 503, "NATIVE_CORE_UNAVAILABLE")
		return
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Accept-Encoding", "identity")
	request.Header.Set("User-Agent", "YNX-DEX-Native-Read/1")
	response, err := p.client.Do(request)
	if err != nil {
		nativeReadFailure(w, 503, "NATIVE_CORE_UNAVAILABLE")
		return
	}
	defer response.Body.Close()
	if response.StatusCode != 200 && !(hash != "" && response.StatusCode == 404) {
		// Never expose an upstream error body, headers, redirect, or credential.
		nativeReadFailure(w, 503, "NATIVE_CORE_UNAVAILABLE")
		return
	}
	media, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	maxBytes := int64(nativeSnapshotMaxBytes)
	if hash != "" {
		maxBytes = nativeReceiptMaxBytes
	}
	if err != nil || media != "application/json" || response.Header.Get("Content-Encoding") != "" || response.ContentLength > maxBytes {
		nativeReadFailure(w, 503, "NATIVE_CORE_INVALID_RESPONSE")
		return
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil || int64(len(body)) > maxBytes || !nativeReadEnvelope(body, response.StatusCode, account, hash) {
		nativeReadFailure(w, 503, "NATIVE_CORE_INVALID_RESPONSE")
		return
	}
	// All original decimal strings, local durability status/proof and explicit
	// not_found bytes survive verbatim. This route does not invent finality.
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(body)
}

// Check the network/subject envelope, not a second implementation of the Core
// ledger. Duplicate keys and trailing JSON are rejected to avoid contradictory
// identity interpretations. Nested objects remain raw bytes, not float64.
func nativeReadEnvelope(body []byte, status int, account, hash string) bool {
	if !utf8.Valid(body) {
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	if !nativeJSONValue(decoder, 0) {
		return false
	}
	if _, err := decoder.Token(); err != io.EOF {
		return false
	}
	var root map[string]json.RawMessage
	if json.Unmarshal(body, &root) != nil || root == nil {
		return false
	}
	str := func(key string) string { var v string; _ = json.Unmarshal(root[key], &v); return v }
	if hash != "" && status == 404 {
		return str("status") == "not_found" && str("transactionHash") == hash
	}
	if str("source") != nativeReadSource || str("integerEncoding") != "decimal-string" || string(root["consensusFinality"]) != "false" {
		return false
	}
	if hash != "" {
		if str("schemaVersion") != "ynx-native-finance-transaction-v1" {
			return false
		}
		switch str("status") {
		case "memory_only", "uncertain", "pending_durable", "durable":
		default:
			return false
		}
		var tx struct {
			Hash string `json:"hash"`
		}
		return json.Unmarshal(root["transaction"], &tx) == nil && tx.Hash == hash
	}
	if str("schemaVersion") != "ynx-native-finance-snapshot-v1" || str("chainId") != "6423" {
		return false
	}
	if account == "" {
		return string(root["account"]) == "null"
	}
	var subject struct {
		Address string `json:"address"`
	}
	return json.Unmarshal(root["account"], &subject) == nil && subject.Address == account
}

func nativeJSONValue(d *json.Decoder, depth int) bool {
	if depth > 64 {
		return false
	}
	token, err := d.Token()
	if err != nil {
		return false
	}
	delim, ok := token.(json.Delim)
	if !ok {
		return true
	}
	switch delim {
	case '{':
		seen := make(map[string]bool)
		for d.More() {
			t, err := d.Token()
			if err != nil {
				return false
			}
			key, ok := t.(string)
			if !ok || seen[key] {
				return false
			}
			seen[key] = true
			if !nativeJSONValue(d, depth+1) {
				return false
			}
		}
		end, err := d.Token()
		return err == nil && end == json.Delim('}')
	case '[':
		for d.More() {
			if !nativeJSONValue(d, depth+1) {
				return false
			}
		}
		end, err := d.Token()
		return err == nil && end == json.Delim(']')
	default:
		return false
	}
}
