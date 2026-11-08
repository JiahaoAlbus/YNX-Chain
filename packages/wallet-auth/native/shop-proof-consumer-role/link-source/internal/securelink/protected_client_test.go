package securelink

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"
)

func shopOrderReadMediaProfileFixture() FixedPeerProfile {
	p := fixedProfileFixture()
	p.Operations[0].MediaProfile = MediaProfileShopOrderReadV1
	p.Operations[0].MaxRequestBytes = 1 << 20
	p.Operations[0].MaxResponseBytes = 1 << 20
	return p
}

func TestFixedPeerMediaRegistrationIsFiniteAndOperationBound(t *testing.T) {
	for name, mutate := range map[string]func(*ServiceOperation){
		"unknown":         func(op *ServiceOperation) { op.MediaProfile = "arbitrary" },
		"wildcard":        func(op *ServiceOperation) { op.MediaProfile = "application/*" },
		"mime-as-profile": func(op *ServiceOperation) { op.MediaProfile = shopOrderReadRequestMedia },
		"profile-case":    func(op *ServiceOperation) { op.MediaProfile = "Shop-Order-Read-V1" },
		"wrong-id":        func(op *ServiceOperation) { op.ID = "other.read" },
		"wrong-method":    func(op *ServiceOperation) { op.Method = http.MethodPut },
		"wrong-path":      func(op *ServiceOperation) { op.Path = "/api/tools/other.read" },
		"request-too-large": func(op *ServiceOperation) {
			op.MaxRequestBytes = (1 << 20) + 1
		},
		"response-too-large": func(op *ServiceOperation) {
			op.MaxResponseBytes = (1 << 20) + 1
		},
	} {
		t.Run(name, func(t *testing.T) {
			p := shopOrderReadMediaProfileFixture()
			mutate(&p.Operations[0])
			if _, _, _, err := validateFixedPeerProfile(p); !errors.Is(err, ErrDenied) {
				t.Fatal("unapproved media registration accepted", err)
			}
		})
	}
	for _, profile := range []OperationMediaProfile{"", MediaProfileJSONCBOR} {
		p := fixedProfileFixture()
		p.Operations[0].MediaProfile = profile
		registered, ops, _, err := validateFixedPeerProfile(p)
		if err != nil || registered.Operations[0].MaxRequestBytes != 32<<10 || ops["shop.order.read"].MaxRequestBytes != 32<<10 {
			t.Fatal("legacy registration or its budget changed", err)
		}
	}
}

func TestFixedPeerMediaRequestResponseRulesRemainIndependent(t *testing.T) {
	shop := shopOrderReadMediaProfileFixture().Operations[0]
	legacy := fixedProfileFixture().Operations[0]
	for _, value := range []string{"", "application/json", "application/cbor", "text/plain", "application/vnd.ynx.shop-order-read.v1; charset=utf-8", "Application/vnd.ynx.shop-order-read.v1", "application/x-ynx.shop-order-read.v1", " application/vnd.ynx.shop-order-read.v1", "application/vnd.ynx.shop-order-read.v1 "} {
		if shop.requestContentTypeAllowed(value) {
			t.Errorf("E5 request accepted unregistered MIME %q", value)
		}
	}
	if !shop.requestContentTypeAllowed(shopOrderReadRequestMedia) || legacy.requestContentTypeAllowed(shopOrderReadRequestMedia) {
		t.Fatal("explicit request registration leaked into legacy operations")
	}
	for _, value := range []string{"", shopOrderReadRequestMedia, "application/cbor", "application/json; charset=utf-8", "Application/JSON", "application/x-json", "application/json, application/json"} {
		if shop.responseContentTypeAllowed(http.Header{"Content-Type": []string{value}}) {
			t.Errorf("E5 response accepted unregistered MIME %q", value)
		}
	}
	if shop.responseContentTypeAllowed(http.Header{"Content-Type": []string{"application/json", "application/json"}}) {
		t.Fatal("duplicate response Content-Type accepted as one canonical value")
	}
	if !shop.responseContentTypeAllowed(http.Header{"Content-Type": []string{"application/json"}}) || shop.responseAccept() != "application/json" {
		t.Fatal("E5 request registration incorrectly changed the JSON response contract")
	}
	if !legacy.responseContentTypeAllowed(http.Header{"Content-Type": []string{"Application/JSON; charset=utf-8"}}) || legacy.responseAccept() != "application/json, application/cbor" {
		t.Fatal("original parsed response MIME compatibility changed")
	}
}

func TestFixedPeerMediaRegistrationCopiesAndBudgetsAreIsolated(t *testing.T) {
	p := shopOrderReadMediaProfileFixture()
	p.Operations[0].MaxRequestBytes = 64
	p.Operations[0].MaxResponseBytes = 32
	p.Operations = append(p.Operations, ServiceOperation{ID: "other.read", Method: "POST", Path: "/api/tools/other.read", MaxRequestBytes: 32 << 10, MaxResponseBytes: 2 << 20})
	registered, ops, maxResponse, err := validateFixedPeerProfile(p)
	if err != nil {
		t.Fatal(err)
	}
	c := &FixedPeerClient{profile: registered, operations: ops}
	p.Operations[0].MediaProfile = MediaProfileJSONCBOR
	p.Operations[0].MaxRequestBytes = 16 << 20
	p.Roots[0].Fingerprint = "changed"
	copyProfile := c.Profile()
	copyProfile.Operations[0].MediaProfile = MediaProfileJSONCBOR
	copyProfile.Operations[0].MaxResponseBytes = 16 << 20
	copyProfile.Roots[0].Fingerprint = "changed-again"
	actual := c.Profile()
	if actual.Operations[0].MediaProfile != MediaProfileShopOrderReadV1 || actual.Operations[0].MaxRequestBytes != 64 || actual.Operations[0].MaxResponseBytes != 32 || actual.Roots[0].Fingerprint != strings.Repeat("a", 64) {
		t.Fatal("caller mutation changed the registered media profile or limits")
	}
	if ops["shop.order.read"].MediaProfile != MediaProfileShopOrderReadV1 || ops["shop.order.read"].MaxResponseBytes != 32 || maxResponse != 2<<20 || ops["other.read"].requestContentTypeAllowed(shopOrderReadRequestMedia) {
		t.Fatal("one operation inherited another operation's registration/budget")
	}
}

func fixedProfileFixture() FixedPeerProfile {
	return FixedPeerProfile{ID: "isolated-profile", Revision: "1", Service: "isolated-shop", EdgeID: "isolated-ai-shop", LocalSAN: "pay.ynx.test", PeerSAN: "adapter.ynx.test", Origin: "https://adapter.ynx.test", Address: "127.0.0.1:443", Epoch: 1, Roots: []Root{{Fingerprint: strings.Repeat("a", 64), Until: time.Now().Add(time.Hour)}}, Operations: []ServiceOperation{{ID: "shop.order.read", Method: "POST", Path: "/api/tools/shop.order.read", MaxRequestBytes: 32 << 10, MaxResponseBytes: 1 << 20}}}
}

func TestFixedPeerProfileRejectsUnregisteredAliasesAndMissingAuthority(t *testing.T) {
	for name, mutate := range map[string]func(*FixedPeerProfile){
		"ordinary-http":        func(p *FixedPeerProfile) { p.Origin = "http://adapter.ynx.test" },
		"origin-userinfo":      func(p *FixedPeerProfile) { p.Origin = "https://caller@adapter.ynx.test" },
		"origin-peer-mismatch": func(p *FixedPeerProfile) { p.Origin = "https://unrelated.ynx.test" },
		"origin-empty-query":   func(p *FixedPeerProfile) { p.Origin += "?" },
		"origin-zero-port":     func(p *FixedPeerProfile) { p.Origin += ":0" },
		"wildcard-peer":        func(p *FixedPeerProfile) { p.PeerSAN = "*.ynx.test" },
		"path-query":           func(p *FixedPeerProfile) { p.Operations[0].Path += "?account=other" },
		"path-percent-alias":   func(p *FixedPeerProfile) { p.Operations[0].Path = "/api/tools/shop%2eorder.read" },
		"empty-post":           func(p *FixedPeerProfile) { p.Operations[0].MaxRequestBytes = 0 },
		"unbounded-body":       func(p *FixedPeerProfile) { p.Operations[0].MaxResponseBytes = 17 << 20 },
		"query-alias-of-dispatch": func(p *FixedPeerProfile) {
			q := p.Operations[0]
			q.ID = "query-original"
			p.Operations = append(p.Operations, q)
		},
		"revision-alias": func(p *FixedPeerProfile) { p.Revision = "01" },
	} {
		t.Run(name, func(t *testing.T) {
			p := fixedProfileFixture()
			mutate(&p)
			if _, _, _, err := validateFixedPeerProfile(p); err == nil {
				t.Fatal("unregistered carrier/profile alias accepted")
			}
		})
	}
	if _, err := NewFixedPeerClient(FixedPeerClientConfig{}); !errors.Is(err, ErrUnavailable) {
		t.Fatal("missing profile did not fail unavailable", err)
	}
	p := fixedProfileFixture()
	cfg := FixedPeerClientConfig{Profile: p}
	cfg.TLS.PeerSAN = p.PeerSAN
	if _, err := NewFixedPeerClient(cfg); !errors.Is(err, ErrUnavailable) {
		t.Fatal("missing service credentials did not fail unavailable", err)
	}
}
