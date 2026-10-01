package social

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type journeyAuthority struct {
	mu        sync.Mutex
	sessions  map[string]productsessionv2.Session
	revoked   map[string]bool
	approvals int
}

func (a *journeyAuthority) Authorize(_ context.Context, r *http.Request, required []string) (productsessionv2.Session, error) {
	raw, err := base64.RawURLEncoding.DecodeString(r.Header.Get(productsessionv2.ProofHeader))
	if err != nil {
		return productsessionv2.Session{}, ErrUnauthorized
	}
	var proof struct {
		Account, SessionBinding string
		RequiredScopes          []string
	}
	if json.Unmarshal(raw, &proof) != nil {
		return productsessionv2.Session{}, ErrUnauthorized
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	session, ok := a.sessions[proof.Account]
	if !ok || a.revoked[proof.Account] || proof.SessionBinding != session.SessionBinding || strings.Join(proof.RequiredScopes, "\n") != strings.Join(required, "\n") {
		return productsessionv2.Session{}, ErrUnauthorized
	}
	for _, scope := range required {
		if !contains(session.Scopes, scope) {
			return productsessionv2.Session{}, ErrUnauthorized
		}
	}
	return session, nil
}

// Actual Social/Chat/Square HTTP+existing JS crypto. Only central approvals and
// browser cookie/IDB plumbing are synthetic; business state starts completely empty.
func TestEmptyQAWorkspaceOriginalAPIAndCryptoJourney(t *testing.T) {
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	runner := filepath.Join(root, "apps/social/node_modules/.bin/tsx")
	if _, err := os.Stat(runner); err != nil {
		t.Fatal("install locked Social dependencies before this integration test")
	}
	alice, bob := newFixture(t, 61), newFixture(t, 62)
	accounts := map[string]fixture{alice.account: alice, bob.account: bob}
	authority := &journeyAuthority{sessions: map[string]productsessionv2.Session{}, revoked: map[string]bool{}}
	var issuerMu sync.Mutex
	grants := map[string]productsessionv2.BrowserGrant{}
	revokedGrants := map[string]bool{}
	issued := 0
	transport := bridgeTransport(func(r *http.Request) (*http.Response, error) {
		var input map[string]string
		json.NewDecoder(r.Body).Decode(&input)
		status := 200
		var body any
		issuerMu.Lock()
		defer issuerMu.Unlock()
		if r.URL.Path == "/v2/browser-sessions/token" {
			account := alice.account
			if input["code"] == strings.Repeat("b", 43) {
				account = bob.account
			} else if input["code"] != strings.Repeat("a", 43) {
				status = 401
			}
			issued++
			digest := sha256.Sum256([]byte(account + strconv.Itoa(issued)))
			token := base64.RawURLEncoding.EncodeToString(digest[:])
			now := time.Now().UTC()
			grant := productsessionv2.BrowserGrant{GrantToken: token, Identity: productsessionv2.BrowserIdentity{Subject: account, Account: account, Generation: 1, ExpiresAt: now.Add(time.Hour)}, Audience: "ynx:social:identity", Scopes: []string{"identity:read"}, ExpiresAt: now.Add(5 * time.Minute)}
			grants[token] = grant
			body = grant
		} else if r.URL.Path == "/v2/browser-sessions/logout-grant" {
			revokedGrants[input["grantToken"]] = true
			body = map[string]bool{"revoked": true}
		} else {
			grant, ok := grants[input["grantToken"]]
			if !ok || revokedGrants[input["grantToken"]] {
				status = 401
				body = map[string]bool{"active": false}
			} else {
				body = grant
			}
		}
		raw, _ := json.Marshal(body)
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(bytes.NewReader(raw))}, nil
	})
	bridge, err := productsessionv2.NewBrowserSSO("social", "https://wallet-auth.ynxweb4.com", bytes.Repeat([]byte{9}, 32), []string{"profile", "conversations"}, transport)
	if err != nil {
		t.Fatal(err)
	}
	service := bridgeService(t, &bridgeAuthority{session: bridgeSession(alice, "web")}, bridge)
	service.cfg.ProductSessions["web"] = authority
	if len(service.state.Contacts) != 0 || len(service.state.Requests) != 0 || len(service.state.Sessions) != 0 || len(service.state.Devices) != 0 {
		t.Fatal("journey must start with no business fixtures")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/test/approve", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Account string
			Scopes  []string
		}
		json.NewDecoder(r.Body).Decode(&input)
		f, ok := accounts[input.Account]
		if !ok || strings.Join(input.Scopes, "\n") != "account:read\nprofile:link\nsocial.contacts\nsocial.messaging\nsocial.profile" {
			writeError(w, 403, "explicit exact Social scope consent required")
			return
		}
		authority.mu.Lock()
		defer authority.mu.Unlock()
		authority.approvals++
		session := bridgeSession(f, "web")
		digest := sha256.Sum256([]byte(input.Account + strconv.Itoa(authority.approvals)))
		session.SessionBinding = hex.EncodeToString(digest[:])
		session.Scopes = append([]string(nil), input.Scopes...)
		authority.sessions[input.Account] = session
		authority.revoked[input.Account] = false
		writeJSON(w, 200, session)
	})
	mux.HandleFunc("/test/revoke", func(w http.ResponseWriter, r *http.Request) {
		var input struct{ Account string }
		json.NewDecoder(r.Body).Decode(&input)
		authority.mu.Lock()
		authority.revoked[input.Account] = true
		authority.mu.Unlock()
		writeJSON(w, 200, map[string]bool{"revoked": true})
	})
	mux.Handle("/", NewServer(service, service).Handler())
	server := httptest.NewServer(mux)
	defer server.Close()
	command := exec.Command(runner, filepath.Join(root, "apps/social/web/empty-qa-journey.mjs"))
	command.Dir = root
	command.Env = append(os.Environ(), "SOCIAL_JOURNEY_ENDPOINT="+server.URL, "SOCIAL_JOURNEY_ACCOUNT_A="+alice.account, "SOCIAL_JOURNEY_ACCOUNT_B="+bob.account)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("empty-QA controller/API/crypto journey failed: %v\n%s", err, output)
	}
	service.mu.Lock()
	defer service.mu.Unlock()
	if len(service.state.Contacts) != 1 || len(service.state.Requests) != 3 {
		t.Fatalf("business state must derive from reject, withdraw, accept UI actions: contacts=%d requests=%d", len(service.state.Contacts), len(service.state.Requests))
	}
}

func TestContactPermissionIsNotInferredFromProfileAndMessaging(t *testing.T) {
	f := newFixture(t, 63)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	service := bridgeService(t, a, nil)
	server := NewServer(service, service)
	if _, err := service.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", ""); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, bridgeRequest("android", "/social/v1/contacts", "GET", nil))
	if w.Code != 401 {
		t.Fatal("contacts inferred from narrower chat grant")
	}
	if len(service.state.Contacts) != 0 || len(service.state.Requests) != 0 {
		t.Fatal("denied contact request mutated state")
	}
}
