//go:build !darwin && !linux

package aitaskactionsource

import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/aiproduct"
	"net/http"
)

var ErrV6NormalRegistration = errors.New("AI_V6_NORMAL_RUNTIME_REGISTRATION_NOT_SUPPLIED")
var ErrV6NormalPlatform = errors.New("AI_V6_NORMAL_RUNTIME_PLATFORM_NOT_SUPPLIED")
var ErrChildrenRetainedV6 = errors.New("AI_TASK_V6_CHILDREN_RETAINED")

type OriginalAITaskActionServerV6 struct{ server *aiproduct.Server }

func OpenOriginalAITaskActionServerV6(server *aiproduct.Server) (*OriginalAITaskActionServerV6, error) {
	return &OriginalAITaskActionServerV6{server: server}, ErrV6NormalPlatform
}
func (o *OriginalAITaskActionServerV6) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r != nil && len(r.Header.Values("x-ynx-product-session-proof-v6")) == 0 && o != nil && o.server != nil {
			o.server.Handler().ServeHTTP(w, r)
			return
		}
		http.Error(w, "AI_V6_NORMAL_RUNTIME_PLATFORM_NOT_SUPPLIED", 503)
	})
}
func (*OriginalAITaskActionServerV6) Retire() error { return nil }
func (*OriginalAITaskActionServerV6) Join(ctx context.Context) error {
	if ctx == nil {
		return ErrV6NormalPlatform
	}
	return ctx.Err()
}
func (*OriginalAITaskActionServerV6) Close() error                             { return nil }
func (o *OriginalAITaskActionServerV6) DrainPartial(ctx context.Context) error { return o.Join(ctx) }
