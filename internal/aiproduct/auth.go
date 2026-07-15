package aiproduct

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

const walletDomain = "YNX_SIGN_IN_V1"

var allowedScopes = map[string]bool{
	"ai:conversations": true,
	"ai:generate":      true,
	"ai:permissions":   true,
	"ai:data-control":  true,
}

type ChallengeInput struct {
	Account                string   `json:"account"`
	DeviceID               string   `json:"deviceId"`
	DeviceSigningPublicKey string   `json:"deviceSigningPublicKey"`
	Callback               string   `json:"callback"`
	Scopes                 []string `json:"scopes"`
}

type ChallengeOutput struct {
	ChallengeID  string             `json:"challengeId"`
	ExpiresAt    time.Time          `json:"expiresAt"`
	SignDocument WalletSignDocument `json:"signDocument"`
	SignBytes    string             `json:"signBytes"`
	Digest       string             `json:"digest"`
	WalletURL    string             `json:"walletUrl"`
	Algorithms   map[string]string  `json:"algorithms"`
}

type VerifyInput struct {
	AccountPublicKey string `json:"accountPublicKey"`
	AccountSignature string `json:"accountSignature"`
	DeviceSignature  string `json:"deviceSignature"`
}

type SessionOutput struct {
	SessionID string    `json:"sessionId"`
	Token     string    `json:"token"`
	Account   string    `json:"account"`
	DeviceID  string    `json:"deviceId"`
	Scopes    []string  `json:"scopes"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func (s *Store) CreateWalletChallenge(input ChallengeInput, exactCallback string) (ChallengeOutput, error) {
	account, err := nativewallet.NormalizeNativeAddress(input.Account)
	if err != nil {
		return ChallengeOutput{}, errors.New("canonical ynx1 account is required")
	}
	if strings.TrimSpace(input.Callback) != exactCallback || exactCallback == "" {
		return ChallengeOutput{}, errors.New("callback does not match the exact YNX AI client binding")
	}
	if len(input.DeviceID) < 3 || len(input.DeviceID) > 64 {
		return ChallengeOutput{}, errors.New("deviceId must contain 3 to 64 characters")
	}
	if _, err := nativewallet.DecodePublicKey(input.DeviceSigningPublicKey, ed25519.PublicKeySize); err != nil {
		return ChallengeOutput{}, errors.New("valid Ed25519 device public key is required")
	}
	if len(input.Scopes) == 0 || len(input.Scopes) > len(allowedScopes) {
		return ChallengeOutput{}, errors.New("bounded YNX AI scopes are required")
	}
	seen := map[string]bool{}
	scopes := make([]string, 0, len(input.Scopes))
	for _, scope := range input.Scopes {
		scope = strings.TrimSpace(scope)
		if !allowedScopes[scope] || seen[scope] {
			return ChallengeOutput{}, errors.New("unknown or duplicate YNX AI scope")
		}
		seen[scope] = true
		scopes = append(scopes, scope)
	}
	now := s.now().UTC().Truncate(time.Second)
	challenge := WalletChallenge{ID: randomID("wallet"), Nonce: randomID("nonce"), Account: account, DeviceID: input.DeviceID, DeviceSigningPublicKey: input.DeviceSigningPublicKey, Callback: exactCallback, Scopes: scopes, IssuedAt: now, ExpiresAt: now.Add(5 * time.Minute), Status: "pending"}
	doc := walletDocument(challenge)
	raw, _ := json.Marshal(doc)
	digest := sha256.Sum256(raw)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.purgeAuthLocked(now)
	s.state.Challenges[challenge.ID] = challenge
	s.auditLocked(account, "wallet_challenge_created", challenge.ID, "exact callback, scopes and five-minute expiry bound")
	if err := s.saveLocked(); err != nil {
		return ChallengeOutput{}, err
	}
	encoded := base64.RawStdEncoding.EncodeToString(raw)
	return ChallengeOutput{ChallengeID: challenge.ID, ExpiresAt: challenge.ExpiresAt, SignDocument: doc, SignBytes: encoded, Digest: "0x" + hex.EncodeToString(digest[:]), WalletURL: "ynx-wallet://authorize?request=" + base64.RawURLEncoding.EncodeToString(raw), Algorithms: map[string]string{"account": "secp256k1-sha256-der-low-s", "device": "ed25519"}}, nil
}

func walletDocument(c WalletChallenge) WalletSignDocument {
	return WalletSignDocument{Domain: walletDomain, Version: 1, Product: ProductID, ChainID: ChainID, Network: ChainNetwork, ChallengeID: c.ID, Nonce: c.Nonce, Account: c.Account, DeviceID: c.DeviceID, DeviceSigningPublicKey: c.DeviceSigningPublicKey, Callback: c.Callback, Scopes: c.Scopes, Purpose: "Sign in to YNX AI; no signing, transfer, publishing, sending, permission change, or freezing authority", IssuedAt: c.IssuedAt.Format(time.RFC3339), ExpiresAt: c.ExpiresAt.Format(time.RFC3339)}
}

func (s *Store) VerifyWalletChallenge(id string, input VerifyInput) (SessionOutput, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC().Truncate(time.Second)
	s.purgeAuthLocked(now)
	c, ok := s.state.Challenges[id]
	if !ok || c.Status != "pending" || !now.Before(c.ExpiresAt) {
		return SessionOutput{}, errors.New("wallet challenge is invalid, expired, or already used")
	}
	doc := walletDocument(c)
	raw, _ := json.Marshal(doc)
	if !verifyAccountSignature(c.Account, input.AccountPublicKey, input.AccountSignature, raw) || !nativewallet.Verify(c.DeviceSigningPublicKey, raw, input.DeviceSignature) {
		return SessionOutput{}, errors.New("wallet account and device signatures are both required")
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return SessionOutput{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	sum := sha256.Sum256([]byte(token))
	session := ProductSession{ID: randomID("session"), TokenHash: hex.EncodeToString(sum[:]), Account: c.Account, DeviceID: c.DeviceID, Scopes: append([]string(nil), c.Scopes...), IssuedAt: now, ExpiresAt: now.Add(12 * time.Hour), Status: "active"}
	c.Status = "consumed"
	s.state.Challenges[id] = c
	s.state.Sessions[session.ID] = session
	s.auditLocked(c.Account, "wallet_challenge_consumed", id, "account and device proofs verified")
	s.auditLocked(c.Account, "session_created", session.ID, "12-hour product-scoped session")
	if err := s.saveLocked(); err != nil {
		return SessionOutput{}, err
	}
	return SessionOutput{SessionID: session.ID, Token: token, Account: session.Account, DeviceID: session.DeviceID, Scopes: session.Scopes, ExpiresAt: session.ExpiresAt}, nil
}

func verifyAccountSignature(account, publicText, signatureText string, payload []byte) bool {
	publicBytes, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(publicText), "0x"))
	if err != nil || len(publicBytes) != secp256k1.PubKeyBytesLenCompressed {
		return false
	}
	derived, err := consensus.NativeAddress(publicBytes)
	if err != nil {
		return false
	}
	derivedNative, err := accountaddress.Encode(derived)
	if err != nil || derivedNative != account {
		return false
	}
	publicKey, err := secp256k1.ParsePubKey(publicBytes)
	if err != nil {
		return false
	}
	signatureBytes, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(signatureText), "0x"))
	if err != nil {
		return false
	}
	signature, err := ecdsa.ParseDERSignature(signatureBytes)
	if err != nil {
		return false
	}
	sValue := signature.S()
	if sValue.IsOverHalfOrder() {
		return false
	}
	digest := sha256.Sum256(payload)
	return signature.Verify(digest[:], publicKey)
}

func (s *Store) Authenticate(token, deviceID string) (ProductSession, error) {
	token = strings.TrimSpace(strings.TrimPrefix(token, "Bearer "))
	if token == "" || deviceID == "" {
		return ProductSession{}, errors.New("product session required")
	}
	sum := sha256.Sum256([]byte(token))
	want := hex.EncodeToString(sum[:])
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC()
	for _, session := range s.state.Sessions {
		if len(session.TokenHash) == len(want) && subtle.ConstantTimeCompare([]byte(session.TokenHash), []byte(want)) == 1 {
			if session.Status != "active" || session.DeviceID != deviceID || !now.Before(session.ExpiresAt) {
				break
			}
			return session, nil
		}
	}
	return ProductSession{}, errors.New("product session invalid or expired")
}

func (s *Store) RevokeSession(token, deviceID string) error {
	session, err := s.Authenticate(token, deviceID)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.state.Sessions[session.ID]
	current.Status = "revoked"
	current.RevokedAt = s.now().UTC()
	s.state.Sessions[session.ID] = current
	s.auditLocked(session.Account, "session_revoked", session.ID, "user sign-out")
	return s.saveLocked()
}

func (s *Store) purgeAuthLocked(now time.Time) {
	for id, c := range s.state.Challenges {
		if c.ExpiresAt.Add(24 * time.Hour).Before(now) {
			delete(s.state.Challenges, id)
		}
	}
	for id, v := range s.state.Sessions {
		terminal := v.ExpiresAt
		if !v.RevokedAt.IsZero() {
			terminal = v.RevokedAt
		}
		if terminal.Add(24 * time.Hour).Before(now) {
			delete(s.state.Sessions, id)
		}
	}
}

func (o ChallengeOutput) String() string { return fmt.Sprintf("wallet challenge %s", o.ChallengeID) }
