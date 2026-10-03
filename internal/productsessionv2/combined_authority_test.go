package productsessionv2

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// Actual Central routes and protected V3 reader. All keys/accounts/state here
// belong solely to the original source-controlled interoperability fixture.
func TestCombinedAuthorityRealHTTP(t *testing.T) {
	source := os.Getenv("YNX_QA_CENTRAL_SOURCE")
	if source == "" {
		t.Skip("explicit reviewed Central source required")
	}
	for _, product := range []string{"ai", "mail"} {
		for _, scenario := range []string{"success", "family-success", "private-revoke-after-browser-await", "browser-revoke-after-private-await", "generation", "expiry", "outage", "bindings", "response-tamper", "expiry-after-response", "cancel-before-http", "cancel-after-http", "deadline-during-http", "cancel-after-body", "cancel-after-close", "cancel-during-sync-decision"} {
			t.Run(product+"/"+scenario, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				public, key, _ := ed25519.GenerateKey(rand.Reader)
				der, _ := x509.MarshalPKIXPublicKey(public)
				directory := t.TempDir()
				if err := os.Chmod(directory, 0700); err != nil {
					t.Fatal(err)
				}
				cmd := exec.CommandContext(ctx, "node", "testdata/combined-authority-node.mjs")
				cmd.Env = append(os.Environ(), "YNX_QA_FAMILY="+map[bool]string{true: "1", false: "0"}[scenario != "success"], "YNX_QA_PRODUCT_ID="+product, "YNX_QA_PLATFORM=web", "YNX_QA_PUBLIC_KEY="+string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})), "YNX_QA_STATE_PATH="+filepath.Join(directory, "authority"))
				var diagnostic bytes.Buffer
				cmd.Stderr = &diagnostic
				pipe, _ := cmd.StdoutPipe()
				if err := cmd.Start(); err != nil {
					t.Fatal(err)
				}
				defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
				var ready struct {
					URL     string       `json:"url"`
					Session Session      `json:"session"`
					Grant   BrowserGrant `json:"browserGrant"`
					Initial string       `json:"initial"`
					Revoke  string       `json:"revoke"`
				}
				scanner := bufio.NewScanner(pipe)
				if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &ready) != nil {
					t.Fatal("fixture startup", diagnostic.String())
				}
				local, _ := url.Parse(ready.URL)
				transport := roundTrip(func(req *http.Request) (*http.Response, error) {
					copy := req.Clone(req.Context())
					u := *req.URL
					u.Scheme = local.Scheme
					u.Host = local.Host
					copy.URL = &u
					return http.DefaultTransport.RoundTrip(copy)
				})
				original := ready.Session
				p := Policy{ProductID: original.ProductID, ClientID: original.ClientID, ApplicationID: original.ApplicationID, Platform: original.Platform, Origin: original.Origin, Callback: original.Callback, AllowedScopes: original.Scopes, BundleID: original.BundleID, PackageID: original.PackageID}
				client, err := NewClient("https://wallet-auth.ynxweb4.com", p, transport)
				if err != nil {
					t.Fatal(err)
				}
				reader, err := NewPrivateBusinessRevalidator(client, p.ClientID+"-business-web-v1", "qa", key)
				if err != nil {
					t.Fatal(err)
				}
				incoming, _ := http.NewRequest("POST", p.Origin+"/business-operation", nil)
				incoming.Header.Set(ProofHeader, ready.Initial)
				incoming.Header.Set("Origin", p.Origin)
				verified, err := client.Authorize(ctx, incoming, p.AllowedScopes)
				if err != nil {
					t.Fatal(err)
				}
				original = verified
				browser, err := NewBrowserSSO(product, client.endpoint, bytes.Repeat([]byte{7}, 32), []string{"overview"}, transport)
				if err != nil {
					t.Fatal(err)
				}
				sealed, err := browser.seal(browser.identityCookie, ready.Grant)
				if err != nil {
					t.Fatal(err)
				}
				set, err := NewRegisteredClientSet(product, []*Client{client}, []*Revalidator{reader})
				if err != nil {
					t.Fatal(err)
				}
				call := func(path string, body string, proof string) int {
					t.Helper()
					req, _ := http.NewRequestWithContext(ctx, "POST", ready.URL+path, bytes.NewBufferString(body))
					req.Header.Set("Content-Type", "application/json")
					if proof != "" {
						req.Header.Set(ProofHeader, proof)
						req.Header.Set("X-Request-Id", "req_combined_qa_revoke")
					}
					res, e := http.DefaultClient.Do(req)
					if e != nil {
						t.Fatal(e)
					}
					defer res.Body.Close()
					return res.StatusCode
				}
				// Establish both original authorizations before the await/race boundary.
				current, grant, err := set.RevalidateBrowser(ctx, original, browser, sealed, p.AllowedScopes)
				if err != nil || !reflect.DeepEqual(current, original) || !reflect.DeepEqual(grant, ready.Grant) {
					t.Fatal("combined original read", err)
				}
				decisionContext := ctx
				switch scenario {
				case "success", "family-success":
					before := mustReadFile(t, filepath.Join(directory, "authority"))
					current, grant, err = set.RevalidateBrowser(ctx, original, browser, sealed, p.AllowedScopes)
					if err != nil || !reflect.DeepEqual(current, original) || !reflect.DeepEqual(grant, ready.Grant) {
						t.Fatal("repeat changed original", err)
					}
					if !bytes.Equal(before, mustReadFile(t, filepath.Join(directory, "authority"))) {
						t.Fatal("private read mutated state")
					}
					return
				case "private-revoke-after-browser-await":
					if _, e := reader.Revalidate(ctx, original, p.AllowedScopes); e != nil {
						t.Fatal(e)
					}
					call("/__qa/private-on-introspect", "{}", "")
					if _, status := browser.VerifyBinding(ctx, sealed, original.Account); status != 200 {
						t.Fatal("the old final browser await remains valid after actual private revoke", status)
					}
				case "browser-revoke-after-private-await":
					if _, status := browser.VerifyBinding(ctx, sealed, original.Account); status != 200 {
						t.Fatal(status)
					}
					call("/__qa/browser-on-private", "{}", "")
					if _, e := reader.Revalidate(ctx, original, p.AllowedScopes); e != nil {
						t.Fatal("the old final private await remains valid after actual browser revoke", e)
					}
				case "generation":
					call("/__qa/generation", "{}", "")
				case "expiry":
					call("/__qa/advance", `{"ms":241000}`, "")
				case "outage":
					call("/__qa/outage", "{}", "")
				case "response-tamper":
					for _, kind := range []string{"unknown", "session", "browser", "deadline", "csrf", "active"} {
						client.http.Transport = roundTrip(func(req *http.Request) (*http.Response, error) {
							res, e := transport.RoundTrip(req)
							if e != nil {
								return nil, e
							}
							raw, _ := io.ReadAll(res.Body)
							res.Body.Close()
							payload, _ := canonicalObject(raw)
							switch kind {
							case "unknown":
								payload["extra"] = true
							case "session":
								payload["session"].(map[string]any)["deviceId"] = "foreign"
							case "browser":
								payload["browser"].(map[string]any)["origin"] = "https://foreign.invalid"
							case "deadline":
								payload["browser"].(map[string]any)["grant"].(map[string]any)["expiresAt"] = "2099-01-01T00:00:00.000Z"
							case "csrf":
								payload["browser"].(map[string]any)["grant"].(map[string]any)["csrf"] = "foreign"
							case "active":
								payload["active"] = false
							}
							raw, _ = canonical(payload)
							res.Body = io.NopCloser(bytes.NewReader(raw))
							res.ContentLength = int64(len(raw))
							return res, nil
						})
						if _, _, e := set.RevalidateBrowser(ctx, original, browser, sealed, p.AllowedScopes); e == nil {
							t.Fatal("tampered response accepted", kind)
						}
					}
					return
				case "cancel-before-http":
					decisionContext, cancelDecision := context.WithCancel(ctx)
					cancelDecision()
					if _, _, e := set.RevalidateBrowser(decisionContext, original, browser, sealed, p.AllowedScopes); e == nil {
						t.Fatal("cancelled original context accepted")
					}
					return
				case "cancel-after-http", "cancel-after-body", "cancel-after-close", "cancel-during-sync-decision":
					var cancelDecision context.CancelFunc
					decisionContext, cancelDecision = context.WithCancel(ctx)
					defer cancelDecision()
					if scenario == "cancel-during-sync-decision" {
						realClock := client.clock
						calls := 0
						client.clock = func() time.Time {
							calls++
							if calls == 4 {
								cancelDecision()
							}
							return realClock()
						}
					} else {
						client.http.Transport = roundTrip(func(req *http.Request) (*http.Response, error) {
							res, e := transport.RoundTrip(req)
							if e != nil {
								return nil, e
							}
							if scenario == "cancel-after-http" {
								cancelDecision()
							} else {
								if scenario == "cancel-after-close" {
									res.Body = &cancelOnBodyClose{ReadCloser: res.Body, cancel: cancelDecision}
								} else {
									res.Body = &cancelOnBodyEnd{ReadCloser: res.Body, cancel: cancelDecision}
								}
							}
							return res, nil
						})
					}
				case "deadline-during-http":
					var cancelDecision context.CancelFunc
					decisionContext, cancelDecision = context.WithTimeout(ctx, 30*time.Millisecond)
					defer cancelDecision()
					client.http.Transport = roundTrip(func(req *http.Request) (*http.Response, error) {
						res, e := transport.RoundTrip(req)
						if e != nil {
							return nil, e
						}
						<-req.Context().Done()
						return res, nil
					})
				case "expiry-after-response":
					client.http.Transport = roundTrip(func(req *http.Request) (*http.Response, error) {
						res, e := transport.RoundTrip(req)
						client.clock = func() time.Time { return ready.Grant.ExpiresAt.Add(time.Second) }
						browser.now = client.clock
						return res, e
					})
				case "bindings":
					bad := original
					bad.DeviceID = "foreign"
					if _, _, e := set.RevalidateBrowser(ctx, bad, browser, sealed, p.AllowedScopes); e == nil {
						t.Fatal("device mismatch")
					}
					bad = original
					bad.Account = "foreign"
					if _, _, e := set.RevalidateBrowser(ctx, bad, browser, sealed, p.AllowedScopes); e == nil {
						t.Fatal("account mismatch")
					}
					changed := ready.Grant
					changed.Identity.Generation++
					other, _ := browser.seal(browser.identityCookie, changed)
					if _, _, e := set.RevalidateBrowser(ctx, original, browser, other, p.AllowedScopes); e == nil {
						t.Fatal("generation mismatch")
					}
					if _, _, e := set.RevalidateBrowser(ctx, original, browser, sealed, []string{"identity:read"}); e == nil {
						t.Fatal("identity upgraded to private")
					}
					if _, _, e := set.RevalidateBrowser(ctx, original, browser, sealed+"!", p.AllowedScopes); e == nil {
						t.Fatal("unsealed cookie")
					}
					return
				}
				failedSession, failedGrant, err := set.RevalidateBrowser(decisionContext, original, browser, sealed, p.AllowedScopes)
				if err == nil {
					t.Fatal("stale combined authorization accepted")
				}
				if strings.HasPrefix(scenario, "cancel-") || scenario == "deadline-during-http" {
					authErr, ok := err.(*Error)
					if !ok || authErr.Code != "AUTHORITY_UNAVAILABLE" || authErr.Status != 503 || decisionContext.Err() == nil || !reflect.DeepEqual(failedSession, Session{}) || !reflect.DeepEqual(failedGrant, BrowserGrant{}) {
						t.Fatal("cancelled read returned a credential or a non503 decision", err)
					}
				}
			})
		}
	}
}
func mustReadFile(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

type cancelOnBodyEnd struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (b *cancelOnBodyEnd) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	if err == io.EOF {
		b.cancel()
	}
	return n, err
}

type cancelOnBodyClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (b *cancelOnBodyClose) Close() error { err := b.ReadCloser.Close(); b.cancel(); return err }
