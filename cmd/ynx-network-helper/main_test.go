package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"
)

const knownTx = "0x5469bfc2a41b76150b765122e4dc5e02c3bbe66886c24f46efe0dfd60edea5ac"

func fixture(t *testing.T, rpc string) (*helper, *httptest.Server) {
	t.Helper()
	s := httptest.NewUnstartedServer(nil)
	origin := "http://" + s.Listener.Addr().String()
	h := newHelper(origin, "local-test-uid", "operator-code", rpc, nil)
	s.Config.Handler = h
	s.Start()
	t.Cleanup(s.Close)
	return h, s
}
func call(t *testing.T, s *httptest.Server, path, origin, ticket string, body any) (int, map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(body)
	r, err := http.NewRequest(http.MethodPost, s.URL+path, bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", origin)
	if ticket != "" {
		r.Header.Set("Authorization", "Bearer "+ticket)
	}
	res, err := s.Client().Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var result map[string]any
	if err = json.NewDecoder(res.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	return res.StatusCode, result
}
func pair(t *testing.T, s *httptest.Server) string {
	t.Helper()
	code, ch := call(t, s, "/api/pair/challenge", s.URL, "", nil)
	if code != 200 {
		t.Fatalf("challenge: %d %v", code, ch)
	}
	code, p := call(t, s, "/api/pair", s.URL, "", map[string]string{"challenge": ch["challenge"].(string), "code": "operator-code"})
	if code != 200 {
		t.Fatalf("pair: %d %v", code, p)
	}
	return p["ticket"].(string)
}

func TestTP0903RejectsForeignOriginUnpairedAndHost(t *testing.T) {
	_, s := fixture(t, "https://rpc.example")
	if code, _ := call(t, s, "/api/pair/challenge", "https://attacker.example", "", nil); code != 403 {
		t.Fatalf("foreign origin = %d", code)
	}
	if code, _ := call(t, s, "/api/status", s.URL, "", nil); code != 401 {
		t.Fatalf("unpaired = %d", code)
	}
	request, _ := http.NewRequest(http.MethodGet, s.URL+"/", nil)
	request.Host = "attacker.example"
	res, err := s.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatalf("DNS rebinding host = %d", res.StatusCode)
	}
}
func TestTP0903ChallengeReplayAndRevocation(t *testing.T) {
	_, s := fixture(t, "https://rpc.example")
	_, ch := call(t, s, "/api/pair/challenge", s.URL, "", nil)
	input := map[string]string{"challenge": ch["challenge"].(string), "code": "operator-code"}
	code, out := call(t, s, "/api/pair", s.URL, "", input)
	if code != 200 {
		t.Fatalf("pair = %d", code)
	}
	ticket := out["ticket"].(string)
	if code, _ := call(t, s, "/api/pair", s.URL, "", input); code != 403 {
		t.Fatalf("replay = %d", code)
	}
	if code, out := call(t, s, "/api/status", s.URL, ticket, nil); code != 200 || out["helperOsUid"] != "local-test-uid" || out["callerOsIdentityVerified"] != false || out["assurance"] != "local-code-origin-ticket" || out["contribution"] != "disabled" {
		t.Fatalf("status = %d %v", code, out)
	}
	if code, _ := call(t, s, "/api/status", "https://attacker.example", ticket, nil); code != 403 {
		t.Fatalf("foreign origin with stolen ticket = %d", code)
	}
	if code, _ := call(t, s, "/api/revoke", s.URL, ticket, nil); code != 200 {
		t.Fatal(code)
	}
	if code, _ := call(t, s, "/api/verify", s.URL, ticket, map[string]any{"txId": knownTx, "proof": map[string]string{}}); code != 401 {
		t.Fatalf("revoked verify = %d", code)
	}
	if code, _ := call(t, s, "/api/pair/challenge", s.URL, "", nil); code != 403 {
		t.Fatalf("reused boot code = %d", code)
	}
}
func TestTP0903ExpiredChallengeAndTicket(t *testing.T) {
	h, s := fixture(t, "https://rpc.example")
	now := time.Now()
	h.now = func() time.Time { return now }
	_, ch := call(t, s, "/api/pair/challenge", s.URL, "", nil)
	now = now.Add(time.Minute)
	if code, _ := call(t, s, "/api/pair", s.URL, "", map[string]string{"challenge": ch["challenge"].(string), "code": "operator-code"}); code != 403 {
		t.Fatalf("expired challenge = %d", code)
	}
	ticket := pair(t, s)
	now = now.Add(ticketLife)
	if code, _ := call(t, s, "/api/status", s.URL, ticket, nil); code != 401 {
		t.Fatalf("expired ticket = %d", code)
	}
}
func TestTP0903WrongApprovalConsumesChallenge(t *testing.T) {
	_, s := fixture(t, "https://rpc.example")
	_, ch := call(t, s, "/api/pair/challenge", s.URL, "", nil)
	input := map[string]string{"challenge": ch["challenge"].(string), "code": "wrong"}
	if code, _ := call(t, s, "/api/pair", s.URL, "", input); code != 403 {
		t.Fatal(code)
	}
	input["code"] = "operator-code"
	if code, _ := call(t, s, "/api/pair", s.URL, "", input); code != 403 {
		t.Fatalf("consumed challenge = %d", code)
	}
}
func TestTP0902RealHTTPEntryFakeRPCNeverPromotes(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/txs/"+knownTx {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"hash":"`+knownTx+`","blockNumber":112195,"status":"success","amount":"999999","events":[{"paid":true}]}`)
	}))
	defer upstream.Close()
	_, s := fixture(t, upstream.URL)
	res, err := s.Client().Get(s.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || !strings.Contains(string(raw), "STATE_VERIFIED") {
		t.Fatalf("PWA entry = %d", res.StatusCode)
	}
	if strings.Contains(string(raw), "operator-code") {
		t.Fatal("pairing secret leaked into page")
	}
	ticket := pair(t, s)
	code, out := call(t, s, "/api/lookup", s.URL, ticket, map[string]string{"txId": knownTx})
	if code != 200 {
		t.Fatalf("lookup = %d %v", code, out)
	}
	view := out["view"].(map[string]any)
	if view["level"] != "RPC_ONLY" {
		t.Fatalf("fake RPC promoted: %v", view)
	}
	if calls != 1 {
		t.Fatalf("lookup requests = %d", calls)
	}
	code, out = call(t, s, "/api/verify", s.URL, ticket, map[string]any{"txId": knownTx, "proof": map[string]any{"source": "fake RPC", "height": "112195", "stateProof": map[string]any{"success": true, "member": "0"}}})
	if code != 200 {
		t.Fatalf("verify = %d %v", code, out)
	}
	if out["level"] != "RPC_ONLY" {
		t.Fatalf("claimed state promoted: %v", out)
	}
	if code, _ := call(t, s, "/api/lookup", s.URL, ticket, map[string]string{"txId": "../../secret"}); code != 400 {
		t.Fatal(code)
	}
	if calls != 1 {
		t.Fatal("invalid tx reached upstream")
	}
}
func TestTP0902RPCFailureAndRedirectRemainFailures(t *testing.T) {
	for _, status := range []int{302, 404, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if status == 302 {
					w.Header().Set("Location", "https://attacker.example")
				}
				w.WriteHeader(status)
			}))
			defer upstream.Close()
			_, s := fixture(t, upstream.URL)
			ticket := pair(t, s)
			code, out := call(t, s, "/api/lookup", s.URL, ticket, map[string]string{"txId": knownTx})
			if code != 502 || out["view"] != nil {
				t.Fatalf("failure yielded receipt = %d %v", code, out)
			}
		})
	}
}
func TestHelperRPCConfiguration(t *testing.T) {
	for _, u := range []string{"http://public.example", "https://user:pass@public.example", "https://example.com?secret=x", "file:///etc/passwd"} {
		if validRPC(u) == nil {
			t.Errorf("accepted %q", u)
		}
	}
	for _, u := range []string{"https://rpc.ynxweb4.com", "http://127.0.0.1:1234"} {
		if err := validRPC(u); err != nil {
			t.Errorf("refused %q: %v", u, err)
		}
	}
}

// Keep the actual browser state regression in the existing Go CI closure.
func TestNetworkPWAStateBindings(t *testing.T) {
	output, err := exec.Command("node", "--test", "../../apps/network/web/app.test.mjs").CombinedOutput()
	if err != nil {
		t.Fatalf("PWA behavior regression failed (node is required): %v\n%s", err, output)
	}
	t.Logf("%s", output)
}
