package commerce

import (
	"bytes"
	"context"
	"errors"
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

// This adapter obtains fresh evidence from LINK's sealed ORIGINAL request.
// It neither injects channel DATA into a new context nor treats it as a Grant.
// The original SDK still calls ServiceChannelFromRequest on this same request
// and verifies its actual channel binding before returning decoded authority.
type originalLINKTaskOrderReader struct{ reader originalTaskOrderReader }

func (l originalLINKTaskOrderReader) readTaskOrder(ctx context.Context, store *Store, r *http.Request, body []byte) (taskOrderReadPayload, error) {
	if len(body) > maxBody {
		return taskOrderReadPayload{}, taskOrderAuthFailure(ErrInvalidState)
	}
	if missingTaskOrderOperand(l.reader) {
		return taskOrderReadPayload{}, ErrUnavailable
	}
	before, err := securelink.ServiceChannelFromRequest(r)
	if err != nil {
		return taskOrderReadPayload{}, ErrUnavailable
	}
	result, err := l.reader.readTaskOrder(ctx, store, r, body)
	if err != nil {
		return taskOrderReadPayload{}, err
	}
	after, err := securelink.ServiceChannelFromRequest(r)
	if err != nil || before.ConnectionID != after.ConnectionID || before.Peer != after.Peer || before.LocalSAN != after.LocalSAN || !bytes.Equal(before.Exporter, after.Exporter) {
		return taskOrderReadPayload{}, ErrUnavailable
	}
	return result, nil
}

// The operator explicitly registers this finite media profile. Smaller
// supplied budgets are preserved; this does not broaden legacy LINK siblings.
func ShopOrderReadLINKOperation(requestLimit, responseLimit int64) (securelink.ServiceOperation, error) {
	if requestLimit < 1 || responseLimit < 1 || requestLimit > maxBody || responseLimit > maxBody {
		return securelink.ServiceOperation{}, ErrInvalidState
	}
	return securelink.ServiceOperation{ID: shopOrderReadOperation, Method: http.MethodPost, Path: shopOrderReadPath, MaxRequestBytes: requestLimit, MaxResponseBytes: responseLimit, MediaProfile: securelink.MediaProfileShopOrderReadV1}, nil
}

// OpenOriginalLINK is the direct producer entry. LINK supplies actual native
// TLS/service admission; Shop supplies only its original task handler. Profiles,
// roots, SANs, epochs, credentials and original Source/SDK are caller-owned.
// No proxy/header/ordinary TLS fallback and no substitute exporter is installed.
func (p *PreparedOriginalShopTaskOrders) OpenOriginalLINK(ctx context.Context, open func() (*Store, error), cfg ServerConfig, link securelink.HTTPServerConfig) (service *securelink.HTTPServer, err error) {
	cfg, err = p.configured(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if open == nil || link.Gate == nil || link.EdgeID == "" || !link.TLS.Server {
		return nil, ErrUnavailable
	}
	var handler http.Handler
	link.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if handler == nil || r.Method != http.MethodPost || r.URL.Path != shopOrderReadPath {
			http.NotFound(w, r)
			return
		}
		// Pass the original pointer unchanged: WithContext/Clone would destroy
		// LINK's process-local request-to-native-connection custody binding.
		handler.ServeHTTP(w, r)
	})
	service, err = securelink.NewHTTPServer(link)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			if e := service.Close(); e != nil {
				err = errors.Join(err, e)
			}
			service = nil
		}
	}()
	store, e := open()
	if e != nil {
		return service, e
	}
	if store == nil {
		return service, ErrUnavailable
	}
	cfg, err = p.configured(ctx, cfg)
	if err != nil {
		return service, err
	}
	cfg.taskOrders = originalLINKTaskOrderReader{cfg.taskOrders}
	handler = NewServer(store, cfg).Handler()
	return service, nil
}
