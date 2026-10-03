package video

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

const productSessionProofV2Header = "X-YNX-Product-Session-Proof-V2"

type videoSessionV2 struct {
	Version        string   `json:"version"`
	ChainID        string   `json:"chainId"`
	SessionBinding string   `json:"sessionBinding"`
	ProductID      string   `json:"productId"`
	ClientID       string   `json:"clientId"`
	Platform       string   `json:"platform"`
	ApplicationID  string   `json:"applicationId"`
	BundleID       *string  `json:"bundleId"`
	PackageID      *string  `json:"packageId"`
	Origin         string   `json:"origin"`
	Callback       string   `json:"callback"`
	Account        string   `json:"account"`
	DeviceID       string   `json:"deviceId"`
	DeviceKey      string   `json:"deviceKey"`
	Scopes         []string `json:"scopes"`
	ExpiresAt      string   `json:"expiresAt"`
}

// The gateway verifies signature, replay and request binding. The consumer
// independently verifies the returned product authority and derives its scope.
func (a CentralProductSessionAuth) accountV2(r *http.Request) (string, error) {
	encoded := strings.TrimSpace(r.Header.Get(productSessionProofV2Header))
	if len(encoded) == 0 || len(encoded) > 16<<10 || r.Header.Get("X-YNX-Product-Session-Proof") != "" {
		return "", ErrUnauthorized
	}
	rawProof, err := base64.RawURLEncoding.DecodeString(encoded)
	var claimed videoSessionV2
	if err != nil || json.Unmarshal(rawProof, &claimed) != nil || !validVideoV2Binding(claimed) {
		return "", fmt.Errorf("%w: invalid Product Session v2 product binding", ErrUnauthorized)
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != claimed.Origin {
		return "", fmt.Errorf("%w: Product Session v2 origin mismatch", ErrUnauthorized)
	}
	scope := videoProductScopeV2(claimed.ProductID, r.Method, r.URL.Path)
	if scope == "" {
		return "", fmt.Errorf("%w: unsupported Product Session v2 operation", ErrUnauthorized)
	}
	body, _ := json.Marshal(map[string][]string{"requiredScopes": {scope}})
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, strings.TrimRight(a.GatewayURL, "/")+"/v2/product-sessions/introspect", bytes.NewReader(body))
	if err != nil {
		return "", ErrUnauthorized
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", ErrUnauthorized
	}
	requestID := "req_video_" + hex.EncodeToString(nonce[:])
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Origin", claimed.Origin)
	request.Header.Set("X-Request-ID", requestID)
	request.Header.Set(productSessionProofV2Header, encoded)
	response, err := a.gatewayClient().Do(request)
	if err != nil {
		return "", fmt.Errorf("%w: Product Session v2 gateway unavailable", ErrUnauthorized)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	if err != nil || len(raw) > 64<<10 || response.StatusCode != http.StatusOK || response.Header.Get("X-Request-ID") != requestID {
		return "", fmt.Errorf("%w: Product Session v2 introspection rejected", ErrUnauthorized)
	}
	var envelope struct {
		OK            bool   `json:"ok"`
		SchemaVersion int    `json:"schemaVersion"`
		RequestID     string `json:"requestId"`
		Result        struct {
			Active  bool           `json:"active"`
			Session videoSessionV2 `json:"session"`
		} `json:"result"`
	}
	if json.Unmarshal(raw, &envelope) != nil || !envelope.OK || envelope.SchemaVersion != 2 || envelope.RequestID != requestID || !envelope.Result.Active {
		return "", ErrUnauthorized
	}
	session := envelope.Result.Session
	if !validVideoV2Binding(session) || session.SessionBinding == "" || session.Platform != claimed.Platform || session.ApplicationID != claimed.ApplicationID ||
		session.ClientID != claimed.ClientID || session.Origin != claimed.Origin || session.Callback != claimed.Callback ||
		!sameVideoV2Optional(session.BundleID, claimed.BundleID) || !sameVideoV2Optional(session.PackageID, claimed.PackageID) ||
		session.SessionBinding != claimed.SessionBinding || session.ProductID != claimed.ProductID || session.Account != claimed.Account ||
		session.DeviceID != claimed.DeviceID || session.DeviceKey != claimed.DeviceKey || !contains(session.Scopes, scope) {
		return "", fmt.Errorf("%w: Product Session v2 returned binding mismatch", ErrUnauthorized)
	}
	expires, err := time.Parse(time.RFC3339Nano, session.ExpiresAt)
	if err != nil || !expires.After(time.Now().UTC()) {
		return "", ErrUnauthorized
	}
	account := strings.ToLower(strings.TrimSpace(session.Account))
	if _, err := accountaddress.Decode(account); err != nil {
		return "", ErrUnauthorized
	}
	return account, nil
}

// Exact product/platform tuples come from the canonical registry. Device proofs
// still go through the original Gateway; a platform cannot borrow another tuple.
func validVideoV2Binding(s videoSessionV2) bool {
	if s.Version != "2" || s.ChainID != "ynx_6423-1" {
		return false
	}
	var application, client, origin, scheme string
	switch s.ProductID {
	case "creator-studio":
		application = "com.ynxweb4.creator-studio"
		client = "ynx-creator-studio-web-v1"
		origin = "https://creator.ynxweb4.com"
		scheme = "ynxcreator"
	case "video":
		application = "com.ynxweb4.video"
		client = "ynx-video-mobile-v1"
		origin = "https://video.ynxweb4.com"
		scheme = "ynxvideo"
	default:
		return false
	}
	if s.ClientID != client {
		return false
	}
	switch s.Platform {
	case "web":
		return s.ApplicationID == application+".web" && s.BundleID == nil && s.PackageID == nil && s.Origin == origin && s.Callback == origin+"/wallet-auth/callback"
	case "android":
		return s.ApplicationID == application && s.BundleID == nil && s.PackageID != nil && *s.PackageID == application && s.Origin == "app://android/"+application && s.Callback == scheme+"://wallet-auth/callback"
	case "macos":
		return s.ApplicationID == application && s.PackageID == nil && s.BundleID != nil && *s.BundleID == application && s.Origin == "app://macos/"+application && s.Callback == scheme+"://wallet-auth/callback"
	}
	return false
}
func sameVideoV2Optional(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func videoProductScopeV2(product, method, path string) string {
	if product == "creator-studio" {
		if strings.Contains(path, "/payout-intents") || strings.Contains(path, "/revenue") || strings.Contains(path, "/disputes") {
			return "creator:revenue"
		}
		if method == http.MethodGet || method == http.MethodHead {
			return "creator:account"
		}
		return "creator:publish"
	}
	if product == "video" {
		if !strings.HasPrefix(path, "/") || strings.Contains(path, "..") || strings.Contains(path, "//") {
			return ""
		}
		parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
		read := method == http.MethodGet || method == http.MethodHead
		if parts[0] == "media" && len(parts) > 1 && read && parts[len(parts)-1] != "" {
			return "video:playback"
		}
		if len(parts) < 2 || parts[0] != "v1" {
			return ""
		}
		if len(parts) == 2 {
			if read && parts[1] == "account" {
				return "video:account"
			}
			if read && (parts[1] == "history" || parts[1] == "playlists" || parts[1] == "subscriptions") || method == http.MethodPost && parts[1] == "playlists" {
				return "video:library"
			}
			if read && parts[1] == "videos" {
				return "video:playback"
			}
		}
		if len(parts) == 3 && parts[1] == "privacy" && parts[2] == "account-data" && method == http.MethodDelete {
			return "video:account"
		}
		if len(parts) < 3 || !videoRouteIDV2(parts[2]) {
			return ""
		}
		if len(parts) == 3 {
			if read && (parts[1] == "videos" || parts[1] == "channels") {
				return "video:playback"
			}
			if method == http.MethodDelete && parts[1] == "playlists" {
				return "video:library"
			}
		}
		if len(parts) == 4 {
			if parts[1] == "channels" && parts[3] == "subscription" && (method == http.MethodPost || method == http.MethodPut || method == http.MethodDelete) ||
				method == http.MethodPost && (parts[1] == "playlists" && parts[3] == "videos" || parts[1] == "videos" && parts[3] == "watch") {
				return "video:library"
			}
			if read && parts[1] == "videos" && parts[3] == "comments" {
				return "video:playback"
			}
			if method == http.MethodPost && (parts[1] == "videos" && (parts[3] == "comments" || parts[3] == "reports") || parts[1] == "reports" && parts[3] == "appeals") {
				return "video:account"
			}
		}
		if len(parts) == 5 && method == http.MethodDelete && parts[1] == "playlists" && parts[3] == "videos" && videoRouteIDV2(parts[4]) {
			return "video:library"
		}
	}
	return ""
}

func videoRouteIDV2(value string) bool {
	if value == "" {
		return false
	}
	for _, c := range value {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
			return false
		}
	}
	return true
}
