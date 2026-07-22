package payproduct

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

// VerifyPayGateway accepts only a server-to-server assertion emitted after the
// canonical central Wallet verifier and active-session guard have succeeded.
// The browser/mobile bearer token is never accepted by the product service.
func (s *Service) VerifyPayGateway(r *http.Request, body []byte) (WalletSession, error) {
	account, accountErr := nativewallet.NormalizeNativeAddress(strings.TrimSpace(r.Header.Get("X-YNX-Account")))
	sessionID := strings.TrimSpace(r.Header.Get("X-YNX-Session-ID"))
	deviceID := strings.TrimSpace(r.Header.Get("X-YNX-Device-ID"))
	nonce := strings.TrimSpace(r.Header.Get("X-YNX-Nonce"))
	requestDigest := strings.ToLower(strings.TrimSpace(r.Header.Get("X-YNX-Request-Digest")))
	sessionBinding := strings.ToLower(strings.TrimSpace(r.Header.Get("X-YNX-Session-Binding")))
	scopes := strings.Fields(r.Header.Get("X-YNX-Scopes"))
	sort.Strings(scopes)
	issued, issuedErr := time.Parse(time.RFC3339Nano, r.Header.Get("X-YNX-Issued-At"))
	expires, expiresErr := time.Parse(time.RFC3339Nano, r.Header.Get("X-YNX-Expires-At"))
	now := s.now().UTC()
	if accountErr != nil || issuedErr != nil || expiresErr != nil || !identifierRE.MatchString(sessionID) || !identifierRE.MatchString(deviceID) || !identifierRE.MatchString(nonce) ||
		r.Header.Get("X-YNX-Product") != walletProduct || r.Header.Get("X-YNX-Client") != walletProductClientID || r.Header.Get("X-YNX-Bundle") != walletBundleID || r.Header.Get("X-YNX-Callback") != walletCallback || r.Header.Get("X-YNX-Chain") != ChainID ||
		!sameStrings(scopes, walletScopes) || len(requestDigest) != 64 || len(sessionBinding) != 64 || !now.Before(expires) || expires.Sub(issued) > 5*time.Minute || now.Before(issued.Add(-30*time.Second)) {
		return WalletSession{}, errors.New("canonical active Pay Gateway assertion required")
	}
	bodyHash := sha256.Sum256(body)
	material := strings.Join([]string{gatewayDomain, r.Method, r.URL.EscapedPath(), hex.EncodeToString(bodyHash[:]), account, sessionID, deviceID, walletProduct, walletProductClientID, walletBundleID, walletCallback, ChainID, strings.Join(scopes, " "), sessionBinding, requestDigest, issued.UTC().Format(time.RFC3339Nano), expires.UTC().Format(time.RFC3339Nano), nonce}, "\n")
	want := hmacHex(s.gatewayKey, []byte(material))
	if !hmac.Equal([]byte(strings.ToLower(strings.TrimSpace(r.Header.Get("X-YNX-Gateway-Signature")))), []byte(want)) {
		return WalletSession{}, errors.New("canonical active Pay Gateway assertion required")
	}
	err := s.store.Update(func(data *Snapshot) error {
		for seen, expiry := range data.GatewaySeen {
			if !now.Before(expiry) {
				delete(data.GatewaySeen, seen)
			}
		}
		key := walletProduct + ":" + nonce
		if _, exists := data.GatewaySeen[key]; exists {
			return errors.New("Pay Gateway assertion replay rejected")
		}
		data.GatewaySeen[key] = expires
		return nil
	})
	if err != nil {
		return WalletSession{}, err
	}
	return WalletSession{ID: sessionID, Account: account, ProductClientID: walletProductClientID, BundleID: walletBundleID, ProductDeviceAlgorithm: walletDeviceAlgorithm, SessionBinding: sessionBinding, Scopes: scopes, ExpiresAt: expires}, nil
}
