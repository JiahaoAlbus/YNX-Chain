package social

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chat"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
	"net/http"
	"strings"
	"time"
)

// Production implementations are the shared Client; decisions are never cached.
type ProductSessionAuthorizer interface {
	Authorize(context.Context, *http.Request, []string) (productsessionv2.Session, error)
}

// Optional additions preserve authenticated schema-5 bytes for old users.
type productSessionBinding struct {
	Account            string    `json:"account"`
	Platform           string    `json:"platform"`
	ProductDeviceID    string    `json:"productDeviceId"`
	ProductDeviceKey   string    `json:"productDeviceKey"`
	ChatDeviceID       string    `json:"chatDeviceId"`
	SessionID          string    `json:"sessionId"`
	SealedBrowserGrant string    `json:"sealedBrowserGrant,omitempty"`
	BrowserGrantDigest string    `json:"browserGrantDigest,omitempty"`
	ExpiresAt          time.Time `json:"expiresAt"`
}
type productDeviceRegistration struct {
	DeviceID                    string `json:"deviceId"`
	SigningPublicKey            string `json:"signingPublicKey"`
	EncryptionPublicKey         string `json:"encryptionPublicKey"`
	DeviceProofSignature        string `json:"deviceProofSignature"`
	ChatRegistrationSignature   string `json:"chatRegistrationSignature"`
	SquareRegistrationSignature string `json:"squareRegistrationSignature"`
}

func bridgeDigest(value string) string {
	bytes := sha256.Sum256([]byte(value))
	return hex.EncodeToString(bytes[:])
}
func productDeviceProofPayload(session productsessionv2.Session, in productDeviceRegistration) []byte {
	return []byte(strings.Join([]string{"ynx-social-session-device-v2", session.Account, session.SessionBinding, session.DeviceID, session.DeviceKey, in.DeviceID, in.SigningPublicKey, in.EncryptionPublicKey}, "\n"))
}
func (s *Server) liveProductSession(r *http.Request, required []string) (productsessionv2.Session, error) {
	values := r.Header.Values(productsessionv2.ProofHeader)
	if len(values) != 1 || len(values[0]) > 16384 {
		return productsessionv2.Session{}, ErrUnauthorized
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(values[0])
	if err != nil {
		return productsessionv2.Session{}, ErrUnauthorized
	}
	var hint struct {
		Platform string `json:"platform"`
	}
	if json.Unmarshal(raw, &hint) != nil {
		return productsessionv2.Session{}, ErrUnauthorized
	}
	authorizer := s.service.cfg.ProductSessions[hint.Platform]
	if authorizer == nil {
		return productsessionv2.Session{}, ErrUnauthorized
	}
	// Untrusted metadata only selects an exact verifier; that verifier checks it.
	session, err := authorizer.Authorize(r.Context(), r, required)
	if err != nil {
		return productsessionv2.Session{}, err
	}
	if session.Platform != hint.Platform || session.ProductID != RequestingProduct || session.ClientID != ProductClientID {
		return productsessionv2.Session{}, ErrUnauthorized
	}
	return session, nil
}
func (s *Server) browserProductBinding(r *http.Request, session productsessionv2.Session, stored *productSessionBinding) (string, string, error) {
	if session.Platform != "web" {
		return "", "", nil
	}
	bridge := s.service.cfg.BrowserSSO
	if bridge == nil {
		return "", "", ErrUnauthorized
	}
	encoded, grant, err := bridge.Binding(r)
	if err != nil || grant.Identity.Account != session.Account {
		return "", "", ErrUnauthorized
	}
	digest := bridgeDigest(grant.GrantToken)
	if stored != nil && (stored.BrowserGrantDigest != digest || stored.Account != session.Account) {
		return "", "", ErrUnauthorized
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		if r.Header.Get("Origin") != Origin || len(r.Header.Values("X-YNX-SSO-CSRF")) != 1 || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-YNX-SSO-CSRF")), []byte(grant.CSRF)) != 1 {
			return "", "", ErrUnauthorized
		}
	}
	if _, status := bridge.VerifyBinding(r.Context(), encoded, session.Account); status != 200 {
		if status >= 500 {
			return "", "", &productsessionv2.Error{Code: "AUTHORITY_UNAVAILABLE", Status: 503}
		}
		return "", "", ErrUnauthorized
	}
	return encoded, digest, nil
}
func (s *Server) bindProductSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, 405, "method not allowed")
		return
	}
	if r.URL.RawQuery != "" {
		writeError(w, 400, "session binding query not accepted")
		return
	}
	if !s.service.Allow(r.RemoteAddr, "anonymous", "product-session-bind") {
		writeServiceError(w, ErrRateLimited)
		return
	}
	session, err := s.liveProductSession(r, []string{"social.messaging", "social.profile"})
	if err != nil {
		writeBridgeError(w, err)
		return
	}
	sealed, digest, err := s.browserProductBinding(r, session, nil)
	if err != nil {
		writeBridgeError(w, err)
		return
	}
	var in productDeviceRegistration
	if !decodeRequest(w, r, &in, 16*1024) {
		return
	}
	actor, err := s.service.bindProductDevice(session, in, sealed, digest)
	if err != nil {
		writeBridgeError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"session": actor, "authMode": "product-session-v2"})
}
func (s *Service) bindProductDevice(session productsessionv2.Session, in productDeviceRegistration, sealed, grantDigest string) (Session, error) {
	if writeUnavailable := s.writeAvailability(); writeUnavailable != nil {
		var unavailableResult0 Session
		return unavailableResult0, writeUnavailable
	}

	now := s.cfg.Now().UTC()
	expires, err := time.Parse(time.RFC3339Nano, session.ExpiresAt)
	if err != nil || !expires.After(now) || !identifierPattern.MatchString(in.DeviceID) || !contains(session.Scopes, "social.profile") || !contains(session.Scopes, "social.messaging") {
		return Session{}, ErrUnauthorized
	}
	if !nativewallet.Verify(in.SigningPublicKey, productDeviceProofPayload(session, in), in.DeviceProofSignature) {
		return Session{}, ErrUnauthorized
	}
	key := bridgeDigest(session.SessionBinding)
	s.mu.Lock()
	if writeUnavailable := s.stateWriteError; writeUnavailable != nil {
		s.mu.Unlock()
		var unavailableResult0 Session
		return unavailableResult0, writeUnavailable
	}

	defer s.mu.Unlock()
	if previous, exists := s.state.ProductBindings[key]; exists {
		if previous.Account != session.Account || previous.Platform != session.Platform || previous.ProductDeviceID != session.DeviceID || previous.ProductDeviceKey != session.DeviceKey || previous.ChatDeviceID != in.DeviceID || previous.BrowserGrantDigest != grantDigest {
			return Session{}, ErrUnauthorized
		}
		actor, ok := s.state.Sessions["psv2:"+key]
		if !ok || actor.RevokedAt != nil || !actor.ExpiresAt.After(now) {
			return Session{}, ErrUnauthorized
		}
		return actor, nil
	}
	if existing, ok := s.state.Devices[in.DeviceID]; ok && (existing.Account != session.Account || existing.SigningPublicKey != in.SigningPublicKey || existing.EncryptionPublicKey != in.EncryptionPublicKey || existing.Status != "active") {
		return Session{}, ErrConflict
	}
	activeBindings := 0
	for _, binding := range s.state.ProductBindings {
		if binding.ExpiresAt.After(now) {
			activeBindings++
		}
	}
	if s.cfg.Chat == nil || s.cfg.Square == nil || activeBindings >= 10000 {
		return Session{}, ErrConflict
	}
	chatRequest := chat.RegisterDeviceRequest{IdempotencyKey: RegistrationIdempotencyKey("social-chat", session.SessionBinding), Account: session.Account, DeviceID: in.DeviceID, SigningPublicKey: in.SigningPublicKey, EncryptionPublicKey: in.EncryptionPublicKey, ProofSignature: in.ChatRegistrationSignature}
	if _, err := s.cfg.Chat.RegisterDevice(chatRequest); err != nil {
		return Session{}, ErrUnauthorized
	}
	squareRequest := square.RegisterDeviceRequest{IdempotencyKey: RegistrationIdempotencyKey("social-square", session.SessionBinding), Account: session.Account, DeviceID: in.DeviceID, SigningPublicKey: in.SigningPublicKey, ProofSignature: in.SquareRegistrationSignature}
	squareExists := false
	for _, device := range s.cfg.Square.ExportAccount(square.Device{Account: session.Account}).Devices {
		if device.ID == in.DeviceID {
			if device.Status != "active" || device.SigningPublicKey != in.SigningPublicKey {
				return Session{}, ErrUnauthorized
			}
			squareExists = true
		}
	}
	if !squareExists {
		if _, err := s.cfg.Square.RegisterDevice(squareRequest); err != nil {
			return Session{}, ErrUnauthorized
		}
	}
	scopes := make([]string, 0, len(session.Scopes))
	for _, scope := range session.Scopes {
		if allowedScopes[scope] {
			scopes = append(scopes, scope)
		}
	}
	actor := Session{ID: "psv2_" + key[:24], Account: session.Account, DeviceID: in.DeviceID, Scopes: scopes, CreatedAt: now, ExpiresAt: expires}
	before := cloneState(s.state)
	if s.state.ProductBindings == nil {
		s.state.ProductBindings = map[string]productSessionBinding{}
	}
	for key, binding := range s.state.ProductBindings {
		if !binding.ExpiresAt.After(now) {
			delete(s.state.ProductBindings, key)
		}
	}
	s.state.ProductBindings[key] = productSessionBinding{session.Account, session.Platform, session.DeviceID, session.DeviceKey, in.DeviceID, actor.ID, sealed, grantDigest, expires}
	s.state.Sessions["psv2:"+key] = actor
	device := s.state.Devices[in.DeviceID]
	if device.ID == "" {
		device = ProductDevice{ID: in.DeviceID, Account: session.Account, SigningPublicKey: in.SigningPublicKey, EncryptionPublicKey: in.EncryptionPublicKey, Status: "active", CreatedAt: now, UpdatedAt: now}
	}
	s.state.Devices[in.DeviceID] = device
	s.appendAuditLocked("product_session_device_bound", "session", actor.ID, actor.Account, objectDigest(in), now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return Session{}, err
	}
	return actor, nil
}
func (s *Server) authorizeProductActor(r *http.Request, scope string) (Session, error) {
	session, err := s.liveProductSession(r, []string{scope})
	if err != nil {
		return Session{}, err
	}
	key := bridgeDigest(session.SessionBinding)
	s.service.mu.Lock()
	binding, exists := s.service.state.ProductBindings[key]
	actor, active := s.service.state.Sessions["psv2:"+key]
	device := s.service.state.Devices[binding.ChatDeviceID]
	s.service.mu.Unlock()
	if !exists || !active || binding.Account != session.Account || binding.Platform != session.Platform || binding.ProductDeviceID != session.DeviceID || binding.ProductDeviceKey != session.DeviceKey || actor.Account != session.Account || actor.RevokedAt != nil || !actor.ExpiresAt.After(s.service.cfg.Now()) || !contains(actor.Scopes, scope) || device.Status != "active" || device.Account != actor.Account {
		return Session{}, ErrUnauthorized
	}
	if _, _, err := s.browserProductBinding(r, session, &binding); err != nil {
		return Session{}, err
	}
	return actor, nil
}
func writeBridgeError(w http.ResponseWriter, err error) {
	var authority *productsessionv2.Error
	if errors.As(err, &authority) {
		writeError(w, authority.Status, authority.Code)
		return
	}
	writeServiceError(w, err)
}
