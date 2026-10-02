package music

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const (
	musicProductClient = "ynx-music-v1"
	musicBundleID      = "com.ynxweb4.music"
)

var (
	digestPattern    = regexp.MustCompile(`^[0-9a-f]{64}$`)
	deviceKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{44}$`)
)

type walletChallengeRequest struct {
	AuthorizationRequest json.RawMessage `json:"authorizationRequest"`
	WalletApproval       json.RawMessage `json:"walletApproval"`
}

type walletChallengeResponse struct {
	Challenge json.RawMessage `json:"challenge"`
}

type walletCompletionRequest struct {
	AuthorizationRequest json.RawMessage `json:"authorizationRequest"`
	WalletApproval       json.RawMessage `json:"walletApproval"`
	GatewayCompletion    json.RawMessage `json:"gatewayCompletion"`
}

type walletSession struct {
	VerifierVersion        string   `json:"verifierVersion"`
	SessionBinding         string   `json:"sessionBinding"`
	ProductClientID        string   `json:"productClientId"`
	BundleID               string   `json:"bundleId"`
	ProductDeviceAlgorithm string   `json:"productDeviceAlgorithm"`
	Account                string   `json:"account"`
	Scopes                 []string `json:"scopes"`
	RequestDigest          string   `json:"requestDigest"`
	IssuedAt               string   `json:"issuedAt"`
	ExpiresAt              string   `json:"expiresAt"`
}

type walletIntrospectionRequest struct {
	SessionBinding   string   `json:"sessionBinding"`
	ProductClientID  string   `json:"productClientId"`
	BundleID         string   `json:"bundleId"`
	ProductDeviceKey string   `json:"productDeviceKey"`
	RequiredScopes   []string `json:"requiredScopes"`
}

type walletIntrospectionResponse struct {
	Active  bool          `json:"active"`
	Session walletSession `json:"session"`
}

// centralJSON is the only outbound boundary for Wallet, Pay and Trust. Callers
// supply an exact operator-configured endpoint; Music never guesses central routes.
func (s *Service) centralJSON(ctx context.Context, endpoint, key string, input, output any) error {
	if strings.TrimSpace(endpoint) == "" || strings.TrimSpace(key) == "" {
		return errors.New("central service is not configured")
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("X-YNX-Product-Client", musicProductClient)
	resp, err := s.cfg.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("central service rejected request with HTTP %d", resp.StatusCode)
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return fmt.Errorf("invalid central response: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("invalid central response: multiple JSON values")
	}
	return nil
}

func walletCompletionReplayKey(input walletCompletionRequest) string {
	raw, _ := json.Marshal(input)
	sum := sha256.Sum256(raw)
	return "wallet-completion:" + hex.EncodeToString(sum[:])
}

func (s walletSession) valid(requiredScope string) bool {
	if s.VerifierVersion != "wallet-auth-v1" || s.ProductClientID != musicProductClient || s.BundleID != musicBundleID || s.ProductDeviceAlgorithm != "p256-sha256" || !digestPattern.MatchString(s.SessionBinding) || !digestPattern.MatchString(s.RequestDigest) {
		return false
	}
	issued, issuedErr := time.Parse("2006-01-02T15:04:05.000Z", s.IssuedAt)
	expires, expiresErr := time.Parse("2006-01-02T15:04:05.000Z", s.ExpiresAt)
	if issuedErr != nil || expiresErr != nil || !expires.After(issued) {
		return false
	}
	if _, err := normalizeActor(s.Account); err != nil {
		return false
	}
	for _, scope := range s.Scopes {
		if scope == requiredScope {
			return true
		}
	}
	return false
}
