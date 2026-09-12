package dex

import (
	"bytes"
	"context"
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

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

const nativeTestAccount = "0x7a601ffa997cede6435aeabf4fa2091f09e149ec"
const nativeTestHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func snapshotBytes(t *testing.T, account string) []byte {
	t.Helper()
	body, err := os.ReadFile("../../apps/dex/src/fixtures/finance-snapshot-fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	if account == nativeTestAccount {
		return body
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(body, &root); err != nil {
		t.Fatal(err)
	}
	if account == "" {
		root["account"] = json.RawMessage("null")
	} else {
		root["account"] = json.RawMessage(fmt.Sprintf(`{"address":%q,"balance":"18446744073709551615","nonce":"9007199254740993"}`, account))
	}
	body, err = json.Marshal(root)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func receiptBytes(status string) []byte {
	return []byte(fmt.Sprintf(`{ "schemaVersion":"ynx-native-finance-transaction-v1","source":%q,"integerEncoding":"decimal-string","consensusFinality":false,"status":%q,"transaction":{"hash":%q,"amount":"18446744073709551615","nonce":"9007199254740993"},"durability":{"version":"ynx-local-durability-v1","scope":"local-snapshot","checkpointHeight":"0","checkpointHash":"","snapshotIntegrity":""} }`, nativeReadSource, status, nativeTestHash))
}

func nativeGateway(t *testing.T, p *NativeReadProxy, storePath string) *httptest.Server {
	t.Helper()
	store, err := OpenStore(storePath, testSecret)
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewServer(store, buildinfo.Info{}, strings.Repeat("a", 32), nil)
	if err != nil {
		t.Fatal(err)
	}
	return httptest.NewServer(s.HandlerWithNativeReads(p))
}

func proxyTo(t *testing.T, upstream string) *NativeReadProxy {
	t.Helper()
	p, err := NewNativeReadProxy(upstream)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func readNative(t *testing.T, endpoint string, headers http.Header) (int, []byte, http.Header) {
	t.Helper()
	r, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	r.Header = headers
	client := &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return res.StatusCode, body, res.Header
}

func TestNativeReadOriginIsOperatorOnly(t *testing.T) {
	for _, origin := range []string{"", "http://127.0.0.1:12345", "http://[::1]:12345", "https://core.example.test", "https://core.example.test:443"} {
		if _, err := NewNativeReadProxy(origin); err != nil {
			t.Fatalf("valid origin rejected: %s", origin)
		}
	}
	for _, origin := range []string{"http://localhost:42", "http://192.0.2.1", "https://user:secret@core.example", "https://core.example/", "https://core.example/v1", "https://core.example?", "https://core.example#", "https://core.example?chainId=1", "https://core.example/#fragment", "https://core.example:0", "https://core.example:65536", "https://core.example:0443", "https://core.example:", "https://core.example:abc", "https://CORE.EXAMPLE", "https://core..example", " https://core.example", "https://core.example\\evil", "file:///tmp/core", "https:core.example", "//core.example"} {
		if _, err := NewNativeReadProxy(origin); err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatalf("unsafe config accepted or disclosed: %q %v", origin, err)
		}
	}
}

func TestNativeReadGoldenBytesAndHeaderIsolation(t *testing.T) {
	body := snapshotBytes(t, nativeTestAccount)
	var calls atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "GET" || r.URL.String() != nativeSnapshotPath+"?account="+nativeTestAccount || r.ContentLength != 0 {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.String())
		}
		for name := range r.Header {
			if name != "Accept" && name != "Accept-Encoding" && name != "User-Agent" && name != "Connection" {
				t.Errorf("forwarded client header %s", name)
			}
		}
		if r.Header.Get("Accept-Encoding") != "identity" || r.Header.Get("Accept") != "application/json" {
			t.Error("unbounded encoding")
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Set-Cookie", "private=secret")
		w.Header().Set("Location", "https://attacker.invalid")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Cache-Control", "public,max-age=99")
		_, _ = w.Write(body)
	}))
	defer core.Close()
	gateway := nativeGateway(t, proxyTo(t, core.URL), filepath.Join(t.TempDir(), "state.json"))
	defer gateway.Close()
	alias, _ := accountaddress.Encode(nativeTestAccount)
	for _, account := range []string{nativeTestAccount, alias} {
		code, got, headers := readNative(t, gateway.URL+nativeSnapshotPath+"?account="+account, http.Header{"Authorization": {"Bearer do-not-forward"}, "Cookie": {"session=secret"}, "Origin": {"https://attacker.invalid"}, "X-Forwarded-Host": {"attacker.invalid"}, "X-YNX-Chain-ID": {"1"}, "Range": {"bytes=0-5"}, "If-None-Match": {"old"}})
		if code != 200 || !bytes.Equal(got, body) {
			t.Fatalf("raw golden not preserved: %d %s", code, got)
		}
		if headers.Get("Cache-Control") != "no-store" || headers.Get("Content-Type") != "application/json" || headers.Get("X-Content-Type-Options") != "nosniff" || headers.Get("Set-Cookie") != "" || headers.Get("Location") != "" || headers.Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("header leak: %v", headers)
		}
	}
	if calls.Load() != 2 {
		t.Fatal("unexpected retry")
	}
}

func TestNativeReadDurabilityAndNotFoundAreNotPromoted(t *testing.T) {
	for _, status := range []string{"memory_only", "uncertain", "pending_durable", "durable", "not_found"} {
		t.Run(status, func(t *testing.T) {
			want := receiptBytes(status)
			code := 200
			if status == "not_found" {
				code = 404
				want = []byte(fmt.Sprintf(`{"status":"not_found","transactionHash":%q}`, nativeTestHash))
			}
			var calls atomic.Int32
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.URL.String() != nativeTransactionPrefix+nativeTestHash {
					t.Error("wrong transaction")
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(code)
				_, _ = w.Write(want)
			}))
			defer core.Close()
			gate := httptest.NewServer(proxyTo(t, core.URL))
			defer gate.Close()
			gotCode, got, _ := readNative(t, gate.URL+nativeTransactionPrefix+nativeTestHash, nil)
			if gotCode != code || !bytes.Equal(got, want) || calls.Load() != 1 {
				t.Fatalf("durability rewritten/retried: %d %s", gotCode, got)
			}
		})
	}
}

func TestNativeReadInvalidRequestsNeverReachCore(t *testing.T) {
	var calls atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer core.Close()
	gate := nativeGateway(t, proxyTo(t, core.URL), filepath.Join(t.TempDir(), "state.json"))
	defer gate.Close()
	for _, path := range []string{"//v1/native-snapshot", "/extra/../v1/native-snapshot", "/extra/../v1/native-transactions/" + nativeTestHash} {
		code, _, headers := readNative(t, gate.URL+path, nil)
		if code != 400 || headers.Get("Location") != "" {
			t.Fatalf("ServeMux normalized invalid native route: %d %s", code, path)
		}
	}
	for _, path := range []string{nativeSnapshotPath + "/", nativeSnapshotPath + "/../internal/v1/events", nativeSnapshotPath + "//", nativeSnapshotPath + "?", nativeSnapshotPath + "?account=", nativeSnapshotPath + "?account=" + nativeTestAccount + "&account=" + nativeTestAccount, nativeSnapshotPath + "?url=https://attacker.invalid", nativeSnapshotPath + "?account=%30x" + nativeTestAccount[2:], nativeSnapshotPath + "?account=" + strings.ToUpper(nativeTestAccount), nativeSnapshotPath + "?account=" + nativeTestAccount + "&chainId=1", nativeTransactionPrefix + nativeTestHash + "/", nativeTransactionPrefix + strings.ToUpper(nativeTestHash), nativeTransactionPrefix + nativeTestHash + "?account=" + nativeTestAccount, nativeTransactionPrefix + "%2e%2e/internal", nativeTransactionPrefix + nativeTestHash + "%2fextra", nativeTransactionPrefix + "https://attacker.invalid"} {
		code, _, headers := readNative(t, gate.URL+path, nil)
		if code != 400 || headers.Get("Location") != "" {
			t.Fatalf("bad request not fail-closed %s: %d", path, code)
		}
	}
	for _, method := range []string{"HEAD", "POST", "PUT", "DELETE", "OPTIONS"} {
		r, _ := http.NewRequest(method, gate.URL+nativeSnapshotPath, nil)
		res, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 405 {
			t.Fatalf("%s accepted", method)
		}
	}
	r, _ := http.NewRequest("GET", gate.URL+nativeSnapshotPath, strings.NewReader("sensitive"))
	res, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatal("GET body accepted")
	}
	proxy := proxyTo(t, core.URL)
	rec := httptest.NewRecorder()
	proxy.ServeHTTP(rec, httptest.NewRequest("GET", "https://attacker.invalid"+nativeSnapshotPath, nil))
	if rec.Code != 400 {
		t.Fatal("absolute-form accepted")
	}
	if calls.Load() != 0 {
		t.Fatalf("invalid requests reached Core %d", calls.Load())
	}
}

func TestNativeReadUnavailableIsUnknownAndIndexerStillWorks(t *testing.T) {
	for _, proxy := range []*NativeReadProxy{nil, proxyTo(t, "")} {
		gate := nativeGateway(t, proxy, filepath.Join(t.TempDir(), "state.json"))
		for _, path := range []string{nativeSnapshotPath, nativeTransactionPrefix + nativeTestHash} {
			code, body, _ := readNative(t, gate.URL+path, nil)
			if code != 503 || !bytes.Contains(body, []byte(`"status":"unknown"`)) || bytes.Contains(bytes.ToLower(body), []byte("offline")) {
				t.Fatalf("unconfigured became wallet status: %d %s", code, body)
			}
		}
		code, _, _ := readNative(t, gate.URL+"/v1/pools", nil)
		if code != 200 {
			t.Fatal("unrelated indexer reads unavailable")
		}
		gate.Close()
	}
}

func TestNativeReadResponseFailuresAreBoundedAndSanitized(t *testing.T) {
	valid := snapshotBytes(t, nativeTestAccount)
	for _, tc := range []struct {
		name   string
		status int
		mime   string
		body   []byte
	}{
		{"html", 200, "text/html", []byte("<html>secret</html>")},
		{"malformed", 200, "application/json", []byte(`{"source":`)},
		{"trailing", 200, "application/json", append(append([]byte{}, valid...), []byte(` {}`)...)},
		{"duplicate", 200, "application/json", bytes.Replace(valid, []byte(`"chainId": "6423"`), []byte(`"chainId":"1","chainId":"6423"`), 1)},
		{"wrong-network", 200, "application/json", bytes.Replace(valid, []byte(`"6423"`), []byte(`"1"`), 1)},
		{"wrong-subject", 200, "application/json", snapshotBytes(t, "0x0000000000000000000000000000000000000001")},
		{"invalid-utf8", 200, "application/json", append([]byte{0xff}, valid...)},
		{"oversized", 200, "application/json", bytes.Repeat([]byte(" "), nativeSnapshotMaxBytes+1)},
		{"snapshot-404", 404, "application/json", []byte(`{"secret":"do-not-disclose"}`)},
		{"core-coverage-error", 503, "application/json", []byte(`{"error":"sensitive details","coverage":{"complete":false}}`)},
		{"rate-limited", 429, "application/json", []byte(`{"secret":"do-not-disclose"}`)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", tc.mime)
				w.WriteHeader(tc.status)
				_, _ = w.Write(tc.body)
			}))
			defer core.Close()
			gate := httptest.NewServer(proxyTo(t, core.URL))
			defer gate.Close()
			code, body, _ := readNative(t, gate.URL+nativeSnapshotPath+"?account="+nativeTestAccount, nil)
			if code != 503 || !bytes.Contains(body, []byte(`"status":"unknown"`)) || bytes.Contains(body, []byte("secret")) || bytes.Contains(body, []byte("sensitive")) || calls.Load() != 1 {
				t.Fatalf("invalid response: %d %s calls%d", code, body, calls.Load())
			}
		})
	}
}

func TestNativeReadRedirectCompressionAndHeadersNeverEscape(t *testing.T) {
	var escaped atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { escaped.Add(1) }))
	defer other.Close()
	for _, mode := range []string{"redirect", "compressed", "oversized-headers"} {
		t.Run(mode, func(t *testing.T) {
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if mode == "redirect" {
					http.Redirect(w, r, other.URL, 307)
					return
				}
				if mode == "compressed" {
					w.Header().Set("Content-Encoding", "gzip")
				}
				if mode == "oversized-headers" {
					w.Header().Set("X-Large", strings.Repeat("x", 32<<10))
				}
				_, _ = w.Write(snapshotBytes(t, ""))
			}))
			defer core.Close()
			gate := httptest.NewServer(proxyTo(t, core.URL))
			defer gate.Close()
			code, _, _ := readNative(t, gate.URL+nativeSnapshotPath, nil)
			if code != 503 {
				t.Fatalf("%s accepted %d", mode, code)
			}
		})
	}
	if escaped.Load() != 0 {
		t.Fatal("followed upstream redirect")
	}
}

func TestNativeReadTwoUsersConcurrentRestartAndNoCache(t *testing.T) {
	users := []string{nativeTestAccount, "0x0000000000000000000000000000000000000001"}
	var generation atomic.Int64
	generation.Store(1)
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		body := snapshotBytes(t, r.URL.Query().Get("account"))
		body = bytes.Replace(body, []byte(`"nonce":"9007199254740993"`), []byte(fmt.Sprintf(`"nonce":"%d"`, generation.Load())), 1)
		_, _ = w.Write(body)
	}))
	defer core.Close()
	path := filepath.Join(t.TempDir(), "state.json")
	for restart := 0; restart < 2; restart++ {
		gate := nativeGateway(t, proxyTo(t, core.URL), path)
		var wg sync.WaitGroup
		for _, user := range users {
			wg.Add(1)
			go func(user string) {
				defer wg.Done()
				for i := 0; i < 10; i++ {
					code, body, _ := readNative(t, gate.URL+nativeSnapshotPath+"?account="+user, nil)
					var value struct {
						Account struct {
							Address string
							Nonce   string
						}
					}
					if json.Unmarshal(body, &value) != nil || code != 200 || value.Account.Address != user {
						t.Errorf("cross-user response %s %d %s", user, code, body)
					}
					if user == users[1] && value.Account.Nonce != fmt.Sprint(generation.Load()) {
						t.Error("cached generation after restart")
					}
				}
			}(user)
		}
		wg.Wait()
		gate.Close()
		generation.Add(1)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("native read persisted a second ledger: %v", err)
	}
}

func TestNativeReadTimeoutCancellationAndConcurrency(t *testing.T) {
	var calls atomic.Int32
	entered := make(chan struct{}, nativeReadConcurrency+1)
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		entered <- struct{}{}
		<-r.Context().Done()
	}))
	defer core.Close()
	p := proxyTo(t, core.URL)
	p.client.Timeout = 150 * time.Millisecond
	gate := httptest.NewServer(p)
	defer gate.Close()
	var wg sync.WaitGroup
	for i := 0; i < nativeReadConcurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			code, _, _ := readNative(t, gate.URL+nativeSnapshotPath, nil)
			if code != 503 {
				t.Error("timeout not unknown")
			}
		}()
	}
	for i := 0; i < nativeReadConcurrency; i++ {
		select {
		case <-entered:
		case <-time.After(2 * time.Second):
			t.Fatal("upstream did not enter")
		}
	}
	code, body, _ := readNative(t, gate.URL+nativeSnapshotPath, nil)
	if code != 503 || !bytes.Contains(body, []byte("NATIVE_CORE_BUSY")) {
		t.Fatalf("unbounded concurrency: %d %s", code, body)
	}
	wg.Wait()
	if calls.Load() != nativeReadConcurrency || len(p.slots) != 0 {
		t.Fatal("timeout leaked slots or retried")
	}
	ctx, cancel := context.WithCancel(context.Background())
	r := httptest.NewRequest("GET", nativeSnapshotPath, nil).WithContext(ctx)
	cancel()
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, r)
	if rec.Code != 503 || len(p.slots) != 0 || calls.Load() != nativeReadConcurrency {
		t.Fatal("cancelled read retried or leaked")
	}
}

func TestNativeReceiptInvalidIdentityAndMissingProofNotInvented(t *testing.T) {
	for _, tc := range []struct {
		code int
		body []byte
		want int
	}{
		{200, receiptBytes("unknown"), 503},
		{200, bytes.Replace(receiptBytes("durable"), []byte(nativeTestHash), []byte("0x"+strings.Repeat("b", 64)), 1), 503},
		{404, []byte(`{"status":"not_found","transactionHash":"wrong"}`), 503},
		{200, bytes.Replace(receiptBytes("uncertain"), []byte(`"checkpointHash":""`), []byte(`"checkpointHash":null`), 1), 200},
		{200, bytes.Repeat([]byte(" "), nativeReceiptMaxBytes+1), 503},
	} {
		core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(tc.code)
			_, _ = w.Write(tc.body)
		}))
		gate := httptest.NewServer(proxyTo(t, core.URL))
		code, body, _ := readNative(t, gate.URL+nativeTransactionPrefix+nativeTestHash, nil)
		if code != tc.want || (code == 200 && !bytes.Equal(body, tc.body)) {
			t.Fatalf("receipt proof invented/reclassified: %d %s", code, body)
		}
		gate.Close()
		core.Close()
	}
}

func TestNativeReadLostConnectionNoRetryThenExplicitFreshReadRecovers(t *testing.T) {
	var calls atomic.Int32
	want := snapshotBytes(t, "")
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			connection, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			_ = connection.Close()
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(want)
	}))
	defer core.Close()
	gate := nativeGateway(t, proxyTo(t, core.URL), filepath.Join(t.TempDir(), "state.json"))
	defer gate.Close()
	code, body, _ := readNative(t, gate.URL+nativeSnapshotPath, nil)
	if code != 503 || calls.Load() != 1 || !bytes.Contains(body, []byte(`"status":"unknown"`)) {
		t.Fatalf("lost response retried: %d %s", code, body)
	}
	code, body, _ = readNative(t, gate.URL+nativeSnapshotPath, nil)
	if code != 200 || calls.Load() != 2 || !bytes.Equal(body, want) {
		t.Fatalf("explicit read could not recover: %d %s", code, body)
	}
}

func TestNativeReadCoreGoldenReceiptRawBytes(t *testing.T) {
	// The accepted Core Transaction does not expose chainId. Do not invent
	// that field or require a consensus-chain string absent from its contract.
	want, err := os.ReadFile("../../apps/dex/src/fixtures/finance-receipt-fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden struct {
		Transaction struct {
			Hash string `json:"hash"`
		} `json:"transaction"`
	}
	if err := json.Unmarshal(want, &golden); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != nativeTransactionPrefix+golden.Transaction.Hash || r.URL.RawQuery != "" {
			t.Error("wrong golden receipt lookup")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(want)
	}))
	defer core.Close()
	gate := nativeGateway(t, proxyTo(t, core.URL), filepath.Join(t.TempDir(), "state.json"))
	defer gate.Close()
	code, got, _ := readNative(t, gate.URL+nativeTransactionPrefix+golden.Transaction.Hash, nil)
	if code != 200 || !bytes.Equal(got, want) || calls.Load() != 1 {
		t.Fatalf("Core receipt contract changed: %d %s", code, got)
	}
}
