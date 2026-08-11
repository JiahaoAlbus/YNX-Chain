package video

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

// CentralProductSessionAuth verifies a fresh, single-use Product Session proof
// with the canonical Wallet Gateway. The required scope is derived by this
// service from the requested route; the browser cannot lower it.
type CentralProductSessionAuth struct {
	GatewayURL string
	Client     *http.Client
	Moderators map[string]bool
}

type centralSessionBinding struct {
	RequestingProduct string
	ProductClientID   string
	BundleID          string
}

func (a CentralProductSessionAuth) IsModerator(account string) bool { return a.Moderators[account] }

func (a CentralProductSessionAuth) Account(r *http.Request) (string, error) {
	proof := strings.TrimSpace(r.Header.Get("X-YNX-Product-Session-Proof"))
	if proof == "" || len(proof) > 16<<10 {
		return "", fmt.Errorf("%w: canonical Product Session proof required", ErrUnauthorized)
	}
	scope := videoProductScope(r.Method, r.URL.Path)
	body, _ := json.Marshal(map[string][]string{"requiredScopes": {scope}})
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, strings.TrimRight(a.GatewayURL, "/")+"/v1/wallet/sessions/introspect", bytes.NewReader(body))
	if err != nil {
		return "", ErrUnauthorized
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-YNX-Product-Session-Proof", proof)
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("%w: central Wallet Gateway unavailable", ErrUnauthorized)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil || response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%w: Product Session introspection rejected", ErrUnauthorized)
	}
	var envelope struct {
		OK     bool `json:"ok"`
		Result struct {
			Active  bool `json:"active"`
			Session struct {
				Account           string   `json:"account"`
				RequestingProduct string   `json:"requestingProduct"`
				ProductClientID   string   `json:"productClientId"`
				BundleID          string   `json:"bundleId"`
				Scopes            []string `json:"scopes"`
				ExpiresAt         string   `json:"expiresAt"`
			} `json:"session"`
		} `json:"result"`
	}
	if json.Unmarshal(raw, &envelope) != nil || !envelope.OK || !envelope.Result.Active {
		return "", ErrUnauthorized
	}
	session := envelope.Result.Session
	if !validVideoSessionBinding(centralSessionBinding{session.RequestingProduct, session.ProductClientID, session.BundleID}, scope) || !contains(session.Scopes, scope) {
		return "", fmt.Errorf("%w: Video Product Session binding mismatch", ErrUnauthorized)
	}
	if expires, parseErr := time.Parse(time.RFC3339Nano, session.ExpiresAt); parseErr != nil || !expires.After(time.Now().UTC()) {
		return "", ErrUnauthorized
	}
	account := strings.ToLower(strings.TrimSpace(session.Account))
	if _, err := accountaddress.Decode(account); err != nil {
		return "", ErrUnauthorized
	}
	return account, nil
}

func validVideoSessionBinding(session centralSessionBinding, scope string) bool {
	switch session.ProductClientID {
	case "ynx-video-web-v1":
		return session.RequestingProduct == "ynx-video" && session.BundleID == "com.ynxweb4.video.web" && strings.HasPrefix(scope, "video.") && scope != "video.creator"
	case "ynx-video-mobile-v1":
		return session.RequestingProduct == "ynx-video" && session.BundleID == "com.ynxweb4.video" && strings.HasPrefix(scope, "video.") && scope != "video.creator"
	case "ynx-creator-studio-web-v1":
		return session.RequestingProduct == "ynx-creator-studio" && session.BundleID == "com.ynxweb4.creator-studio.web" && (scope == "video.creator" || scope == "video.read" || scope == "ai.video.propose" || scope == "pay.payout.intent")
	default:
		return false
	}
}

func videoProductScope(method, path string) string {
	if strings.Contains(path, "/ai/") {
		return "ai.video.propose"
	}
	if strings.Contains(path, "/payout-intents") || strings.Contains(path, "/revenue") || strings.Contains(path, "/disputes") {
		return "pay.payout.intent"
	}
	if method == http.MethodGet || method == http.MethodHead {
		if strings.Contains(path, "/history") || strings.Contains(path, "/playlists") {
			return "video.history"
		}
		return "video.read"
	}
	if strings.Contains(path, "/comments") {
		return "video.comment"
	}
	if strings.Contains(path, "/reports") {
		return "video.report"
	}
	if strings.Contains(path, "subscription") {
		return "video.subscribe"
	}
	if strings.Contains(path, "/watch") || strings.Contains(path, "/playlists") {
		return "video.history"
	}
	return "video.creator"
}
