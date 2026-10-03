package social

import (
	"bufio"
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

type socialCombinedTransport func(*http.Request) (*http.Response, error)

func (f socialCombinedTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type observedSocialCombinedAuthority struct {
	clients  *productsessionv2.RegisteredClientSet
	observed productsessionv2.Session
}

func (a *observedSocialCombinedAuthority) Authorize(ctx context.Context, r *http.Request, scopes []string) (productsessionv2.Session, error) {
	session, err := a.clients.Authorize(ctx, r, scopes)
	a.observed = session
	return session, err
}

// Real source-controlled private+Browser authorities, software keys and
// original Social stores/HTTP handler. Not a real Wallet/public acceptance.
func TestSocialCombinedAuthorityMountedHTTP(t *testing.T) {
	source := os.Getenv("YNX_QA_CENTRAL_SOURCE")
	if source == "" {
		t.Skip("exact reviewed complete Central source required")
	}
	for _, scenario := range []string{"success", "private-revoke-during-browser-read", "browser-revoke-before-combined", "cancel-after-combined", "binding-replaced-after-combined"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			public, private, err := ed25519.GenerateKey(rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			der, err := x509.MarshalPKIXPublicKey(public)
			if err != nil {
				t.Fatal(err)
			}
			command := exec.CommandContext(ctx, "node", "testdata/social-combined-authority-node.mjs")
			stateDirectory := t.TempDir()
			if err := os.Chmod(stateDirectory, 0700); err != nil {
				t.Fatal(err)
			}
			command.Env = append(os.Environ(), "YNX_QA_PRODUCT_ID=social", "YNX_QA_PLATFORM=web", "YNX_QA_FAMILY=1", "YNX_QA_PUBLIC_KEY="+string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})), "YNX_QA_STATE_PATH="+filepath.Join(stateDirectory, "authority"))
			var diagnostic bytes.Buffer
			command.Stderr = &diagnostic
			pipe, err := command.StdoutPipe()
			if err != nil {
				t.Fatal(err)
			}
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = command.Process.Kill(); _ = command.Wait() })
			var ready struct {
				URL          string                        `json:"url"`
				Session      productsessionv2.Session      `json:"session"`
				Grant        productsessionv2.BrowserGrant `json:"browserGrant"`
				ProfileProof string                        `json:"profileProof"`
			}
			scanner := bufio.NewScanner(pipe)
			if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &ready) != nil {
				t.Fatal("source fixture startup", diagnostic.String())
			}
			local, err := url.Parse(ready.URL)
			if err != nil {
				t.Fatal(err)
			}
			var service *Service
			requestCtx, abort := context.WithCancel(ctx)
			defer abort()
			combined, authorizes := 0, 0
			var statuses []string
			control := func(path string) {
				t.Helper()
				r, err := http.NewRequestWithContext(ctx, http.MethodPost, ready.URL+path, bytes.NewBufferString("{}"))
				if err != nil {
					t.Fatal(err)
				}
				response, err := http.DefaultClient.Do(r)
				if err != nil {
					t.Fatal(err)
				}
				response.Body.Close()
				if response.StatusCode != 200 {
					t.Fatalf("source fixture control failed: %d", response.StatusCode)
				}
			}
			transport := socialCombinedTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path == "/v2/product-sessions/introspect" {
					authorizes++
				}
				if r.URL.Path == "/v2/browser-sessions/product-browser-revalidate" {
					combined++
					if scenario == "browser-revoke-before-combined" {
						control("/__qa/browser-revoke")
					}
				}
				copy := r.Clone(r.Context())
				u := *r.URL
				u.Scheme, u.Host = local.Scheme, local.Host
				copy.URL = &u
				response, err := http.DefaultTransport.RoundTrip(copy)
				if err == nil {
					statuses = append(statuses, r.URL.Path+"="+http.StatusText(response.StatusCode))
				}
				if err == nil && r.URL.Path == "/v2/browser-sessions/product-browser-revalidate" {
					if scenario == "cancel-after-combined" {
						abort()
					}
					if scenario == "binding-replaced-after-combined" {
						service.mu.Lock()
						key := bridgeDigest(ready.Session.SessionBinding)
						binding := service.state.ProductBindings[key]
						binding.BrowserGrantDigest = "replacement-family"
						service.state.ProductBindings[key] = binding
						service.mu.Unlock()
					}
				}
				return response, err
			})
			original := ready.Session
			policy := productsessionv2.Policy{ProductID: original.ProductID, ClientID: original.ClientID, Platform: original.Platform, ApplicationID: original.ApplicationID, Origin: original.Origin, Callback: original.Callback, AllowedScopes: original.Scopes}
			client, err := productsessionv2.NewClient("https://wallet-auth.ynxweb4.com", policy, transport)
			if err != nil {
				t.Fatal(err)
			}
			reader, err := productsessionv2.NewPrivateBusinessRevalidator(client, original.ClientID+"-business-web-v1", "qa", private)
			if err != nil {
				t.Fatal(err)
			}
			clients, err := productsessionv2.NewRegisteredClientSet("social", []*productsessionv2.Client{client}, []*productsessionv2.Revalidator{reader})
			if err != nil {
				t.Fatal(err)
			}
			sealKey := bytes.Repeat([]byte{7}, 32)
			browser, err := productsessionv2.NewBrowserSSO("social", "https://wallet-auth.ynxweb4.com", sealKey, []string{"overview"}, transport)
			if err != nil {
				t.Fatal(err)
			}
			derived := sha256.Sum256(append([]byte("YNX product browser SSO cookie v1\x00social\x00"), sealKey...))
			block, err := aes.NewCipher(derived[:])
			if err != nil {
				t.Fatal(err)
			}
			aead, err := cipher.NewGCM(block)
			if err != nil {
				t.Fatal(err)
			}
			nonce := make([]byte, aead.NonceSize())
			if _, err := rand.Read(nonce); err != nil {
				t.Fatal(err)
			}
			grantBytes, err := json.Marshal(ready.Grant)
			if err != nil {
				t.Fatal(err)
			}
			cookieName := "__Host-ynx-social-identity"
			sealed := base64.RawURLEncoding.EncodeToString(aead.Seal(nonce, nonce, grantBytes, []byte(cookieName+"\x00"+Origin)))
			f := newFixture(t, 102)
			// Exact isolated Node fixture account/device secrets, not user keys.
			walletSecret := make([]byte, 32)
			walletSecret[31] = 1
			f.key = secp256k1.PrivKeyFromBytes(walletSecret)
			f.account = original.Account
			deviceSecret := bytes.Repeat([]byte{3}, 32)
			x, y := elliptic.P256().ScalarBaseMult(deviceSecret)
			f.productKey = &ecdsa.PrivateKey{PublicKey: ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}, D: new(big.Int).SetBytes(deviceSecret)}
			a := &bridgeAuthority{session: original}
			service = bridgeService(t, a, browser)
			observed := &observedSocialCombinedAuthority{clients: clients}
			service.cfg.ProductSessionAuthority = observed
			service.cfg.ProductBrowserSessionRevalidator = clients
			if _, err := service.bindProductDevice(original, bridgeRegistration(f, original), sealed, bridgeDigest(ready.Grant.GrantToken)); err != nil {
				t.Fatal(err)
			}
			before := objectDigest(service.state.Settings)
			if scenario == "private-revoke-during-browser-read" {
				control("/__qa/private-on-introspect")
			}
			request := bridgeRequest("web", "/social/v1/settings", http.MethodPut, ProfileSettingsInput{IdempotencyKey: "social-combined-settings", AllowRequestsFrom: "nobody"}).WithContext(requestCtx)
			request.Header.Set(productsessionv2.ProofHeader, ready.ProfileProof)
			request.Header.Set("Origin", Origin)
			request.Header.Set("X-YNX-SSO-CSRF", ready.Grant.CSRF)
			request.AddCookie(&http.Cookie{Name: cookieName, Value: sealed})
			if _, grant, err := browser.Binding(request); err != nil || objectDigest(grant) != objectDigest(ready.Grant) {
				t.Fatalf("original sealed fixture binding: %v", err)
			}
			response := httptest.NewRecorder()
			NewServer(service, service).Handler().ServeHTTP(response, request)
			want := map[string]int{"success": 200, "private-revoke-during-browser-read": 401, "browser-revoke-before-combined": 401, "cancel-after-combined": 408, "binding-replaced-after-combined": 401}[scenario]
			if response.Code != want {
				if objectDigest(observed.observed) != objectDigest(original) {
					leftBytes, _ := json.Marshal(original)
					rightBytes, _ := json.Marshal(observed.observed)
					var left, right map[string]json.RawMessage
					_ = json.Unmarshal(leftBytes, &left)
					_ = json.Unmarshal(rightBytes, &right)
					var fields []string
					for key, value := range left {
						if !bytes.Equal(value, right[key]) {
							fields = append(fields, key)
						}
					}
					t.Logf("original full-session differing field names only: %v", fields)
				}
				t.Fatalf("got %d want %d: %s; authority paths=%v", response.Code, want, response.Body.String(), statuses)
			}
			if authorizes != 1 || combined != 1 {
				t.Fatalf("proof replay or combined bypass: authorize=%d combined=%d", authorizes, combined)
			}
			if scenario == "success" {
				if service.state.Settings[original.Account].AllowRequestsFrom != "nobody" {
					t.Fatal("actual Social settings effect missing")
				}
			} else if objectDigest(service.state.Settings) != before {
				t.Fatal("failed combined authority wrote private settings")
			}
		})
	}
}
