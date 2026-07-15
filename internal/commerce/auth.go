package commerce

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

type ChallengeInput struct {
	Account, Callback, DeviceID, Purpose string
	Scopes                               []string
}
type SessionInput struct{ ChallengeID, PublicKey, Signature, Role string }

type AuthConfig struct {
	AllowedCallbacks map[string]bool
	SessionTTL       time.Duration
}

func (s *Store) CreateChallenge(in ChallengeInput, cfg AuthConfig) (WalletChallenge, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !consensus.IsNativeAddress(in.Account) {
		return WalletChallenge{}, errors.New("canonical ynx1 account required")
	}
	if !cfg.AllowedCallbacks[in.Callback] || in.DeviceID == "" || len(in.DeviceID) > 128 {
		return WalletChallenge{}, errors.New("callback and device binding must be allowlisted")
	}
	if in.Purpose == "" || len(in.Purpose) > 200 {
		return WalletChallenge{}, errors.New("human-readable purpose required")
	}
	if len(in.Scopes) == 0 || len(in.Scopes) > 4 {
		return WalletChallenge{}, errors.New("one to four scopes required")
	}
	allowed := map[string]bool{"shop.profile": true, "shop.orders": true, "shop.seller": true}
	seen := map[string]bool{}
	for _, scope := range in.Scopes {
		if !allowed[scope] || seen[scope] {
			return WalletChallenge{}, errors.New("unsupported or duplicate scope")
		}
		seen[scope] = true
	}
	now := s.now()
	c := WalletChallenge{ID: newID("siwy"), Account: in.Account, Nonce: newID("nonce"), Product: "com.ynx.shop", Callback: in.Callback, DeviceID: in.DeviceID, Scopes: append([]string(nil), in.Scopes...), Purpose: in.Purpose, IssuedAt: now, ExpiresAt: now.Add(5 * time.Minute)}
	s.s.Challenges[c.ID] = c
	s.auditLocked(in.Account, "buyer", "wallet_challenge_created", "auth", c.ID, "pending", "device and callback bound")
	if err := s.persistLocked(); err != nil {
		return WalletChallenge{}, err
	}
	return c, nil
}

func challengeSignBytes(c WalletChallenge) []byte {
	b, _ := json.Marshal(struct {
		Domain, Version, Chain, Product, Account, Callback, DeviceID, Nonce, Purpose string
		Scopes                                                                       []string
		IssuedAt, ExpiresAt                                                          time.Time
	}{"SIGN_IN_WITH_YNX_WALLET", "1", ChainName, c.Product, c.Account, c.Callback, c.DeviceID, c.Nonce, c.Purpose, c.Scopes, c.IssuedAt, c.ExpiresAt})
	return b
}

func (s *Store) CompleteSession(in SessionInput, cfg AuthConfig) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.s.Challenges[in.ChallengeID]
	if !ok {
		return Session{}, ErrNotFound
	}
	now := s.now()
	if c.Consumed || !c.ExpiresAt.After(now) {
		return Session{}, fmtAuth("challenge expired or replayed")
	}
	if in.Role != "buyer" && in.Role != "seller" {
		return Session{}, fmtAuth("invalid role")
	}
	pubBytes, err := hex.DecodeString(strings.TrimPrefix(in.PublicKey, "0x"))
	if err != nil {
		return Session{}, fmtAuth("invalid public key")
	}
	pub, err := secp256k1.ParsePubKey(pubBytes)
	if err != nil {
		return Session{}, fmtAuth("invalid public key")
	}
	derived, err := consensus.NativeAddress(pub.SerializeCompressed())
	if err != nil || derived != c.Account {
		return Session{}, fmtAuth("public key does not match account")
	}
	sigBytes, err := hex.DecodeString(strings.TrimPrefix(in.Signature, "0x"))
	if err != nil {
		return Session{}, fmtAuth("invalid signature")
	}
	sig, err := ecdsa.ParseDERSignature(sigBytes)
	if err != nil {
		return Session{}, fmtAuth("invalid signature")
	}
	digest := sha256.Sum256(challengeSignBytes(c))
	if !sig.Verify(digest[:], pub) {
		return Session{}, fmtAuth("signature verification failed")
	}
	if in.Role == "seller" {
		permitted := false
		for _, scope := range c.Scopes {
			if scope == "shop.seller" {
				permitted = true
			}
		}
		if !permitted {
			return Session{}, fmtAuth("seller scope not granted")
		}
	}
	c.Consumed = true
	s.s.Challenges[c.ID] = c
	ttl := cfg.SessionTTL
	if ttl <= 0 {
		ttl = 12 * time.Hour
	}
	sess := Session{Token: newID("session"), Account: c.Account, Role: in.Role, ExpiresAt: now.Add(ttl)}
	s.s.Sessions[sess.Token] = sess
	s.auditLocked(sess.Account, sess.Role, "session_created", "auth", sess.Token, "approved", "wallet signature verified")
	if err := s.persistLocked(); err != nil {
		return Session{}, err
	}
	return sess, nil
}

func fmtAuth(message string) error { return errors.New("wallet authorization failed: " + message) }
func (s *Store) Authenticate(token string) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.s.Sessions[token]
	if !ok || !sess.ExpiresAt.After(s.now()) {
		return Session{}, ErrUnauthorized
	}
	return sess, nil
}
