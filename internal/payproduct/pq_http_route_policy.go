//go:build pay_pq

package payproduct

import (
	"bytes"
	"context"
	"errors"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// OriginalCoreRoutePolicy is normal boot-only ownership of the two real Gate
// objects. No HTTP/client setter or request-supplied route callback exists.
// The new constructor is only used by the actual same-engine private host.
type OriginalCoreRoutePolicy struct {
	ServerGate, ClientGate     *securelink.Gate
	ServerPolicy, ClientPolicy securelink.Policy
	EdgeID                     string
}
type nativePayRoutePolicy struct {
	mu    sync.Mutex
	owned OriginalCoreRoutePolicy
	first error
}

func cloneCorePolicy(p securelink.Policy) securelink.Policy {
	out := securelink.Policy{Edges: append([]securelink.Edge(nil), p.Edges...)}
	for i := range out.Edges {
		out.Edges[i].Roots = append([]securelink.Root(nil), out.Edges[i].Roots...)
		out.Edges[i].Routes = append([]securelink.Route(nil), out.Edges[i].Routes...)
	}
	return out
}

func NewPrivateBFTPayHTTP(origin string, client *http.Client, policy OriginalCoreRoutePolicy) (*NativePayHTTP, error) {
	if client == nil || policy.ServerGate == nil || policy.ClientGate == nil || policy.EdgeID == "" {
		return nil, ErrNativePayUnavailable
	}
	if _, ok := client.Transport.(*securelink.Transport); !ok {
		return nil, errors.New("normal BFT Pay requires original LINK transport")
	}
	h, err := NewNativePayHTTP(origin, client)
	if err != nil {
		return nil, err
	}
	policy.ServerPolicy = cloneCorePolicy(policy.ServerPolicy)
	policy.ClientPolicy = cloneCorePolicy(policy.ClientPolicy)
	for _, p := range []securelink.Policy{policy.ServerPolicy, policy.ClientPolicy} {
		found := false
		for _, e := range p.Edges {
			if e.ID == policy.EdgeID {
				for _, r := range e.Routes {
					if r.Method == http.MethodPost && r.Path == nativePayBroadcastPath {
						found = true
					}
				}
			}
		}
		if !found {
			return nil, errors.New("normal BFT Pay broadcast route not originally registered")
		}
	}
	h.routePolicy = &nativePayRoutePolicy{owned: policy}
	return h, nil
}

func appendOriginalReadRoutes(p securelink.Policy, edge string, routes []securelink.Route) (securelink.Policy, bool, error) {
	out := cloneCorePolicy(p)
	found, changed := false, false
	for i := range out.Edges {
		e := &out.Edges[i]
		if e.ID != edge {
			continue
		}
		found = true
		for _, r := range routes {
			exists := false
			for _, old := range e.Routes {
				if old.Method == r.Method && old.Path == r.Path {
					if old.Risk != r.Risk {
						return p, false, securelink.ErrDenied
					}
					exists = true
					break
				}
			}
			if !exists {
				e.Routes = append(e.Routes, r)
				changed = true
			}
		}
		if len(e.Routes) > 4096 {
			return p, false, securelink.ErrBounds
		}
	}
	if !found {
		return p, false, securelink.ErrDenied
	}
	if changed {
		for i := range out.Edges {
			if out.Edges[i].Epoch == math.MaxUint64 {
				return p, false, securelink.ErrBounds
			}
			out.Edges[i].Epoch++
		}
	}
	return out, changed, nil
}

// Called only from the original service's verified-Member dispatch or its
// authenticated retained-Store reconciliation. Never from response URLs, JSON
// paths, a public client method or an unverified request. It only adds three
// exact GET routes; it cannot add POST/retry/send permission. Full replacement
// closes old Gate connections/read handles; no atomic two-peer update claimed.
func (h *NativePayHTTP) registerOriginalReadRoutes(ctx context.Context, g NativePayAuthorization, op NativePayOperation) error {
	if h == nil || h.routePolicy == nil {
		return nil
	}
	if ctx == nil || ctx.Err() != nil || g.Current == nil || !time.Now().Before(g.Until) {
		return ErrNativePayUnavailable
	}
	if err := g.Current(); err != nil {
		return err
	}
	envelope, action, err := nativePayHTTPMember(op.Member)
	if err != nil || consensus.SignedTransactionHash(op.Member) != op.NativeHash || consensus.SignedTransactionHash(envelope) != op.ABCIHash || action.Kind != op.Kind || action.Owner != op.Owner {
		return errors.New("exact retained original Member required for read routes")
	}
	if _, err = ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceSettle, ynxauth.InvoiceSettlePayload{Merchant: op.Merchant, InvoiceID: op.InvoiceID, TermsHash: bytes.Repeat([]byte{1}, 32), Amount: 1}); err != nil {
		return err
	}
	routes := []securelink.Route{{Method: http.MethodGet, Path: nativePayOriginalPath + op.NativeHash, Risk: "read"}, {Method: http.MethodGet, Path: nativePayOriginalPath + op.NativeHash + "/pq-finality-proof", Risk: "read"}, {Method: http.MethodGet, Path: "/invoices/pq/" + op.Merchant + "/" + op.InvoiceID, Risk: "read"}}
	p := h.routePolicy
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.first != nil {
		return p.first
	}
	server, sc, err := appendOriginalReadRoutes(p.owned.ServerPolicy, p.owned.EdgeID, routes)
	if err != nil {
		return err
	}
	client, cc, err := appendOriginalReadRoutes(p.owned.ClientPolicy, p.owned.EdgeID, routes)
	if err != nil {
		return err
	}
	if err = g.Current(); err != nil {
		return err
	}
	if sc {
		if err = p.owned.ServerGate.ReplacePolicy(server); err != nil {
			p.first = err
			return err
		}
		p.owned.ServerPolicy = server
	}
	if cc {
		if err = p.owned.ClientGate.ReplacePolicy(client); err != nil {
			p.first = err
			return err
		}
		p.owned.ClientPolicy = client
	}
	if (sc || cc) && h.client != nil {
		h.client.CloseIdleConnections()
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	return g.Current()
}
