package social

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

const matrixLoginProtocol = "ynx-social-matrix-login/v1"
const matrixPeerProtocol = "ynx-social-matrix-peer/v1"

var matrixSocialPerson = regexp.MustCompile(`^sp_[A-Za-z0-9_-]{32}$`)

// A contact selected in the normal UI is bound to its existing opaque Social
// identity, not its mutable handle or a wallet address entered by the user.
func validMatrixPeerQuery(query url.Values) bool {
	if len(query) != 1 {
		return false
	}
	user := strings.SplitN(query.Get("userId"), ":", 2)
	return len(query["account"]) == 1 && matrixAccount.MatchString(query.Get("account")) ||
		len(query["person"]) == 1 && matrixSocialPerson.MatchString(query.Get("person")) ||
		len(query["userId"]) == 1 && len(user) == 2 && validMatrixUserID(query.Get("userId"), user[1])
}

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
	if err != nil || !peer && len(query) != 0 || peer && !validMatrixPeerQuery(query) {
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
	personID := query.Get("person")
	if peer {
		account, protocol = query.Get("account"), matrixPeerProtocol
		if personID != "" {
			// Resolve only an already persisted public identity. Do not allocate a
			// replacement ID, provision a Matrix user or expose lookup existence.
			account, err = s.service.resolveProfileLocator(socialLocatorPrefix + personID)
			if err != nil {
				writeServiceError(w, ErrUnauthorized)
				return
			}
		}
		if userID := query.Get("userId"); userID != "" {
			identity, resolveErr := s.service.cfg.MatrixDirectory.resolveUser(userID)
			if resolveErr != nil {
				if errors.Is(resolveErr, ErrNotFound) {
					writeServiceError(w, ErrUnauthorized)
				} else {
					writeError(w, http.StatusServiceUnavailable, "existing Matrix identity directory required")
				}
				return
			}
			account = identity.Account
			s.service.mu.Lock()
			personID = s.service.state.PublicIdentities[account]
			s.service.mu.Unlock()
		}
		if !s.service.matrixPeerAllowed(session.Account, account) {
			writeServiceError(w, ErrUnauthorized)
			return
		}
		if query.Get("userId") != "" && !matrixSocialPerson.MatchString(personID) {
			writeError(w, http.StatusConflict, "existing Social identity mapping required; no identity was created")
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
	// Legacy account queries retain five token-free fields. Contact selection
	// additionally echoes its original public ID for the normal UI's final fence.
	writeJSON(w, http.StatusOK, struct {
		Protocol string `json:"protocol"`
		MatrixIdentity
		Person string `json:"person,omitempty"`
	}{protocol, identity, personID})
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
