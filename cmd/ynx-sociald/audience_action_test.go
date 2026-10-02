package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

func TestSocialActionAdapterOriginalSharedSignedProof(t *testing.T) {
	raw, err := os.ReadFile("testdata/social-action-js-proof.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Session productsessionv2.Session `json:"session"`
		Header  string                   `json:"header"`
		Body    string                   `json:"body"`
		Path    string                   `json:"path"`
		At      time.Time                `json:"at"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	v := socialAudienceActionVerifier{now: func() time.Time { return fixture.At }}
	r := httptest.NewRequest(http.MethodPost, fixture.Path, nil)
	r.Header.Set(productsessionv2.ActionProofHeader, fixture.Header)
	scopes := []string{"social.contacts", "social.feed", "social.messaging", "social.profile"}
	receipt, err := v.VerifyHTTPAction(context.Background(), r, fixture.Session, []byte(fixture.Body), scopes)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Nonce == "" || receipt.BodyDigest != fmt.Sprintf("%x", sha256.Sum256([]byte(fixture.Body))) || receipt.SessionBinding != fixture.Session.SessionBinding || !receipt.ExpiresAt.Equal(fixture.At.Add(30*time.Second)) {
		t.Fatal("original signed proof receipt was changed")
	}
	for _, changed := range []string{fixture.Body + " ", `{"kind":"private","txn":"qa-transaction"}`} {
		if got, err := v.VerifyHTTPAction(context.Background(), r, fixture.Session, []byte(changed), scopes); err == nil || got.Nonce != "" {
			t.Fatal("changed exact raw body accepted")
		}
	}
	changed := fixture.Session
	changed.DeviceID = "different-original-device"
	if _, err := v.VerifyHTTPAction(context.Background(), r, changed, []byte(fixture.Body), scopes); err == nil {
		t.Fatal("substituted original device accepted")
	}
}

func TestSocialActionReceiptPreservesSharedFields(t *testing.T) {
	original := productsessionv2.ActionAuthorization{Nonce: "original-nonce", BodyDigest: "original-exact-body", SessionBinding: "original-private-binding", ExpiresAt: time.Now().UTC().Add(time.Second)}
	got := socialActionReceipt(original)
	if got.Nonce != original.Nonce || got.BodyDigest != original.BodyDigest || got.SessionBinding != original.SessionBinding || !got.ExpiresAt.Equal(original.ExpiresAt) || got.BrowserBinding != "" {
		t.Fatal("adapter changed shared receipt or fabricated BrowserSSO binding")
	}
}

func TestSocialActionAdapterRejectsBeforeBusinessMutation(t *testing.T) {
	scopes := []string{"social.contacts", "social.feed", "social.messaging", "social.profile"}
	for _, name := range []string{"missing-proof", "duplicate-proof", "duplicate-scope", "widened-scope", "invalid-original-proof"} {
		t.Run(name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/social/v3/matrix/audience/authorize", nil)
			policy := append([]string(nil), scopes...)
			switch name {
			case "duplicate-proof":
				r.Header.Add(productsessionv2.ActionProofHeader, "first")
				r.Header.Add(productsessionv2.ActionProofHeader, "second")
			case "duplicate-scope":
				policy[1] = policy[0]
			case "widened-scope":
				policy[1] = "social.ai"
			case "invalid-original-proof":
				r.Header.Set(productsessionv2.ActionProofHeader, "invalid")
			}
			receipt, err := (socialAudienceActionVerifier{}).VerifyHTTPAction(context.Background(), r, productsessionv2.Session{}, []byte(`{}`), policy)
			var typed *productsessionv2.Error
			if !errors.As(err, &typed) || receipt.Nonce != "" {
				t.Fatal("invalid action did not fail closed with original shared error")
			}
			want := http.StatusForbidden
			if name == "duplicate-scope" || name == "widened-scope" {
				want = http.StatusInternalServerError
			}
			if typed.Status != want {
				t.Fatalf("wrong failure classification: %d", typed.Status)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (socialAudienceActionVerifier{}).VerifyHTTPAction(ctx, nil, productsessionv2.Session{}, nil, scopes); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled original operation continued")
	}
}
