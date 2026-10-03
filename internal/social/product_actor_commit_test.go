package social

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Shared authority is synthetic; the bound actor, original device, business
// records, idempotency and persistence below use the actual Social stores.
func TestProductActorBusinessCommitRejectsStaleSnapshotBeforeReplay(t *testing.T) {
	for _, failure := range []string{"revoked", "expired", "device-disabled", "key-replaced", "scope-removed", "actor-replaced", "binding-missing", "binding-expired", "binding-ambiguous"} {
		t.Run(failure, func(t *testing.T) {
			f, peer := newFixture(t, 84), newFixture(t, 85)
			a := &bridgeAuthority{session: bridgeSession(f, "android")}
			a.session.Scopes = append(a.session.Scopes, "social.contacts")
			s := bridgeService(t, a, nil)
			actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
			if err != nil {
				t.Fatal(err)
			}
			requestInput := ContactRequestInput{IdempotencyKey: "bound-request", TargetAccount: peer.account, Source: "handle"}
			request, _, err := s.RequestContact(actor, requestInput)
			if err != nil {
				t.Fatal(err)
			}
			settings := ProfileSettingsInput{IdempotencyKey: "bound-settings", AllowRequestsFrom: "everyone"}
			if _, _, err := s.SetSettings(actor, settings); err != nil {
				t.Fatal(err)
			}
			if _, _, err := s.CreateInviteIntent(actor, time.Hour, "bound-invite"); err != nil {
				t.Fatal(err)
			}
			if failure == "revoked" {
				if err := s.RevokeSession(actor); err != nil {
					t.Fatal(err)
				}
			} else {
				s.mu.Lock()
				key := bridgeDigest(a.session.SessionBinding)
				sessionKey := "psv2:" + key
				device := s.state.Devices[actor.DeviceID]
				current := s.state.Sessions[sessionKey]
				binding := s.state.ProductBindings[key]
				switch failure {
				case "expired":
					s.cfg.Now = func() time.Time { return actor.ExpiresAt }
				case "device-disabled":
					device.Status = "revoked"
					s.state.Devices[actor.DeviceID] = device
				case "key-replaced":
					device.EncryptionPublicKey = "substituted-key"
					s.state.Devices[actor.DeviceID] = device
				case "scope-removed":
					current.Scopes = []string{"social.messaging"}
					s.state.Sessions[sessionKey] = current
				case "actor-replaced":
					current.CreatedAt = current.CreatedAt.Add(time.Millisecond)
					s.state.Sessions[sessionKey] = current
				case "binding-missing":
					delete(s.state.ProductBindings, key)
				case "binding-expired":
					binding.ExpiresAt = s.cfg.Now()
					s.state.ProductBindings[key] = binding
				case "binding-ambiguous":
					s.state.ProductBindings["duplicate-binding"] = binding
				}
				s.mu.Unlock()
			}
			operations := map[string]func() error{
				"invite revoke": func() error {
					s.mu.Lock()
					id := ""
					for key := range s.state.Invites {
						id = key
					}
					s.mu.Unlock()
					_, err := s.RevokeInvite(actor, id)
					return err
				},
				"request replay": func() error { _, _, err := s.RequestContact(actor, requestInput); return err },
				"request new": func() error {
					in := requestInput
					in.IdempotencyKey = "new-bound-request"
					_, _, err := s.RequestContact(actor, in)
					return err
				},
				"withdraw":        func() error { _, err := s.TransitionRequest(actor, request.ID, "withdraw"); return err },
				"settings replay": func() error { _, _, err := s.SetSettings(actor, settings); return err },
				"settings new": func() error {
					in := settings
					in.IdempotencyKey = "new-bound-settings"
					_, _, err := s.SetSettings(actor, in)
					return err
				},
				"invite replay":  func() error { _, _, err := s.CreateInviteIntent(actor, time.Hour, "bound-invite"); return err },
				"invite new":     func() error { _, _, err := s.CreateInviteIntent(actor, time.Hour, "new-bound-invite"); return err },
				"invite read":    func() error { _, err := s.ReadInvitations(actor, "bound-invite"); return err },
				"block":          func() error { return s.Block(actor, peer.account) },
				"mute":           func() error { return s.Mute(actor, peer.account, true) },
				"delete contact": func() error { return s.DeleteContact(actor, peer.account) },
			}
			for name, operation := range operations {
				s.mu.Lock()
				before := objectDigest(s.state)
				s.mu.Unlock()
				if err := operation(); !errors.Is(err, ErrUnauthorized) {
					t.Fatalf("%s accepted stale %s: %v", name, failure, err)
				}
				s.mu.Lock()
				after := objectDigest(s.state)
				s.mu.Unlock()
				if before != after {
					t.Fatalf("%s changed state after %s", name, failure)
				}
			}
		})
	}
}

type revokeDuringBodyRead struct {
	reader io.Reader
	revoke func()
	done   bool
}

func (r *revokeDuringBodyRead) Read(p []byte) (int, error) {
	if !r.done {
		r.done = true
		r.revoke()
	}
	return r.reader.Read(p)
}

func TestMountedSettingsRouteRejectsRevokeAfterAuthorizationBeforeBody(t *testing.T) {
	f := newFixture(t, 88)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(ProfileSettingsInput{IdempotencyKey: "revoked-body-settings", AllowRequestsFrom: "nobody"})
	if err != nil {
		t.Fatal(err)
	}
	request := bridgeRequest("android", "/social/v1/settings", http.MethodPut, nil)
	request.Body = io.NopCloser(&revokeDuringBodyRead{reader: bytes.NewReader(raw), revoke: func() {
		if a.calls != 1 {
			t.Fatal("revoke must occur after the single authority decision")
		}
		if err := s.RevokeSession(actor); err != nil {
			t.Fatal(err)
		}
	}})
	response := httptest.NewRecorder()
	NewServer(s, s).Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("revoked request returned %d: %s", response.Code, response.Body.String())
	}
	if a.calls != 1 {
		t.Fatal("authorization proof was replayed")
	}
	s.mu.Lock()
	_, settingsExist := s.state.Settings[actor.Account]
	_, receiptExists := s.state.Idempotency[idempotencyStateKey(actor.Account, "revoked-body-settings")]
	s.mu.Unlock()
	if settingsExist || receiptExists {
		t.Fatal("revoked request committed settings or a receipt")
	}
}

func TestCurrentProductActorContactSettingsInvitationAndRetryRemainUsable(t *testing.T) {
	f, peer := newFixture(t, 86), newFixture(t, 87)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	a.session.Scopes = append(a.session.Scopes, "social.contacts")
	s := bridgeService(t, a, nil)
	actor, err := s.bindProductDevice(a.session, bridgeRegistration(f, a.session), "", "")
	if err != nil {
		t.Fatal(err)
	}
	in := ContactRequestInput{IdempotencyKey: "current-request", TargetAccount: peer.account, Source: "handle"}
	request, replay, err := s.RequestContact(actor, in)
	if err != nil || replay {
		t.Fatalf("new request: %v", err)
	}
	if retry, replay, err := s.RequestContact(actor, in); err != nil || !replay || retry.ID != request.ID {
		t.Fatalf("original request retry: %v", err)
	}
	if _, err := s.TransitionRequest(actor, request.ID, "withdraw"); err != nil {
		t.Fatal(err)
	}
	settings := ProfileSettingsInput{IdempotencyKey: "current-settings", AllowRequestsFrom: "contacts"}
	if _, _, err := s.SetSettings(actor, settings); err != nil {
		t.Fatal(err)
	}
	if _, replay, err := s.SetSettings(actor, settings); err != nil || !replay {
		t.Fatalf("settings retry: %v", err)
	}
	invite, token, err := s.CreateInviteIntent(actor, time.Hour, "current-invite")
	if err != nil {
		t.Fatal(err)
	}
	if retry, originalToken, err := s.CreateInviteIntent(actor, time.Hour, "current-invite"); err != nil || retry.ID != invite.ID || originalToken != token {
		t.Fatalf("invite retry: %v", err)
	}
	if snapshot, err := s.ReadInvitations(actor, "current-invite"); err != nil || snapshot.Operation == nil || !snapshot.Operation.Confirmed {
		t.Fatalf("invitation readback: %v", err)
	}
	if err := s.Block(actor, peer.account); err != nil {
		t.Fatal(err)
	}
}
