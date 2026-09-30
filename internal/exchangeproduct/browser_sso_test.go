package exchangeproduct

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Product boundary regression with simulated central/native authorities; not
// an installed Wallet or public E2E receipt. Existing schema-10 data is real.
func TestBrowserSSOV10OwnedReadsAndDurableProductRevocation(t *testing.T) {
	_, native := v2Fixture(t, alice, "exchange:read")
	_, nativeB := v2Fixture(t, bob, "exchange:read")
	nativeB.SessionBinding = strings.Repeat("b", 64)
	service, _, path := v2Server(t, func(r *http.Request) (*http.Response, error) {
		raw, _ := base64.RawURLEncoding.DecodeString(r.Header.Get(productsessionv2.ProofHeader))
		var proof map[string]any
		_ = json.Unmarshal(raw, &proof)
		selected := native
		if proof["account"] == bob {
			selected = nativeB
		}
		return v2Response(t, r, selected, ""), nil
	})
	defer service.Close()
	if _, err := service.CreditTestQuote("Bearer "+adminKey, alice, 17*AmountScale, "sso-v10-alice-credit"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreditTestQuote("Bearer "+adminKey, bob, 31*AmountScale, "sso-v10-bob-credit"); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	revoked := map[string]bool{}
	identity := productsessionv2.BrowserIdentity{Subject: alice, Account: alice, Generation: 1, ExpiresAt: time.Now().Add(time.Hour)}
	bridge, err := productsessionv2.NewBrowserSSO("exchange", exchangeSessionAuthority, []byte(strings.Repeat("k", 32)), []string{"assets", "market"}, exchangeV2RoundTrip(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		defer mu.Unlock()
		status := 200
		var body any
		var input map[string]string
		_ = json.NewDecoder(r.Body).Decode(&input)
		targetToken := input["grantToken"]
		if r.URL.Path == "/v2/browser-sessions/token" {
			targetToken = strings.Repeat("g", 43)
			if input["code"] == strings.Repeat("b", 43) {
				targetToken = strings.Repeat("h", 43)
			}
		}
		if r.URL.Path == "/v2/browser-sessions/logout-grant" {
			revoked[targetToken] = true
			body = map[string]bool{"revoked": true}
		} else if revoked[targetToken] {
			status = 401
			body = map[string]string{"code": "revoked"}
		} else {
			token := ""
			if r.URL.Path == "/v2/browser-sessions/token" {
				token = targetToken
			}
			selected := identity
			if targetToken == strings.Repeat("h", 43) {
				selected.Account = bob
				selected.Subject = bob
			}
			body = productsessionv2.BrowserGrant{GrantToken: token, Identity: selected, Audience: "ynx:exchange:identity", Scopes: []string{"identity:read"}, ExpiresAt: time.Now().Add(5 * time.Minute)}
		}
		raw, _ := json.Marshal(body)
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(string(raw)))}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	service.cfg.BrowserSSO = bridge
	api := NewServer(service)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /sso/start", bridge.Start)
	mux.HandleFunc("GET /sso/callback", bridge.Callback)
	mux.Handle("/", api)
	product := httptest.NewTLSServer(mux)
	defer product.Close()
	client := product.Client()
	client.Timeout = 5 * time.Second
	client.Jar, _ = cookiejar.New(nil)
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	start, err := client.Get(product.URL + "/sso/start?target=assets")
	if err != nil {
		t.Fatal(err)
	}
	start.Body.Close()
	location, _ := url.Parse(start.Header.Get("Location"))
	completed, err := client.Get(product.URL + "/sso/callback?" + url.Values{"code": {strings.Repeat("c", 43)}, "state": {location.Query().Get("state")}}.Encode())
	if err != nil {
		t.Fatal(err)
	}
	completed.Body.Close()
	if completed.StatusCode != 303 {
		t.Fatal("product callback failed")
	}
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			proof, _ := v2Fixture(t, alice, "exchange:read")
			proof = v2Mutate(t, proof, func(p map[string]any) { p["nonce"] = strings.Repeat("n", 20) + string(rune('a'+i)) })
			request, _ := http.NewRequest("GET", product.URL+"/v1/account", nil)
			request.Header.Set("Origin", exchangeWebOrigin)
			request.Header.Set(productsessionv2.ProofHeader, proof)
			response, err := client.Do(request)
			if err != nil {
				t.Error(err)
				return
			}
			defer response.Body.Close()
			if response.StatusCode != 200 {
				t.Errorf("first concurrent owned read status %d", response.StatusCode)
				return
			}
			var snapshot AccountSnapshot
			if json.NewDecoder(response.Body).Decode(&snapshot) != nil {
				t.Error("invalid owned snapshot")
			}
			for _, balance := range snapshot.Balances {
				if balance.Account != alice {
					t.Error("cross-user balance")
				}
			}
			assertSSOOwnedQuote(t, snapshot, alice, 17*AmountScale)
		}(i)
	}
	wg.Wait()
	clientB := *client
	clientB.Jar, _ = cookiejar.New(nil)
	startB, err := clientB.Get(product.URL + "/sso/start?target=assets")
	if err != nil {
		t.Fatal(err)
	}
	startB.Body.Close()
	locationB, _ := url.Parse(startB.Header.Get("Location"))
	callbackB, err := clientB.Get(product.URL + "/sso/callback?" + url.Values{"code": {strings.Repeat("b", 43)}, "state": {locationB.Query().Get("state")}}.Encode())
	if err != nil {
		t.Fatal(err)
	}
	callbackB.Body.Close()
	if callbackB.StatusCode != 303 {
		t.Fatal("second QA callback failed")
	}
	readB := func(selected string) int {
		proof, _ := v2Fixture(t, selected, "exchange:read")
		if selected == bob {
			proof = v2Mutate(t, proof, func(p map[string]any) { p["sessionBinding"] = nativeB.SessionBinding })
		}
		request, _ := http.NewRequest("GET", product.URL+"/v1/account", nil)
		request.Header.Set("Origin", exchangeWebOrigin)
		request.Header.Set(productsessionv2.ProofHeader, proof)
		response, err := clientB.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode == 200 {
			var owned AccountSnapshot
			_ = json.NewDecoder(response.Body).Decode(&owned)
			for _, balance := range owned.Balances {
				if balance.Account != selected {
					t.Fatal("wrong QA owned data")
				}
			}
			if selected == bob {
				assertSSOOwnedQuote(t, owned, bob, 31*AmountScale)
			}
		}
		return response.StatusCode
	}
	if readB(bob) != 200 || readB(alice) != 401 {
		t.Fatal("second QA ownership/isolation failed")
	}
	stored, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(stored), `"schemaVersion": 10`) || !strings.Contains(string(stored), `"browserSSOBindings"`) {
		t.Fatal("schema-10 association not durable")
	}
	identityView, err := client.Get(product.URL + "/v1/sso/account")
	if err != nil {
		t.Fatal(err)
	}
	var account map[string]any
	_ = json.NewDecoder(identityView.Body).Decode(&account)
	identityView.Body.Close()
	logoutRequest, _ := http.NewRequest("POST", product.URL+"/v1/sso/logout", nil)
	logoutRequest.Header.Set("Origin", exchangeWebOrigin)
	logoutRequest.Header.Set("X-YNX-SSO-CSRF", account["csrfToken"].(string))
	logout, err := client.Do(logoutRequest)
	if err != nil {
		t.Fatal(err)
	}
	logout.Body.Close()
	if logout.StatusCode != 200 {
		t.Fatal("product logout failed")
	}
	if readB(bob) != 200 {
		t.Fatal("first QA product logout revoked another QA")
	}
	proof, _ := v2Fixture(t, alice, "exchange:read")
	denied := httptest.NewRecorder()
	api.ServeHTTP(denied, v2Request("GET", "/v1/account", proof, ""))
	if denied.Code != 401 {
		t.Fatal("deleting cookie bypassed durable association")
	}
	product.Close()
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	restarted, err := New(service.cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	if restarted.state.SchemaVersion != 10 {
		t.Fatal("schema changed")
	}
	product = httptest.NewTLSServer(NewServer(restarted))
	defer product.Close()
	if readB(bob) != 200 {
		t.Fatal("second QA owned read did not survive actual restart")
	}
	request, _ := http.NewRequest("GET", product.URL+"/v1/account", nil)
	request.Header.Set("Origin", exchangeWebOrigin)
	request.Header.Set(productsessionv2.ProofHeader, proof)
	withoutCookie := product.Client()
	withoutCookie.Timeout = 5 * time.Second
	oldRead, err := withoutCookie.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	oldRead.Body.Close()
	if oldRead.StatusCode != 401 {
		t.Fatal("restarted linked session bypassed product revocation without cookie")
	}
}

func assertSSOOwnedQuote(t *testing.T, snapshot AccountSnapshot, account string, amount int64) {
	t.Helper()
	for _, balance := range snapshot.Balances {
		if balance.Account == account && balance.Asset == "YUSD_TEST" {
			if balance.AvailableMicro != amount {
				t.Errorf("owned quote amount differs from existing schema-10 data")
			}
			return
		}
	}
	t.Error("owned quote balance missing")
}
