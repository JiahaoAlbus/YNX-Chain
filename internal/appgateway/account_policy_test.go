package appgateway

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

// Rejection regressions can unexpectedly receive a minted test token on a
// vulnerable baseline. Report only statuses, never that response body.
func policyCreateChallenge(t *testing.T, base string, owner ownershipFixture, want int) ChallengeResponse {
	t.Helper()
	body, _ := json.Marshal(ChallengeRequest{Account: owner.account, DeviceID: owner.deviceID, DeviceSigningPublicKey: owner.devicePublic})
	resp, err := http.DefaultClient.Do(mustRequest(t, http.MethodPost, base+"/app/session/challenges", body, testOrigin))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != want {
		t.Fatalf("challenge status %d want %d", resp.StatusCode, want)
	}
	var challenge ChallengeResponse
	if want == http.StatusCreated {
		if json.NewDecoder(resp.Body).Decode(&challenge) != nil {
			t.Fatal("invalid challenge response")
		}
	}
	return challenge
}

func policyVerifyChallenge(t *testing.T, base string, challenge ChallengeResponse, owner ownershipFixture, want int) SessionResponse {
	t.Helper()
	signBytes, err := base64.RawStdEncoding.DecodeString(challenge.SignBytes)
	if err != nil {
		t.Fatal("invalid test sign bytes")
	}
	digest := sha256.Sum256(signBytes)
	body, _ := json.Marshal(VerifyChallengeRequest{AccountPublicKey: owner.accountPublic, AccountSignature: hex.EncodeToString(ecdsa.Sign(owner.accountPrivate, digest[:]).Serialize()), DeviceSignature: nativewallet.Sign(owner.devicePrivate, signBytes)})
	resp, err := http.DefaultClient.Do(mustRequest(t, http.MethodPost, base+"/app/session/challenges/"+challenge.ChallengeID+"/verify", body, testOrigin))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != want {
		t.Fatalf("verification status %d want %d", resp.StatusCode, want)
	}
	var session SessionResponse
	if want == http.StatusCreated {
		if json.NewDecoder(resp.Body).Decode(&session) != nil {
			t.Fatal("invalid session response")
		}
	}
	return session
}

func freshPolicyOwner(t *testing.T) ownershipFixture {
	t.Helper()
	private, err := secp256k1.GeneratePrivateKey()
	if err != nil {
		t.Fatal("test account key generation failed")
	}
	canonical, err := consensus.NativeAddress(private.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	account, err := accountaddress.Encode(canonical)
	if err != nil {
		t.Fatal(err)
	}
	devicePublic, devicePrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal("test device key generation failed")
	}
	return ownershipFixture{accountPrivate: private, accountPublic: hex.EncodeToString(private.PubKey().SerializeCompressed()), account: account, devicePrivate: devicePrivate, devicePublic: nativewallet.EncodePublicKey(devicePublic), deviceID: "policy-test-device"}
}

// Existing legacy lifecycle tests use a real Core read-only policy endpoint,
// explicitly installed for a future height; no production fallback is implied.
func configureLegacyPolicy(t *testing.T, cfg *Config) {
	t.Helper()
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if err := d.EnableAccountPQ(100); err != nil {
		t.Fatal(err)
	}
	state, _ := d.AccountAuthorization("0x" + strings.Repeat("1", 40))
	core := httptest.NewServer(api.NewServer(d))
	t.Cleanup(core.Close)
	cfg.AccountPolicyURL, cfg.AccountPolicyNetworkID = core.URL, hex.EncodeToString(state.NetworkID)
}

// The synthetic history below is only a negative admission test: public bytes
// are never submitted as a migration or used to grant a PQ/canonical session.
type policyTestRegistry struct {
	mu      sync.Mutex
	mutate  func(map[string]any)
	chainID string
}

func (p *policyTestRegistry) handler(w http.ResponseWriter, r *http.Request) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if r.URL.Path == "/evm" {
		var request struct {
			Method string `json:"method"`
		}
		if json.NewDecoder(r.Body).Decode(&request) != nil || request.Method != "eth_chainId" {
			w.WriteHeader(400)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": p.chainID})
		return
	}
	owner := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/accounts/"), "/authorization")
	v := map[string]any{"owner": owner, "executionHeight": "9", "ledgerNonce": "1", "algorithmVersion": "legacy", "enabled": true, "policyVersion": ynxauth.PolicyVersion, "networkId": strings.Repeat("ab", 32), "enableAt": "1", "records": []any{}}
	v["policyView"], v["source"], v["recordsView"] = "next_execution", "authoritative_producer", "includes_pending"
	if p.mutate != nil {
		p.mutate(v)
	}
	_ = json.NewEncoder(w).Encode(v)
}
func (p *policyTestRegistry) set(f func(map[string]any)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.mutate = f
}
func activePolicy(v map[string]any) {
	v["executionHeight"], v["algorithmVersion"], v["activeRevision"] = "10", ynxbatch.Version, "1"
	v["records"] = []any{map[string]any{"algorithmVersion": ynxbatch.Version, "owner": v["owner"], "pkA": strings.Repeat("01", ynxbatch.PublicKeyASize), "pkB": strings.Repeat("02", ynxbatch.PublicKeyBSize), "revision": "1", "registeredAt": "2", "activeFrom": "10", "ledgerNonce": "1"}}
}
func policyTestGateway(t *testing.T) (*Gateway, *policyTestRegistry, *httptest.Server) {
	t.Helper()
	_, chat := startUpstream(t, "chat", "X-YNX-Chat-Key", testChatKey)
	_, square := startUpstream(t, "square", "X-YNX-Square-Key", testSquareKey)
	cfg := testConfig(t, chat.URL, square.URL, 100)
	p := &policyTestRegistry{chainID: "0x1917"}
	registry := httptest.NewServer(http.HandlerFunc(p.handler))
	t.Cleanup(registry.Close)
	cfg.AccountPolicyURL, cfg.AccountPolicyNetworkID = registry.URL, strings.Repeat("ab", 32)
	g, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewServer(NewServer(g).Handler())
	t.Cleanup(s.Close)
	return g, p, s
}

func TestClassicSessionPolicyChecksChallengeVerificationAndReuse(t *testing.T) {
	g, p, s := policyTestGateway(t)
	owner := freshPolicyOwner(t)
	p.set(activePolicy)
	policyCreateChallenge(t, s.URL, owner, http.StatusForbidden)
	if len(g.state.Challenges) != 0 {
		t.Fatal("active PQ created classic challenge")
	}
	p.set(nil)
	challenge := policyCreateChallenge(t, s.URL, owner, http.StatusCreated)
	p.set(activePolicy)
	policyVerifyChallenge(t, s.URL, challenge, owner, http.StatusForbidden)
	if g.state.Challenges[challenge.ChallengeID].Status != "pending" || len(g.state.Sessions) != 0 {
		t.Fatal("policy denial consumed challenge or minted session")
	}
	p.set(nil)
	session := policyVerifyChallenge(t, s.URL, challenge, owner, http.StatusCreated)
	p.set(activePolicy)
	resp := protectedRequest(t, s.URL, http.MethodPost, "/app/square/posts", map[string]any{"content": "blocked"}, owner.deviceID, session.Token, testOrigin)
	if resp.Code != http.StatusForbidden || !strings.Contains(resp.Body.String(), "pq_session_required") {
		t.Fatal("classic session remained usable after activation")
	}
	if g.state.Sessions[session.SessionID].Status != "active" {
		t.Fatal("policy denial rewrote persisted session lifecycle")
	}
	if err := g.RevokeSession(testOrigin, session.Token, owner.deviceID); err != nil {
		t.Fatal("holder could not revoke blocked session")
	}
}

func TestClassicSessionPolicyRejectsUnknownOrInconsistentRegistry(t *testing.T) {
	for name, mutate := range map[string]func(map[string]any){
		"committed-only view":      func(v map[string]any) { v["policyView"] = "committed" },
		"missing provenance":       func(v map[string]any) { delete(v, "source") },
		"truncated history view":   func(v map[string]any) { v["recordsView"] = "active_only" },
		"missing policy":           func(v map[string]any) { delete(v, "networkId") },
		"disabled unknown":         func(v map[string]any) { v["enabled"] = false },
		"wrong network":            func(v map[string]any) { v["networkId"] = strings.Repeat("cd", 32) },
		"wrong owner":              func(v map[string]any) { v["owner"] = "0x" + strings.Repeat("0", 40) },
		"noncanonical height":      func(v map[string]any) { v["executionHeight"] = "09" },
		"numeric height":           func(v map[string]any) { v["executionHeight"] = 9 },
		"overflow height":          func(v map[string]any) { v["executionHeight"] = "18446744073709551616" },
		"omitted history":          func(v map[string]any) { delete(v, "records") },
		"false legacy summary":     func(v map[string]any) { activePolicy(v); v["algorithmVersion"] = "legacy"; delete(v, "activeRevision") },
		"wrong active revision":    func(v map[string]any) { activePolicy(v); v["activeRevision"] = "2" },
		"missing history revision": func(v map[string]any) { activePolicy(v); v["records"].([]any)[0].(map[string]any)["revision"] = "2" },
		"future registration":      func(v map[string]any) { activePolicy(v); v["executionHeight"] = "1" },
		"wrong public key length":  func(v map[string]any) { activePolicy(v); v["records"].([]any)[0].(map[string]any)["pkA"] = "00" },
	} {
		t.Run(name, func(t *testing.T) {
			g, p, s := policyTestGateway(t)
			p.set(mutate)
			owner := freshPolicyOwner(t)
			policyCreateChallenge(t, s.URL, owner, http.StatusServiceUnavailable)
			if len(g.state.Challenges) != 0 {
				t.Fatal("unknown policy created challenge")
			}
		})
	}
}

func TestClassicSessionPendingPolicyAndUint64Height(t *testing.T) {
	_, p, s := policyTestGateway(t)
	owner := freshPolicyOwner(t)
	p.set(func(v map[string]any) {
		activePolicy(v)
		v["executionHeight"] = "9"
		v["algorithmVersion"] = "legacy"
		delete(v, "activeRevision")
	})
	policyCreateChallenge(t, s.URL, owner, http.StatusCreated)
	p.set(func(v map[string]any) {
		v["enableAt"] = "18446744073709551615"
		v["executionHeight"] = "18446744073709551614"
	})
	policyCreateChallenge(t, s.URL, owner, http.StatusCreated)
}

func TestClassicSessionUnconfiguredRegistryDoesNotBlockCanonicalProxy(t *testing.T) {
	g, _, s := policyTestGateway(t)
	g.cfg.AccountPolicyURL, g.cfg.AccountPolicyNetworkID = "", ""
	owner := freshPolicyOwner(t)
	policyCreateChallenge(t, s.URL, owner, http.StatusServiceUnavailable)
	req := mustRequest(t, http.MethodPost, s.URL+"/v1/wallet/session", []byte(`{}`), testOrigin)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatal("classic policy gate intercepted canonical Wallet proxy")
	}
}

func TestClassicSessionRegistryTransportFailsClosed(t *testing.T) {
	for _, value := range []string{"0x1918", "0x01917", "0x10000000000000000", "6423", "0X1917"} {
		t.Run("chain-"+value, func(t *testing.T) {
			_, p, s := policyTestGateway(t)
			p.mu.Lock()
			p.chainID = value
			p.mu.Unlock()
			policyCreateChallenge(t, s.URL, freshPolicyOwner(t), http.StatusServiceUnavailable)
		})
	}
	for _, mode := range []string{"redirect", "not-found", "oversize", "closed"} {
		t.Run(mode, func(t *testing.T) {
			g, _, s := policyTestGateway(t)
			var redirected atomic.Int32
			sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected.Add(1) }))
			defer sink.Close()
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch mode {
				case "redirect":
					http.Redirect(w, r, sink.URL, http.StatusTemporaryRedirect)
				case "not-found":
					w.WriteHeader(http.StatusNotFound)
				case "oversize":
					_, _ = w.Write([]byte(strings.Repeat(" ", 4097)))
				}
			}))
			defer upstream.Close()
			g.cfg.AccountPolicyURL = upstream.URL
			if mode == "closed" {
				upstream.Close()
			}
			policyCreateChallenge(t, s.URL, freshPolicyOwner(t), http.StatusServiceUnavailable)
			if redirected.Load() != 0 || len(g.state.Challenges) != 0 {
				t.Fatal("untrusted policy transport allowed effects")
			}
		})
	}
}

func TestClassicSessionActivationAboveSafeJSONInteger(t *testing.T) {
	_, p, s := policyTestGateway(t)
	owner := freshPolicyOwner(t)
	p.set(func(v map[string]any) {
		activePolicy(v)
		v["executionHeight"] = "9007199254740992"
		v["algorithmVersion"] = "legacy"
		delete(v, "activeRevision")
		r := v["records"].([]any)[0].(map[string]any)
		r["registeredAt"], r["activeFrom"] = "9007199254740992", "9007199254740993"
	})
	policyCreateChallenge(t, s.URL, owner, http.StatusCreated)
	p.set(func(v map[string]any) {
		activePolicy(v)
		v["executionHeight"] = "9007199254740993"
		r := v["records"].([]any)[0].(map[string]any)
		r["registeredAt"], r["activeFrom"] = "9007199254740992", "9007199254740993"
	})
	policyCreateChallenge(t, s.URL, owner, http.StatusForbidden)
}

func TestAccountPolicyConfigRequiresExplicitExactOriginAndNetwork(t *testing.T) {
	g, _, _ := policyTestGateway(t)
	for _, raw := range []string{"http://remote.example", "https://core.example/path", "https://user@core.example", "https://core.example?x=1", "https://core.example#fragment", "https://core.example?"} {
		cfg := g.cfg
		cfg.AccountPolicyURL = raw
		if ValidateConfig(cfg) == nil {
			t.Fatal("unsafe policy origin accepted")
		}
	}
	for _, raw := range []string{"", "0x" + strings.Repeat("ab", 32), strings.Repeat("AB", 32), strings.Repeat("ab", 31)} {
		cfg := g.cfg
		cfg.AccountPolicyNetworkID = raw
		if ValidateConfig(cfg) == nil {
			t.Fatal("invalid policy network accepted")
		}
	}
}
