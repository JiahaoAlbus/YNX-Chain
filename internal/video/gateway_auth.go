package video

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

const (
	WalletVerifierVersion = "wallet-auth-v1"
	WalletDeviceAlgorithm = "p256-sha256"
)

type GatewayClient struct {
	BundleID string
	Scopes   []string
}

// GatewaySessionAuth accepts only attestations produced by the trusted central
// Gateway after packages/wallet-auth has verified the Wallet approval and the
// product-device P-256 challenge. The Wallet or product secret never crosses
// this boundary. A request-bound HMAC prevents header/body substitution and the
// persisted nonce makes replay fail after restart.
type GatewaySessionAuth struct {
	Service    *Service
	Key        []byte
	Clients    map[string]GatewayClient
	Moderators map[string]bool
	Now        func() time.Time
}

func (a GatewaySessionAuth) IsModerator(account string) bool { return a.Moderators[account] }

func (a GatewaySessionAuth) Account(r *http.Request) (string, error) {
	if a.Service == nil || len(a.Key) < 32 {
		return "", fmt.Errorf("%w: central Wallet Gateway unavailable", ErrUnauthorized)
	}
	now := time.Now().UTC()
	if a.Now != nil {
		now = a.Now().UTC()
	}
	verifier := r.Header.Get("X-YNX-Wallet-Verifier")
	algorithm := r.Header.Get("X-YNX-Product-Device-Algorithm")
	clientID := r.Header.Get("X-YNX-Product-Client")
	bundleID := r.Header.Get("X-YNX-Product-Bundle")
	account := strings.ToLower(strings.TrimSpace(r.Header.Get("X-YNX-Wallet-Account")))
	scopes := strings.Fields(r.Header.Get("X-YNX-Wallet-Scopes"))
	sessionBinding := r.Header.Get("X-YNX-Session-Binding")
	nonce := r.Header.Get("X-YNX-Request-Nonce")
	timestampText := r.Header.Get("X-YNX-Request-Time")
	expiresText := r.Header.Get("X-YNX-Session-Expires")
	signature := r.Header.Get("X-YNX-Gateway-Signature")
	client, ok := a.Clients[clientID]
	if !ok || client.BundleID != bundleID || verifier != WalletVerifierVersion || algorithm != WalletDeviceAlgorithm {
		return "", fmt.Errorf("%w: Wallet product binding mismatch", ErrUnauthorized)
	}
	if !equalStrings(scopes, client.Scopes) || !sort.StringsAreSorted(scopes) {
		return "", fmt.Errorf("%w: Wallet scope binding mismatch", ErrUnauthorized)
	}
	if _, err := accountaddress.Decode(account); err != nil {
		return "", fmt.Errorf("%w: non-canonical YNX account", ErrUnauthorized)
	}
	requestTime, err := time.Parse(time.RFC3339Nano, timestampText)
	if err != nil || requestTime.Before(now.Add(-2*time.Minute)) || requestTime.After(now.Add(15*time.Second)) {
		return "", fmt.Errorf("%w: stale Gateway request", ErrUnauthorized)
	}
	expires, err := time.Parse(time.RFC3339Nano, expiresText)
	if err != nil || !expires.After(now) || expires.After(now.Add(24*time.Hour)) {
		return "", fmt.Errorf("%w: expired or overlong Wallet session", ErrUnauthorized)
	}
	if len(sessionBinding) != 64 || len(nonce) < 24 || len(nonce) > 128 || len(signature) != 64 {
		return "", fmt.Errorf("%w: invalid Gateway attestation", ErrUnauthorized)
	}
	var body []byte
	if r.Body != nil {
		var bodyErr error
		body, bodyErr = io.ReadAll(io.LimitReader(r.Body, a.Service.cfg.MaxObjectBytes+(10<<20)+1))
		if bodyErr != nil {
			return "", ErrUnauthorized
		}
	}
	if int64(len(body)) > a.Service.cfg.MaxObjectBytes+(10<<20) {
		return "", fmt.Errorf("%w: request body exceeds product bound", ErrUnauthorized)
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	bodyHash := sha256.Sum256(body)
	material := gatewayRequestMaterial(r.Method, r.URL.RequestURI(), timestampText, nonce, hex.EncodeToString(bodyHash[:]), sessionBinding, clientID, bundleID, account, strings.Join(scopes, " "), expiresText)
	mac := hmac.New(sha256.New, a.Key)
	_, _ = mac.Write([]byte(material))
	actual, decodeErr := hex.DecodeString(signature)
	if decodeErr != nil || !hmac.Equal(actual, mac.Sum(nil)) {
		return "", fmt.Errorf("%w: Gateway request signature failed", ErrUnauthorized)
	}
	requestHash := sha256.Sum256([]byte(material))
	if err = a.Service.consumeGatewayNonce(nonce, sessionBinding, hex.EncodeToString(requestHash[:])); err != nil {
		return "", err
	}
	return account, nil
}

func gatewayRequestMaterial(method, uri, timestamp, nonce, bodyHash, binding, client, bundle, account, scopes, expires string) string {
	return strings.Join([]string{"YNX_VIDEO_GATEWAY_REQUEST_V1", method, uri, timestamp, nonce, bodyHash, binding, client, bundle, account, scopes, expires}, "\n")
}

func (s *Service) consumeGatewayNonce(nonce, binding, requestHash string) error {
	return s.store.update(func(st *State) error {
		if previous, exists := st.GatewayNonces[nonce]; exists {
			if previous.SessionBinding == binding && previous.RequestHash == requestHash {
				return fmt.Errorf("%w: Gateway request replay", ErrUnauthorized)
			}
			return fmt.Errorf("%w: Gateway nonce tamper", ErrUnauthorized)
		}
		st.GatewayNonces[nonce] = GatewayNonce{Nonce: nonce, SessionBinding: binding, RequestHash: requestHash, ConsumedAt: s.cfg.Now().UTC()}
		s.audit(st, "central-gateway", "wallet.request.consume", "session", binding, requestHash)
		return nil
	})
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func SignGatewayRequest(key []byte, r *http.Request, body []byte, fields map[string]string) (map[string]string, error) {
	if len(key) < 32 {
		return nil, errors.New("Gateway signing key must be at least 32 bytes")
	}
	scopes := strings.Fields(fields["scopes"])
	sort.Strings(scopes)
	bodyHash := sha256.Sum256(body)
	material := gatewayRequestMaterial(r.Method, r.URL.RequestURI(), fields["time"], fields["nonce"], hex.EncodeToString(bodyHash[:]), fields["binding"], fields["client"], fields["bundle"], fields["account"], strings.Join(scopes, " "), fields["expires"])
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(material))
	return map[string]string{
		"X-YNX-Wallet-Verifier":          WalletVerifierVersion,
		"X-YNX-Product-Device-Algorithm": WalletDeviceAlgorithm,
		"X-YNX-Product-Client":           fields["client"],
		"X-YNX-Product-Bundle":           fields["bundle"],
		"X-YNX-Wallet-Account":           fields["account"],
		"X-YNX-Wallet-Scopes":            strings.Join(scopes, " "),
		"X-YNX-Session-Binding":          fields["binding"],
		"X-YNX-Request-Nonce":            fields["nonce"],
		"X-YNX-Request-Time":             fields["time"],
		"X-YNX-Session-Expires":          fields["expires"],
		"X-YNX-Gateway-Signature":        hex.EncodeToString(mac.Sum(nil)),
	}, nil
}
