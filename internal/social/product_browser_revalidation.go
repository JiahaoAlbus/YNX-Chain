package social

import (
	"context"
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Original combined-authority contract; credentials stay backend-only. This
// does not replace the original action proof, nonce or transaction fences.
type ProductBrowserSessionRevalidator interface {
	RevalidateBrowser(context.Context, productsessionv2.Session, *productsessionv2.BrowserSSO, string, []string) (productsessionv2.Session, productsessionv2.BrowserGrant, error)
}

// Caller invokes this only under the original Social store mutex, after the
// outside-lock current read. A rebind cannot rescue an older business request.
func (s *Server) productActorBindingFence(original productsessionv2.Session, binding productSessionBinding) func() error {
	key, digest := bridgeDigest(original.SessionBinding), objectDigest(binding)
	return func() error {
		current, ok := s.service.state.ProductBindings[key]
		if !ok || objectDigest(current) != digest {
			return ErrUnauthorized
		}
		return nil
	}
}

func (s *Server) revalidateProductBrowser(r *http.Request, original productsessionv2.Session, binding productSessionBinding, scope string, reader ProductBrowserSessionRevalidator) (productsessionv2.Session, error) {
	if reader == nil || s.service.cfg.BrowserSSO == nil || binding.SealedBrowserGrant == "" {
		return productsessionv2.Session{}, &productsessionv2.Error{Status: 503, Code: "SOCIAL_JOINT_CURRENT_AUTHORITY_REQUIRED"}
	}
	headers := objectDigest(r.Header)
	// Check actual owner Origin/CSRF and original family before the combined
	// decision. Never call another remote browser reader after that decision.
	if _, _, err := s.browserProductBinding(r, original, &binding); err != nil {
		return productsessionv2.Session{}, err
	}
	current, browser, err := reader.RevalidateBrowser(r.Context(), original, s.service.cfg.BrowserSSO, binding.SealedBrowserGrant, []string{scope})
	if err != nil {
		return productsessionv2.Session{}, err
	}
	if err := r.Context().Err(); err != nil {
		return productsessionv2.Session{}, err
	}
	sealed, localBrowser, err := s.service.cfg.BrowserSSO.Binding(r)
	if err != nil || headers != objectDigest(r.Header) || sealed != binding.SealedBrowserGrant || objectDigest(localBrowser) != objectDigest(browser) {
		return productsessionv2.Session{}, ErrUnauthorized
	}
	return current, nil
}
