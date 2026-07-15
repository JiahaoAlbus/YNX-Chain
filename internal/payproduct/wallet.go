package payproduct

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	secpECDSA "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

type WalletChallengeInput struct {
	Account         string `json:"account"`
	DevicePublicKey string `json:"devicePublicKey"`
}
type WalletChallengeResult struct {
	Challenge WalletChallenge `json:"challenge"`
	DeepLink  string          `json:"deepLink"`
}

func (s *Service) CreateWalletChallenge(input WalletChallengeInput) (WalletChallengeResult, error) {
	account, err := nativewallet.NormalizeNativeAddress(input.Account)
	if err != nil {
		return WalletChallengeResult{}, err
	}
	if _, err := nativewallet.DecodePublicKey(input.DevicePublicKey, ed25519.PublicKeySize); err != nil {
		return WalletChallengeResult{}, err
	}
	now := s.now()
	c := WalletChallenge{ID: "wch_" + randomToken(12), Account: account, DevicePublicKey: input.DevicePublicKey, Nonce: randomToken(24), Callback: s.publicBase + "/v1/wallet/session", Scopes: []string{"pay.invoice.read", "pay.settlement.submit", "pay.case.create"}, ExpiresAt: now.Add(5 * time.Minute)}
	doc := map[string]any{"domain": "YNX_WALLET_SIGN_IN_V1", "version": 1, "chainId": EVMChainID, "network": ChainID, "product": "ynx-pay", "challengeId": c.ID, "account": c.Account, "devicePublicKey": c.DevicePublicKey, "nonce": c.Nonce, "callback": c.Callback, "scopes": c.Scopes, "issuedAt": now, "expiresAt": c.ExpiresAt, "purpose": "Sign in to review YNX Pay invoices and manage your own payment cases"}
	raw, _ := json.Marshal(doc)
	c.SignBytes = base64.RawURLEncoding.EncodeToString(raw)
	err = s.store.Update(func(data *Snapshot) error {
		data.WalletChallenges[c.ID] = c
		appendAudit(data, "", "wallet:"+account, "wallet.signin.challenge", c.ID, "issued", "", now)
		return nil
	})
	if err != nil {
		return WalletChallengeResult{}, err
	}
	return WalletChallengeResult{Challenge: c, DeepLink: "ynxwallet://authorize?request=" + base64.RawURLEncoding.EncodeToString(raw)}, nil
}

type WalletSessionInput struct {
	ChallengeID      string `json:"challengeId"`
	AccountPublicKey string `json:"accountPublicKey"`
	AccountSignature string `json:"accountSignature"`
	DeviceSignature  string `json:"deviceSignature"`
}
type WalletSessionResult struct {
	SessionID string    `json:"sessionId"`
	Token     string    `json:"token"`
	Account   string    `json:"account"`
	Scopes    []string  `json:"scopes"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func (s *Service) CompleteWalletSession(input WalletSessionInput) (WalletSessionResult, error) {
	var c WalletChallenge
	err := s.store.View(func(data Snapshot) error {
		var ok bool
		c, ok = data.WalletChallenges[input.ChallengeID]
		if !ok {
			return errors.New("wallet challenge not found")
		}
		if c.UsedAt != nil {
			return errors.New("wallet challenge replay rejected")
		}
		if !s.now().Before(c.ExpiresAt) {
			return errors.New("wallet challenge expired")
		}
		return nil
	})
	if err != nil {
		return WalletSessionResult{}, err
	}
	pubBytes, err := hex.DecodeString(input.AccountPublicKey)
	if err != nil {
		return WalletSessionResult{}, errors.New("invalid account public key")
	}
	pub, err := secp256k1.ParsePubKey(pubBytes)
	if err != nil {
		return WalletSessionResult{}, errors.New("invalid account public key")
	}
	derived, err := consensus.NativeAddress(pub.SerializeCompressed())
	if err == nil {
		derived, err = accountaddress.Encode(derived)
	}
	if err != nil || derived != c.Account {
		return WalletSessionResult{}, errors.New("wallet account public key mismatch")
	}
	sigBytes, err := hex.DecodeString(input.AccountSignature)
	if err != nil {
		return WalletSessionResult{}, errors.New("invalid account signature")
	}
	sig, err := secpECDSA.ParseDERSignature(sigBytes)
	if err != nil {
		return WalletSessionResult{}, errors.New("invalid account signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(c.SignBytes)
	if err != nil {
		return WalletSessionResult{}, errors.New("wallet challenge is corrupt")
	}
	digest := sha256.Sum256(payload)
	if !sig.Verify(digest[:], pub) {
		return WalletSessionResult{}, errors.New("wallet account signature verification failed")
	}
	if !nativewallet.Verify(c.DevicePublicKey, payload, input.DeviceSignature) {
		return WalletSessionResult{}, errors.New("wallet device binding signature verification failed")
	}
	token := randomToken(32)
	session := WalletSession{ID: "wss_" + randomToken(12), Account: c.Account, DevicePublicKey: c.DevicePublicKey, TokenHash: hashString(token), Scopes: c.Scopes, ExpiresAt: s.now().Add(8 * time.Hour)}
	now := s.now()
	err = s.store.Update(func(data *Snapshot) error {
		challenge := data.WalletChallenges[c.ID]
		if challenge.UsedAt != nil {
			return errors.New("wallet challenge replay rejected")
		}
		challenge.UsedAt = &now
		data.WalletChallenges[c.ID] = challenge
		data.WalletSessions[session.ID] = session
		appendAudit(data, "", "wallet:"+c.Account, "wallet.signin.complete", session.ID, "committed", "", now)
		return nil
	})
	if err != nil {
		return WalletSessionResult{}, err
	}
	return WalletSessionResult{SessionID: session.ID, Token: token, Account: session.Account, Scopes: session.Scopes, ExpiresAt: session.ExpiresAt}, nil
}
func (s *Service) AuthenticateWallet(header string) (WalletSession, error) {
	value := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	parts := strings.SplitN(value, ".", 2)
	if len(parts) != 2 {
		return WalletSession{}, errors.New("wallet session required")
	}
	var session WalletSession
	err := s.store.View(func(data Snapshot) error {
		var ok bool
		session, ok = data.WalletSessions[parts[0]]
		if !ok || session.RevokedAt != nil || !s.now().Before(session.ExpiresAt) {
			return errors.New("wallet session is invalid or expired")
		}
		if !hmacEqual(session.TokenHash, hashString(parts[1])) {
			return errors.New("wallet session is invalid")
		}
		return nil
	})
	return session, err
}
func hmacEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var v byte
	for i := range a {
		v |= a[i] ^ b[i]
	}
	return v == 0
}

func (s *Service) CreateRefundRequest(session WalletSession, invoiceID string, amount int64, reason, key string) (RefundRequest, error) {
	invoice, err := s.Invoice(contextBackground(), invoiceID)
	if err != nil {
		return RefundRequest{}, err
	}
	if invoice.Settlement == nil || invoice.Settlement.Payer != session.Account {
		return RefundRequest{}, errors.New("only the committed payer can request a refund")
	}
	if amount <= 0 || amount > invoice.Amount {
		return RefundRequest{}, errors.New("refund request amount is invalid")
	}
	key, err = validKey(key)
	if err != nil {
		return RefundRequest{}, err
	}
	id := "rfr_" + hashString(invoiceID, session.Account, key)[:20]
	now := s.now()
	request := RefundRequest{ID: id, InvoiceID: invoiceID, MerchantID: invoice.MerchantID, Payer: session.Account, Amount: amount, Reason: strings.TrimSpace(reason), Status: "requested", CreatedAt: now, UpdatedAt: now}
	err = s.idempotentUpdate("refund-request", session.Account, key, hashJSON(request), id, func(data *Snapshot) error {
		data.Refunds[id] = request
		appendAudit(data, invoice.MerchantID, "wallet:"+session.Account, "refund.request", id, "committed", "human merchant action required", now)
		return nil
	})
	return request, err
}
func (s *Service) CreateDispute(session WalletSession, invoiceID, reason, key string, evidence []string) (Dispute, error) {
	invoice, err := s.Invoice(contextBackground(), invoiceID)
	if err != nil {
		return Dispute{}, err
	}
	if invoice.Settlement == nil || invoice.Settlement.Payer != session.Account {
		return Dispute{}, errors.New("only the committed payer can open a dispute")
	}
	if len(strings.TrimSpace(reason)) < 8 {
		return Dispute{}, errors.New("dispute reason is too short")
	}
	if len(evidence) > 20 {
		return Dispute{}, errors.New("too many Trust evidence references")
	}
	for _, v := range evidence {
		if !identifierRE.MatchString(v) {
			return Dispute{}, errors.New("invalid Trust evidence reference")
		}
	}
	key, err = validKey(key)
	if err != nil {
		return Dispute{}, err
	}
	id := "dsp_" + hashString(invoiceID, session.Account, key)[:20]
	now := s.now()
	d := Dispute{ID: id, InvoiceID: invoiceID, MerchantID: invoice.MerchantID, Payer: session.Account, Reason: strings.TrimSpace(reason), TrustEvidence: evidence, Status: "open", CreatedAt: now, UpdatedAt: now}
	err = s.idempotentUpdate("dispute", session.Account, key, hashJSON(d), id, func(data *Snapshot) error {
		data.Disputes[id] = d
		appendAudit(data, invoice.MerchantID, "wallet:"+session.Account, "dispute.open", id, "committed", "Trust review required", now)
		return nil
	})
	return d, err
}

// contextBackground is isolated to make request-derived methods use their caller's
// context in HTTP handlers while preserving a bounded fallback for direct callers.
func contextBackground() context.Context { return context.Background() }
