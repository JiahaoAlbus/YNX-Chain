//go:build commerce_v2

package payproduct

import (
	"context"
	"crypto/ed25519"
	"errors"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

func TestMerchantCombined641QualificationStaysClosed(t *testing.T) {
	service, m, _, _ := merchantBusinessQA(t)
	var calls atomic.Int32
	transport := merchantQATransport(func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return nil, errors.New("no live authority permitted")
	})
	cfg := MerchantCombinedConfig{Transport: transport, BackendKeyID: "controlled-qa", BackendKey: ed25519.NewKeyFromSeed(bytes32(6)), BrowserSealKey: bytes32(9), BindActor: func(*http.Request, v2.Session, v2.BrowserGrant, string) (func() error, error) {
		t.Fatal("unregistered Merchant actor invoked")
		return nil, nil
	}}
	server, err := NewMerchantCombinedV2ServerWithLogger(service, cfg, buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	w := merchantQARequest(server, "POST", "/v1/merchant/sessions", `{"merchantId":"`+m.ID+`"}`, "", "")
	if w.Code != 503 || calls.Load() != 0 {
		t.Fatal("unregistered Merchant upgraded or sent authority", w.Code, calls.Load())
	}
	for _, product := range []string{"shop", MerchantProductID} {
		browser, err := v2.NewBrowserSSO(product, "https://wallet-auth.ynxweb4.com", bytes32(9), []string{"commerce"}, transport)
		if err == nil || browser != nil {
			t.Fatal("641 unexpectedly qualified original unregistered Browser tuple", product)
		}
	}
}
func TestMerchantCombinedCannotBorrowAIIdentityOrSeparateAuthorities(t *testing.T) {
	var calls atomic.Int32
	transport := merchantQATransport(func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return nil, errors.New("must not make authority call")
	})
	policy := v2.Policy{ProductID: MerchantProductID, ClientID: MerchantClientID, ApplicationID: MerchantBundleID + ".web", Platform: "web", Origin: "https://pay.ynxweb4.com", Callback: MerchantCallback, AllowedScopes: merchantConsoleScopes}
	client, err := v2.NewClient("https://wallet-auth.ynxweb4.com", policy, transport)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := v2.NewPrivateBusinessRevalidator(client, MerchantClientID+"-business-web-v1", "controlled-qa", ed25519.NewKeyFromSeed(bytes32(6)))
	if err != nil {
		t.Fatal(err)
	}
	browser, err := v2.NewBrowserSSO("ai", "https://wallet-auth.ynxweb4.com", bytes32(9), []string{"chat"}, transport)
	if err != nil {
		t.Fatal(err)
	}
	session, grant, err := reader.RevalidateBrowser(context.Background(), v2.Session{}, browser, "original-not-a-merchant-binding", merchantConsoleScopes)
	if err == nil || session.SessionBinding != "" || grant.GrantToken != "" || calls.Load() != 0 {
		t.Fatal("borrowed identity accepted or separate authority called", err, calls.Load())
	}
}
func TestMerchantCombinedCancelledBeforeDecisionReturnsNoSnapshot(t *testing.T) {
	original := v2.Session{ProductID: MerchantProductID}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	holder := &merchantCombinedOriginal{original: original}
	snapshot, err := holder.ReadMerchantAuthority(ctx, original, merchantConsoleScopes)
	if err == nil || snapshot.Session.ProductID != "" || snapshot.Current != nil {
		t.Fatal("cancelled original decision returned authority")
	}
}
func TestMerchantOriginalBrowserAssociationCannotChangeOnCarrier(t *testing.T) {
	s, m, v, server := merchantBusinessQA(t)
	original := merchantQASession(t, server, m, "")
	_ = v
	_ = s.store.Update(func(d *Snapshot) error {
		for id, carrier := range d.ConsoleSessions {
			carrier.BrowserBindingDigest = strings.Repeat("d", 64)
			d.ConsoleSessions[id] = carrier
		}
		return nil
	})
	w := merchantQARequest(server, "GET", "/v1/merchant/state", "", original.Token, "")
	if w.Code != 401 || strings.Contains(w.Body.String(), m.DisplayName) {
		t.Fatal("original Browser association replaced", w.Code, w.Body.String())
	}
	before, _, _ := merchantCounts(t, s)
	a := &merchantAdmission{account: v.account, binding: v.binding, nonce: strings.Repeat("x", 32), digest: strings.Repeat("a", 64), method: "POST", path: "/v1/merchant/catalog", merchantID: m.ID, expires: time.Now().Add(time.Minute), proofExpires: time.Now().Add(time.Minute), browserBindingDigest: strings.Repeat("e", 64), domainID: original.SessionID, domainToken: strings.Split(original.Token, ".")[1], refresh: func(context.Context) (func() error, time.Time, error) {
		return func() error { return nil }, time.Now().Add(time.Minute), nil
	}}
	child := s.merchantScope(context.Background(), a, "invoice")
	if err := child.store.Update(func(d *Snapshot) error { d.Catalog["forbidden"] = CatalogItem{}; return nil }); err == nil {
		t.Fatal("changed original browser binding committed")
	}
	after, _, count := merchantCounts(t, s)
	if before != after || count != 0 {
		t.Fatal("browser mismatch changed nonce/effect")
	}
}

func TestMerchantChangedOriginalBrowserCannotMintAnotherCarrier(t *testing.T) {
	s, m, _, server := merchantBusinessQA(t)
	original := merchantQASession(t, server, m, "")
	_ = s.store.Update(func(d *Snapshot) error {
		carrier := d.ConsoleSessions[original.SessionID]
		carrier.BrowserBindingDigest = strings.Repeat("d", 64)
		d.ConsoleSessions[original.SessionID] = carrier
		return nil
	})
	before, sessions, _ := merchantCounts(t, s)
	w := merchantQARequest(server, "POST", "/v1/merchant/sessions", `{"merchantId":"`+m.ID+`"}`, "", "")
	after, current, _ := merchantCounts(t, s)
	if w.Code != 401 || after != before || sessions != current {
		t.Fatal("changed original Browser silently minted replacement", w.Code, before, after, sessions, current)
	}
}
