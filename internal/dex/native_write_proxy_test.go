package dex

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

// Public synthetic key 1 fixture verified by the exact bundled Wallet SDK's
// parseSignedApplicationAction. No user key, wallet, live Core or transaction.
// Deadline 1 is intentional: transport must preserve a possible old hash replay.
const nativeSignedGolden = `{"version":1,"chainId":6423,"type":"application_action","signer":"0x7e5f4552091a69125d5dfcb7b8c2659029395bdf","nonce":1,"action":"dex_swap_exact_input","payload":{"poolId":"dex_test_pool","assetIn":"YNXT","amountIn":10,"minAmountOut":1,"deadlineUnix":1},"payloadHash":"0b36e855418deb45d86781db930e6a16cbcc44f3dc38a316a14ca3c75648acc2","fee":1,"aiUnits":0,"payUnits":0,"publicKey":"0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798","signature":"304402203a6016f8d6bc14a8363e30c1cbecf353194ad678f3a3469849a94a2241c0d36202201a7ed2662a93535c6238c552e7f7692a796f0a412ac2eee53ddaa5b9d240191e"}`
const nativeSignedGoldenHash = "0x175e08b62ae406f8d5931442ef3f1074b05bcbdb553d967d3941abf226efa1b7"

// Public synthetic key 2, also independently checked by the same official SDK.
const nativeSignedSecondUser = `{"version":1,"chainId":6423,"type":"application_action","signer":"0x2b5ad5c4795c026514f8317c7a215e218dccd6cf","nonce":1,"action":"dex_swap_exact_input","payload":{"poolId":"dex_test_pool","assetIn":"YNXT","amountIn":20,"minAmountOut":1,"deadlineUnix":1},"payloadHash":"a0ba7b9ace8d7b5357dfa31dc8c40b89686353dbc1a6cb038e0c3865220e4eff","fee":1,"aiUnits":0,"payUnits":0,"publicKey":"02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5","signature":"3044022065c936c2d22ed9b9d95ec5a611f2784ca24e6b8448c519ad1d352496579e62d6022028692531fcd9b6da2a59cccdef24361e5a3a7fbf8658bc92d892984ccb6e31d6"}`

func writeHash(raw []byte) string {
	sum := sha256.Sum256(raw)
	return "0x" + hex.EncodeToString(sum[:])
}
func nativeWriteTo(t *testing.T, origin string) *NativeWriteProxy {
	t.Helper()
	p, err := NewNativeWriteProxy(proxyTo(t, origin), true)
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func writeRequest(raw []byte) *http.Request {
	r := httptest.NewRequest(http.MethodPost, nativeSubmitPath, bytes.NewReader(raw))
	r.Header.Set("Origin", nativeWriteOrigin)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-YNX-Transaction-Hash", writeHash(raw))
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	return r
}
func submitFixture(p http.Handler, r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	p.ServeHTTP(w, r)
	return w
}
func ackFixture(t *testing.T, raw []byte, replay bool) []byte {
	t.Helper()
	i, ok := parseNativeWriteIntent(raw)
	if !ok {
		t.Fatal("invalid fixture format")
	}
	pool := ""
	if !replay {
		pool = fmt.Sprintf(`,"pool":{"id":%q,"transactionHash":%q,"reserve0":9223372036854775807}`, i.pool, i.hash)
	}
	return []byte(fmt.Sprintf(`{ "source":%q,"mainnet":false,"replayed":%t,"transaction":{"hash":%q,"type":%q,"from":%q,"to":%q,"nonce":%d,"fee":1},"result":{"event":{"transactionHash":%q,"type":%q,"signer":%q,"poolId":%q}%s} }`, nativeReadSource, replay, i.hash, i.envelope.Action, i.envelope.Signer, i.pool, i.envelope.Nonce, i.hash, i.envelope.Action, i.envelope.Signer, i.pool, pool))
}

func TestNativeWriteExactSDKGoldenBytesAndCredentialIsolation(t *testing.T) {
	raw := []byte(nativeSignedGolden)
	if writeHash(raw) != nativeSignedGoldenHash {
		t.Fatal("SDK golden drift")
	}
	want := ackFixture(t, raw, false)
	var calls atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		got, _ := io.ReadAll(r.Body)
		if r.Method != "POST" || r.URL.String() != "/dex/pools/dex_test_pool/swaps/exact-input" || !bytes.Equal(got, raw) {
			t.Error("not exact fixed-path raw POST")
		}
		for k := range r.Header {
			if k != "Content-Type" && k != "Accept" && k != "Accept-Encoding" && k != "User-Agent" && k != "Content-Length" && k != "Connection" {
				t.Errorf("forwarded credential/header %s", k)
			}
		}
		if r.Header.Get("Content-Type") != "application/json" || r.Header.Get("Accept-Encoding") != "identity" {
			t.Error("wrong bounded encoding")
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Set-Cookie", "private=do-not-forward")
		w.Header().Set("Location", "https://attacker.invalid")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		_, _ = w.Write(want)
	}))
	defer core.Close()
	r := writeRequest(raw)
	r.Header.Set("Authorization", "Bearer secret")
	r.Header.Set("Cookie", "session=secret")
	r.Header.Set("X-Forwarded-Host", "attacker.invalid")
	r.Header.Set("Idempotency-Key", "must-not-forward")
	w := submitFixture(nativeWriteTo(t, core.URL), r)
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), want) || calls.Load() != 1 {
		t.Fatalf("ACK mismatch %d %s", w.Code, w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Set-Cookie") != "" || w.Header().Get("Location") != "" || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("unsafe reply headers")
	}
}

// Mutated envelopes below test transport format and routing only; the mock
// Core is not a cryptographic verifier or evidence that a signature is valid.
func nativeWriteActionFixture(t *testing.T, action string) []byte {
	t.Helper()
	var e nativeWriteEnvelope
	_ = json.Unmarshal([]byte(nativeSignedGolden), &e)
	e.Action = action
	values := map[string]string{
		"dex_swap_exact_input":  `{"poolId":"dex_test_pool","assetIn":"YNXT","amountIn":10,"minAmountOut":1,"deadlineUnix":1}`,
		"dex_swap_exact_output": `{"poolId":"dex_test_pool","assetOut":"ynx-test","amountOut":10,"maxAmountIn":20,"deadlineUnix":1}`,
		"dex_liquidity_add":     `{"poolId":"dex_test_pool","amount0":10,"amount1":20,"minShares":1,"deadlineUnix":1}`,
		"dex_liquidity_remove":  `{"poolId":"dex_test_pool","shares":10,"minAmount0":0,"minAmount1":0,"deadlineUnix":1}`,
	}
	e.Payload = json.RawMessage(values[action])
	sum := sha256.Sum256(e.Payload)
	e.PayloadHash = hex.EncodeToString(sum[:])
	raw, err := json.Marshal(e)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestNativeWriteFourRoutesReplayAndProxyRestart(t *testing.T) {
	for action, suffix := range map[string]string{"dex_swap_exact_input": "swaps/exact-input", "dex_swap_exact_output": "swaps/exact-output", "dex_liquidity_add": "liquidity/add", "dex_liquidity_remove": "liquidity/remove"} {
		t.Run(action, func(t *testing.T) {
			raw := nativeWriteActionFixture(t, action)
			var calls atomic.Int32
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				n := calls.Add(1)
				got, _ := io.ReadAll(r.Body)
				if !bytes.Equal(got, raw) || r.URL.Path != "/dex/pools/dex_test_pool/"+suffix {
					t.Error("route/body drift")
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write(ackFixture(t, raw, n > 1))
			}))
			defer core.Close()
			for attempt := 0; attempt < 2; attempt++ {
				p := nativeWriteTo(t, core.URL)
				w := submitFixture(p, writeRequest(raw))
				want := ackFixture(t, raw, attempt > 0)
				if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), want) {
					t.Fatalf("replay without pool incorrectly failed %d %s", w.Code, w.Body.String())
				}
			}
			if calls.Load() != 2 {
				t.Fatal("proxy admission cache or implicit retry")
			}
		})
	}
}

func TestNativeWriteDefaultsOriginsAndInvalidPathsNeverReachCore(t *testing.T) {
	var calls atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer core.Close()
	p := nativeWriteTo(t, core.URL)
	disabled, _ := NewNativeWriteProxy(proxyTo(t, core.URL), false)
	for _, handler := range []*NativeWriteProxy{nil, disabled} {
		w := submitFixture(handler, writeRequest([]byte(nativeSignedGolden)))
		if w.Code != 503 || !strings.Contains(w.Body.String(), "NATIVE_WRITES_DISABLED") {
			t.Fatal("not disabled by default")
		}
	}
	if _, err := NewNativeWriteProxy(nil, true); err == nil {
		t.Fatal("enabled without Core")
	}
	for _, origin := range []string{"", "null", "http://dex.ynxweb4.com", "https://dex.ynxweb4.com/", "https://dex.ynxweb4.com.evil.test", "https://quant.ynxweb4.com", "https://dex.ynxweb4.com https://attacker.invalid"} {
		r := writeRequest([]byte(nativeSignedGolden))
		r.Header.Set("Origin", origin)
		if w := submitFixture(p, r); w.Code != 403 {
			t.Fatalf("origin accepted %q", origin)
		}
	}
	r := writeRequest([]byte(nativeSignedGolden))
	r.Header.Add("Origin", nativeWriteOrigin)
	if submitFixture(p, r).Code != 403 {
		t.Fatal("duplicate Origin")
	}
	for _, site := range []string{"cross-site", "same-site", "none"} {
		r := writeRequest([]byte(nativeSignedGolden))
		r.Header.Set("Sec-Fetch-Site", site)
		if submitFixture(p, r).Code != 403 {
			t.Fatal("cross-site fetch accepted")
		}
	}
	for _, route := range []string{nativeSubmitPath + "?", nativeSubmitPath + "?endpoint=https://attacker.invalid", nativeSubmitPath + "/", nativeSubmitPath + "/hash", "//v1/native-transactions", "/v1/../v1/native-transactions", "https://attacker.invalid/v1/native-transactions", "/v1/native-%74ransactions"} {
		r := httptest.NewRequest("POST", route, strings.NewReader(nativeSignedGolden))
		r.Header = writeRequest(nil).Header
		if submitFixture(p, r).Code != 400 {
			t.Fatalf("path accepted %q", route)
		}
	}
	for _, method := range []string{"GET", "HEAD", "PUT", "DELETE", "OPTIONS"} {
		r := writeRequest([]byte(nativeSignedGolden))
		r.Method = method
		if submitFixture(p, r).Code != 405 {
			t.Fatalf("mutating method accepted %s", method)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("invalid request reached Core")
	}
}

func TestNativeWriteMalformedSignedBytesHashAndContentType(t *testing.T) {
	var calls atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer core.Close()
	p := nativeWriteTo(t, core.URL)
	for name, body := range map[string][]byte{
		"empty": nil, "trailing-newline": []byte(nativeSignedGolden + "\n"), "trailing-json": []byte(nativeSignedGolden + "{}"), "duplicate": []byte(strings.Replace(nativeSignedGolden, `"nonce":1`, `"nonce":1,"nonce":1`, 1)),
		"nested-duplicate": []byte(strings.Replace(nativeSignedGolden, `"amountIn":10`, `"amountIn":10,"amountIn":10`, 1)), "invalid-utf8": append([]byte{0xff}, []byte(nativeSignedGolden)...), "unknown": []byte(strings.Replace(nativeSignedGolden, `"version":1`, `"endpoint":"https://attacker.invalid","version":1`, 1)),
		"version": []byte(strings.Replace(nativeSignedGolden, `"version":1`, `"version":2`, 1)), "network": []byte(strings.Replace(nativeSignedGolden, `"chainId":6423`, `"chainId":1`, 1)), "nonce-rounded": []byte(strings.Replace(nativeSignedGolden, `"nonce":1`, `"nonce":9007199254740992`, 1)), "nonce-string": []byte(strings.Replace(nativeSignedGolden, `"nonce":1`, `"nonce":"1"`, 1)),
		"negative-zero": []byte(strings.Replace(nativeSignedGolden, `"aiUnits":0`, `"aiUnits":-0`, 1)), "noncanonical-number": []byte(strings.Replace(nativeSignedGolden, `"fee":1`, `"fee":1.0`, 1)), "trust-field": []byte(strings.Replace(nativeSignedGolden, `"payUnits":0`, `"payUnits":0,"trustUnits":0`, 1)),
		"unsupported-action": []byte(strings.Replace(nativeSignedGolden, "dex_swap_exact_input", "dex_asset_create", 1)), "pool-traversal": []byte(strings.Replace(nativeSignedGolden, "dex_test_pool", "dex_test_pool/../evil", 1)), "payload-hash": []byte(strings.Replace(nativeSignedGolden, `"amountIn":10`, `"amountIn":11`, 1)), "signature-empty": []byte(strings.Replace(nativeSignedGolden, `"signature":"3044`, `"signature":"`, 1)),
		"space": []byte(" " + nativeSignedGolden), "escaped-key": []byte(strings.Replace(nativeSignedGolden, `"nonce"`, `"no\u006ece"`, 1)), "too-deep": []byte(strings.Repeat("[", 66) + "0" + strings.Repeat("]", 66)),
	} {
		t.Run(name, func(t *testing.T) {
			w := submitFixture(p, writeRequest(body))
			if w.Code != 400 {
				t.Fatalf("invalid body got %d", w.Code)
			}
			if strings.Contains(w.Body.String(), "3044") || strings.Contains(w.Body.String(), "attacker") {
				t.Fatal("reflected signed payload")
			}
		})
	}
	for _, contentType := range []string{"", "text/plain", "application/json; charset=latin1", "application/json; boundary=x"} {
		r := writeRequest([]byte(nativeSignedGolden))
		r.Header.Set("Content-Type", contentType)
		if submitFixture(p, r).Code != 415 {
			t.Fatal("bad Content-Type")
		}
	}
	r := writeRequest([]byte(nativeSignedGolden))
	r.Header.Set("Content-Encoding", "gzip")
	if submitFixture(p, r).Code != 415 {
		t.Fatal("compressed request accepted")
	}
	for _, hash := range []string{"", nativeTestHash, strings.ToUpper(nativeSignedGoldenHash)} {
		r := writeRequest([]byte(nativeSignedGolden))
		r.Header.Set("X-YNX-Transaction-Hash", hash)
		if submitFixture(p, r).Code != 400 {
			t.Fatal("unbound hash accepted")
		}
	}
	r = writeRequest([]byte(nativeSignedGolden))
	r.Header.Add("X-YNX-Transaction-Hash", nativeSignedGoldenHash)
	if submitFixture(p, r).Code != 400 {
		t.Fatal("duplicate hash header")
	}
	for _, length := range []int64{nativeActionMaxBytes + 1, -1} {
		r := writeRequest(bytes.Repeat([]byte("x"), nativeActionMaxBytes+1))
		r.ContentLength = length
		if submitFixture(p, r).Code != 413 {
			t.Fatal("unbounded request body")
		}
	}
	if calls.Load() != 0 {
		t.Fatal("malformed signed input reached Core")
	}
}

func TestNativeWriteACKBindingErrorClassificationAndSanitization(t *testing.T) {
	raw := []byte(nativeSignedGolden)
	valid := ackFixture(t, raw, false)
	for _, tc := range []struct {
		name           string
		status         int
		mime, encoding string
		body           []byte
		want           int
		code           string
	}{
		{"wrong-hash", 200, "application/json", "", bytes.ReplaceAll(valid, []byte(nativeSignedGoldenHash), []byte(nativeTestHash)), 503, "NATIVE_CORE_INVALID_ACK"},
		{"wrong-signer", 200, "application/json", "", bytes.ReplaceAll(valid, []byte("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"), []byte(nativeTestAccount)), 503, "NATIVE_CORE_INVALID_ACK"},
		{"wrong-nonce", 200, "application/json", "", bytes.Replace(valid, []byte(`"nonce":1`), []byte(`"nonce":2`), 1), 503, "NATIVE_CORE_INVALID_ACK"},
		{"missing-pool-new", 200, "application/json", "", bytes.Replace(ackFixture(t, raw, true), []byte(`"replayed":true`), []byte(`"replayed":false`), 1), 503, "NATIVE_CORE_INVALID_ACK"},
		{"false-success", 200, "application/json", "", []byte(`{"success":true}`), 503, "NATIVE_CORE_INVALID_ACK"},
		{"duplicate-ack", 200, "application/json", "", bytes.Replace(valid, []byte(`"mainnet":false`), []byte(`"mainnet":true,"mainnet":false`), 1), 503, "NATIVE_CORE_INVALID_ACK"},
		{"html", 200, "text/html", "", []byte("secret upstream"), 503, "NATIVE_CORE_INVALID_ACK"},
		{"compressed", 200, "application/json", "gzip", valid, 503, "NATIVE_CORE_INVALID_ACK"},
		{"oversized", 200, "application/json", "", bytes.Repeat([]byte(" "), nativeReceiptMaxBytes+1), 503, "NATIVE_CORE_INVALID_ACK"},
		{"nonce", 409, "application/json", "", []byte(`{"error":"DEX action nonce must equal next nonce SECRET"}`), 409, "NATIVE_CORE_NONCE_OR_CONFLICT"},
		{"expired", 422, "application/json", "", []byte(`{"error":"invalid or expired DEX request SECRET"}`), 422, "NATIVE_CORE_ACTION_EXPIRED"},
		{"signature", 422, "application/json", "", []byte(`{"error":"signature verification failed SECRET"}`), 422, "NATIVE_CORE_ACTION_REJECTED"},
		{"decode", 400, "application/json", "", []byte(`{"error":"invalid canonical JSON SECRET"}`), 400, "NATIVE_CORE_ACTION_INVALID"},
		{"uncertain", 503, "application/json", "", []byte(fmt.Sprintf(`{"error":"SECRET","status":"transaction_durability_uncertain","transactionHash":%q}`, nativeSignedGoldenHash)), 503, "NATIVE_DURABILITY_UNCERTAIN"},
		{"uncertain-other-hash", 503, "application/json", "", []byte(fmt.Sprintf(`{"error":"SECRET","status":"transaction_durability_uncertain","transactionHash":%q}`, nativeTestHash)), 503, "NATIVE_CORE_ACK_UNKNOWN"},
		{"server-error", 500, "application/json", "", []byte(`{"error":"SECRET"}`), 503, "NATIVE_CORE_ACK_UNKNOWN"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", tc.mime)
				if tc.encoding != "" {
					w.Header().Set("Content-Encoding", tc.encoding)
				}
				w.Header().Set("Set-Cookie", "SECRET")
				w.WriteHeader(tc.status)
				_, _ = w.Write(tc.body)
			}))
			defer core.Close()
			w := submitFixture(nativeWriteTo(t, core.URL), writeRequest(raw))
			if w.Code != tc.want || !strings.Contains(w.Body.String(), tc.code) || strings.Contains(w.Body.String(), "SECRET") || w.Header().Get("Set-Cookie") != "" || calls.Load() != 1 {
				t.Fatalf("bad safe classification %d %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestNativeWriteLostACKRedirectAndCancellationNeverRetry(t *testing.T) {
	for _, kind := range []string{"lost-ack", "redirect", "timeout", "cancelled"} {
		t.Run(kind, func(t *testing.T) {
			var calls atomic.Int32
			entered := make(chan struct{})
			var once sync.Once
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				_, _ = io.Copy(io.Discard, r.Body)
				once.Do(func() { close(entered) })
				switch kind {
				case "lost-ack":
					c, _, _ := w.(http.Hijacker).Hijack()
					_ = c.Close()
				case "redirect":
					w.Header().Set("Location", "/second-write")
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(307)
					_, _ = w.Write([]byte(`{"error":"redirect"}`))
				default:
					select {
					case <-r.Context().Done():
					case <-time.After(time.Second):
						t.Error("fixture request cancellation not delivered")
					}
				}
			}))
			defer core.Close()
			p := nativeWriteTo(t, core.URL)
			p.core.client.Timeout = 40 * time.Millisecond
			r := writeRequest([]byte(nativeSignedGolden))
			ctx, cancel := context.WithCancel(r.Context())
			defer cancel()
			r = r.WithContext(ctx)
			if kind == "cancelled" {
				go func() { <-entered; cancel() }()
			}
			w := submitFixture(p, r)
			if w.Code != 503 || calls.Load() != 1 || !strings.Contains(w.Body.String(), nativeSignedGoldenHash) {
				t.Fatalf("lost ACK retried/promoted %d %s calls=%d", w.Code, w.Body.String(), calls.Load())
			}
		})
	}
}

func TestNativeWriteConcurrentUsersAndSlotRecovery(t *testing.T) {
	raw := []byte(nativeSignedGolden)
	var mu sync.Mutex
	seen := map[string]int{}
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		h := writeHash(body)
		mu.Lock()
		seen[h]++
		replayed := seen[h] > 1
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(ackFixture(t, body, replayed))
	}))
	defer core.Close()
	p := nativeWriteTo(t, core.URL)
	var wg sync.WaitGroup
	for i := 1; i <= 8; i++ {
		body := raw
		if i%2 == 0 {
			body = []byte(nativeSignedSecondUser)
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := submitFixture(p, writeRequest(body))
			if w.Code != 200 || !strings.Contains(w.Body.String(), writeHash(body)) {
				t.Errorf("concurrent intent mixed %d", w.Code)
			}
		}()
	}
	wg.Wait()
	if len(seen) != 2 {
		t.Fatal("two independently signed account intents coalesced")
	}
	for _, n := range seen {
		if n != 4 {
			t.Fatal("concurrent request retried or dropped")
		}
	}
	p.slots = make(chan struct{}, 1)
	p.slots <- struct{}{}
	w := submitFixture(p, writeRequest(raw))
	if w.Code != 503 || !strings.Contains(w.Body.String(), "NATIVE_CORE_BUSY") {
		t.Fatal("unbounded write concurrency")
	}
	<-p.slots
	if submitFixture(p, writeRequest(raw)).Code != 200 {
		t.Fatal("slots did not recover")
	}
}

func TestNativeWriteServerDispatchNoStoreMutation(t *testing.T) {
	storePath := filepath.Join(t.TempDir(), "state.json")
	store, err := OpenStore(storePath, testSecret)
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewServer(store, buildinfo.Info{}, strings.Repeat("a", 32), nil)
	if err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "POST" {
			_, _ = w.Write(ackFixture(t, []byte(nativeSignedGolden), false))
			return
		}
		w.WriteHeader(404)
		_, _ = fmt.Fprintf(w, `{"status":"not_found","transactionHash":%q}`, nativeSignedGoldenHash)
	}))
	defer core.Close()
	reads := proxyTo(t, core.URL)
	writes, _ := NewNativeWriteProxy(reads, true)
	handler := s.HandlerWithNativeCore(reads, writes)
	if submitFixture(handler, writeRequest([]byte(nativeSignedGolden))).Code != 200 {
		t.Fatal("not mounted")
	}
	w := submitFixture(handler, httptest.NewRequest("GET", nativeTransactionPrefix+nativeSignedGoldenHash, nil))
	if w.Code != 404 || !strings.Contains(w.Body.String(), "not_found") {
		t.Fatal("same-hash read unavailable")
	}
	if submitFixture(s.HandlerWithNativeReads(reads), writeRequest([]byte(nativeSignedGolden))).Code != 503 {
		t.Fatal("read-only constructor enables writes")
	}
	for _, path := range []string{"//v1/native-transactions", "/extra/../v1/native-transactions"} {
		r := writeRequest([]byte(nativeSignedGolden))
		r.URL.Path = path
		w := submitFixture(handler, r)
		if w.Code == 200 || w.Header().Get("Location") != "" {
			t.Fatal("ServeMux redirect/mutation")
		}
	}
	if calls.Load() != 2 {
		t.Fatal("extra write/read")
	}
	// No signed intent, account, nonce, or Core admission is persisted by gateway.
	if store.state.Sequence != 0 {
		t.Fatal("native transport touched indexer ledger")
	}
	if _, err := os.Stat(storePath); !os.IsNotExist(err) {
		t.Fatal("native transport created durable gateway state")
	}
}
