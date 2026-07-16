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
	"strings"
)

const (
	musicProductClient = "ynx-music-v1"
	musicBundleID      = "com.ynxweb4.music"
)

type walletExchangeRequest struct {
	Response        string `json:"response"`
	ExpectedNonce   string `json:"expectedNonce"`
	ProductClientID string `json:"productClientId"`
	BundleID        string `json:"bundleId"`
}

type walletSession struct {
	Token     string `json:"token"`
	Account   string `json:"account"`
	DeviceID  string `json:"deviceId"`
	ExpiresAt string `json:"expiresAt"`
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
	if err := json.Unmarshal(body, output); err != nil {
		return fmt.Errorf("invalid central response: %w", err)
	}
	return nil
}

func responseReplayKey(response string) string {
	sum := sha256.Sum256([]byte(response))
	return "wallet-response:" + hex.EncodeToString(sum[:])
}
