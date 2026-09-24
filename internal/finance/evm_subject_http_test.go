package finance

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func evmSubjectGET(t *testing.T, url string, proof json.RawMessage) (*http.Response, map[string]any) {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", BrowserFinanceOrigin)
	request.Header.Set(evmSubjectProofHeader, base64.RawURLEncoding.EncodeToString(proof))
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return response, body
}

func TestEVMSubjectHTTPRealWalletProofAndBrokerIsolation(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node runtime unavailable")
	}
	script, _ := filepath.Abs(filepath.Join("..", "..", "apps", "finance", "scripts", "evm-subject-authority.bundle.mjs"))
	fixture, _ := filepath.Abs(filepath.Join("..", "..", "apps", "finance", "tests", "fixtures", "evm-subject-sign.mjs"))
	if _, err := os.Stat(filepath.Join("..", "..", "packages", "wallet-auth", "node_modules", "@noble", "curves")); err != nil {
		t.Skip("Wallet/Auth test dependencies unavailable")
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
	upstreams, err := NewUpstreams("https://explorer.example", "", "", "https://support.example/dispute")
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{Store: store, Upstreams: upstreams, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/dispute"}}
	auth, _ := testAuthenticator(t, "evm-subject-native-isolation")
	server, err := NewServer(service, auth, ServerConfig{AllowedOrigins: []string{BrowserFinanceOrigin}, CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey, EVMSubjectAuthority: authority, Now: func() time.Time { return clock }})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(server.Handler())
	defer ts.Close()
	var identity struct {
		Account     string `json:"account"`
		AccountType string `json:"accountType"`
		DeviceID    string `json:"deviceId"`
		DeviceKey   string `json:"deviceKey"`
	}
	if err := json.Unmarshal(evmReadFixture(t, node, fixture, map[string]any{"action": "identity"}), &identity); err != nil {
		t.Fatal(err)
	}
	challengeInput := map[string]any{"account": identity.Account, "accountType": identity.AccountType, "deviceId": identity.DeviceID, "deviceKey": identity.DeviceKey}
	if response, _ := postEVMLogin(t, ts.URL+"/api/evm-subject/challenges", challengeInput, ""); response.StatusCode != http.StatusForbidden {
		t.Fatal("originless EVM-only challenge accepted")
	}
	response, issued := postEVMLogin(t, ts.URL+"/api/evm-subject/challenges", challengeInput, BrowserFinanceOrigin)
	if response.StatusCode != http.StatusCreated || issued["brokerAuthorized"] != false {
		t.Fatalf("EVM subject challenge rejected: %d %#v", response.StatusCode, issued)
	}
	challenge := issued["challenge"]
	proof := evmReadFixture(t, node, fixture, map[string]any{"action": "login", "challenge": challenge})
	response, sessionResult := postEVMLogin(t, ts.URL+"/api/evm-subject/sessions", map[string]any{"proof": proof}, BrowserFinanceOrigin)
	if response.StatusCode != http.StatusCreated || sessionResult["brokerAuthorized"] != false || sessionResult["evmSubjectReadAuthorized"] != true {
		t.Fatalf("EVM subject session rejected: %d %#v", response.StatusCode, sessionResult)
	}
	session := sessionResult["session"]
	sessionMap := session.(map[string]any)
	if sessionMap["nativeAccount"] != nil || !strings.HasPrefix(sessionMap["subjectId"].(string), "evm_subject_") {
		t.Fatalf("EVM-only session crossed native identity: %#v", sessionMap)
	}
	reopened, err := OpenStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.EVMSubjectSession(sessionMap["sessionId"].(string)); err != nil {
		t.Fatalf("EVM-only session did not persist: %v", err)
	}
	if response, _ := postEVMLogin(t, ts.URL+"/api/evm-subject/sessions", map[string]any{"proof": proof}, BrowserFinanceOrigin); response.StatusCode == http.StatusCreated {
		t.Fatal("replayed subject login issued a second session")
	}
	clock = clock.Add(2 * time.Second)
	readInput := map[string]any{"method": "GET", "target": evmSubjectIdentityPath, "bodyDigest": evmReadEmptyBodyDigest, "nonce": "finance_subject_read_nonce_0123456789abcdef", "issuedAt": evmReadTime(clock), "expiresAt": evmReadTime(clock.Add(30 * time.Second))}
	readProof := evmReadFixture(t, node, fixture, map[string]any{"action": "read", "session": session, "request": readInput})
	for _, path := range []string{"/api/broker/orders", "/api/broker/snapshot"} {
		request, _ := http.NewRequest(http.MethodGet, ts.URL+path, nil)
		request.Header.Set("Origin", BrowserFinanceOrigin)
		request.Header.Set(evmSubjectProofHeader, base64.RawURLEncoding.EncodeToString(readProof))
		privateResponse, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		_ = privateResponse.Body.Close()
		if privateResponse.StatusCode != http.StatusUnauthorized {
			t.Fatalf("EVM-only proof accessed native Broker route %s: %d", path, privateResponse.StatusCode)
		}
	}
	response, result := evmSubjectGET(t, ts.URL+evmSubjectIdentityPath, readProof)
	if response.StatusCode != http.StatusOK || result["evmAccount"] != identity.Account || result["brokerAuthorized"] != false || result["nativeAccount"] != nil {
		t.Fatalf("EVM-only private read failed: %d %#v", response.StatusCode, result)
	}
	if response, _ := evmSubjectGET(t, ts.URL+evmSubjectIdentityPath, readProof); response.StatusCode == http.StatusOK {
		t.Fatal("replayed private read proof accepted")
	}
	wrongTargetInput := map[string]any{"method": "GET", "target": evmSubjectIdentityPath, "bodyDigest": evmReadEmptyBodyDigest, "nonce": "finance_subject_wrong_target_0123456789abcdef", "issuedAt": evmReadTime(clock), "expiresAt": evmReadTime(clock.Add(30 * time.Second))}
	wrongTargetProof := evmReadFixture(t, node, fixture, map[string]any{"action": "read", "session": session, "request": wrongTargetInput})
	if response, _ := evmSubjectGET(t, ts.URL+evmSubjectIdentityPath+"?changed=1", wrongTargetProof); response.StatusCode == http.StatusOK {
		t.Fatal("proof accepted a different raw query target")
	}
	revokeInput := map[string]any{"bodyDigest": evmReadEmptyBodyDigest, "nonce": "finance_subject_revoke_nonce_0123456789abcdef", "issuedAt": evmReadTime(clock), "expiresAt": evmReadTime(clock.Add(30 * time.Second))}
	revokeProof := evmReadFixture(t, node, fixture, map[string]any{"action": "revoke", "session": session, "request": revokeInput})
	revokeRequest, _ := http.NewRequest(http.MethodPost, ts.URL+evmSubjectRevokePath, nil)
	revokeRequest.Header.Set("Origin", BrowserFinanceOrigin)
	revokeRequest.Header.Set(evmSubjectProofHeader, base64.RawURLEncoding.EncodeToString(revokeProof))
	revokeResponse, err := http.DefaultClient.Do(revokeRequest)
	if err != nil {
		t.Fatal(err)
	}
	_ = revokeResponse.Body.Close()
	if revokeResponse.StatusCode != http.StatusOK {
		t.Fatalf("EVM subject revoke rejected: %d", revokeResponse.StatusCode)
	}
	if response, _ := evmSubjectGET(t, ts.URL+evmSubjectIdentityPath, wrongTargetProof); response.StatusCode == http.StatusOK {
		t.Fatal("revoked subject session remained readable")
	}
}
