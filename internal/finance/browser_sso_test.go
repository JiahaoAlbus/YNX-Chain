package finance

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/centralbrowserfamily"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

func TestFinanceSSOExpiredTransactionReturnsTargetWithoutRedeeming(t *testing.T) {
	now := time.Now()
	s := &Server{cfg: ServerConfig{CentralBrowserSSO: true, WalletGatewayURL: BrowserWalletAuthority, CursorSigningKey: testCursorKey}, now: func() time.Time { return now }}
	start := httptest.NewRecorder()
	s.ssoStart(start, httptest.NewRequest("GET", BrowserFinanceOrigin+"/sso/start?target=planning", nil))
	cookie := start.Result().Cookies()[0]
	if cookie.MaxAge != 600 {
		t.Fatal("unbounded or missing target recovery")
	}
	u, err := url.Parse(start.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	state := u.Query().Get("state")
	now = now.Add(3 * time.Minute)
	for _, sample := range []struct {
		query  string
		status int
		target string
	}{
		{"state=" + state + "&error=access_denied", 303, "/#planning"},
		{"state=" + state + "&code=" + strings.Repeat("c", 43), 400, ""},
		{"state=" + strings.Repeat("x", 43) + "&error=access_denied", 400, ""},
	} {
		r := httptest.NewRequest("GET", BrowserFinanceOrigin+"/sso/callback?"+sample.query, nil)
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		s.ssoCallback(w, r)
		if w.Code != sample.status || w.Header().Get("Location") != sample.target {
			t.Fatal("expired callback authorization/target boundary failed")
		}
	}
}

func TestFinanceSSOLocaleActualBrowserFlow(t *testing.T) {
	s := &Server{cfg: ServerConfig{CentralBrowserSSO: true, WalletGatewayURL: BrowserWalletAuthority, CursorSigningKey: testCursorKey}, now: time.Now}
	server := httptest.NewServer(http.HandlerFunc(s.ssoStart))
	defer server.Close()
	command := exec.Command("node", "../../apps/finance/tests/central-locale-flow.mjs", server.URL+"/sso/start")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("isolated Finance → real Go start → central source page locale flow failed: %v\n%s", err, output)
	}
}

func TestFinanceSSOLocaleCannotAlterRegisteredAuthorization(t *testing.T) {
	s := &Server{cfg: ServerConfig{CentralBrowserSSO: true, WalletGatewayURL: BrowserWalletAuthority, CursorSigningKey: testCursorKey}, now: time.Now}
	for _, language := range []string{"en", "zh-CN", "zh-Hant", "javascript:alert(1)", "https://attacker.invalid", "<script>"} {
		recorder := httptest.NewRecorder()
		s.ssoStart(recorder, httptest.NewRequest("GET", BrowserFinanceOrigin+"/sso/start?lang="+url.QueryEscape(language), nil))
		destination, err := url.Parse(recorder.Header().Get("Location"))
		if err != nil || destination.Scheme+"://"+destination.Host != BrowserWalletAuthority || destination.Query().Get("redirectUri") != BrowserFinanceOrigin+"/sso/callback" || len(destination.Query()) != 6 {
			t.Fatal("UI language modified registered authorization")
		}
		want := ""
		if language == "en" || language == "zh-CN" || language == "zh-Hant" {
			want = "lang=" + language
		}
		if destination.Fragment != want {
			t.Fatal("language fragment was not whitelisted")
		}
	}
}

func centralBrowserQAGateway(t *testing.T) string {
	t.Helper()
	script, err := filepath.Abs(filepath.Join("..", "..", "apps", "finance", "scripts", "central-browser-session-local-qa.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command("node", script)
	pipe, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = command.Process.Signal(syscall.SIGTERM); _ = command.Wait() })
	ready := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(pipe)
		if scanner.Scan() {
			ready <- scanner.Text()
		} else {
			ready <- ""
		}
	}()
	select {
	case line := <-ready:
		if !strings.HasPrefix(line, "FINANCE_CENTRAL_QA=http://127.0.0.1:") {
			t.Fatal("isolated central QA did not start")
		}
		return strings.TrimPrefix(line, "FINANCE_CENTRAL_QA=")
	case <-time.After(5 * time.Second):
		t.Fatal("isolated central QA startup exceeded deadline")
	}
	return ""
}

// Actual TLS product + durable NodeHost, isolated QA signing authority only.
// No installed Wallet/public/platform success is inferred from this test.
func TestCentralBrowserSilentRecoveryActualGatewayAndLogoutRace(t *testing.T) {
	gateway := centralBrowserQAGateway(t)
	store, err := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
	if err != nil {
		t.Fatal(err)
	}
	upstreams, _ := NewUpstreams("https://explorer.example", "", "", "https://support.example/disputes")
	auth, _ := testAuthenticator(t, "unused-private-proof")
	s, err := NewServer(&Service{Store: store, Upstreams: upstreams, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/disputes"}}, auth, ServerConfig{AllowedOrigins: []string{BrowserFinanceOrigin}, CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey, CentralBrowserSSO: true, WalletGatewayURL: gateway})
	if err != nil {
		t.Fatal(err)
	}
	product := httptest.NewTLSServer(s.Handler())
	defer product.Close()
	newClient := func() *http.Client {
		v := *product.Client()
		v.Timeout = 5 * time.Second
		v.Jar, _ = cookiejar.New(nil)
		v.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		return &v
	}
	client := newClient()
	get := func(c *http.Client, path string) *http.Response {
		response, err := c.Get(product.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		return response
	}
	centralGet := func(query string, cookie *http.Cookie) *http.Response {
		r, _ := http.NewRequest("GET", gateway+"/v2/browser-sessions/authorize?"+query, nil)
		if cookie != nil {
			r.AddCookie(cookie)
		}
		v := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		response, err := v.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		return response
	}
	start := get(client, "/sso/start?prompt=none&target=planning")
	u, _ := url.Parse(start.Header.Get("Location"))
	quietGuest := centralGet(u.RawQuery, nil)
	guestCallback, _ := url.Parse(quietGuest.Header.Get("Location"))
	if quietGuest.StatusCode != 303 || guestCallback.Query().Get("error") != "login_required" || quietGuest.Header.Get("Content-Type") == "text/html; charset=utf-8" {
		t.Fatal("quiet guest became interactive")
	}
	guest := get(client, guestCallback.RequestURI())
	if guest.StatusCode != 303 || guest.Header.Get("Location") != "/#planning" || get(client, "/api/sso/account").StatusCode != 401 {
		t.Fatal("quiet guest fabricated identity or lost target")
	}
	if get(client, "/sso/start?prompt=none&target=planning").Header.Get("Location") != "/#planning" {
		t.Fatal("quiet callback loops automatically")
	}
	start = get(client, "/sso/start?target=planning")
	u, _ = url.Parse(start.Header.Get("Location"))
	input := map[string]string{}
	for k, v := range u.Query() {
		input[k] = v[0]
	}
	boot, bootstrap := centralQARequest(t, gateway+"/v2/browser-sessions/bootstrap", nil, nil, "")
	transaction := boot.Cookies()[0]
	_, challenged := centralQARequest(t, gateway+"/v2/browser-sessions/challenge", input, transaction, bootstrap["csrfToken"].(string))
	_, approval := centralQARequest(t, gateway+"/__qa/approve", map[string]any{"challenge": challenged["challenge"], "account": "A"}, nil, "")
	completed, _ := centralQARequest(t, gateway+"/v2/browser-sessions/complete", approval, transaction, bootstrap["csrfToken"].(string))
	if completed.StatusCode != 200 {
		t.Fatal("isolated canonical consent failed")
	}
	central := completed.Cookies()[0]
	first := centralGet(u.RawQuery, central)
	callback, _ := url.Parse(first.Header.Get("Location"))
	if get(client, callback.RequestURI()).StatusCode != 303 {
		t.Fatal("explicit initial identity failed")
	}
	// A second product tab silently recovers from the existing root. Its
	// callback is deliberately delayed until after product-only logout.
	late := newClient()
	lateStart := get(late, "/sso/start?prompt=none&target=statements")
	lateURL, _ := url.Parse(lateStart.Header.Get("Location"))
	lateCode := centralGet(lateURL.RawQuery, central)
	lateCallback, _ := url.Parse(lateCode.Header.Get("Location"))
	if lateCode.StatusCode != 303 || lateCallback.Query().Get("code") == "" {
		t.Fatal("active root did not silently authorize identity")
	}
	accountResponse, err := client.Get(product.URL + "/api/sso/account")
	if err != nil {
		t.Fatal(err)
	}
	var account map[string]any
	_ = json.NewDecoder(accountResponse.Body).Decode(&account)
	accountResponse.Body.Close()
	r, _ := http.NewRequest("POST", product.URL+"/api/sso/logout", strings.NewReader("{}"))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", BrowserFinanceOrigin)
	r.Header.Set("X-YNX-SSO-CSRF", account["csrfToken"].(string))
	logout, err := client.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	logout.Body.Close()
	if logout.StatusCode != 200 {
		t.Fatal("product logout failed")
	}
	if get(late, lateCallback.RequestURI()).StatusCode == 303 || get(late, "/api/sso/account").StatusCode != 401 {
		t.Fatal("late silent code revived product identity")
	}
	if get(client, "/sso/start?prompt=none&target=planning").Header.Get("Location") != "/#planning" {
		t.Fatal("product logout did not suppress automatic sign-in")
	}
	// Explicit action can reuse the still-valid central root, without another
	// challenge/signature. The prior product-only logout is not global logout.
	start = get(client, "/sso/start?target=planning")
	u, _ = url.Parse(start.Header.Get("Location"))
	fresh := centralGet(u.RawQuery, central)
	callback, _ = url.Parse(fresh.Header.Get("Location"))
	if get(client, callback.RequestURI()).StatusCode != 303 || get(client, "/api/sso/account").StatusCode != 200 {
		t.Fatal("explicit restart did not reuse central identity")
	}
	_, rootBootstrap := centralQARequest(t, gateway+"/v2/browser-sessions/bootstrap", nil, central, "")
	rootLogout, _ := centralQARequest(t, gateway+"/v2/browser-sessions/logout", map[string]any{}, central, rootBootstrap["sessionCsrfToken"].(string))
	if rootLogout.StatusCode != 200 {
		t.Fatal("global logout failed")
	}
	if get(client, "/api/sso/account").StatusCode != 401 {
		t.Fatal("global logout preserved linked identity")
	}
	newTab := newClient()
	last := get(newTab, "/sso/start?prompt=none&target=statements")
	lastURL, _ := url.Parse(last.Header.Get("Location"))
	denied := centralGet(lastURL.RawQuery, central)
	deniedURL, _ := url.Parse(denied.Header.Get("Location"))
	if deniedURL.Query().Get("error") != "login_required" || get(newTab, deniedURL.RequestURI()).Header.Get("Location") != "/#statements" {
		t.Fatal("revoked root silent recovery was not quiet guest")
	}
}
func centralQARequest(t *testing.T, endpoint string, body any, cookie *http.Cookie, csrf string) (*http.Response, map[string]any) {
	t.Helper()
	var reader io.Reader
	method := "GET"
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(encoded)
		method = "POST"
	}
	request, err := http.NewRequest(method, endpoint, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", BrowserWalletAuthority)
	}
	if cookie != nil {
		request.AddCookie(cookie)
	}
	if csrf != "" {
		request.Header.Set("X-YNX-Browser-CSRF", csrf)
	}
	response, err := (&http.Client{Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var result map[string]any
	if response.StatusCode != 204 {
		if err = json.NewDecoder(response.Body).Decode(&result); err != nil {
			t.Fatal("isolated central response was invalid")
		}
	}
	return response, result
}
func TestCentralBrowserSSORealGatewayFinanceCookieOwnershipRecoveryAndLogout(t *testing.T) {
	gateway := centralBrowserQAGateway(t)
	store, err := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
	if err != nil {
		t.Fatal(err)
	}
	upstreams, err := NewUpstreams("https://explorer.example", "", "", "https://support.example/disputes")
	if err != nil {
		t.Fatal(err)
	}
	auth, _ := testAuthenticator(t, "unused-native-product-proof")
	server, err := NewServer(&Service{Store: store, Upstreams: upstreams, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/disputes"}}, auth, ServerConfig{AllowedOrigins: []string{BrowserFinanceOrigin}, CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey, CentralBrowserSSO: true, WalletGatewayURL: gateway})
	if err != nil {
		t.Fatal(err)
	}
	product := httptest.NewTLSServer(server.Handler())
	defer product.Close()
	clients := map[string]*http.Client{}
	accounts := map[string]string{}
	for _, account := range []string{"A", "B"} {
		jar, _ := cookiejar.New(nil)
		isolatedClient := *product.Client()
		isolatedClient.Timeout = 5 * time.Second
		client := &isolatedClient
		client.Jar = jar
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		clients[account] = client
		start, err := client.Get(product.URL + "/sso/start?target=planning")
		if err != nil {
			t.Fatal(err)
		}
		start.Body.Close()
		if start.StatusCode != 303 {
			t.Fatal("SSO start did not navigate to issuer")
		}
		location, err := url.Parse(start.Header.Get("Location"))
		if err != nil {
			t.Fatal(err)
		}
		parameters := location.Query()
		if location.Scheme+"://"+location.Host != BrowserWalletAuthority {
			t.Fatal("SSO issuer was not fixed")
		}
		// Repeated start keeps the original PKCE/state/target transaction.
		repeated, err := client.Get(product.URL + "/sso/start?target=assets")
		if err != nil {
			t.Fatal(err)
		}
		repeated.Body.Close()
		if repeated.Header.Get("Location") != start.Header.Get("Location") {
			t.Fatal("SSO start replaced an active pending transaction")
		}
		boot, bootstrap := centralQARequest(t, gateway+"/v2/browser-sessions/bootstrap", nil, nil, "")
		transaction := boot.Cookies()[0]
		initiator := map[string]string{}
		for key, values := range parameters {
			initiator[key] = values[0]
		}
		challenged, challenge := centralQARequest(t, gateway+"/v2/browser-sessions/challenge", initiator, transaction, bootstrap["csrfToken"].(string))
		if challenged.StatusCode != 200 {
			t.Fatal("real central challenge failed")
		}
		_, approval := centralQARequest(t, gateway+"/__qa/approve", map[string]any{"challenge": challenge["challenge"], "account": account}, nil, "")
		completed, _ := centralQARequest(t, gateway+"/v2/browser-sessions/complete", approval, transaction, bootstrap["csrfToken"].(string))
		if completed.StatusCode != 200 {
			t.Fatal("native canonical central consent was not verified")
		}
		central := completed.Cookies()[0]
		request, _ := http.NewRequest("GET", gateway+"/v2/browser-sessions/authorize?"+parameters.Encode(), nil)
		request.AddCookie(central)
		noRedirect := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		authorized, err := noRedirect.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		authorized.Body.Close()
		if authorized.StatusCode != 303 {
			t.Fatal("central browser did not authorize registered Finance")
		}
		callback, _ := url.Parse(authorized.Header.Get("Location"))
		callback.Path = "/sso/callback"
		wrong, err := client.Get(product.URL + "/sso/callback?code=" + url.QueryEscape(callback.Query().Get("code")) + "&state=wrong")
		if err != nil {
			t.Fatal(err)
		}
		wrong.Body.Close()
		if wrong.StatusCode != 400 {
			t.Fatal("wrong callback state was accepted")
		}
		finished, err := client.Get(product.URL + callback.RequestURI())
		if err != nil {
			t.Fatal(err)
		}
		finished.Body.Close()
		if finished.StatusCode != 303 || finished.Header.Get("Location") != "/#planning" {
			t.Fatal("SSO callback lost original target")
		}
		for _, cookie := range finished.Cookies() {
			if cookie.Name == financeSSOCookieName && (!cookie.Secure || !cookie.HttpOnly || cookie.Domain != "" || cookie.Path != "/") {
				t.Fatal("product cookie policy widened")
			}
		}
		accounts[account] = approval["account"].(string)
		owned, err := client.Get(product.URL + "/api/sso/account")
		if err != nil {
			t.Fatal(err)
		}
		var result map[string]any
		_ = json.NewDecoder(owned.Body).Decode(&result)
		owned.Body.Close()
		if owned.StatusCode != 200 || result["account"] != accounts[account] || result["privateWorkspaceAuthorized"] != false {
			t.Fatal("identity grant did not bind original native subject or widened private authority")
		}
		private, err := client.Get(product.URL + "/api/overview")
		if err != nil {
			t.Fatal(err)
		}
		private.Body.Close()
		if private.StatusCode != 401 {
			t.Fatal("identity grant bypassed native product scope approval")
		}
		replayed, err := client.Get(product.URL + callback.RequestURI())
		if err != nil {
			t.Fatal(err)
		}
		replayed.Body.Close()
		if replayed.StatusCode != 400 {
			t.Fatal("consumed callback was accepted")
		}
	}
	if accounts["A"] == accounts["B"] {
		t.Fatal("isolated native QA subjects were merged")
	}
	client := clients["A"]
	address, _ := url.Parse(product.URL)
	privateA := Session{Verifier: "wallet-auth-v2", ProductClient: "ynx-finance-v1", SessionBinding: strings.Repeat("a", 64), Account: accounts["A"], ExpiresAt: time.Now().Add(time.Hour)}
	privateRequest := func(account string) *http.Request {
		request, _ := http.NewRequest("GET", product.URL+"/api/overview", nil)
		for _, cookie := range clients[account].Jar.Cookies(address) {
			request.AddCookie(cookie)
		}
		return request
	}
	// Existing native permission is a separate input here; this assertion tests
	// durable browser association, not a substitute Wallet approval or core API.
	if server.authorizeBrowserSSOContext(privateRequest("B"), privateA) != 401 {
		t.Fatal("central B accepted existing native permission A")
	}
	var firstReads sync.WaitGroup
	results := make(chan int, 6)
	for i := 0; i < 6; i++ {
		firstReads.Add(1)
		go func() {
			defer firstReads.Done()
			results <- server.authorizeBrowserSSOContext(privateRequest("A"), privateA)
		}()
	}
	firstReads.Wait()
	close(results)
	for status := range results {
		if status != 200 {
			t.Fatal("same-account concurrent first private reads were not idempotent")
		}
	}
	if server.authorizeBrowserSSOContext(privateRequest("B"), privateA) != 401 {
		t.Fatal("linked native A crossed central browser B")
	}
	before := client.Jar.Cookies(address)
	_, _ = centralQARequest(t, gateway+"/__qa/unavailable", map[string]any{}, nil, "")
	unavailable, err := client.Get(product.URL + "/api/sso/account")
	if err != nil {
		t.Fatal(err)
	}
	unavailable.Body.Close()
	if unavailable.StatusCode != 503 {
		t.Fatal("temporary central failure was not distinct from logout")
	}
	after := client.Jar.Cookies(address)
	if len(after) != len(before) || after[0].Value != before[0].Value {
		t.Fatal("temporary failure cleared or rotated verified product cookie")
	}
	_, _ = centralQARequest(t, gateway+"/__qa/available", map[string]any{}, nil, "")
	verified, err := client.Get(product.URL + "/api/sso/account")
	if err != nil {
		t.Fatal(err)
	}
	var identityResult map[string]any
	_ = json.NewDecoder(verified.Body).Decode(&identityResult)
	verified.Body.Close()
	if verified.StatusCode != 200 {
		t.Fatal("same product session did not recover")
	}
	beforeLogout, err := client.Get(product.URL + "/sso/start?target=planning")
	if err != nil {
		t.Fatal(err)
	}
	beforeLogout.Body.Close()
	pendingLocation, _ := url.Parse(beforeLogout.Header.Get("Location"))
	logoutRequest, _ := http.NewRequest("POST", product.URL+"/api/sso/logout", strings.NewReader("{}"))
	logoutRequest.Header.Set("Origin", BrowserFinanceOrigin)
	logoutRequest.Header.Set("X-YNX-SSO-CSRF", identityResult["csrfToken"].(string))
	logout, err := client.Do(logoutRequest)
	if err != nil {
		t.Fatal(err)
	}
	logout.Body.Close()
	if logout.StatusCode != 200 {
		t.Fatal("product grant logout was not verified")
	}
	clearedPending := false
	for _, cookie := range logout.Cookies() {
		if cookie.Name == financeSSOPendingName && cookie.MaxAge < 0 {
			clearedPending = true
		}
	}
	if !clearedPending {
		t.Fatal("logout retained the pending callback cookie")
	}
	// Another tab shares the host-only cookie jar, not a JavaScript verifier.
	otherTab := *client
	late, err := otherTab.Get(product.URL + "/sso/callback?" + url.Values{"state": {pendingLocation.Query().Get("state")}, "code": {strings.Repeat("a", 43)}}.Encode())
	if err != nil {
		t.Fatal(err)
	}
	late.Body.Close()
	if late.StatusCode != 400 {
		t.Fatal("late callback after product logout was not rejected")
	}
	denied, err := client.Get(product.URL + "/api/sso/account")
	if err != nil {
		t.Fatal(err)
	}
	denied.Body.Close()
	if denied.StatusCode != 401 {
		t.Fatal("logout identity remained authorized")
	}
	withoutCookie, _ := http.NewRequest("GET", product.URL+"/api/overview", nil)
	if server.authorizeBrowserSSOContext(withoutCookie, privateA) != 401 {
		t.Fatal("clearing cookie bypassed linked product logout")
	}
	restartedStore, err := OpenStore(store.path)
	if err != nil {
		t.Fatal(err)
	}
	server.service.Store = restartedStore
	if server.authorizeBrowserSSOContext(withoutCookie, privateA) != 401 {
		t.Fatal("restart lost product logout association")
	}
	other, err := clients["B"].Get(product.URL + "/api/sso/account")
	if err != nil {
		t.Fatal(err)
	}
	other.Body.Close()
	if other.StatusCode != 200 {
		t.Fatal("one browser logout invalidated another QA browser")
	}
	t.Run("current-state-compatible-rollback", func(t *testing.T) {
		// Reproduce the pre-SSO persistedState reader without duplicating its
		// financial schema: its sole missing field is browserSSOBindings, and
		// it uses the same strict decoder. Version 2 does not imply old-reader
		// compatibility with a populated authorization association.
		restartedStore.mu.Lock()
		raw, marshalErr := json.Marshal(restartedStore.state)
		bindingsBefore, bindingErr := json.Marshal(restartedStore.state.BrowserSSOBindings)
		bindingCount := len(restartedStore.state.BrowserSSOBindings)
		version := restartedStore.state.Version
		restartedStore.mu.Unlock()
		if marshalErr != nil || bindingErr != nil || bindingCount == 0 || version != 2 {
			t.Fatal("rollback fixture needs populated version-2 associations")
		}
		currentType := reflect.TypeOf(persistedState{})
		fields := make([]reflect.StructField, 0, currentType.NumField()-1)
		for i := 0; i < currentType.NumField(); i++ {
			field := currentType.Field(i)
			if field.Name != "BrowserSSOBindings" {
				fields = append(fields, field)
			}
		}
		legacy := reflect.New(reflect.StructOf(fields)).Interface()
		if err := decodeStrictJSON(raw, legacy); err == nil || !strings.Contains(err.Error(), `unknown field "browserSSOBindings"`) {
			t.Fatal("pre-SSO strict reader did not reject new authorization history")
		}
		var oldShape map[string]json.RawMessage
		if err := json.Unmarshal(raw, &oldShape); err != nil {
			t.Fatal(err)
		}
		delete(oldShape, "browserSSOBindings")
		oldRaw, err := json.Marshal(oldShape)
		if err != nil || decodeStrictJSON(oldRaw, legacy) != nil {
			t.Fatal("legacy reader baseline is not the pre-SSO shape")
		}

		// Supported rollback keeps the current reader and current state, but
		// disables the entry point. It must not turn linked sessions native-only.
		server.cfg.CentralBrowserSSO = false
		if server.authorizeBrowserSSOContext(withoutCookie, privateA) != 401 {
			t.Fatal("disabled SSO bypassed persisted linked revocation")
		}
		categoryA, err := server.service.AddCategory(accounts["A"], "Rollback A", "#002FA7", "rollback-category-a")
		if err != nil {
			t.Fatal(err)
		}
		categoryB, err := server.service.AddCategory(accounts["B"], "Rollback B", "#002FA7", "rollback-category-b")
		if err != nil {
			t.Fatal(err)
		}
		reopened, err := OpenStore(store.path)
		if err != nil {
			t.Fatal(err)
		}
		server.service.Store = reopened
		if server.authorizeBrowserSSOContext(withoutCookie, privateA) != 401 {
			t.Fatal("save/reopen with SSO disabled lost linked rejection")
		}
		reopened.mu.Lock()
		defer reopened.mu.Unlock()
		bindingsAfter, err := json.Marshal(reopened.state.BrowserSSOBindings)
		if err != nil || !bytes.Equal(bindingsBefore, bindingsAfter) {
			t.Fatal("business save changed authorization associations")
		}
		for account, category := range map[string]Category{accounts["A"]: categoryA, accounts["B"]: categoryB} {
			state := reopened.state.Accounts[account]
			if len(state.Categories) != 1 || state.Categories[0].ID != category.ID || state.Categories[0].Name != category.Name {
				t.Fatal("current-state rollback lost or mixed owned categories")
			}
		}
	})
}

// Consumer fixtures exercise the real Finance HTTP handlers; no fixture is a
// claim that Central's durable protocol or a public Wallet flow has passed.
type finiteSSOFixture struct {
	pendingRevoke                           map[string]bool
	resolveError                            error
	mu                                      sync.Mutex
	now                                     func() time.Time
	grants                                  map[string]centralbrowserfamily.Grant
	intents                                 map[string]bool
	states                                  map[string]string
	prepares, redeems, resolves, activities int
	entered, resume                         chan struct{}
	uncertain                               bool
}

func (f *finiteSSOFixture) Prepare(_ context.Context, in centralbrowserfamily.PrepareInput) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.intents == nil {
		f.intents = map[string]bool{}
		f.states = map[string]string{}
	}
	f.prepares++
	id := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{byte(f.prepares)}, 32))
	f.intents[id] = false
	f.states[id] = in.State
	return id, nil
}
func (f *finiteSSOFixture) Redeem(_ context.Context, in centralbrowserfamily.PKCEInput) (centralbrowserfamily.Grant, error) {
	if f.entered != nil {
		close(f.entered)
		<-f.resume
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if fenced, ok := f.intents[in.IntentID]; !ok || fenced || f.states[in.IntentID] != in.State {
		return centralbrowserfamily.Grant{}, &centralbrowserfamily.Error{Code: centralbrowserfamily.CodeFenced}
	}
	f.redeems++
	id := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{byte(f.redeems + 100)}, 32))
	account, _ := accountaddress.Encode(fmt.Sprintf("0x%040x", f.redeems))
	now := f.now()
	g := centralbrowserfamily.Grant{FamilyID: id, GrantToken: strings.Repeat("g", 43), Identity: centralbrowserfamily.Identity{Subject: account, Account: account, Generation: 1, ExpiresAt: now.Add(2 * time.Hour)}, Audience: financeSSOAudience, Scopes: []string{"identity:read"}, ExpiresAt: now.Add(5 * time.Minute), AbsoluteExpiresAt: now.Add(2 * time.Hour), IdleExpiresAt: now.Add(30 * time.Minute), ApprovedProfile: "fixture-reviewed", ApprovedClientsDigest: strings.Repeat("a", 64)}
	if f.grants == nil {
		f.grants = map[string]centralbrowserfamily.Grant{}
	}
	f.grants[id] = g
	return g, nil
}
func (f *finiteSSOFixture) Resolve(_ context.Context, id string) (centralbrowserfamily.Grant, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.resolves++
	if f.resolveError != nil {
		return centralbrowserfamily.Grant{}, f.resolveError
	}
	if f.pendingRevoke[id] {
		return centralbrowserfamily.Grant{}, &centralbrowserfamily.Error{Code: centralbrowserfamily.CodeFenced, LocallyFenced: true, RevocationPending: true}
	}
	g, ok := f.grants[id]
	if !ok || !g.IdleExpiresAt.After(f.now()) || !g.AbsoluteExpiresAt.After(f.now()) {
		return g, &centralbrowserfamily.Error{Code: centralbrowserfamily.CodeLoginRequired}
	}
	if !g.ExpiresAt.After(f.now().Add(time.Minute)) {
		g.ExpiresAt = f.now().Add(5 * time.Minute)
		if g.ExpiresAt.After(g.IdleExpiresAt) {
			g.ExpiresAt = g.IdleExpiresAt
		}
		if g.ExpiresAt.After(g.AbsoluteExpiresAt) {
			g.ExpiresAt = g.AbsoluteExpiresAt
		}
		f.grants[id] = g
	}
	return g, nil
}
func (f *finiteSSOFixture) Activity(_ context.Context, id, event string, at time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	g, ok := f.grants[id]
	if !ok || !g.IdleExpiresAt.After(f.now()) || !g.AbsoluteExpiresAt.After(f.now()) {
		return &centralbrowserfamily.Error{Code: centralbrowserfamily.CodeLoginRequired}
	}
	f.activities++
	g.IdleExpiresAt = at.Add(30 * time.Minute)
	if g.IdleExpiresAt.After(g.AbsoluteExpiresAt) {
		g.IdleExpiresAt = g.AbsoluteExpiresAt
	}
	f.grants[id] = g
	return nil
}
func (f *finiteSSOFixture) Logout(_ context.Context, in centralbrowserfamily.LogoutInput) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.grants, in.FamilyID)
	if in.IntentID != "" {
		f.intents[in.IntentID] = true
	}
	if f.uncertain {
		if f.pendingRevoke == nil {
			f.pendingRevoke = map[string]bool{}
		}
		f.pendingRevoke[in.FamilyID] = true
		return &centralbrowserfamily.Error{Code: centralbrowserfamily.CodeUnavailable, LocallyFenced: true, RevocationPending: true}
	}
	delete(f.pendingRevoke, in.FamilyID)
	return nil
}
func finiteSSOServer(now *time.Time) (*Server, *finiteSSOFixture) {
	f := &finiteSSOFixture{now: func() time.Time { return *now }}
	return &Server{cfg: ServerConfig{CentralBrowserSSO: true, CentralBrowserFamily: f, WalletGatewayURL: BrowserWalletAuthority, CursorSigningKey: testCursorKey}, now: f.now}, f
}
func finiteSSOStart(t *testing.T, s *Server, previous *http.Cookie) (*http.Cookie, string) {
	t.Helper()
	r := httptest.NewRequest("GET", BrowserFinanceOrigin+"/sso/start?target=planning", nil)
	if previous != nil {
		r.AddCookie(previous)
	}
	w := httptest.NewRecorder()
	s.ssoStart(w, r)
	if w.Code != 303 {
		t.Fatal(w.Code, w.Body.String())
	}
	u, _ := url.Parse(w.Header().Get("Location"))
	for _, c := range w.Result().Cookies() {
		if c.Name == financeSSOPendingName {
			return c, u.Query().Get("state")
		}
	}
	t.Fatal("pending missing")
	return nil, ""
}
func finiteSSOComplete(t *testing.T, s *Server, pending *http.Cookie, state string) *http.Cookie {
	t.Helper()
	r := httptest.NewRequest("GET", BrowserFinanceOrigin+"/sso/callback?state="+state+"&code="+strings.Repeat("c", 43), nil)
	r.AddCookie(pending)
	w := httptest.NewRecorder()
	s.ssoCallback(w, r)
	if w.Code != 303 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == financeSSOCookieName {
			return c
		}
	}
	t.Fatal("family missing")
	return nil
}
func finiteSSOReference(t *testing.T, s *Server, cookie *http.Cookie) financeSSOFamilyReference {
	t.Helper()
	r := httptest.NewRequest("GET", "/", nil)
	r.AddCookie(cookie)
	var ref financeSSOFamilyReference
	if s.openSSOCookie(r, financeSSOCookieName, &ref) != nil {
		t.Fatal("cookie contains fields beyond opaque family+csrf")
	}
	return ref
}
func finiteSSOAccount(s *Server, cookie *http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest("GET", BrowserFinanceOrigin+"/api/sso/account", nil)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	s.ssoAccount(w, r)
	return w
}
func TestFinanceFiniteOpaqueCookieRenewAndIndependentUsers(t *testing.T) {
	now := time.Now().UTC()
	s, f := finiteSSOServer(&now)
	p, a := finiteSSOStart(t, s, nil)
	one := finiteSSOComplete(t, s, p, a)
	p, b := finiteSSOStart(t, s, nil)
	two := finiteSSOComplete(t, s, p, b)
	ref := finiteSSOReference(t, s, one)
	if one.MaxAge != 7200 || one.Expires.Before(now.Add(119*time.Minute)) {
		t.Fatal("cookie is bound to short access/idle lifetime")
	}
	if ref.FamilyID == finiteSSOReference(t, s, two).FamilyID {
		t.Fatal("users share family")
	}
	now = now.Add(6 * time.Minute)
	for _, cookie := range []*http.Cookie{one, two} {
		w := finiteSSOAccount(s, cookie)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"privateWorkspaceAuthorized":false`) {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if f.redeems != 2 || f.activities != 0 {
		t.Fatal("read silently logs in or attests activity")
	}
	now = now.Add(25 * time.Minute)
	if finiteSSOAccount(s, one).Code != 401 {
		t.Fatal("passive reads extended idle")
	}
}
func TestFinanceFiniteLogoutFencesInflightCallbackWithoutAffectingOtherBrowser(t *testing.T) {
	now := time.Now().UTC()
	s, f := finiteSSOServer(&now)
	p, state := finiteSSOStart(t, s, nil)
	cookie := finiteSSOComplete(t, s, p, state)
	ref := finiteSSOReference(t, s, cookie)
	old, state := finiteSSOStart(t, s, cookie)
	other, otherState := finiteSSOStart(t, s, nil)
	f.entered = make(chan struct{})
	f.resume = make(chan struct{})
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		r := httptest.NewRequest("GET", BrowserFinanceOrigin+"/sso/callback?state="+state+"&code="+strings.Repeat("c", 43), nil)
		r.AddCookie(old)
		w := httptest.NewRecorder()
		s.ssoCallback(w, r)
		done <- w
	}()
	<-f.entered
	r := httptest.NewRequest("POST", BrowserFinanceOrigin+"/api/sso/logout", strings.NewReader("{}"))
	r.Header.Set("Origin", BrowserFinanceOrigin)
	r.Header.Set("X-YNX-SSO-CSRF", ref.CSRF)
	r.AddCookie(cookie)
	r.AddCookie(old)
	w := httptest.NewRecorder()
	s.ssoLogout(w, r)
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	close(f.resume)
	late := <-done
	for _, c := range late.Result().Cookies() {
		if c.Name == financeSSOCookieName && c.Value != "" {
			t.Fatal("late callback installed old family")
		}
	}
	if late.Code == 303 {
		t.Fatal("fenced callback succeeds")
	}
	f.entered = nil
	f.resume = nil
	otherCookie := finiteSSOComplete(t, s, other, otherState)
	if finiteSSOAccount(s, otherCookie).Code != 200 || finiteSSOAccount(s, cookie).Code != 401 {
		t.Fatal("logout isolation failed")
	}
}
func TestFinanceFiniteActivityCSRFExpiryAndUncertainLogout(t *testing.T) {
	now := time.Now().UTC()
	s, f := finiteSSOServer(&now)
	p, state := finiteSSOStart(t, s, nil)
	cookie := finiteSSOComplete(t, s, p, state)
	ref := finiteSSOReference(t, s, cookie)
	for _, sample := range []struct {
		origin, csrf, action string
		at                   time.Time
		want                 int
	}{{"https://evil.invalid", ref.CSRF, "navigate", now, 403}, {BrowserFinanceOrigin, "wrong", "navigate", now, 403}, {BrowserFinanceOrigin, ref.CSRF, "poll", now, 400}, {BrowserFinanceOrigin, ref.CSRF, "navigate", now.Add(-31 * time.Second), 400}, {BrowserFinanceOrigin, ref.CSRF, "navigate", now.Add(time.Second), 400}, {BrowserFinanceOrigin, ref.CSRF, "navigate", now, 200}} {
		body, _ := json.Marshal(map[string]any{"eventId": strings.Repeat("a", 43), "action": sample.action, "observedAt": sample.at})
		r := httptest.NewRequest("POST", "/api/sso/activity", bytes.NewReader(body))
		r.Header.Set("Origin", sample.origin)
		r.Header.Set("X-YNX-SSO-CSRF", sample.csrf)
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		s.ssoActivity(w, r)
		if w.Code != sample.want {
			t.Fatal(w.Code, sample.want, w.Body.String())
		}
	}
	if f.activities != 1 {
		t.Fatal("invalid event attested")
	}
	f.uncertain = true
	r := httptest.NewRequest("POST", "/api/sso/logout", nil)
	r.Header.Set("Origin", BrowserFinanceOrigin)
	r.Header.Set("X-YNX-SSO-CSRF", ref.CSRF)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	s.ssoLogout(w, r)
	if w.Code != 503 || finiteSSOAccount(s, cookie).Code != 503 {
		t.Fatal("uncertain logout revived family")
	}
}

func TestFinanceFiniteRealCentralErrorsAndExpiredCookieReentry(t *testing.T) {
	now := time.Now().UTC()
	s, f := finiteSSOServer(&now)
	p, state := finiteSSOStart(t, s, nil)
	cookie := finiteSSOComplete(t, s, p, state)
	// These are actual codes from CentralBrowserSessionAuthority/HTTP, not fixture-only codes.
	for _, code := range []string{"SSO_GRANT_INVALID", "SSO_FAMILY_INVALID", "SSO_GENERATION_REVOKED"} {
		f.resolveError = &centralbrowserfamily.Error{Code: code}
		w := finiteSSOAccount(s, cookie)
		if w.Code != 401 {
			t.Fatal(code, w.Code)
		}
		cleared := false
		for _, c := range w.Result().Cookies() {
			if c.Name == financeSSOCookieName && c.MaxAge == -1 {
				cleared = true
			}
		}
		if !cleared {
			t.Fatal("invalid family cookie stranded user")
		}
	}
	f.resolveError = &centralbrowserfamily.Error{Code: centralbrowserfamily.CodeUnavailable}
	if w := finiteSSOAccount(s, cookie); w.Code != 503 || len(w.Result().Cookies()) != 0 {
		t.Fatal("network error discarded credentials")
	}
	f.resolveError = nil
	now = now.Add(31 * time.Minute)
	pending, newState := finiteSSOStart(t, s, cookie)
	newCookie := finiteSSOComplete(t, s, pending, newState)
	if finiteSSOAccount(s, newCookie).Code != 200 {
		t.Fatal("idle expiry blocked explicit new sign in")
	}
}
func TestFinanceFinitePrivatePermissionKeepsOwnExpiryAndInvalidScopeRejected(t *testing.T) {
	now := time.Now().UTC()
	s, f := finiteSSOServer(&now)
	store, err := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
	if err != nil {
		t.Fatal(err)
	}
	s.service = &Service{Store: store}
	p, state := finiteSSOStart(t, s, nil)
	cookie := finiteSSOComplete(t, s, p, state)
	ref := finiteSSOReference(t, s, cookie)
	grant := f.grants[ref.FamilyID]
	session := Session{Account: grant.Identity.Account, Verifier: "fixture-private-proof", ProductClient: "ynx-finance-v1", SessionBinding: "fixture-private-session", ExpiresAt: now.Add(240 * time.Second)}
	r := httptest.NewRequest("GET", "/api/overview", nil)
	r.AddCookie(cookie)
	if s.authorizeBrowserSSOContext(r, session) != 200 {
		t.Fatal("family cannot bind existing private session")
	}
	binding, ok, err := store.browserSSOBinding(browserSSOBindingKey(session))
	if err != nil || !ok || !binding.ExpiresAt.Equal(session.ExpiresAt) {
		t.Fatal("private expiry changed")
	}
	now = now.Add(241 * time.Second)
	if finiteSSOAccount(s, cookie).Code != 200 || s.authorizeBrowserSSOContext(r, session) != 401 {
		t.Fatal("identity renewal expanded 240s private permission")
	}
	g := f.grants[ref.FamilyID]
	g.Scopes = append(g.Scopes, "finance:write")
	f.grants[ref.FamilyID] = g
	if finiteSSOAccount(s, cookie).Code != 401 {
		t.Fatal("scope superset accepted")
	}
}
func TestFinanceFinitePendingLogoutSurvivesReloadAndRetry(t *testing.T) {
	now := time.Now().UTC()
	s, f := finiteSSOServer(&now)
	p, state := finiteSSOStart(t, s, nil)
	cookie := finiteSSOComplete(t, s, p, state)
	ref := finiteSSOReference(t, s, cookie)
	f.uncertain = true
	r := httptest.NewRequest("POST", "/api/sso/logout", nil)
	r.Header.Set("Origin", BrowserFinanceOrigin)
	r.Header.Set("X-YNX-SSO-CSRF", ref.CSRF)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	s.ssoLogout(w, r)
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
	account := finiteSSOAccount(s, cookie)
	if account.Code != 503 || !strings.Contains(account.Body.String(), `"revocationPending":true`) || strings.Contains(account.Body.String(), `"account"`) {
		t.Fatal("reload lost retry or restored identity", account.Body.String())
	}
	f.uncertain = false
	w = httptest.NewRecorder()
	s.ssoLogout(w, r)
	if w.Code != 200 {
		t.Fatal("retry cannot confirm")
	}
	p, state = finiteSSOStart(t, s, cookie)
	fresh := finiteSSOComplete(t, s, p, state)
	if finiteSSOAccount(s, fresh).Code != 200 {
		t.Fatal("confirmed logout cannot sign in again")
	}
}

func TestFinanceFiniteActivityCannotExtendAbsoluteAndIsBounded(t *testing.T) {
	now := time.Now().UTC()
	s, f := finiteSSOServer(&now)
	p, state := finiteSSOStart(t, s, nil)
	cookie := finiteSSOComplete(t, s, p, state)
	ref := finiteSSOReference(t, s, cookie)
	absolute := f.grants[ref.FamilyID].AbsoluteExpiresAt
	send := func(event int) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]any{"eventId": base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{byte(event)}, 32)), "action": "save", "observedAt": now})
		r := httptest.NewRequest("POST", "/api/sso/activity", bytes.NewReader(body))
		r.Header.Set("Origin", BrowserFinanceOrigin)
		r.Header.Set("X-YNX-SSO-CSRF", ref.CSRF)
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		s.ssoActivity(w, r)
		return w
	}
	for i := 1; i <= 5; i++ {
		now = now.Add(20 * time.Minute)
		if send(i).Code != 200 || finiteSSOAccount(s, cookie).Code != 200 {
			t.Fatal("valid user activity denied")
		}
	}
	if !f.grants[ref.FamilyID].AbsoluteExpiresAt.Equal(absolute) {
		t.Fatal("absolute identity deadline reset")
	}
	for i := 6; i <= 16; i++ {
		if send(i).Code != 200 {
			t.Fatal("bounded user events unexpectedly denied")
		}
	}
	if send(17).Code != 429 {
		t.Fatal("event burst unbounded")
	}
	now = absolute
	if finiteSSOAccount(s, cookie).Code != 401 || send(18).Code != 401 {
		t.Fatal("activity/refresh resurrected absolute expired session")
	}
}

func TestFinanceFiniteFirstVisitSilentAndInvalidFamilyExplicitOnly(t *testing.T) {
	now := time.Now().UTC()
	s, f := finiteSSOServer(&now)
	initial := httptest.NewRecorder()
	s.ssoAccount(initial, httptest.NewRequest("GET", "/api/sso/account", nil))
	if initial.Code != 401 || !strings.Contains(initial.Body.String(), `"silentRestoreAllowed":true`) {
		t.Fatal("first product visit cannot silently restore", initial.Body.String())
	}
	start := httptest.NewRecorder()
	s.ssoStart(start, httptest.NewRequest("GET", BrowserFinanceOrigin+"/sso/start?prompt=none", nil))
	if start.Code != 303 || !strings.Contains(start.Header().Get("Location"), "prompt=none") {
		t.Fatal("first silent intent does not reach original Central authorize")
	}
	p, state := finiteSSOStart(t, s, nil)
	cookie := finiteSSOComplete(t, s, p, state)
	f.resolveError = &centralbrowserfamily.Error{Code: "SSO_GENERATION_REVOKED"}
	invalid := finiteSSOAccount(s, cookie)
	if invalid.Code != 401 || !strings.Contains(invalid.Body.String(), `"silentRestoreAllowed":false`) {
		t.Fatal("revoked family allowed passive regrant")
	}
	var marker *http.Cookie
	for _, c := range invalid.Result().Cookies() {
		if c.Name == financeSSOCookieName+"-signedout" {
			marker = c
		}
	}
	if marker == nil {
		t.Fatal("no durable product opt-out after invalid family")
	}
	r := httptest.NewRequest("GET", BrowserFinanceOrigin+"/sso/start?prompt=none", nil)
	r.AddCookie(marker)
	denied := httptest.NewRecorder()
	s.ssoStart(denied, r)
	if denied.Code != 303 || strings.HasPrefix(denied.Header().Get("Location"), BrowserWalletAuthority) {
		t.Fatal("reload silently replaces revoked family")
	}
	// A direct silent URL with the old cookie must also avoid Prepare/regrant.
	direct := httptest.NewRequest("GET", BrowserFinanceOrigin+"/sso/start?prompt=none", nil)
	direct.AddCookie(cookie)
	denied = httptest.NewRecorder()
	s.ssoStart(denied, direct)
	if denied.Code != 303 || strings.HasPrefix(denied.Header().Get("Location"), BrowserWalletAuthority) {
		t.Fatal("direct silent request replaced invalid family")
	}
	f.resolveError = nil
	now = now.Add(31 * time.Minute)
	idle := finiteSSOAccount(s, cookie)
	if idle.Code != 401 || !strings.Contains(idle.Body.String(), `"silentRestoreAllowed":false`) {
		t.Fatal("expired idle family allowed passive regrant")
	}
	// Explicit login clears only this product marker and remains usable.
	explicit := httptest.NewRequest("GET", BrowserFinanceOrigin+"/sso/start", nil)
	explicit.AddCookie(marker)
	approved := httptest.NewRecorder()
	s.ssoStart(approved, explicit)
	if approved.Code != 303 || !strings.HasPrefix(approved.Header().Get("Location"), BrowserWalletAuthority) {
		t.Fatal("explicit login blocked by product marker")
	}
}
