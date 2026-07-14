package appgateway

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

const (
	ownershipDomain     = "YNX_APP_ACCOUNT_OWNERSHIP_V1"
	ownershipVersion    = 1
	maxStoredChallenges = 4096
	maxStoredSessions   = 4096
	maxStoredAudit      = 8192
	stateRetention      = 24 * time.Hour
)

var (
	ErrInvalidSessionRequest = errors.New("invalid app ownership request")
	ErrSessionUnauthorized   = errors.New("app ownership verification failed")
	ErrSessionConflict       = errors.New("app ownership state conflict")
	identifierPattern        = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$`)
)

type ChallengeRequest struct {
	Account                string `json:"account"`
	DeviceID               string `json:"deviceId"`
	DeviceSigningPublicKey string `json:"deviceSigningPublicKey"`
}

type OwnershipSignDocument struct {
	Domain                 string `json:"domain"`
	Version                int    `json:"version"`
	ChainID                int64  `json:"chainId"`
	ChallengeID            string `json:"challengeId"`
	Nonce                  string `json:"nonce"`
	Account                string `json:"account"`
	DeviceID               string `json:"deviceId"`
	DeviceSigningPublicKey string `json:"deviceSigningPublicKey"`
	Origin                 string `json:"origin"`
	IssuedAt               string `json:"issuedAt"`
	ExpiresAt              string `json:"expiresAt"`
}

type Challenge struct {
	ID                     string    `json:"id"`
	Nonce                  string    `json:"nonce"`
	Account                string    `json:"account"`
	CanonicalAddress       string    `json:"canonicalAddress"`
	DeviceID               string    `json:"deviceId"`
	DeviceSigningPublicKey string    `json:"deviceSigningPublicKey"`
	Origin                 string    `json:"origin"`
	IssuedAt               time.Time `json:"issuedAt"`
	ExpiresAt              time.Time `json:"expiresAt"`
	Status                 string    `json:"status"`
	ConsumedAt             time.Time `json:"consumedAt,omitempty"`
}

type ChallengeResponse struct {
	ChallengeID string                `json:"challengeId"`
	Account     string                `json:"account"`
	ExpiresAt   time.Time             `json:"expiresAt"`
	SignDoc     OwnershipSignDocument `json:"signDocument"`
	SignBytes   string                `json:"signBytes"`
	Digest      string                `json:"digest"`
	Algorithms  map[string]string     `json:"algorithms"`
	Warnings    []string              `json:"warnings"`
}

type VerifyChallengeRequest struct {
	AccountPublicKey string `json:"accountPublicKey"`
	AccountSignature string `json:"accountSignature"`
	DeviceSignature  string `json:"deviceSignature"`
}

type AppSession struct {
	ID                     string    `json:"id"`
	TokenHash              string    `json:"tokenHash"`
	Account                string    `json:"account"`
	CanonicalAddress       string    `json:"canonicalAddress"`
	DeviceID               string    `json:"deviceId"`
	DeviceSigningPublicKey string    `json:"deviceSigningPublicKey"`
	Origin                 string    `json:"origin"`
	IssuedAt               time.Time `json:"issuedAt"`
	ExpiresAt              time.Time `json:"expiresAt"`
	Status                 string    `json:"status"`
	RevokedAt              time.Time `json:"revokedAt,omitempty"`
}

type SessionResponse struct {
	SessionID string    `json:"sessionId"`
	Token     string    `json:"token"`
	Account   string    `json:"account"`
	DeviceID  string    `json:"deviceId"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type AuditEvent struct {
	Sequence     uint64    `json:"sequence"`
	Type         string    `json:"type"`
	ObjectID     string    `json:"objectId"`
	Account      string    `json:"account"`
	Origin       string    `json:"origin"`
	At           time.Time `json:"at"`
	PreviousHash string    `json:"previousHash"`
	Hash         string    `json:"hash"`
}

func (g *Gateway) CreateChallenge(origin string, req ChallengeRequest) (ChallengeResponse, error) {
	origin = strings.TrimSpace(origin)
	account, err := nativewallet.NormalizeNativeAddress(req.Account)
	if err != nil || !g.BindingAllowed(origin) || !identifierPattern.MatchString(req.DeviceID) {
		return ChallengeResponse{}, fmt.Errorf("%w: exact client binding, ynx1 account, and device id are required", ErrInvalidSessionRequest)
	}
	if _, err := nativewallet.DecodePublicKey(req.DeviceSigningPublicKey, ed25519.PublicKeySize); err != nil {
		return ChallengeResponse{}, fmt.Errorf("%w: invalid device signing public key", ErrInvalidSessionRequest)
	}
	canonicalAddress, err := normalizeCanonical(account)
	if err != nil {
		return ChallengeResponse{}, fmt.Errorf("%w: invalid native account", ErrInvalidSessionRequest)
	}
	id, err := randomText(g.cfg.Random, 16)
	if err != nil {
		return ChallengeResponse{}, err
	}
	nonce, err := randomText(g.cfg.Random, 32)
	if err != nil {
		return ChallengeResponse{}, err
	}
	now := g.cfg.Now().UTC().Truncate(time.Second)
	challenge := Challenge{ID: id, Nonce: nonce, Account: account, CanonicalAddress: canonicalAddress, DeviceID: req.DeviceID, DeviceSigningPublicKey: req.DeviceSigningPublicKey, Origin: origin, IssuedAt: now, ExpiresAt: now.Add(g.cfg.ChallengeTTL), Status: "pending"}
	g.stateMu.Lock()
	defer g.stateMu.Unlock()
	before := cloneState(g.state)
	g.purgeExpiredLocked(now)
	if len(g.state.Challenges) >= maxStoredChallenges {
		g.state = before
		return ChallengeResponse{}, fmt.Errorf("%w: challenge capacity reached", ErrSessionConflict)
	}
	g.state.Challenges[id] = challenge
	g.appendAuditLocked("challenge_created", id, account, origin, now)
	if err := saveState(g.cfg.StatePath, &g.state); err != nil {
		g.state = before
		return ChallengeResponse{}, err
	}
	return challengeResponse(g.cfg.ChainID, challenge)
}

func (g *Gateway) VerifyChallenge(origin, challengeID string, req VerifyChallengeRequest) (SessionResponse, error) {
	origin = strings.TrimSpace(origin)
	if !g.BindingAllowed(origin) || !validSegment(challengeID) {
		return SessionResponse{}, ErrSessionUnauthorized
	}
	g.stateMu.Lock()
	defer g.stateMu.Unlock()
	challenge, ok := g.state.Challenges[challengeID]
	now := g.cfg.Now().UTC().Truncate(time.Second)
	if !ok || challenge.Status != "pending" || challenge.Origin != origin || !now.Before(challenge.ExpiresAt) {
		return SessionResponse{}, ErrSessionUnauthorized
	}
	response, err := challengeResponse(g.cfg.ChainID, challenge)
	if err != nil {
		return SessionResponse{}, err
	}
	signBytes, err := base64.RawStdEncoding.DecodeString(response.SignBytes)
	if err != nil || !verifyAccountOwnership(challenge.CanonicalAddress, req.AccountPublicKey, req.AccountSignature, signBytes) || !nativewallet.Verify(challenge.DeviceSigningPublicKey, signBytes, req.DeviceSignature) {
		return SessionResponse{}, ErrSessionUnauthorized
	}
	sessionID, err := randomText(g.cfg.Random, 16)
	if err != nil {
		return SessionResponse{}, err
	}
	token, err := randomText(g.cfg.Random, 32)
	if err != nil {
		return SessionResponse{}, err
	}
	tokenHash := sha256.Sum256([]byte(token))
	session := AppSession{ID: sessionID, TokenHash: hex.EncodeToString(tokenHash[:]), Account: challenge.Account, CanonicalAddress: challenge.CanonicalAddress, DeviceID: challenge.DeviceID, DeviceSigningPublicKey: challenge.DeviceSigningPublicKey, Origin: origin, IssuedAt: now, ExpiresAt: now.Add(g.cfg.SessionTTL), Status: "active"}
	before := cloneState(g.state)
	g.purgeExpiredLocked(now)
	if len(g.state.Sessions) >= maxStoredSessions {
		g.state = before
		return SessionResponse{}, fmt.Errorf("%w: session capacity reached", ErrSessionConflict)
	}
	challenge.Status = "consumed"
	challenge.ConsumedAt = now
	g.state.Challenges[challengeID] = challenge
	g.state.Sessions[sessionID] = session
	g.appendAuditLocked("challenge_consumed", challengeID, challenge.Account, origin, now)
	g.appendAuditLocked("session_created", sessionID, challenge.Account, origin, now)
	if err := saveState(g.cfg.StatePath, &g.state); err != nil {
		g.state = before
		return SessionResponse{}, err
	}
	return SessionResponse{SessionID: sessionID, Token: token, Account: session.Account, DeviceID: session.DeviceID, ExpiresAt: session.ExpiresAt}, nil
}

func (g *Gateway) AuthenticateSession(origin, token, deviceID string) (AppSession, error) {
	origin = strings.TrimSpace(origin)
	token = strings.TrimSpace(token)
	deviceID = strings.TrimSpace(deviceID)
	if !g.BindingAllowed(origin) || token == "" || deviceID == "" {
		return AppSession{}, ErrSessionUnauthorized
	}
	digest := sha256.Sum256([]byte(token))
	want := hex.EncodeToString(digest[:])
	g.stateMu.Lock()
	defer g.stateMu.Unlock()
	now := g.cfg.Now().UTC()
	for _, session := range g.state.Sessions {
		if len(session.TokenHash) == len(want) && subtle.ConstantTimeCompare([]byte(session.TokenHash), []byte(want)) == 1 {
			if session.Status != "active" || session.Origin != origin || session.DeviceID != deviceID || !now.Before(session.ExpiresAt) {
				return AppSession{}, ErrSessionUnauthorized
			}
			return session, nil
		}
	}
	return AppSession{}, ErrSessionUnauthorized
}

func (g *Gateway) RevokeSession(origin, token, deviceID string) error {
	session, err := g.AuthenticateSession(origin, token, deviceID)
	if err != nil {
		return err
	}
	g.stateMu.Lock()
	defer g.stateMu.Unlock()
	current, ok := g.state.Sessions[session.ID]
	if !ok || current.Status != "active" {
		return ErrSessionConflict
	}
	before := cloneState(g.state)
	now := g.cfg.Now().UTC().Truncate(time.Second)
	current.Status = "revoked"
	current.RevokedAt = now
	g.state.Sessions[current.ID] = current
	g.appendAuditLocked("session_revoked", current.ID, current.Account, current.Origin, now)
	if err := saveState(g.cfg.StatePath, &g.state); err != nil {
		g.state = before
		return err
	}
	return nil
}

func (g *Gateway) RegistrationMatchesSession(service string, session AppSession, body []byte) bool {
	var request struct {
		Account          string `json:"account"`
		DeviceID         string `json:"deviceId"`
		SigningPublicKey string `json:"signingPublicKey"`
	}
	if err := json.Unmarshal(body, &request); err != nil {
		return false
	}
	account, err := nativewallet.NormalizeNativeAddress(request.Account)
	if err != nil || account != session.Account || request.DeviceID != session.DeviceID || request.SigningPublicKey != session.DeviceSigningPublicKey {
		return false
	}
	return service == "chat" || service == "square"
}

func (g *Gateway) ActiveSessionCount() int {
	g.stateMu.Lock()
	defer g.stateMu.Unlock()
	now := g.cfg.Now().UTC()
	count := 0
	for _, session := range g.state.Sessions {
		if session.Status == "active" && now.Before(session.ExpiresAt) {
			count++
		}
	}
	return count
}

func challengeResponse(chainID int64, challenge Challenge) (ChallengeResponse, error) {
	doc := OwnershipSignDocument{Domain: ownershipDomain, Version: ownershipVersion, ChainID: chainID, ChallengeID: challenge.ID, Nonce: challenge.Nonce, Account: challenge.Account, DeviceID: challenge.DeviceID, DeviceSigningPublicKey: challenge.DeviceSigningPublicKey, Origin: challenge.Origin, IssuedAt: challenge.IssuedAt.Format(time.RFC3339), ExpiresAt: challenge.ExpiresAt.Format(time.RFC3339)}
	signBytes, err := json.Marshal(doc)
	if err != nil {
		return ChallengeResponse{}, err
	}
	digest := sha256.Sum256(signBytes)
	return ChallengeResponse{
		ChallengeID: challenge.ID, Account: challenge.Account, ExpiresAt: challenge.ExpiresAt,
		SignDoc: doc, SignBytes: base64.RawStdEncoding.EncodeToString(signBytes), Digest: "0x" + hex.EncodeToString(digest[:]),
		Algorithms: map[string]string{"account": "secp256k1-sha256-der-low-s", "device": "ed25519"},
		Warnings: []string{
			"Signing proves current account and device control; it does not back up or export either private key.",
			"Keep account and device recovery material offline; the gateway cannot recover keys or move YNXT.",
		},
	}, nil
}

func verifyAccountOwnership(canonicalAddress, publicKeyText, signatureText string, signBytes []byte) bool {
	publicKeyBytes, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(publicKeyText), "0x"))
	if err != nil || len(publicKeyBytes) != secp256k1.PubKeyBytesLenCompressed {
		return false
	}
	derived, err := consensus.NativeAddress(publicKeyBytes)
	if err != nil || derived != canonicalAddress {
		return false
	}
	publicKey, err := secp256k1.ParsePubKey(publicKeyBytes)
	if err != nil {
		return false
	}
	signatureBytes, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(signatureText), "0x"))
	if err != nil || len(signatureBytes) == 0 {
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
	digest := sha256.Sum256(signBytes)
	return signature.Verify(digest[:], publicKey)
}

func normalizeCanonical(account string) (string, error) {
	return normalizeAccountAddress(account)
}

func randomText(reader io.Reader, size int) (string, error) {
	buffer := make([]byte, size)
	if _, err := io.ReadFull(reader, buffer); err != nil {
		return "", fmt.Errorf("generate app ownership random value: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func (g *Gateway) appendAuditLocked(eventType, objectID, account, origin string, at time.Time) {
	previous := ""
	if len(g.state.Audit) > 0 {
		previous = g.state.Audit[len(g.state.Audit)-1].Hash
	}
	g.state.AuditSequence++
	event := AuditEvent{Sequence: g.state.AuditSequence, Type: eventType, ObjectID: objectID, Account: account, Origin: origin, At: at, PreviousHash: previous}
	copy := event
	copy.Hash = ""
	payload, _ := json.Marshal(copy)
	digest := sha256.Sum256(payload)
	event.Hash = hex.EncodeToString(digest[:])
	if len(g.state.Audit) >= maxStoredAudit {
		g.state.Audit = append([]AuditEvent(nil), g.state.Audit[len(g.state.Audit)-maxStoredAudit+1:]...)
	}
	g.state.Audit = append(g.state.Audit, event)
}

func (g *Gateway) purgeExpiredLocked(now time.Time) {
	cutoff := now.Add(-stateRetention)
	for id, challenge := range g.state.Challenges {
		terminalAt := challenge.ExpiresAt
		if !challenge.ConsumedAt.IsZero() {
			terminalAt = challenge.ConsumedAt
		}
		if terminalAt.Before(cutoff) {
			delete(g.state.Challenges, id)
		}
	}
	for id, session := range g.state.Sessions {
		terminalAt := session.ExpiresAt
		if !session.RevokedAt.IsZero() {
			terminalAt = session.RevokedAt
		}
		if terminalAt.Before(cutoff) {
			delete(g.state.Sessions, id)
		}
	}
}
