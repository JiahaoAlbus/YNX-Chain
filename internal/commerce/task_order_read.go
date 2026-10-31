package commerce

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"reflect"
)

const shopOrderReadOperation = "shop.order.read"
const shopOrderReadPath = "/api/tools/shop.order.read"

const ShopOrderReadRequestContentType = "application/vnd.ynx.shop-order-read.v1"

// Only the original private composition can install this in-process reader.
// No HTTP/session/model value creates one. Its actual Auth consumer is built
// with the original normal-source Auth supplier module.
type originalTaskOrderReader interface {
	readTaskOrder(context.Context, *Store, *http.Request, []byte) (taskOrderReadPayload, error)
}

type taskOrderReadPayload struct {
	Body        []byte
	ContentType string
	AuthFence   string
}

type taskOrderReadFailure struct {
	code       string
	status     int
	originalOp string
	cause      error
}

func (e *taskOrderReadFailure) Error() string { return e.code }
func (e *taskOrderReadFailure) Unwrap() error { return e.cause }

func missingTaskOrderOperand(v any) bool {
	if v == nil {
		return true
	}
	r := reflect.ValueOf(v)
	switch r.Kind() {
	case reflect.Pointer, reflect.Interface, reflect.Func, reflect.Map, reflect.Slice, reflect.Chan:
		return r.IsNil()
	}
	return false
}

// This is a prepared original runtime operand, not an authority provider API.
// Its zero value cannot open a Store or activate the tool. The supplier-facing
// constructor accepts only original in-process operands, not HTTP registration.
type PreparedOriginalShopTaskOrders struct {
	reader  originalTaskOrderReader
	current func(context.Context) error
}

func (p *PreparedOriginalShopTaskOrders) configured(ctx context.Context, cfg ServerConfig) (ServerConfig, error) {
	if p == nil || missingTaskOrderOperand(p.reader) || p.current == nil || ctx == nil {
		return cfg, ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return cfg, err
	}
	if err := p.current(ctx); err != nil {
		return cfg, err
	}
	cfg.taskOrders = guardedTaskOrderReader{p.reader, p.current}
	return cfg, nil
}

// OpenOriginal reuses the caller's original Store opener after protected
// runtime custody checks; it creates no second order/task/authorization store.
func (p *PreparedOriginalShopTaskOrders) OpenOriginal(ctx context.Context, open func() (*Store, error), cfg ServerConfig) (*Server, error) {
	cfg, err := p.configured(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if open == nil {
		return nil, ErrUnavailable
	}
	store, err := open()
	if err != nil {
		return nil, err
	}
	if store == nil {
		return nil, ErrUnavailable
	}
	cfg, err = p.configured(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return NewServer(store, cfg), nil
}

type guardedTaskOrderReader struct {
	reader  originalTaskOrderReader
	current func(context.Context) error
}

func (g guardedTaskOrderReader) readTaskOrder(ctx context.Context, store *Store, r *http.Request, body []byte) (taskOrderReadPayload, error) {
	if missingTaskOrderOperand(g.reader) || g.current == nil {
		return taskOrderReadPayload{}, ErrUnavailable
	}
	if err := g.current(ctx); err != nil {
		return taskOrderReadPayload{}, err
	}
	result, err := g.reader.readTaskOrder(ctx, store, r, body)
	if err != nil {
		return taskOrderReadPayload{}, err
	}
	if err := ctx.Err(); err != nil {
		return taskOrderReadPayload{}, err
	}
	if err := g.current(ctx); err != nil {
		return taskOrderReadPayload{}, err
	}
	return result, nil
}

func (s *Server) taskOrderRead(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if missingTaskOrderOperand(s.cfg.taskOrders) {
		write(w, 503, map[string]string{"code": "SHOP_TASK_ORDER_READ_NOT_ADMITTED", "error": "original protected task source and codec not installed"})
		return
	}
	// A transport hint, login session, query string or path alias cannot alter
	// the exact tool/target selected by the original private runtime.
	if r.Method != http.MethodPost || r.URL.Path != shopOrderReadPath || r.URL.RawPath != "" || r.URL.RawQuery != "" || r.URL.EscapedPath() != shopOrderReadPath {
		write(w, 403, map[string]string{"code": "SHOP_TASK_ORDER_READ_TARGET_MISMATCH"})
		return
	}
	media := r.Header.Values("Content-Type")
	if len(media) != 1 || media[0] != ShopOrderReadRequestContentType {
		write(w, 415, map[string]string{"code": "SHOP_TASK_ORDER_READ_MEDIA_REQUIRED"})
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		write(w, 413, map[string]string{"code": "SHOP_TASK_ORDER_READ_BODY_BOUNDS"})
		return
	}
	result, err := s.cfg.taskOrders.readTaskOrder(r.Context(), s.store, r, body)
	if err != nil {
		var failure *taskOrderReadFailure
		if errors.As(err, &failure) {
			payload := map[string]string{"code": failure.code}
			if failure.originalOp != "" {
				payload["originalOp"] = failure.originalOp
			}
			write(w, failure.status, payload)
		} else {
			write(w, 503, map[string]string{"code": "SHOP_TASK_ORDER_READ_UNAVAILABLE"})
		}
		return
	}
	if err := r.Context().Err(); err != nil {
		write(w, 503, map[string]string{"code": "SHOP_TASK_ORDER_READ_UNAVAILABLE"})
		return
	}
	if len(result.Body) == 0 || len(result.Body) > maxBody || result.ContentType != "application/json" || !json.Valid(result.Body) || (result.AuthFence != "same-authority-resource-fence" && result.AuthFence != "egress-only-read-fence") {
		write(w, 503, map[string]string{"code": "SHOP_TASK_ORDER_READ_ENCODING_UNAVAILABLE"})
		return
	}
	w.Header().Set("Content-Type", result.ContentType)
	// Diagnostic scope from the held Auth result, not a bearer/capability and
	// never selected from the request or the SDK encoder's response body.
	w.Header().Set("X-YNX-Auth-Fence", result.AuthFence)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(result.Body)
}
