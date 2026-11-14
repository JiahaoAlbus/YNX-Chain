//go:build pay_pq

package payproduct

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

func originalRouteFixture(t *testing.T) (*NativePayHTTP, NativePayAuthorization, NativePayOperation) {
	t.Helper()
	f := newNativeServiceFixture(t)
	wire := f.sign(t, ynxauth.ActionInvoiceTerms, f.terms, 2)
	a, _, grant, envelope, err := f.service.member(context.Background(), NativePayAccess{Operation: "register_terms", SourceOrder: "order-100"}, wire)
	if err != nil {
		t.Fatal(err)
	}
	op := nativeOperation(f.merchant, f.terms.InvoiceID, a, wire, envelope)
	policy := securelink.Policy{Edges: []securelink.Edge{{ID: "original-core", LocalSAN: "core.ynx.test", PeerSAN: "pay.ynx.test", Epoch: 1, Roots: []securelink.Root{{Fingerprint: strings.Repeat("1", 64), Until: time.Now().Add(time.Hour)}}, Routes: []securelink.Route{{Method: http.MethodPost, Path: nativePayBroadcastPath, Risk: "write"}}}}}
	server, err := securelink.NewGate(policy)
	if err != nil {
		t.Fatal(err)
	}
	clientPolicy := cloneCorePolicy(policy)
	clientPolicy.Edges[0].LocalSAN, clientPolicy.Edges[0].PeerSAN = "pay.ynx.test", "core.ynx.test"
	client, err := securelink.NewGate(clientPolicy)
	if err != nil {
		t.Fatal(err)
	}
	// PUBLIC existing Source fixture verifies the real complete Member. This
	// private policy test does not claim S3/Root commissioning or live Node.
	h := f.service.cfg.HTTP
	h.routePolicy = &nativePayRoutePolicy{owned: OriginalCoreRoutePolicy{ServerGate: server, ClientGate: client, ServerPolicy: policy, ClientPolicy: clientPolicy, EdgeID: "original-core"}}
	return h, grant, op
}

func TestPrivateCoreRoutesOnlyVerifiedOriginalExactReads(t *testing.T) {
	h, grant, op := originalRouteFixture(t)
	if err := h.registerOriginalReadRoutes(context.Background(), grant, op); err != nil {
		t.Fatal(err)
	}
	for _, p := range []securelink.Policy{h.routePolicy.owned.ServerPolicy, h.routePolicy.owned.ClientPolicy} {
		e := p.Edges[0]
		if e.Epoch != 2 || len(e.Routes) != 4 {
			t.Fatal("full exact policy/epoch not advanced", e.Epoch, len(e.Routes))
		}
		for _, r := range e.Routes[1:] {
			if r.Method != "GET" || r.Risk != "read" || strings.ContainsAny(r.Path, "?*%") {
				t.Fatal("route expanded into chooser/write/template", r)
			}
		}
		if e.Routes[1].Path != nativePayOriginalPath+op.NativeHash || e.Routes[2].Path != nativePayOriginalPath+op.NativeHash+"/pq-finality-proof" || e.Routes[3].Path != "/invoices/pq/"+op.Merchant+"/"+op.InvoiceID {
			t.Fatal("routes not derived from exact retained original", e.Routes)
		}
	}
	if err := h.registerOriginalReadRoutes(context.Background(), grant, op); err != nil || h.routePolicy.owned.ServerPolicy.Edges[0].Epoch != 2 {
		t.Fatal("same original re-registration retired connections again", err)
	}
}

func TestPrivateCoreRoutesRevokedTamperedAndBoundedRefuse(t *testing.T) {
	h, grant, op := originalRouteFixture(t)
	denied := errors.New("PUBLIC original Source revoked")
	grant.Current = func() error { return denied }
	if err := h.registerOriginalReadRoutes(context.Background(), grant, op); err != denied || h.routePolicy.owned.ServerPolicy.Edges[0].Epoch != 1 {
		t.Fatal("revoked original expanded policy", err)
	}
	grant.Current = func() error { return nil }
	op.NativeHash = "0x" + strings.Repeat("2", 64)
	if err := h.registerOriginalReadRoutes(context.Background(), grant, op); err == nil || h.routePolicy.owned.ServerPolicy.Edges[0].Epoch != 1 {
		t.Fatal("retargeted identity expanded policy", err)
	}
	p := cloneCorePolicy(h.routePolicy.owned.ServerPolicy)
	p.Edges[0].Routes = make([]securelink.Route, 4096)
	if _, _, err := appendOriginalReadRoutes(p, "original-core", []securelink.Route{{Method: "GET", Path: "/new-original", Risk: "read"}}); err == nil || p.Edges[0].Epoch != 1 {
		t.Fatal("route bound changed original policy", err)
	}
}
