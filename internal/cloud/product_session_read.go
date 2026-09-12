package cloud

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type productReadAuthority interface {
	Authorize(context.Context, *http.Request, []string) (productsessionv2.Session, error)
}

// EnableProductSessionV2 configures fresh remote authorization before Handler is
// served. It does not migrate, mint, persist, or replay a legacy bearer session.
func (s *Server) EnableProductSessionV2(endpoint string) error {
	policies := []productsessionv2.Policy{
		{ProductID: "cloud", ClientID: "ynx-cloud-web-v1", ApplicationID: "com.ynxweb4.cloud.web", Platform: "web",
			Origin: "https://web4.ynxweb4.com", Callback: "https://web4.ynxweb4.com/wallet-auth/callback", AllowedScopes: []string{"files.read", "files.write"}},
		{ProductID: "docs", ClientID: "ynx-docs-mobile-v1", ApplicationID: "com.ynxweb4.docs.web", Platform: "web",
			Origin: "https://docs.ynxweb4.com", Callback: "https://docs.ynxweb4.com/wallet-auth/callback", AllowedScopes: []string{"docs.read", "docs.write", "files.read", "files.write"}},
	}
	clients := make(map[string]productReadAuthority, len(policies))
	for _, policy := range policies {
		client, err := productsessionv2.NewClient(endpoint, policy, nil)
		if err != nil {
			return err
		}
		clients[policy.Origin] = client
	}
	journal, err := newProductWriteJournal(s.service.cfg.StatePath + ".v2-idempotency")
	if err != nil {
		return err
	}
	s.v2Writes = journal
	s.v2 = clients
	return nil
}

func productRequestOrigin(r *http.Request) string {
	if origin := r.Header.Get("Origin"); origin != "" {
		return origin
	}
	// Host only selects a fixed policy. The authority still checks the signed
	// exact origin; forwarded headers and proof payloads cannot supply policy.
	return "https://" + r.Host
}

func (s *Server) useProductSessionV2(r *http.Request) bool {
	return len(r.Header.Values(productsessionv2.ProofHeader)) != 0 || s.v2[productRequestOrigin(r)] != nil
}

func productReadFailure(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]string{"error": code, "code": code})
}

func (s *Server) authorizeProductRead(w http.ResponseWriter, r *http.Request, next authed) {
	w.Header().Set("Cache-Control", "no-store")
	if len(s.v2) == 0 {
		productReadFailure(w, 503, "PRODUCT_SESSION_V2_DISABLED")
		return
	}
	origin := productRequestOrigin(r)
	client := s.v2[origin]
	if client == nil {
		productReadFailure(w, 403, "ORIGIN_MISMATCH")
		return
	}
	read := r.Method == http.MethodGet && (r.Pattern == "GET /api/v1/objects" || r.Pattern == "GET /api/v1/objects/{id}" || r.Pattern == "GET /api/v1/objects/{id}/content" || r.Pattern == "GET /api/v1/objects/{id}/versions")
	write := (r.Method == http.MethodPost && (r.Pattern == "POST /api/v1/objects" || r.Pattern == "POST /api/v1/objects/{id}/trash" || r.Pattern == "POST /api/v1/objects/{id}/restore" || r.Pattern == "POST /api/v1/objects/{id}/versions/{version}/restore")) || (r.Method == http.MethodPut && r.Pattern == "PUT /api/v1/objects/{id}/document")
	write = write || (r.Method == http.MethodPatch && r.Pattern == "PATCH /api/v1/objects/{id}")
	if !read && !write {
		productReadFailure(w, 403, "V2_ROUTE_NOT_ENABLED")
		return
	}
	if write && r.Header.Get("Origin") == "" {
		productReadFailure(w, 403, "ORIGIN_REQUIRED")
		return
	}
	product := "cloud"
	scopes := []string{"files.read"}
	if origin == "https://docs.ynxweb4.com" {
		product = "docs"
		scopes = []string{"docs.read", "files.read"}
	}
	if write {
		scopes = []string{"files.write"}
		if product == "docs" {
			scopes = []string{"docs.write", "files.write"}
		}
	}
	identity, err := client.Authorize(r.Context(), r, scopes)
	if err != nil {
		var failure *productsessionv2.Error
		if errors.As(err, &failure) {
			productReadFailure(w, failure.Status, failure.Code)
		} else {
			productReadFailure(w, 503, "AUTHORITY_UNAVAILABLE")
		}
		return
	}
	if identity.ProductID != product || identity.Account == "" {
		productReadFailure(w, 403, "CROSS_PRODUCT_SESSION")
		return
	}
	issued, issueErr := time.Parse(time.RFC3339Nano, identity.IssuedAt)
	expires, expiryErr := time.Parse(time.RFC3339Nano, identity.ExpiresAt)
	if issueErr != nil || expiryErr != nil || !expires.After(s.service.cfg.Now()) {
		productReadFailure(w, 401, "SESSION_EXPIRED")
		return
	}
	actor := Session{Account: identity.Account, Product: product, ClientID: identity.ClientID,
		SessionBinding: identity.SessionBinding, RequestDigest: identity.RequestDigest,
		Callback: identity.Callback, DeviceKey: identity.DeviceKey, IssuedAt: issued, ExpiresAt: expires,
		Scopes: append([]string(nil), scopes...)}
	if product == "docs" {
		// Internal read-handler vocabulary only: never grant write scopes or
		// serialize this request-local compatibility actor as a stored session.
		if write {
			actor.Scopes = append(actor.Scopes, "documents.write")
		} else {
			actor.Scopes = append(actor.Scopes, "documents.read")
		}
	}
	id := r.PathValue("id")
	if id == "" {
		id = r.URL.Query().Get("parentId")
	}
	if strings.TrimSpace(id) != "" {
		if err := s.service.CheckObjectProduct(actor.Account, id, actor.Product); err != nil {
			productReadFailure(w, 403, "OBJECT_PRODUCT_DENIED")
			return
		}
	}
	if write {
		s.v2Writes.serve(w, r, actor, next)
		return
	}
	next(w, r, actor)
}
