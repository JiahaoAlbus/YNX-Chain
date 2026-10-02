package social

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

const matrixLoginProtocol = "ynx-social-matrix-login/v1"
const matrixPeerProtocol = "ynx-social-matrix-peer/v1"

// This endpoint only reads existing identities and accepted relationships.
// Standard homeserver SSO/token login stays in the existing browser consumer.
func (s *Server) matrixLogin(w http.ResponseWriter, r *http.Request) {
	peer := r.URL.Path == "/social/v3/matrix/peer"
	method := http.MethodPost
	if peer {
		method = http.MethodGet
	}
	if r.Method != method {
		w.Header().Set("Allow", method)
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || !peer && len(query) != 0 || peer && (len(query) != 1 || len(query["account"]) != 1 || !matrixAccount.MatchString(query.Get("account"))) {
		writeError(w, http.StatusBadRequest, "invalid Matrix metadata request")
		return
	}
	if !peer && !decodeMatrixDevice(w, r) {
		writeError(w, http.StatusBadRequest, "original Matrix device required")
		return
	}
	// Use the exact two-scope introspection proof already emitted by the Web
	// consumer; profile consent is additionally checked on the verified session.
	if !s.service.Allow(r.RemoteAddr, "anonymous", "matrix-metadata") {
		writeServiceError(w, ErrRateLimited)
		return
	}
	session, err := s.liveProductSession(r, []string{"social.contacts", "social.messaging"})
	if err != nil {
		writeBridgeError(w, err)
		return
	}
	expires, expiryErr := time.Parse(time.RFC3339Nano, session.ExpiresAt)
	if expiryErr != nil || !expires.After(s.service.cfg.Now()) || !matrixAccount.MatchString(session.Account) || !contains(session.Scopes, "social.profile") || !contains(session.Scopes, "social.contacts") || !contains(session.Scopes, "social.messaging") {
		writeServiceError(w, ErrUnauthorized)
		return
	}
	if _, _, err := s.browserProductBinding(r, session, nil); err != nil {
		writeBridgeError(w, err)
		return
	}
	account, protocol := session.Account, matrixLoginProtocol
	if peer {
		account, protocol = query.Get("account"), matrixPeerProtocol
		if !s.service.matrixPeerAllowed(session.Account, account) {
			writeServiceError(w, ErrUnauthorized)
			return
		}
	}
	identity, err := s.service.cfg.MatrixDirectory.Resolve(account)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeError(w, http.StatusConflict, "existing Matrix identity mapping required; no account was created")
		} else {
			writeError(w, http.StatusServiceUnavailable, "Matrix identity directory is not configured; retry after service setup")
		}
		return
	}
	// Exactly five token-free fields match the existing standard SSO consumer.
	writeJSON(w, http.StatusOK, struct {
		Protocol string `json:"protocol"`
		MatrixIdentity
	}{protocol, identity})
}

func decodeMatrixDevice(w http.ResponseWriter, r *http.Request) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return false
	}
	key, err := decoder.Token()
	if err != nil || key != "deviceId" {
		return false
	}
	var deviceID string
	if decoder.Decode(&deviceID) != nil || !matrixDevice.MatchString(deviceID) || decoder.More() {
		return false
	}
	end, err := decoder.Token()
	return err == nil && end == json.Delim('}') && decoder.Decode(new(any)) == io.EOF
}

func (s *Service) matrixPeerAllowed(actor, peer string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return actor != peer && s.contactLocked(actor, peer) && !s.blockedLocked(actor, peer)
}

// Keep an explicit compile-time link to the shared live authority contract;
// metadata never uses identity-only cookie login as messaging consent.
var _ ProductSessionAuthorizer = (*productsessionv2.Client)(nil)
