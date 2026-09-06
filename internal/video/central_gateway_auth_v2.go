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
		if strings.Contains(path, "/history") || strings.Contains(path, "/playlists") || strings.Contains(path, "/subscriptions") || strings.Contains(path, "/subscription") || strings.Contains(path, "/watch") {
			return "video:library"
		}
		if method == http.MethodGet || method == http.MethodHead {
			return "video:playback"
		}
	}
	return ""
}
