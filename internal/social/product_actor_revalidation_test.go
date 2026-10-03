package social

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type productRevalidationReaderFunc func(context.Context, productsessionv2.Session, []string) (productsessionv2.Session, error)

func (f productRevalidationReaderFunc) Revalidate(ctx context.Context, session productsessionv2.Session, scopes []string) (productsessionv2.Session, error) {
	return f(ctx, session, scopes)
}

// This software authority exercises the actual mounted route and original
// stores. It is not a real Wallet approval or public/installed acceptance.
func TestProductRevalidationMountedProfile(t *testing.T) {
	for _, scenario := range []string{"success", "authority-unavailable", "revoked", "device-replaced", "scope-replaced", "expired-after-read", "cancel-after-read", "busy-after-read"} {
		t.Run(scenario, func(t *testing.T) {
			f := newFixture(t, 91)
			a := &bridgeAuthority{session: bridgeSession(f, "android")}
			s := bridgeService(t, a, nil)
			_, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
			if err != nil {
				t.Fatal(err)
			}
			frozen, err := json.Marshal(a.session)
			if err != nil {
				t.Fatal(err)
			}
			before := objectDigest(s.state)
			squarePath := filepath.Join(filepath.Dir(s.cfg.StatePath), "square.json")
			squareBefore, squareBeforeErr := os.ReadFile(squarePath)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			calls, locked := 0, false
			s.cfg.ProductSessionRevalidator = productRevalidationReaderFunc(func(ctx context.Context, in productsessionv2.Session, scopes []string) (productsessionv2.Session, error) {
				calls++
				if !s.mu.TryLock() {
					t.Fatal("remote reader called under original store lock")
				}
				s.mu.Unlock()
				raw, err := json.Marshal(in)
				if err != nil || string(raw) != string(frozen) {
					t.Fatal("original full session was changed")
				}
				if len(scopes) != 1 || scopes[0] != "social.profile" {
					t.Fatal("scope was expanded")
				}
				var out productsessionv2.Session
				if err := json.Unmarshal(frozen, &out); err != nil {
					t.Fatal(err)
				}
				// The caller must deep-clone input scopes, not share frozen storage.
				in.Scopes[0] = "reader-mutated-input"
				switch scenario {
				case "authority-unavailable":
					return out, &productsessionv2.Error{Status: 503, Code: "AUTHORITY_UNAVAILABLE"}
				case "revoked":
					return out, &productsessionv2.Error{Status: 401, Code: "SESSION_REVOKED"}
				case "device-replaced":
					out.DeviceID = "replacement-device"
				case "scope-replaced":
					out.Scopes = []string{"social.messaging"}
				case "expired-after-read":
					expiry, err := time.Parse(time.RFC3339Nano, out.ExpiresAt)
					if err != nil {
						t.Fatal(err)
					}
					s.cfg.Now = func() time.Time { return expiry }
				case "cancel-after-read":
					cancel()
				case "busy-after-read":
					if calls == 2 {
						s.mu.Lock()
						locked = true
					}
				}
				return out, nil
			})
			request := bridgeRequest("android", "/social/v1/profile", http.MethodPut, map[string]string{
				"idempotencyKey": "revalidated-profile", "handle": "revalidationqa", "displayName": "Revalidation QA", "bio": "Original profile contract",
			}).WithContext(ctx)
			response := httptest.NewRecorder()
			NewServer(s, s).Handler().ServeHTTP(response, request)
			if locked {
				s.mu.Unlock()
			}
			want := 401
			switch scenario {
			case "success":
				if response.Code < 200 || response.Code >= 300 {
					t.Fatalf("profile failed: %d %s", response.Code, response.Body.String())
				}
				if calls < 3 {
					t.Fatalf("expected revalidation at successive effect boundaries, got %d", calls)
				}
			case "authority-unavailable":
				want = 503
			case "cancel-after-read":
				want = 408
			case "busy-after-read":
				want = 409
			}
			if scenario != "success" && response.Code != want {
				t.Fatalf("got %d want %d: %s", response.Code, want, response.Body.String())
			}
			if a.calls != 1 {
				t.Fatalf("original proof was re-authorized %d times", a.calls)
			}
			if scenario != "success" && scenario != "busy-after-read" && before != objectDigest(s.state) {
				t.Fatal("rejected authority changed original Social state")
			}
			if scenario == "busy-after-read" {
				squareAfter, squareAfterErr := os.ReadFile(squarePath)
				if !errors.Is(squareAfterErr, squareBeforeErr) || string(squareAfter) != string(squareBefore) {
					t.Fatal("busy dispatch changed original Square bytes")
				}
				if calls != 2 {
					t.Fatalf("busy boundary did not stop dispatch: %d", calls)
				}
				prepared := false
				for _, record := range s.state.Idempotency {
					if record.Action == "profile_contract_prepared" {
						prepared = true
					}
				}
				if !prepared {
					t.Fatal("original prepared intent was discarded")
				}
				// A deliberate new request must perform another current read; no
				// automatic replay or stale result dispatch is permitted.
				s.cfg.ProductSessionRevalidator = productRevalidationReaderFunc(func(context.Context, productsessionv2.Session, []string) (productsessionv2.Session, error) {
					return productsessionv2.Session{}, &productsessionv2.Error{Status: 401, Code: "SESSION_REVOKED"}
				})
				retry := bridgeRequest("android", "/social/v1/profile", http.MethodPut, map[string]string{"idempotencyKey": "revalidated-profile", "handle": "revalidationqa", "displayName": "Revalidation QA", "bio": "Original profile contract"})
				rejected := httptest.NewRecorder()
				NewServer(s, s).Handler().ServeHTTP(rejected, retry)
				if rejected.Code != 401 {
					t.Fatalf("explicit retry reused stale authority: %d", rejected.Code)
				}
			}
		})
	}
}

func TestProductRevalidationWebRequiresJointCurrentProducer(t *testing.T) {
	f := newFixture(t, 92)
	a := &bridgeAuthority{session: bridgeSession(f, "web")}
	s := bridgeService(t, a, nil)
	called := false
	s.cfg.ProductSessionRevalidator = productRevalidationReaderFunc(func(context.Context, productsessionv2.Session, []string) (productsessionv2.Session, error) {
		called = true
		return a.session, nil
	})
	server := NewServer(s, s)
	request := httptest.NewRequest(http.MethodPut, "/social/v1/profile", nil)
	err := server.productActorRevalidation(request, a.session, productSessionBinding{})("social.profile")
	var typed *productsessionv2.Error
	if !errors.As(err, &typed) || typed.Status != 503 || typed.Code != "SOCIAL_JOINT_CURRENT_AUTHORITY_REQUIRED" || called {
		t.Fatalf("split readers claimed joint authority: %v, called=%v", err, called)
	}
}
