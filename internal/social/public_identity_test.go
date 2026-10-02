package social

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
)

func TestOpaquePreviewConfirmationUsesOriginalPrivateAccountOverHTTP(t *testing.T) {
	s, now := testService(t)
	s.cfg.RateLimitMax = 100
	profiles, err := square.New(square.Config{StatePath: filepath.Join(t.TempDir(), "square.json"), APIKey: "opaque-http-test-key", Now: s.cfg.Now})
	if err != nil {
		t.Fatal(err)
	}
	s.cfg.Square = profiles
	a, b, c := newFixture(t, 129), newFixture(t, 130), newFixture(t, 131)
	target := Session{Account: b.account, DeviceID: "opaque-http-device"}
	if _, _, err := s.UpdateContractProfile(target, "opaque-http-profile", "opaque_http", "Target", "", ""); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.SetSettings(target, ProfileSettingsInput{IdempotencyKey: "opaque-http-settings", DiscoverableByHandle: true, AllowRequestsFrom: "everyone"}); err != nil {
		t.Fatal(err)
	}
	login, err := s.Login(signedLogin(t, s, a, now))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(s, s).Handler())
	defer server.Close()
	response := doRequest(t, http.MethodPost, server.URL+"/social/v1/contacts/preview", login.Token, []byte(`{"source":"handle","value":"opaque_http"}`))
	var result struct {
		Person PersonView `json:"person"`
	}
	err = json.NewDecoder(response.Body).Decode(&result)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || !strings.HasPrefix(result.Person.ID, "sp_") {
		t.Fatal("HTTP preview did not provide public identity")
	}
	body := []byte(fmt.Sprintf(`{"source":"handle","value":"opaque_http","idempotencyKey":"opaque-http-request","expectedAccount":%q}`, result.Person.ID))
	response = doRequest(t, http.MethodPost, server.URL+"/social/v1/contact-requests", login.Token, body)
	response.Body.Close()
	if response.StatusCode != 201 {
		t.Fatalf("opaque confirmation status=%d", response.StatusCode)
	}
	if len(s.state.Requests) != 1 {
		t.Fatal("opaque confirmation duplicated request")
	}
	for _, request := range s.state.Requests {
		if request.To != b.account {
			t.Fatal("public ID replaced private relation actor")
		}
	}
	if _, _, err := s.UpdateContractProfile(target, "opaque-http-rename", "opaque_http_new", "Target", "", ""); err != nil {
		t.Fatal(err)
	}
	other := Session{Account: c.account, DeviceID: "opaque-http-other-device"}
	if _, _, err := s.UpdateContractProfile(other, "opaque-http-recycled", "opaque_http", "Different Person", "", ""); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.SetSettings(other, ProfileSettingsInput{IdempotencyKey: "opaque-http-other-settings", DiscoverableByHandle: true, AllowRequestsFrom: "everyone"}); err != nil {
		t.Fatal(err)
	}
	response = doRequest(t, http.MethodPost, server.URL+"/social/v1/contact-requests", login.Token, body)
	response.Body.Close()
	if response.StatusCode != 409 || len(s.state.Requests) != 1 {
		t.Fatal("recycled username substituted confirmation identity")
	}
}

func TestPublicIdentityPrivateBindingStableWithoutRelationshipRewrite(t *testing.T) {
	s, _ := testService(t)
	a, b := newFixture(t, 125), newFixture(t, 126)
	request, _, err := s.RequestContact(Session{Account: a.account}, ContactRequestInput{IdempotencyKey: "opaque-old-request", TargetAccount: b.account, Source: "handle"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.TransitionRequest(Session{Account: b.account}, request.ID, "accept"); err != nil {
		t.Fatal(err)
	}
	id, err := s.publicIdentity(b.account)
	if err != nil || !strings.HasPrefix(id, "sp_") || strings.Contains(id, b.account) {
		t.Fatal("public ID exposes account")
	}
	second, err := s.publicIdentity(a.account)
	if err != nil || second == id {
		t.Fatal("public identities collided")
	}
	if !s.expectedIdentityMatches(b.account, id) || s.expectedIdentityMatches(a.account, id) {
		t.Fatal("confirmation binding changed actor")
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if again, err := restarted.publicIdentity(b.account); err != nil || again != id {
		t.Fatal("restart changed public identity")
	}
	if !restarted.contactLocked(a.account, b.account) || restarted.state.Requests[request.ID].To != b.account {
		t.Fatal("public ID rewrote old relation keys")
	}
	if account, err := restarted.resolveProfileLocator(socialLocatorPrefix + id); err != nil || account != b.account {
		t.Fatal("locator lost private binding")
	}
	if _, err := restarted.resolveProfileLocator("ynxsocial://profile/old_handle"); !errors.Is(err, ErrConflict) {
		t.Fatal("unsafe legacy handle QR resolved")
	}
}

func TestPublicPreviewAndQRSurviveRenameAndDoNotExposeFunds(t *testing.T) {
	s, _ := testService(t)
	profiles, err := square.New(square.Config{StatePath: filepath.Join(t.TempDir(), "square.json"), APIKey: "opaque-profile-test-key", Now: s.cfg.Now})
	if err != nil {
		t.Fatal(err)
	}
	s.cfg.Square = profiles
	a, b := newFixture(t, 127), newFixture(t, 128)
	actor, target := Session{Account: a.account}, Session{Account: b.account, DeviceID: "opaque-device"}
	if _, _, err := s.UpdateContractProfile(target, "opaque-profile-old", "opaque_old", "Opaque Person", "", ""); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.SetSettings(target, ProfileSettingsInput{IdempotencyKey: "opaque-settings", DiscoverableByHandle: true, AllowRequestsFrom: "everyone"}); err != nil {
		t.Fatal(err)
	}
	preview, err := s.PreviewContact(actor, s, "handle", "opaque_old")
	if err != nil {
		t.Fatal(err)
	}
	bytes, _ := json.Marshal(preview)
	if strings.Contains(string(bytes), b.account) {
		t.Fatal("preview exposes native funding address")
	}
	profile, err := s.ContractProfile(target)
	if err != nil {
		t.Fatal(err)
	}
	qr := profile.Privacy.ProfileQRPayload
	if qr != socialLocatorPrefix+preview.ID {
		t.Fatal("profile QR is not opaque binding")
	}
	if _, _, err := s.UpdateContractProfile(target, "opaque-profile-new", "opaque_new", "Opaque Person", "", ""); err != nil {
		t.Fatal(err)
	}
	if account, err := s.ResolveDiscovery("qr", qr); err != nil || account != b.account {
		t.Fatal("rename changed QR identity")
	}
	if again, err := s.PreviewContact(actor, s, "qr", qr); err != nil || again.ID != preview.ID || again.Handle != "opaque_new" {
		t.Fatal("QR preview changed stable identity")
	}
	for _, bad := range []string{qr + "?other=1", qr + "#other", strings.Replace(qr, "social.ynxweb4.com", "example.invalid", 1), socialLocatorPrefix + b.account} {
		if _, err := s.ResolveDiscovery("qr", bad); err == nil {
			t.Fatal("foreign or funding locator accepted")
		}
	}
}
