//go:build pay_pq && pay_cloud && pay_auth_source

package nativehost

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
	rpcserver "github.com/cometbft/cometbft/rpc/jsonrpc/server"
)

// Explicit original service material; a Root/Source grant is never inferred
// from these paths/policies. Exact finite routes remain LINK-owned; no glob.
type BFTEndpointConfig struct {
	ListenAddress, Origin, EdgeID string
	ServerTLS, ClientTLS          native.Config
	ServerPolicy, ClientPolicy    securelink.Policy
}

type bftEndpoint struct {
	mu              sync.Mutex
	server          *securelink.HTTPServer
	listener        net.Listener
	client          *http.Client
	done            chan struct{}
	serveErr, first error
	started         bool
}

// BindBFT builds the actual normal RPC handler from the supplied original Node,
// then the original BFT gateway against that same fixed local RPC origin. Both
// requests go through the same actual PQ LINK server/client. No caller can pass
// another handler, RPC URL, HTTP callback, BlockStore or parallel Application.
// The App/Node remain borrowed: this function never starts/stops consensus,
// creates identities, opens a database or closes those original parents.
func BindBFT(app *consensus.Application, original *node.Node, cfg BFTEndpointConfig, build buildinfo.Info) (*EngineBinding, error) {
	b := &EngineBinding{resources: Resources{Engine: BFTEngine, BFTApplication: app, BFTNode: original}, endpoint: &bftEndpoint{done: make(chan struct{})}}
	b.self = b
	fail := func(err error) (*EngineBinding, error) { b.endpoint.first = err; return b, err }
	if app == nil || original == nil {
		return fail(ErrEngineEndpointNotSupplied)
	}
	view, err := original.ProofSourceView()
	if err != nil {
		return fail(err)
	}
	checkpoint, err := view.LoadState()
	if err != nil {
		return fail(err)
	}
	if _, err = app.ConsensusAuthorityForState(checkpoint.ChainID, checkpoint.LastBlockHeight, checkpoint.AppHash); err != nil {
		return fail(err)
	}
	host, _, err := net.SplitHostPort(cfg.ListenAddress)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return fail(errors.New("BFT Pay endpoint requires explicit loopback service address"))
	}
	// This is the original normal RPC constructor, including its real existing
	// public validator identity and genesis initialization checks. No test getter.
	environment, err := original.ConfigureRPC()
	if err != nil {
		return fail(err)
	}
	rpcMux := http.NewServeMux()
	rpcserver.RegisterRPCFuncs(rpcMux, environment.GetRoutes(), log.NewNopLogger())
	serverGate, err := securelink.NewGate(cfg.ServerPolicy)
	if err != nil {
		return fail(err)
	}
	clientGate, err := securelink.NewGate(cfg.ClientPolicy)
	if err != nil {
		return fail(err)
	}
	for _, policy := range []securelink.Policy{cfg.ServerPolicy, cfg.ClientPolicy} {
		if err = validateBFTRPCRoutes(policy, cfg.EdgeID); err != nil {
			return fail(err)
		}
	}
	mux := http.NewServeMux()
	b.endpoint.server, err = securelink.NewHTTPServer(securelink.HTTPServerConfig{TLS: cfg.ServerTLS, Gate: serverGate, EdgeID: cfg.EdgeID, Handler: mux})
	if err != nil {
		return fail(err)
	}
	b.endpoint.listener, err = net.Listen("tcp", cfg.ListenAddress)
	if err != nil {
		return fail(err)
	}
	b.endpoint.client, err = securelink.NewHTTPClient(securelink.HTTPClientConfig{TLS: cfg.ClientTLS, Gate: clientGate, EdgeID: cfg.EdgeID, Address: b.endpoint.listener.Addr().String(), Origin: cfg.Origin, Timeout: 30 * time.Second, MaxResponseBytes: 16 << 20})
	if err != nil {
		return fail(err)
	}
	gateway, err := bftgateway.New(bftgateway.Config{CometRPCURL: cfg.Origin + "/rpc", HTTPClient: b.endpoint.client, Build: build})
	if err != nil {
		return fail(err)
	}
	mux.Handle("/rpc/", originalInvoiceRPCBoundary(http.StripPrefix("/rpc", rpcMux)))
	mux.Handle("/", gateway.Handler())
	b.handler = gateway.Handler()
	b.http, err = payproduct.NewPrivateBFTPayHTTP(cfg.Origin, b.endpoint.client, payproduct.OriginalCoreRoutePolicy{ServerGate: serverGate, ClientGate: clientGate, ServerPolicy: cfg.ServerPolicy, ClientPolicy: cfg.ClientPolicy, EdgeID: cfg.EdgeID})
	if err != nil {
		return fail(err)
	}
	b.endpoint.started = true
	go func() {
		err := b.endpoint.server.Serve(b.endpoint.listener)
		b.endpoint.mu.Lock()
		b.endpoint.serveErr = err
		b.endpoint.mu.Unlock()
		close(b.endpoint.done)
	}()
	return b, nil
}

// ShutdownEndpoint follows successful Products/Source drain+close, never
// before it. It only drains the owned HTTP boundary/client; App/Node lifetime
// stays with Core. A failed drain or first close cause is retained.
func (b *EngineBinding) ShutdownEndpoint(ctx context.Context) error {
	if b == nil || b.self != b {
		return ErrEngineEndpointNotSupplied
	}
	if ctx == nil {
		return ErrEngineEndpointNotSupplied
	}
	if b.endpoint == nil {
		return nil
	}
	e := b.endpoint
	e.mu.Lock()
	defer e.mu.Unlock()
	remember := func(err error) {
		if e.first == nil && err != nil {
			e.first = err
		}
	}
	if e.server != nil {
		if err := e.server.Shutdown(ctx); err != nil {
			remember(err)
			return e.first
		}
	}
	if e.listener != nil {
		if err := e.listener.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			remember(err)
		}
	}
	// Serve's outcome is checked without holding its publication lock.
	if e.started {
		e.mu.Unlock()
		select {
		case <-ctx.Done():
			e.mu.Lock()
			remember(ctx.Err())
			return e.first
		case <-e.done:
		}
		e.mu.Lock()
		if e.serveErr != nil && !errors.Is(e.serveErr, http.ErrServerClosed) && !errors.Is(e.serveErr, net.ErrClosed) {
			remember(e.serveErr)
		}
	}
	if e.client != nil {
		if c, ok := e.client.Transport.(*securelink.Transport); ok {
			remember(c.Close())
		}
	}
	return e.first
}
