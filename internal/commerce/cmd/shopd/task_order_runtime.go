package main

import (
	"context"
	"errors"
	"net"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/commerce"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	policy "ynx.local/authgrantpolicy"
)

// The original publisher supplies this private bootstrap in the same build.
// Neither the HTTP listener nor flags or environment register a task route.
var originalShopTaskOrderPublisher *shopTaskOrderPublisher

type shopTaskOrderPublisher struct {
	channels  commerce.OriginalShopTaskOrderOuterChannelAuthority
	responses commerce.OriginalShopTaskOrderResponseAuthority
	target    policy.Sink
	orderKind string
	link      securelink.HTTPServerConfig
	listen    func(context.Context) (net.Listener, error)
}

var errShopTaskOrderPublisherNotSupplied = errors.New("SHOP_TASK_ORDER_PUBLISHER_NOT_SUPPLIED")

type shopTaskOrderRuntime struct {
	reader                *commerce.PreparedOriginalShopTaskOrders
	link                  *securelink.HTTPServer
	listener              net.Listener
	served                bool
	closeMu               sync.Mutex
	closed                bool
	listenerCloseSelected bool
	closeErr              error
}

func openShopTaskOrderRuntime(ctx context.Context, store *commerce.Store, cfg commerce.ServerConfig, publisher *shopTaskOrderPublisher) (runtime *shopTaskOrderRuntime, err error) {
	if ctx == nil || store == nil {
		return nil, commerce.ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if publisher == nil || publisher.channels == nil || publisher.responses == nil ||
		publisher.listen == nil || publisher.link.Gate == nil ||
		publisher.link.EdgeID == "" || !publisher.link.TLS.Server {
		return nil, errShopTaskOrderPublisherNotSupplied
	}
	p := *publisher
	runtime = &shopTaskOrderRuntime{}
	runtime.reader, err = commerce.OpenOriginalShopTaskOrdersSDKResult(ctx, p.channels, p.responses, p.target, p.orderKind)
	if err != nil {
		return runtime, err
	}
	runtime.link, err = runtime.reader.OpenOriginalLINK(ctx, func() (*commerce.Store, error) { return store, nil }, cfg, p.link)
	if err != nil {
		return runtime, err
	}
	runtime.listener, err = p.listen(ctx)
	if err == nil && runtime.listener == nil {
		err = commerce.ErrUnavailable
	}
	return runtime, err
}

func (r *shopTaskOrderRuntime) serve() error {
	r.closeMu.Lock()
	if r.closed || r.listenerCloseSelected {
		r.closeMu.Unlock()
		return net.ErrClosed
	}
	r.served = true
	r.closeMu.Unlock()
	return r.link.Serve(r.listener)
}

func (r *shopTaskOrderRuntime) close(ctx context.Context) error {
	if r == nil {
		return nil
	}
	r.closeMu.Lock()
	defer r.closeMu.Unlock()
	if r.closed {
		return r.closeErr
	}
	if r.listenerCloseSelected && r.closeErr != nil {
		return r.closeErr
	}
	if r.link != nil {
		if err := r.link.Shutdown(ctx); err != nil {
			return err
		}
	}
	// LINK/http owns listener closure after Serve starts. For a failed
	// bootstrap the listener was never handed to it and remains ours.
	if r.listener != nil && !r.served {
		r.listenerCloseSelected = true
		if err := r.listener.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			r.closeErr = err
			return r.closeErr
		}
	}
	r.closeErr = r.reader.Close()
	r.closed = true
	return r.closeErr
}
