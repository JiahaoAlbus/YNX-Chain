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
	if err != nil || json.Unmarshal(rawProof, &claimed) != nil || !validVideoV2WebBinding(claimed) {
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
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	response, err := client.Do(request)
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
	if !validVideoV2WebBinding(session) || session.ChainID != "ynx_6423-1" || session.Platform != "web" || session.SessionBinding == "" ||
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

func validVideoV2WebBinding(s videoSessionV2) bool {
	if s.Version != "2" || s.BundleID != nil || s.PackageID != nil {
		return false
	}
	switch s.ProductID {
	case "creator-studio":
		return s.ClientID == "ynx-creator-studio-web-v1" && s.ApplicationID == "com.ynxweb4.creator-studio.web" && s.Origin == "https://creator.ynxweb4.com" && s.Callback == s.Origin+"/wallet-auth/callback"
	case "video":
		return s.ClientID == "ynx-video-mobile-v1" && s.ApplicationID == "com.ynxweb4.video.web" && s.Origin == "https://video.ynxweb4.com" && s.Callback == s.Origin+"/wallet-auth/callback"
	}
	return false
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
			if parts[1] == "channels" && parts[3] == "subscription" && (method == http.MethodPost || method == http.MethodDelete) ||
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
