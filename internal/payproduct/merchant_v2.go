//go:build commerce_v2

package payproduct

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"reflect"
	"slices"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// A owns the joint authority implementation and registration/protected keys.
// This is ONE authoritative snapshot of private session AND current Browser/
// account/device/local epoch, not two independent reversed validation awaits.
// Current must reject changes synchronously and be safe under the Store lock.
// Session is the exact original complete verified private Session; scopes never
// replace MerchantMembers. No product factory fabricates an epoch or verifier.
type MerchantV2AuthoritySnapshot struct {
	Session    v2.Session
	ValidUntil time.Time
	Current    func() error
}
type MerchantV2AuthorityReader interface {
	ReadMerchantAuthority(context.Context, v2.Session, []string) (MerchantV2AuthoritySnapshot, error)
}
type merchantSDKVerifier struct {
	client    *v2.Client
	authority MerchantV2AuthorityReader
	now       func() time.Time
}

// A may mount the closed factory while its shared joint reader is unavailable:
// every private request stays 503. Legacy NewServer remains compatibility only.
func NewMerchantV2Server(service *Service, transport http.RoundTripper, authority MerchantV2AuthorityReader) (*Server, error) {
	if service == nil || service.store == nil {
		return nil, errors.New("original Pay service required")
	}
	policy := v2.Policy{ProductID: MerchantProductID, ClientID: MerchantClientID, ApplicationID: MerchantBundleID + ".web", Platform: "web", Origin: "https://pay.ynxweb4.com", Callback: MerchantCallback, AllowedScopes: slices.Clone(merchantConsoleScopes)}
	client, err := v2.NewClient("https://wallet-auth.ynxweb4.com", policy, transport)
	if err != nil {
		return nil, err
	}
	if authority == nil {
		return newMerchantBusinessServer(service, nil), nil
	}
	return newMerchantBusinessServer(service, &merchantSDKVerifier{client, authority, service.now}), nil
}
func merchantSharedError(err error) error {
	var shared *v2.Error
	if errors.As(err, &shared) {
		return merchantDenied(shared.Code, shared.Status)
	}
	return merchantDenied("AUTHORITY_UNAVAILABLE", 503)
}
func (g *merchantSDKVerifier) verify(r *http.Request, body []byte) (*merchantAdmission, error) {
	// Shared SDK consumes introspection proof ONCE. Rechecks use confidential A
	// snapshot reader and never consume the device's one-shot proof a second time.
	original, err := g.client.Authorize(r.Context(), r, merchantConsoleScopes)
	if err != nil {
		return nil, merchantSharedError(err)
	}
	if original.Version != "2" || original.ChainID != ChainID || original.ProductID != MerchantProductID || original.ClientID != MerchantClientID || original.Platform != "web" || original.ApplicationID != MerchantBundleID+".web" || original.BundleID != nil || original.PackageID != nil || original.Origin != "https://pay.ynxweb4.com" || original.Callback != MerchantCallback || !slices.Equal(original.Scopes, merchantConsoleScopes) {
		return nil, merchantDenied("CROSS_PRODUCT_SESSION", 403)
	}
	decoded, err := accountaddress.Normalize(original.Account)
	normalized, encodeErr := accountaddress.Encode(decoded)
	if err != nil || encodeErr != nil || normalized != original.Account {
		return nil, merchantDenied("ACCOUNT_BINDING_MISMATCH", 403)
	}
	values := r.Header.Values(v2.ActionProofHeader)
	if len(values) != 1 {
		return nil, merchantDenied("ACTION_PROOF_REQUIRED", 403)
	}
	action, err := g.client.VerifyHTTPAction(values[0], original, r.Method, r.URL.Path, body, merchantConsoleScopes, g.now())
	if err != nil {
		return nil, merchantSharedError(err)
	}
	expiry, err := time.Parse(time.RFC3339Nano, original.ExpiresAt)
	if err != nil || !g.now().Before(expiry) {
		return nil, merchantDenied("SESSION_EXPIRED", 401)
	}
	// Freeze full Session including device/consent data, not proof expiry or a
	// mutable caller slice. Reader sees a fresh copy for each access.
	frozen, err := json.Marshal(original)
	if err != nil {
		return nil, merchantDenied("INVALID_SESSION", 403)
	}
	admission := &merchantAdmission{account: original.Account, binding: original.SessionBinding, nonce: action.Nonce, digest: action.BodyDigest, method: r.Method, path: r.URL.Path, expires: expiry, proofExpires: action.ExpiresAt}
	admission.refresh = func(ctx context.Context) (func() error, time.Time, error) {
		var input v2.Session
		if json.Unmarshal(frozen, &input) != nil {
			return nil, time.Time{}, merchantDenied("INVALID_SESSION", 403)
		}
		snapshot, err := g.authority.ReadMerchantAuthority(ctx, input, slices.Clone(merchantConsoleScopes))
		if err != nil {
			return nil, time.Time{}, merchantSharedError(err)
		}
		var expected v2.Session
		_ = json.Unmarshal(frozen, &expected)
		if snapshot.Current == nil || !reflect.DeepEqual(snapshot.Session, expected) || snapshot.ValidUntil.IsZero() || snapshot.ValidUntil.After(expiry) || !g.now().Before(snapshot.ValidUntil) {
			return nil, time.Time{}, merchantDenied("AUTHORITY_SNAPSHOT_MISMATCH", 503)
		}
		return snapshot.Current, snapshot.ValidUntil, nil
	}
	return admission, nil
}

// Keep A's actual source/version observability when mounting the v2 factory.
func NewMerchantV2ServerWithLogger(service *Service, transport http.RoundTripper, authority MerchantV2AuthorityReader, build buildinfo.Info, logger *slog.Logger) (*Server, error) {
	canonical, err := NewMerchantV2Server(service, transport, authority)
	if err != nil {
		return nil, err
	}
	server := NewServerWithLogger(service, build, logger)
	server.business = canonical.business
	server.privateUnavailable = canonical.privateUnavailable
	return server, nil
}
