package quantlab

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Actual TLS product endpoints and durable tenant/base state, with explicitly
// simulated native/central authorities. This is not Wallet/Relay/public E2E.
func TestQuantBrowserSSOActualPrivateRouteKeepsTenantsAndAuthoritySeparate(t *testing.T) {
	accounts := []string{"ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80", "ynx19dddt3retspx298cx9785g27yxxue4k0zst9fl"}
	var mu sync.Mutex
	used, revoked := map[string]bool{}, map[string]bool{}
	identityExpiry := time.Now().UTC().Add(time.Hour)
	grantExpiry := time.Now().UTC().Add(5 * time.Minute)
	_, nativeA := quantProofFixture(t, "a")
	_, nativeB := quantProofFixture(t, "c")
	nativeA["account"], nativeB["account"] = accounts[0], accounts[1]
	_, recordsA := quantProofFixture(t, "d")
	_, recordsB := quantProofFixture(t, "e")
	recordsA["account"], recordsB["account"] = accounts[0], accounts[1]
	recordsA["scopes"], recordsB["scopes"] = []string{"quant:records:read"}, []string{"quant:records:read"}
	native, err := productsessionv2.NewClient(QuantPrivateAuthority, QuantPrivateSessionPolicy(), privateRoundTrip(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		defer mu.Unlock()
		raw, _ := base64.RawURLEncoding.DecodeString(r.Header.Get(productsessionv2.ProofHeader))
		var proof map[string]any
		_ = json.Unmarshal(raw, &proof)
		index := 0
		if proof["account"] == accounts[1] {
			index = 1
		}
		session := []map[string]any{nativeA, nativeB}[index]
		if proof["sessionBinding"] == strings.Repeat("d", 64) {
			session = recordsA
		}
		if proof["sessionBinding"] == strings.Repeat("e", 64) {
			session = recordsB
		}
		key := fmt.Sprint(proof["sessionBinding"], proof["nonce"])
		status := 200
		body := map[string]any{"schemaVersion": 2, "requestId": r.Header.Get("X-Request-Id"), "ok": true, "result": map[string]any{"active": true, "session": session}}
		if used[key] {
			status = 400
			body = map[string]any{"schemaVersion": 2, "requestId": r.Header.Get("X-Request-Id"), "ok": false, "error": map[string]string{"code": "PROOF_REPLAY", "message": "Fixture proof consumed"}}
		}
		used[key] = true
		bytes, _ := json.Marshal(body)
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}, "Cache-Control": {"no-store"}, "X-Request-Id": {r.Header.Get("X-Request-Id")}}, Body: io.NopCloser(strings.NewReader(string(bytes)))}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	bridge, err := productsessionv2.NewBrowserSSO("quant", QuantPrivateAuthority, []byte(strings.Repeat("k", 32)), []string{"research", "portfolio"}, privateRoundTrip(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		defer mu.Unlock()
		var input map[string]string
		_ = json.NewDecoder(r.Body).Decode(&input)
		token := input["grantToken"]
		if r.URL.Path == "/v2/browser-sessions/token" {
			token = strings.Repeat("g", 43)
			if input["code"] == strings.Repeat("b", 43) {
				token = strings.Repeat("h", 43)
			}
		}
		status := 200
		var body any
		if r.URL.Path == "/v2/browser-sessions/logout-grant" {
			revoked[token] = true
			body = map[string]bool{"revoked": true}
		} else if revoked[token] {
			status = 401
			body = map[string]string{"code": "revoked"}
		} else {
			index := 0
			if token == strings.Repeat("h", 43) {
				index = 1
			}
			grantToken := ""
			if r.URL.Path == "/v2/browser-sessions/token" {
				grantToken = token
			}
			body = productsessionv2.BrowserGrant{GrantToken: grantToken, Identity: productsessionv2.BrowserIdentity{Subject: accounts[index], Account: accounts[index], Generation: 1, ExpiresAt: identityExpiry}, Audience: "ynx:quant:identity", Scopes: []string{"identity:read"}, ExpiresAt: grantExpiry}
		}
		bytes, _ := json.Marshal(body)
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(string(bytes)))}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	config := Config{StatePath: filepath.Join(t.TempDir(), "state.json"), PrivateSession: native, BrowserSSO: bridge, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}}
	service, err := NewTenantServer(config, "all")
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /sso/start", bridge.Start)
	mux.HandleFunc("GET /sso/callback", bridge.Callback)
	mux.Handle("/", service)
	server := httptest.NewTLSServer(mux)
	defer server.Close()
	clients := make([]*http.Client, 2)
	for index := range clients {
		isolated := *server.Client()
		client := &isolated
		client.Timeout = 5 * time.Second
		client.Jar, _ = cookiejar.New(nil)
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		clients[index] = client
		started, err := client.Get(server.URL + "/sso/start?target=portfolio")
		if err != nil {
			t.Fatal(err)
		}
		started.Body.Close()
		location, _ := url.Parse(started.Header.Get("Location"))
		code := strings.Repeat("a", 43)
		if index == 1 {
			code = strings.Repeat("b", 43)
		}
		callback, err := client.Get(server.URL + "/sso/callback?" + url.Values{"state": {location.Query().Get("state")}, "code": {code}}.Encode())
		if err != nil {
			t.Fatal(err)
		}
		callback.Body.Close()
		if callback.StatusCode != 303 {
			t.Fatal("callback failed")
		}
		view, err := client.Get(server.URL + "/v1/sso/account")
		if err != nil {
			t.Fatal(err)
		}
		var identity map[string]any
		_ = json.NewDecoder(view.Body).Decode(&identity)
		view.Body.Close()
		if identity["account"] != accounts[index] || identity["privateWorkspaceAuthorized"] != false {
			t.Fatal("identity grants private permission")
		}
	}
	entries, err := os.ReadDir(service.root)
	if err != nil || len(entries) != 0 {
		t.Fatal("identity flow created a tenant")
	}
	// Seed existing core services through their original APIs, not an identity
	// echo or a new engine. Test-only mandate/broker doubles do not prove Wallet.
	digests := make([]string, 2)
	for index := range accounts {
		seedConfig := config
		seedConfig.StatePath = filepath.Join(service.root, strings.Repeat([]string{"e", "f"}[index], 64)+".json")
		seed, err := New(seedConfig)
		if err != nil {
			t.Fatal(err)
		}
		experiment, err := seed.RunBacktest(request())
		if err != nil {
			t.Fatal(err)
		}
		mandate := validMandate(time.Now().UTC(), experiment.Strategy.StrategyHash)
		mandate.Account = accounts[index]
		mandate.MaxDailyLoss = int64(100 + index)
		registered, err := seed.RegisterMandate(mandate)
		if err != nil {
			t.Fatal(err)
		}
		digests[index] = registered.Digest
		if _, err := seed.SubmitTestnetWithSession(context.Background(), registered.Digest, "buy", 1_000_000, 1, "owned-record-seed", "wallet-order-signature", "one-time-session", validRisk(time.Now().UTC())); err != nil {
			t.Fatal(err)
		}
		if err := seed.Close(); err != nil {
			t.Fatal(err)
		}
	}
	sequence := 0
	readRecords := func(client *http.Client, index int, accountOnly bool, route string) int {
		sequence++
		label := []string{"d", "e"}[index]
		if accountOnly {
			label = []string{"a", "c"}[index]
		}
		proof, _ := quantProofFixture(t, label)
		proof["account"] = accounts[index]
		proof["nonce"] = fmt.Sprintf("fixture-record-once-%016d", sequence)
		digest := sha256.Sum256([]byte(`{"requiredScopes":["quant:records:read"]}`))
		proof["bodyDigest"] = hex.EncodeToString(digest[:])
		r, _ := http.NewRequest("POST", server.URL+route, strings.NewReader("{}"))
		r.Header.Set("Origin", "https://quant.ynxweb4.com")
		r.Header.Set("Content-Type", "application/json")
		if route != "/v1/wallet/private-records" {
			r.Header.Set(TenantHeader, strings.Repeat([]string{"e", "f"}[index], 64))
		} else if index == 1 {
			r.Header.Set(TenantHeader, strings.Repeat("9", 64))
		} // Unknown locator cannot create a tenant.
		r.Header.Set(productsessionv2.ProofHeader, quantProofHeader(t, proof))
		response, err := client.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode == 200 {
			var data struct {
				Account                string              `json:"account"`
				Records                financeQuantPayload `json:"records"`
				NativeExecutionEnabled bool                `json:"nativeExecutionEnabled"`
				PaperWorkspaceLinked   bool                `json:"paperWorkspaceLinked"`
			}
			if json.NewDecoder(response.Body).Decode(&data) != nil || data.Account != accounts[index] || data.NativeExecutionEnabled || data.PaperWorkspaceLinked || len(data.Records.Mandates) != 1 || len(data.Records.Executions) != 1 || data.Records.Mandates[0].Digest != digests[index] || data.Records.Mandates[0].MaxDailyLoss != int64(100+index) || data.Records.Executions[0].MandateDigest != digests[index] || len(data.Records.Paper) != 0 || len(data.Records.Strategies) != 0 || len(data.Records.Experiments) != 0 {
				t.Fatal("owned records lost core content, leaked another account or granted writes")
			}
		}
		return response.StatusCode
	}
	if readRecords(clients[0], 0, true, "/v1/wallet/private-records") != 403 {
		t.Fatal("account-only approval silently gained record reads")
	}
	if readRecords(clients[0], 0, false, "/v1/wallet/private-records") != 200 || readRecords(clients[1], 1, false, "/v1/wallet/private-records") != 200 || readRecords(clients[1], 0, false, "/v1/wallet/private-records") != 401 || readRecords(clients[0], 0, false, "/v1/mandates") != 403 {
		t.Fatal("separate records consent/ownership/write boundary failed")
	}
	entries, err = os.ReadDir(service.root)
	if err != nil || len(entries) != 2 || len(service.servers) != 1 {
		t.Fatal("records read allocated a tenant/workspace")
	} // Only the explicit old write-boundary attempt opens existing Alice.
	read := func(client *http.Client, index int, tenant string) int {
		sequence++
		proof, _ := quantProofFixture(t, []string{"a", "c"}[index])
		proof["account"] = accounts[index]
		proof["nonce"] = fmt.Sprintf("fixture-once-nonce-%016d", sequence)
		r, _ := http.NewRequest("POST", server.URL+"/v1/wallet/private-account", strings.NewReader("{}"))
		r.Header.Set("Origin", "https://quant.ynxweb4.com")
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set(TenantHeader, tenant)
		r.Header.Set(productsessionv2.ProofHeader, quantProofHeader(t, proof))
		response, err := client.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode == 200 {
			var data map[string]any
			_ = json.NewDecoder(response.Body).Decode(&data)
			if data["account"] != accounts[index] || data["nativeExecutionEnabled"] != false || data["paperWorkspaceLinked"] != false {
				t.Fatal("private account widened authority")
			}
		}
		return response.StatusCode
	}
	if read(clients[0], 0, "") != 401 {
		t.Fatal("identity bypassed original tenant requirement")
	}
	if read(clients[0], 0, strings.Repeat("e", 64)) != 200 || read(clients[1], 1, strings.Repeat("f", 64)) != 200 || read(clients[1], 0, strings.Repeat("f", 64)) != 401 {
		t.Fatal("private ownership isolation failed")
	}
	view, err := clients[0].Get(server.URL + "/v1/sso/account")
	if err != nil {
		t.Fatal(err)
	}
	var identity map[string]any
	_ = json.NewDecoder(view.Body).Decode(&identity)
	view.Body.Close()
	logout, _ := http.NewRequest("POST", server.URL+"/v1/sso/logout", strings.NewReader("{}"))
	logout.Header.Set("Origin", "https://quant.ynxweb4.com")
	logout.Header.Set("X-YNX-SSO-CSRF", identity["csrfToken"].(string))
	response, err := clients[0].Do(logout)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("product logout failed")
	}
	withoutCookie := server.Client()
	withoutCookie.Timeout = 5 * time.Second
	if read(withoutCookie, 0, strings.Repeat("d", 64)) != 401 || read(clients[1], 1, strings.Repeat("f", 64)) != 200 {
		t.Fatal("tenant switch escaped revocation or revoked second QA")
	}
	if readRecords(withoutCookie, 0, false, "/v1/wallet/private-records") != 401 || readRecords(clients[1], 1, false, "/v1/wallet/private-records") != 200 {
		t.Fatal("logout lost record grant isolation")
	}
	server.Close()
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	service, err = NewTenantServer(config, "all")
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	server = httptest.NewTLSServer(service)
	defer server.Close()
	if read(withoutCookie, 0, strings.Repeat("d", 64)) != 401 || read(clients[1], 1, strings.Repeat("f", 64)) != 200 {
		t.Fatal("restart lost linked revocation")
	}
	if readRecords(withoutCookie, 0, false, "/v1/wallet/private-records") != 401 || readRecords(clients[1], 1, false, "/v1/wallet/private-records") != 200 {
		t.Fatal("restart lost durable record ownership/revocation")
	}
}

type browserRollbackFailStore struct{ stateStore }

func (browserRollbackFailStore) save(*state) error {
	return errors.New("fixture durable save unavailable")
}

func TestQuantBrowserSSOCurrentReaderRollbackRestoreAndDeleteKeepBindings(t *testing.T) {
	root := t.TempDir()
	config := Config{StatePath: filepath.Join(root, "state.json")}
	service, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	if _, err := service.RunBacktest(request()); err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(root, "pre-sso.backup.json")
	if _, err := service.Backup(backup); err != nil {
		t.Fatal(err)
	}
	session := productsessionv2.Session{Account: "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80", SessionBinding: strings.Repeat("a", 64)}
	key := hashBytes([]byte(session.SessionBinding))
	service.mu.Lock()
	service.state.BrowserSSOBindings = map[string]browserSSOBinding{key: {Account: session.Account, GrantDigest: strings.Repeat("b", 64), SealedGrant: "non-authorizing-local-durable-fixture", ExpiresAt: time.Now().UTC().Add(time.Hour)}}
	err = service.save()
	service.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	bindings, _ := json.Marshal(service.state.BrowserSSOBindings)
	// The old reader silently drops this field, but its typed integrity digest
	// then fails. Keeping the schema number is not binary rollback compatibility.
	typ := reflect.TypeOf(state{})
	fields := []reflect.StructField{}
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		if field.Name != "BrowserSSOBindings" {
			fields = append(fields, field)
		}
	}
	legacy := reflect.New(reflect.StructOf(fields))
	raw, _ := json.Marshal(service.state)
	if json.Unmarshal(raw, legacy.Interface()) != nil {
		t.Fatal("legacy-shaped decode fixture failed")
	}
	previousDigest := legacy.Elem().FieldByName("Integrity").String()
	legacy.Elem().FieldByName("Integrity").SetString("")
	if hash(legacy.Elem().Interface()) == previousDigest {
		t.Fatal("old reader accepted populated binding history")
	}
	assertCurrent := func() {
		t.Helper()
		current, err := New(config)
		if err != nil {
			t.Fatal(err)
		}
		defer current.Close()
		actual, _ := json.Marshal(current.state.BrowserSSOBindings)
		if !reflect.DeepEqual(bindings, actual) {
			t.Fatal("save/reopen rolled browser authorization history back")
		}
		server := &Server{service: current}
		if server.authorizeBrowserSSO(httptest.NewRequest("POST", "/v1/wallet/private-account", nil), session) != 401 {
			t.Fatal("SSO-off current reader converted linked authorization to native-only")
		}
	}
	assertCurrent()
	for _, operation := range []string{"restore", "delete"} {
		before, err := os.ReadFile(config.StatePath)
		if err != nil {
			t.Fatal(err)
		}
		original := service.store
		service.store = browserRollbackFailStore{original}
		if operation == "restore" {
			_, err = service.Restore(backup)
		} else {
			_, err = service.DeleteAllLocalData("DELETE ALL LOCAL QUANT DATA")
		}
		service.store = original
		if err == nil {
			t.Fatal("injected persistent failure was reported as success")
		}
		after, _ := os.ReadFile(config.StatePath)
		if !reflect.DeepEqual(before, after) {
			t.Fatal("failed operation changed durable state")
		}
		assertCurrent()
	}
	if _, err := service.Restore(backup); err != nil {
		t.Fatal(err)
	}
	assertCurrent()
	if len(service.state.Experiments) != 1 {
		t.Fatal("current-reader restore lost original business experiment")
	}
	if _, err := service.DeleteAllLocalData("DELETE ALL LOCAL QUANT DATA"); err != nil {
		t.Fatal(err)
	}
	assertCurrent()
	if len(service.state.Experiments) != 0 {
		t.Fatal("financial deletion did not clear local business data")
	}
}
