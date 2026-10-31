package securelink

import (
	"errors"
	"strings"
	"testing"
	"time"
)

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
