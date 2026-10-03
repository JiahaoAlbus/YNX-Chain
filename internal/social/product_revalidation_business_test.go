package social

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Original local stores and actor binding, with software authority only.
// This regression must not be described as a real Wallet acceptance.
func TestProductBusinessMutationsUseOriginalCurrentReader(t *testing.T) {
	for _, operation := range []string{"settings", "request", "withdraw", "invite-create", "invite-revoke", "invite-read", "block", "mute", "unmute", "delete-contact"} {
		t.Run(operation, func(t *testing.T) {
			f, peer := newFixture(t, 93), newFixture(t, 94)
			a := &bridgeAuthority{session: bridgeSession(f, "android")}
			a.session.Scopes = append(a.session.Scopes, "social.contacts")
			s := bridgeService(t, a, nil)
			actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
			if err != nil {
				t.Fatal(err)
			}
			requestID, inviteID := "", ""
			if operation == "withdraw" {
				request, _, err := s.RequestContact(actor, ContactRequestInput{IdempotencyKey: "reader-existing-contact", TargetAccount: peer.account, Source: "handle"})
				if err != nil {
					t.Fatal(err)
				}
				requestID = request.ID
			}
			if operation == "invite-revoke" {
				if _, _, err := s.CreateInviteIntent(actor, time.Hour, "reader-existing-invite"); err != nil {
					t.Fatal(err)
				}
				for id := range s.state.Invites {
					inviteID = id
				}
				if inviteID == "" {
					t.Fatal("missing original invite")
				}
			}
			before := objectDigest(s.state)
			calls := 0
			actor.revalidateProduct = func(scope string) error {
				calls++
				if !s.mu.TryLock() {
					t.Fatal("current authority was read inside the store lock")
				}
				s.mu.Unlock()
				wantScope := "social.contacts"
				if operation == "settings" {
					wantScope = "social.profile"
				}
				if scope != wantScope {
					t.Fatalf("scope changed: %s", scope)
				}
				return &productsessionv2.Error{Status: 503, Code: "AUTHORITY_UNAVAILABLE"}
			}
			switch operation {
			case "settings":
				_, _, err = s.SetSettings(actor, ProfileSettingsInput{IdempotencyKey: "reader-new-settings", AllowRequestsFrom: "everyone"})
			case "request":
				_, _, err = s.RequestContact(actor, ContactRequestInput{IdempotencyKey: "reader-new-contact", TargetAccount: peer.account, Source: "handle"})
			case "withdraw":
				_, err = s.TransitionRequest(actor, requestID, "withdraw")
			case "invite-create":
				_, _, err = s.CreateInviteIntent(actor, time.Hour, "reader-new-invite")
			case "invite-revoke":
				_, err = s.RevokeInvite(actor, inviteID)
			case "invite-read":
				_, err = s.ReadInvitations(actor, "")
			case "block":
				err = s.Block(actor, peer.account)
			case "mute":
				err = s.Mute(actor, peer.account, true)
			case "unmute":
				err = s.Mute(actor, peer.account, false)
			case "delete-contact":
				err = s.DeleteContact(actor, peer.account)
			}
			var typed *productsessionv2.Error
			if !errors.As(err, &typed) || typed.Status != 503 || calls != 1 {
				t.Fatalf("business bypassed original current reader: err=%v calls=%d", err, calls)
			}
			if objectDigest(s.state) != before {
				t.Fatal("unavailable authority changed original business state")
			}
		})
	}
}

func TestProductCurrentReaderMountedPrivacySettings(t *testing.T) {
	for _, scenario := range []string{"success", "revoked", "unavailable", "cancelled", "busy"} {
		t.Run(scenario, func(t *testing.T) {
			f := newFixture(t, 95)
			a := &bridgeAuthority{session: bridgeSession(f, "android")}
			s := bridgeService(t, a, nil)
			if _, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", ""); err != nil {
				t.Fatal(err)
			}
			before := objectDigest(s.state)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			calls, locked := 0, false
			s.cfg.ProductSessionRevalidator = productRevalidationReaderFunc(func(_ context.Context, original productsessionv2.Session, scopes []string) (productsessionv2.Session, error) {
				calls++
				if !s.mu.TryLock() {
					t.Fatal("privacy reader ran under store mutex")
				}
				s.mu.Unlock()
				if objectDigest(original) != objectDigest(a.session) || len(scopes) != 1 || scopes[0] != "social.profile" {
					t.Fatal("original authority or scope was substituted")
				}
				switch scenario {
				case "revoked":
					return original, &productsessionv2.Error{Status: 401, Code: "SESSION_REVOKED"}
				case "unavailable":
					return original, &productsessionv2.Error{Status: 503, Code: "AUTHORITY_UNAVAILABLE"}
				case "cancelled":
					cancel()
				case "busy":
					s.mu.Lock()
					locked = true
				}
				return original, nil
			})
			request := bridgeRequest("android", "/social/v1/settings", http.MethodPut, ProfileSettingsInput{IdempotencyKey: "current-privacy-settings", AllowRequestsFrom: "nobody", DiscoverableByHandle: true}).WithContext(ctx)
			response := httptest.NewRecorder()
			NewServer(s, s).Handler().ServeHTTP(response, request)
			if locked {
				s.mu.Unlock()
			}
			want := map[string]int{"success": 200, "revoked": 401, "unavailable": 503, "cancelled": 408, "busy": 409}[scenario]
			if response.Code != want {
				t.Fatalf("got %d want %d: %s", response.Code, want, response.Body.String())
			}
			if calls != 1 || a.calls != 1 {
				t.Fatalf("authority replay: current=%d authorize=%d", calls, a.calls)
			}
			if scenario != "success" && objectDigest(s.state) != before {
				t.Fatal("failed current authority wrote privacy state")
			}
			if scenario == "success" {
				settings := s.state.Settings[f.account]
				if settings.AllowRequestsFrom != "nobody" || !settings.DiscoverableByHandle {
					t.Fatal("actual privacy effect missing")
				}
			}
		})
	}
}

func TestPublicIdentityCandidateHasNoIndependentEffect(t *testing.T) {
	f := newFixture(t, 96)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	before := objectDigest(s.state)
	s.mu.Lock()
	id, err := s.publicIdentityCandidateLocked(f.account)
	s.mu.Unlock()
	if err != nil || id == "" {
		t.Fatalf("candidate unavailable: %v", err)
	}
	if objectDigest(s.state) != before {
		t.Fatal("candidate committed outside original business rollback")
	}
}

func TestProfileAvatarDeniedReadKeepsPreparedOriginalIntentOnly(t *testing.T) {
	f := newFixture(t, 97)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	if _, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", ""); err != nil {
		t.Fatal(err)
	}
	calls, preparedDigest := 0, ""
	s.cfg.ProductSessionRevalidator = productRevalidationReaderFunc(func(_ context.Context, original productsessionv2.Session, _ []string) (productsessionv2.Session, error) {
		calls++
		if calls == 2 {
			preparedDigest = objectDigest(s.state)
		}
		if calls == 3 {
			return original, &productsessionv2.Error{Status: 503, Code: "AUTHORITY_UNAVAILABLE"}
		}
		return original, nil
	})
	request := bridgeRequest("android", "/social/v1/profile", http.MethodPut, map[string]string{
		"idempotencyKey": "avatar-current-read", "handle": "avatarcurrentqa", "displayName": "Avatar Current QA", "avatarURL": "https://example.test/avatar.png",
	})
	response := httptest.NewRecorder()
	NewServer(s, s).Handler().ServeHTTP(response, request)
	if response.Code != 503 || calls != 3 {
		t.Fatalf("avatar did not stop at failed current read: %d calls=%d %s", response.Code, calls, response.Body.String())
	}
	if preparedDigest == "" || objectDigest(s.state) != preparedDigest {
		t.Fatal("failed avatar authority left an independent locator/settings effect")
	}
}
