package finance

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func evmReadFixture(t *testing.T, node, script string, input any) json.RawMessage {
	t.Helper()
	encoded, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(node, script)
	command.Stdin = bytes.NewReader(encoded)
	output, err := command.Output()
	if err != nil || !json.Valid(output) {
		t.Fatalf("Wallet/Auth test signer failed: %v", err)
	}
	return json.RawMessage(output)
}

func evmReadGET(t *testing.T, url string, proof json.RawMessage, origin string) (*http.Response, map[string]any) {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", origin)
	request.Header.Set(evmReadProofHeader, base64.RawURLEncoding.EncodeToString(proof))
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(io.LimitReader(response.Body, 128<<10)).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return response, body
}

func TestEVMReadHTTPRealWalletProofDurableOwnershipAndRevoke(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node runtime is unavailable")
	}
	script, err := filepath.Abs(filepath.Join("..", "..", "apps", "finance", "scripts", "evm-read-session-authority.bundle.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	fixture, err := filepath.Abs(filepath.Join("..", "..", "apps", "finance", "tests", "fixtures", "evm-read-sign.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	dependencies := filepath.Join("..", "..", "packages", "wallet-auth", "node_modules", "@noble", "curves")
	if _, err := os.Stat(dependencies); err != nil {
		t.Skip("install Wallet/Auth npm dependencies to run the real HTTP proof fixture")
	}
	authority, err := NewNodeEVMReadAuthority(node, script, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	clock := time.Now().UTC().Truncate(time.Millisecond)
	storePath := filepath.Join(t.TempDir(), "finance.json")
	store, err := OpenStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	var expectedAccount string
	explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/health":
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "nativeSymbol": "YNXT", "truthfulStatus": "indexed-with-reported-lag", "lastCheckedAt": clock})
		case r.URL.Path == "/api/accounts/"+expectedAccount:
			_ = json.NewEncoder(w).Encode(map[string]any{"account": map[string]any{"address": expectedAccount, "balance": 123, "staked": 4}})
		case r.URL.Path == "/api/txs":
			_ = json.NewEncoder(w).Encode(map[string]any{"transactions": []any{}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer explorer.Close()
	upstreams, err := NewUpstreams(explorer.URL, "", "", "https://support.example/dispute")
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{Store: store, Upstreams: upstreams, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/dispute"}}
	auth, _ := testAuthenticator(t, "evm-read-native-isolation")
	server, err := NewServer(service, auth, ServerConfig{AllowedOrigins: []string{BrowserFinanceOrigin}, CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey, EVMReadAuthority: authority, Now: func() time.Time { return clock }})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(server.Handler())
	defer ts.Close()
	var identity struct {
		Account   string `json:"account"`
		DeviceID  string `json:"deviceId"`
		DeviceKey string `json:"deviceKey"`
	}
	if err := json.Unmarshal(evmReadFixture(t, node, fixture, map[string]any{"action": "identity"}), &identity); err != nil {
		t.Fatal(err)
	}
	expectedAccount = identity.Account
	challengeURL := ts.URL + "/api/evm-read/challenges"
	if response, _ := postEVMLogin(t, challengeURL, map[string]any{"account": identity.Account, "providerKind": "metamask", "deviceId": identity.DeviceID, "deviceKey": identity.DeviceKey}, ""); response.StatusCode != http.StatusForbidden {
		t.Fatal("originless EVM read challenge was accepted")
	}
	response, issued := postEVMLogin(t, challengeURL, map[string]any{"account": identity.Account, "providerKind": "metamask", "deviceId": identity.DeviceID, "deviceKey": identity.DeviceKey}, BrowserFinanceOrigin)
	if response.StatusCode != http.StatusCreated || issued["privateFinanceAuthorized"] != false {
		t.Fatalf("EVM read challenge failed: status=%d body=%#v", response.StatusCode, issued)
	}
	challenge := issued["challenge"]
	proof := evmReadFixture(t, node, fixture, map[string]any{"action": "login", "challenge": challenge})
	response, sessionResult := postEVMLogin(t, ts.URL+"/api/evm-read/sessions", map[string]any{"proof": proof}, BrowserFinanceOrigin)
	if response.StatusCode != http.StatusCreated || sessionResult["privateFinanceAuthorized"] != false || sessionResult["evmAccountReadAuthorized"] != true || sessionResult["extensionLiveStateAttested"] != false {
		t.Fatalf("EVM session issue failed: status=%d body=%#v", response.StatusCode, sessionResult)
	}
	session := sessionResult["session"]
	reopened, err := OpenStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.EVMReadSession(session.(map[string]any)["sessionId"].(string)); err != nil {
		t.Fatalf("EVM session not durable across stores: %v", err)
	}
	if response, _ := postEVMLogin(t, ts.URL+"/api/evm-read/sessions", map[string]any{"proof": proof}, BrowserFinanceOrigin); response.StatusCode == http.StatusCreated {
		t.Fatal("login proof replay issued a second session")
	}
	clock = clock.Add(2 * time.Second)
	target := evmReadPortfolioPath + "?view=balances"
	readInput := map[string]any{"method": "GET", "target": target, "bodyDigest": evmReadEmptyBodyDigest, "nonce": "finance_read_nonce_0123456789abcdef", "issuedAt": evmReadTime(clock), "expiresAt": evmReadTime(clock.Add(30 * time.Second))}
	readProof := evmReadFixture(t, node, fixture, map[string]any{"action": "read", "session": session, "request": readInput})
	response, portfolio := evmReadGET(t, ts.URL+target, readProof, BrowserFinanceOrigin)
	if response.StatusCode != http.StatusOK || portfolio["account"] != identity.Account || portfolio["privateFinanceAuthorized"] != false || portfolio["evmAccountReadAuthorized"] != true {
		t.Fatalf("EVM account-bound read failed: status=%d body=%#v", response.StatusCode, portfolio)
	}
	owned := portfolio["portfolio"].(map[string]any)
	if owned["balanceYnxt"] != float64(123) || owned["account"] != identity.Account {
		t.Fatalf("Explorer-backed account ownership was lost: %#v", owned)
	}
	browserGETInput := map[string]any{"method": "GET", "target": target, "bodyDigest": evmReadEmptyBodyDigest, "nonce": "finance_browser_get_nonce_0123456789abcdef", "issuedAt": evmReadTime(clock), "expiresAt": evmReadTime(clock.Add(30 * time.Second))}
	browserGETProof := evmReadFixture(t, node, fixture, map[string]any{"action": "read", "session": session, "request": browserGETInput})
	browserGET, err := http.NewRequest(http.MethodGet, ts.URL+target, nil)
	if err != nil {
		t.Fatal(err)
	}
	browserGET.Host = "finance.ynxweb4.com"
	browserGET.Header.Set("Sec-Fetch-Site", "same-origin")
	browserGET.Header.Set("Sec-Fetch-Mode", "cors")
	browserGET.Header.Set("Sec-Fetch-Dest", "empty")
	browserGET.Header.Set(evmReadProofHeader, base64.RawURLEncoding.EncodeToString(browserGETProof))
	browserResponse, err := http.DefaultClient.Do(browserGET)
	if err != nil {
		t.Fatal(err)
	}
	_ = browserResponse.Body.Close()
	if browserResponse.StatusCode != http.StatusOK {
		t.Fatalf("same-origin Chromium GET without Origin was rejected: %d", browserResponse.StatusCode)
	}
	missingMetadata, _ := http.NewRequest(http.MethodGet, ts.URL+target, nil)
	missingMetadata.Host = "finance.ynxweb4.com"
	missingMetadata.Header.Set(evmReadProofHeader, base64.RawURLEncoding.EncodeToString(browserGETProof))
	missingResponse, err := http.DefaultClient.Do(missingMetadata)
	if err != nil {
		t.Fatal(err)
	}
	_ = missingResponse.Body.Close()
	if missingResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("originless GET without browser metadata was accepted: %d", missingResponse.StatusCode)
	}
	for _, mismatch := range []struct {
		host string
		site string
	}{{"attacker.example", "same-origin"}, {"finance.ynxweb4.com", "cross-site"}} {
		request, _ := http.NewRequest(http.MethodGet, ts.URL+target, nil)
		request.Host = mismatch.host
		request.Header.Set("Sec-Fetch-Site", mismatch.site)
		request.Header.Set("Sec-Fetch-Mode", "cors")
		request.Header.Set("Sec-Fetch-Dest", "empty")
		request.Header.Set(evmReadProofHeader, base64.RawURLEncoding.EncodeToString(browserGETProof))
		denied, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		_ = denied.Body.Close()
		if denied.StatusCode != http.StatusForbidden {
			t.Fatalf("originless GET with host/site mismatch was accepted: host=%s site=%s status=%d", mismatch.host, mismatch.site, denied.StatusCode)
		}
	}
	if response, _ := evmReadGET(t, ts.URL+target, readProof, BrowserFinanceOrigin); response.StatusCode == http.StatusOK {
		t.Fatal("HTTP proof replay read private EVM account data")
	}
	changed := map[string]any{"method": "GET", "target": target, "bodyDigest": evmReadEmptyBodyDigest, "nonce": "finance_changed_nonce_0123456789abcdef", "issuedAt": evmReadTime(clock), "expiresAt": evmReadTime(clock.Add(30 * time.Second))}
	changedProof := evmReadFixture(t, node, fixture, map[string]any{"action": "read", "session": session, "request": changed})
	if response, _ := evmReadGET(t, ts.URL+evmReadPortfolioPath+"?view=orders", changedProof, BrowserFinanceOrigin); response.StatusCode == http.StatusOK {
		t.Fatal("changed raw query was accepted")
	}
	if response, _ := evmReadGET(t, ts.URL+target, changedProof, "https://other.ynxweb4.com"); response.StatusCode == http.StatusOK {
		t.Fatal("cross-origin read was accepted")
	}
	native, err := http.Get(ts.URL + "/api/overview")
	if err != nil {
		t.Fatal(err)
	}
	_ = native.Body.Close()
	if native.StatusCode == http.StatusOK {
		t.Fatal("EVM read session widened native v2 overview authority")
	}
	clock = clock.Add(time.Second)
	revokeInput := map[string]any{"bodyDigest": evmReadEmptyBodyDigest, "nonce": "finance_revoke_nonce_0123456789abcdef", "issuedAt": evmReadTime(clock), "expiresAt": evmReadTime(clock.Add(30 * time.Second))}
	revokeProof := evmReadFixture(t, node, fixture, map[string]any{"action": "revoke", "session": session, "request": revokeInput})
	revokeRequest, _ := http.NewRequest(http.MethodPost, ts.URL+evmReadRevokePath, nil)
	revokeRequest.Header.Set("Origin", BrowserFinanceOrigin)
	revokeRequest.Header.Set(evmReadProofHeader, base64.RawURLEncoding.EncodeToString(revokeProof))
	revoked, err := http.DefaultClient.Do(revokeRequest)
	if err != nil {
		t.Fatal(err)
	}
	_ = revoked.Body.Close()
	if revoked.StatusCode != http.StatusOK {
		t.Fatalf("authenticated EVM revoke failed: %d", revoked.StatusCode)
	}
	if response, _ := evmReadGET(t, ts.URL+target, changedProof, BrowserFinanceOrigin); response.StatusCode == http.StatusOK {
		t.Fatal("revoked session read account data")
	}
	if revokedAgain, err := http.DefaultClient.Do(revokeRequest); err == nil {
		_ = revokedAgain.Body.Close()
		if revokedAgain.StatusCode == http.StatusOK {
			t.Fatal("replayed revoke was accepted")
		}
	}
	if !strings.HasPrefix(session.(map[string]any)["account"].(string), "0x") {
		t.Fatal("session account is not a canonical EVM account")
	}
}
