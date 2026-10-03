package exchangeproduct

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

type supportPostgresFixtureGateway map[string]WalletSession

func (g supportPostgresFixtureGateway) Authorize(proof, scope, clientID, bundleID string) (WalletSession, error) {
	if clientID != "ynx-exchange-v1" || bundleID != "com.ynxweb4.exchange" || scope != "exchange:read" {
		return WalletSession{}, ErrForbidden
	}
	session, ok := g[proof]
	if !ok || proof == "" {
		return WalletSession{}, ErrUnauthorized
	}
	return session, nil
}

// Real database/HTTP test with isolated legacy test Wallet sessions. It does
// not grant the current Web v2 read proof permission to use write routes.
func TestPostgreSQLOwnedSupportTwoHTTPInstancesIsolationAndRestart(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_EXCHANGE_POSTGRES_TEST_URL is required")
	}
	cfg := Config{StateDatabaseURL: databaseURL, APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback"}
	seed := reopenSupportService(t, cfg)
	a := accountSession(t, seed, alice, "pg-support-alice", "exchange:read")
	b := accountSession(t, seed, bob, "pg-support-bob", "exchange:read")
	// Only this isolated test authorizer recognizes these fixture sessions.
	// Session issuance alone intentionally does not authorize HTTP in production.
	cfg.Gateway = supportPostgresFixtureGateway{a.token: a.session, b.token: b.session}
	cfg.GatewayClientID, cfg.GatewayBundleID = "ynx-exchange-v1", "com.ynxweb4.exchange"
	first, second := reopenSupportService(t, cfg), reopenSupportService(t, cfg)
	one, two := httptest.NewServer(NewServer(first)), httptest.NewServer(NewServer(second))
	t.Cleanup(one.Close)
	t.Cleanup(two.Close)
	client := &http.Client{Timeout: 5 * time.Second}
	type response struct {
		status int
		body   []byte
		err    error
	}
	request := func(base, method, route, token string, body []byte) response {
		req, err := http.NewRequest(method, base+route, bytes.NewReader(body))
		if err != nil {
			return response{err: err}
		}
		req.Header.Set("X-YNX-Product-Session-Proof", token)
		req.Header.Set("Content-Type", "application/json")
		res, err := client.Do(req)
		if err != nil {
			return response{err: err}
		}
		defer res.Body.Close()
		raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		return response{status: res.StatusCode, body: raw, err: err}
	}
	body := []byte(`{"category":"account","message":"Please review my account settings.","idempotencyKey":"pg-owned-support-same-intent"}`)
	start, results := make(chan struct{}), make(chan response, 2)
	for _, base := range []string{one.URL, two.URL} {
		go func(base string) {
			<-start
			results <- request(base, http.MethodPost, "/v1/support", a.token, body)
		}(base)
	}
	close(start)
	var created SupportCase
	successes := 0
	for i := 0; i < 2; i++ {
		r := <-results
		if r.err != nil || r.status != http.StatusCreated && r.status != http.StatusConflict {
			t.Fatalf("concurrent support status=%d err=%v", r.status, r.err)
		}
		if r.status == http.StatusCreated {
			var record SupportCase
			if err := json.Unmarshal(r.body, &record); err != nil || record.Account != alice || record.ID == "" {
				t.Fatal("invalid owned support response")
			}
			if successes > 0 && record != created {
				t.Fatal("same intent produced different support records")
			}
			created = record
			successes++
		}
	}
	if successes == 0 {
		t.Fatal("no concurrent writer committed")
	}
	durable := reopenSupportService(t, cfg)
	before := digest(durable.state)
	for _, base := range []string{one.URL, two.URL} {
		retry := request(base, http.MethodPost, "/v1/support", a.token, body)
		var record SupportCase
		if retry.err != nil || retry.status != http.StatusCreated || json.Unmarshal(retry.body, &record) != nil || record != created {
			t.Fatal("explicit retry did not recover the exact committed case")
		}
		foreign := request(base, http.MethodPost, "/v1/support", b.token, body)
		if foreign.err != nil || foreign.status != http.StatusConflict || bytes.Contains(foreign.body, []byte(created.ID)) {
			t.Fatal("cross-account key reuse leaked a case or succeeded")
		}
		changed := request(base, http.MethodPost, "/v1/support", a.token, bytes.Replace(body, []byte("Please review my account settings."), []byte("Please review a different account settings issue."), 1))
		if changed.err != nil || changed.status != http.StatusConflict {
			t.Fatal("changed intent reused the committed idempotency key")
		}
	}
	if digest(reopenSupportService(t, cfg).state) != before {
		t.Fatal("idempotent/foreign retries changed durable state or audit")
	}
	bobBody := []byte(`{"category":"account","message":"Please review my own account settings.","idempotencyKey":"pg-owned-support-bob-intent"}`)
	if r := request(two.URL, http.MethodPost, "/v1/support", b.token, bobBody); r.err != nil || r.status != http.StatusCreated {
		t.Fatalf("second owner create status=%d err=%v", r.status, r.err)
	}
	// Reopening the actual service pool and HTTP server must retain both owners.
	restarted := httptest.NewServer(NewServer(reopenSupportService(t, cfg)))
	t.Cleanup(restarted.Close)
	for _, base := range []string{one.URL, two.URL, restarted.URL} {
		unauthorized := request(base, http.MethodGet, "/v1/account", "unknown-test-proof", nil)
		if unauthorized.err != nil || unauthorized.status != http.StatusUnauthorized || bytes.Contains(unauthorized.body, []byte(created.ID)) {
			t.Fatal("unrecognized proof read or leaked account data")
		}
		for _, owner := range []testAccount{a, b} {
			r := request(base, http.MethodGet, "/v1/account", owner.token, nil)
			var snapshot AccountSnapshot
			if r.err != nil || r.status != http.StatusOK || json.Unmarshal(r.body, &snapshot) != nil || len(snapshot.Support) != 1 || snapshot.Support[0].Account != owner.account {
				t.Fatalf("isolated account read status=%d err=%v", r.status, r.err)
			}
			if owner.account == alice && snapshot.Support[0] != created {
				t.Fatal("restart/read changed the first owner's case")
			}
		}
	}
}
