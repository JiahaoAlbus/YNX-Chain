package social

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Synthetic authority fixtures test routing/state guards, not Wallet acceptance.
func TestOriginalProofRoutesWithoutAddingPlatform(t *testing.T) {
	f := newFixture(t, 81)
	for _, platform := range []string{"web", "android", "ios"} {
		t.Run(platform, func(t *testing.T) {
			a := &bridgeAuthority{session: bridgeSession(f, platform)}
			s := bridgeService(t, a, nil)
			proof := map[string]any{"productId": RequestingProduct, "clientId": ProductClientID, "applicationId": BundleID, "bundleId": nil, "packageId": nil, "callback": Callback}
			switch platform {
			case "web":
				proof["applicationId"] = BundleID + ".web"
				proof["origin"] = Origin
				proof["callback"] = Origin + "/wallet-auth/callback"
			case "android":
				proof["origin"] = "app://android/" + BundleID
				proof["packageId"] = BundleID
			case "ios":
				proof["origin"] = "app://ios/" + BundleID
				proof["bundleId"] = BundleID
			}
			r := bridgeRequest(platform, "/social/v2/session/bind", http.MethodPost, nil)
			raw, err := json.Marshal(proof)
			if err != nil {
				t.Fatal(err)
			}
			header := base64.RawURLEncoding.EncodeToString(raw)
			r.Header.Set(productsessionv2.ProofHeader, header)
			if _, err := NewServer(s, s).liveProductSession(r, []string{"social.profile"}); err != nil {
				t.Fatal(err)
			}
			if a.calls != 1 || r.Header.Get(productsessionv2.ProofHeader) != header {
				t.Fatal("proof was rewritten or authority called more than once")
			}
			proof["origin"] = "https://unregistered.example"
			raw, err = json.Marshal(proof)
			if err != nil {
				t.Fatal(err)
			}
			r.Header.Set(productsessionv2.ProofHeader, base64.RawURLEncoding.EncodeToString(raw))
			if _, err := NewServer(s, s).liveProductSession(r, []string{"social.profile"}); !errors.Is(err, ErrUnauthorized) {
				t.Fatalf("unregistered tuple accepted: %v", err)
			}
			if a.calls != 1 {
				t.Fatal("unregistered tuple reached authority")
			}
		})
	}
}

func TestProductBindingRejectsReplacedOriginalDeviceAndTuple(t *testing.T) {
	f := newFixture(t, 82)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	in := bridgeRegistration(f, a.session)
	if _, err := s.bindProductDevice(a.session, in, "", ""); err != nil {
		t.Fatal(err)
	}
	replacement := newFixture(t, 83)
	replacement.device = f.device
	substitute := bridgeRegistration(replacement, a.session)
	if _, err := s.bindProductDevice(a.session, substitute, "", ""); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("self-signed substituted key accepted: %v", err)
	}
	changed := a.session
	changed.DeviceBinding = "different-original-device-binding"
	if _, err := s.bindProductDevice(changed, bridgeRegistration(f, changed), "", ""); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("changed original session tuple accepted: %v", err)
	}
	r := bridgeRequest("android", "/social/v1/profile", http.MethodGet, nil)
	ctx, cancel := context.WithCancel(r.Context())
	cancel()
	if _, err := NewServer(s, s).authorizeProductActor(r.WithContext(ctx), "social.profile"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("canceled request accepted: %v", err)
	}
	s.mu.Lock()
	device := s.state.Devices[f.device]
	device.SigningPublicKey = substitute.SigningPublicKey
	s.state.Devices[f.device] = device
	s.mu.Unlock()
	if _, err := NewServer(s, s).authorizeProductActor(r, "social.profile"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("replaced enrolled key accepted: %v", err)
	}
}
