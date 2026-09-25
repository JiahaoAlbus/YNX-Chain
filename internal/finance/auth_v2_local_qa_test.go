package finance

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// This opt-in test is driven by Finance's isolated browser/Gateway QA. The
// transport changes only the socket destination: the verifier still sends its
// canonical authority URL, proof, policy and request to the real Node host.
func TestLocalNodeHostProductSessionBridge(t *testing.T) {
	endpoint, proof, expectedAccount := os.Getenv("YNX_FINANCE_QA_GATEWAY_LOOPBACK"), os.Getenv("YNX_FINANCE_QA_PROOF_HEADER"), os.Getenv("YNX_FINANCE_QA_ACCOUNT")
	if endpoint == "" && proof == "" && expectedAccount == "" {
		t.Skip("isolated QA Gateway/browser proof not supplied")
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" || parsed.Port() == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.String() != endpoint || proof == "" || !strings.HasPrefix(expectedAccount, "ynx1") {
		t.Fatal("isolated QA contract is invalid")
	}
	transport := financeRoundTrip(func(request *http.Request) (*http.Response, error) {
		if request.URL.Scheme != "https" || request.URL.Host != "wallet-auth.ynxweb4.com" || request.URL.Path != "/v2/product-sessions/introspect" {
			t.Fatal("Finance verifier attempted a noncanonical authority route")
		}
		forwarded := request.Clone(request.Context())
		forwarded.URL.Scheme, forwarded.URL.Host = "http", parsed.Host
		forwarded.Host = parsed.Host
		return http.DefaultTransport.RoundTrip(forwarded)
	})
	auth, err := newBrowserV2Authenticator(transport, allowFinanceAuthority)
	if err != nil {
		t.Fatal(err)
	}
	explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "isolated QA upstream unavailable", http.StatusServiceUnavailable)
	}))
	defer explorer.Close()
	upstreams, err := NewUpstreams(explorer.URL, "", "", "https://support.invalid/disputes")
	if err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(&Service{Store: store, Upstreams: upstreams, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.invalid/help", PrivacyURL: "https://support.invalid/privacy", DisputeURL: "https://support.invalid/disputes"}}, auth, ServerConfig{AllowedOrigins: []string{BrowserFinanceOrigin}, CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey})
	if err != nil {
		t.Fatal(err)
	}
	product := httptest.NewServer(server.Handler())
	defer product.Close()
	call := func() (*http.Response, error) {
		request, err := http.NewRequest(http.MethodGet, product.URL+"/api/overview", nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Origin", BrowserFinanceOrigin)
		request.Header.Set(productsessionv2.ProofHeader, proof)
		return http.DefaultClient.Do(request)
	}
	response, err := call()
	if err != nil {
		t.Fatal(err)
	}
	var overview struct {
		Portfolio struct {
			Account string `json:"account"`
		} `json:"portfolio"`
	}
	decodeErr := json.NewDecoder(response.Body).Decode(&overview)
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("real Finance protected /api/overview rejected browser proof: %d", response.StatusCode)
	}
	if decodeErr != nil || overview.Portfolio.Account != expectedAccount {
		t.Fatalf("real Finance overview did not bind the approved account: decode=%v", decodeErr)
	}
	response, err = call()
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("real Finance protected /api/overview did not reject proof replay: %d", response.StatusCode)
	}
}
