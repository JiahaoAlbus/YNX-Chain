package finance

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

const evmReadPortfolioPath = "/api/evm-read/portfolio"
const evmReadRevokePath = "/api/wallet-login/revoke"
const evmReadProofHeader = "X-YNX-EVM-Read-Proof"

var evmReadEmptyBodyDigest = func() string {
	digest := sha256.Sum256(nil)
	return hex.EncodeToString(digest[:])
}()

func (s *Server) evmReadOriginAllowed(r *http.Request) bool {
	if r.Header.Get("Origin") == BrowserFinanceOrigin {
		return s.originAllowed(r)
	}
	// A same-origin browser GET normally omits Origin. Fetch metadata and the
	// canonical Host identify that narrow case; the signed device proof still
	// binds Finance's exact origin, account, raw target and nonce.
	return r.Method == http.MethodGet && r.Header.Get("Origin") == "" &&
		r.Host == "finance.ynxweb4.com" && r.Header.Get("Sec-Fetch-Site") == "same-origin" &&
		r.Header.Get("Sec-Fetch-Mode") == "cors" && r.Header.Get("Sec-Fetch-Dest") == "empty"
}

func (s *Server) evmReadAvailable(w http.ResponseWriter) bool {
	if s.cfg.EVMReadAuthority == nil {
		writeError(w, http.StatusServiceUnavailable, "evm_read_unavailable", "EVM account read-only session is not configured; Standard Wallet remains available")
		return false
	}
	return true
}

func evmReadRandomToken() (string, error) {
	bytes := make([]byte, 24)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func (s *Server) evmReadChallenge(w http.ResponseWriter, r *http.Request) {
	if !s.evmReadAvailable(w) {
		return
	}
	if !s.evmReadOriginAllowed(r) {
		writeError(w, http.StatusForbidden, "origin_not_allowed", "EVM read challenge requires the exact Finance browser origin")
		return
	}
	var input struct {
		Account      string `json:"account"`
		ProviderKind string `json:"providerKind"`
		DeviceID     string `json:"deviceId"`
		DeviceKey    string `json:"deviceKey"`
	}
	if decodeStrict(w, r, &input) != nil || !accountaddress.IsCanonical(input.Account) || (input.ProviderKind != "ynx-wallet" && input.ProviderKind != "metamask") {
		writeError(w, http.StatusBadRequest, "invalid_evm_read_challenge", "Selected EVM account, provider and device key are required")
		return
	}
	remoteHost, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remoteHost = r.RemoteAddr
	}
	if !s.allow("evm-read-challenge:"+remoteHost+":"+input.Account, http.MethodPost) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "rate_limited", "EVM read challenge rate limit exceeded")
		return
	}
	nonce, err := evmReadRandomToken()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "random_unavailable", "Secure EVM challenge cannot be issued")
		return
	}
	state, err := evmReadRandomToken()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "random_unavailable", "Secure EVM challenge cannot be issued")
		return
	}
	requestToken, err := evmReadRandomToken()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "random_unavailable", "Secure EVM challenge cannot be issued")
		return
	}
	now := s.now().UTC().Truncate(time.Millisecond)
	expires := now.Add(5 * time.Minute)
	requestID := "finance-evm-read-" + requestToken
	challengeInput := map[string]any{
		"chainId": 6423, "account": input.Account, "productId": "finance", "origin": BrowserFinanceOrigin,
		"callback": BrowserFinanceOrigin + "/wallet-auth/callback", "scope": "finance.account.read",
		"deviceId": input.DeviceID, "deviceAlgorithm": "p256-sha256", "deviceKey": input.DeviceKey,
		"nonce": nonce, "state": state, "requestId": requestID, "providerKind": input.ProviderKind,
		"issuedAt": evmReadTime(now), "expiresAt": evmReadTime(expires),
	}
	result, err := s.cfg.EVMReadAuthority.Invoke(r.Context(), map[string]any{"action": "create", "challenge": challengeInput}, "", nil)
	var issued struct {
		Kind           string          `json:"kind"`
		Challenge      json.RawMessage `json:"challenge"`
		SigningRequest struct {
			Method  string   `json:"method"`
			Params  []string `json:"params"`
			Message string   `json:"message"`
		} `json:"signingRequest"`
	}
	if err != nil || json.Unmarshal(result, &issued) != nil || issued.Kind != "result" || len(issued.SigningRequest.Params) != 2 || issued.SigningRequest.Method != "personal_sign" || issued.SigningRequest.Params[1] != input.Account {
		writeError(w, http.StatusServiceUnavailable, "evm_read_authority_unavailable", "EVM read challenge authority is unavailable")
		return
	}
	record := EVMReadChallengeRecord{RequestID: requestID, Nonce: nonce, State: state, Account: input.Account, ExactChallenge: string(issued.Challenge), IssuedAt: now, ExpiresAt: expires}
	if err := s.service.Store.PutEVMReadChallenge(record, now); err != nil {
		writeError(w, http.StatusConflict, "evm_read_challenge_not_persisted", "EVM read challenge was not persisted")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{"schemaVersion": "finance-evm-read-challenge-v1", "challenge": issued.Challenge, "signingRequest": issued.SigningRequest, "privateFinanceAuthorized": false})
}

func (s *Server) evmReadIssueSession(w http.ResponseWriter, r *http.Request) {
	if !s.evmReadAvailable(w) {
		return
	}
	if !s.evmReadOriginAllowed(r) {
		writeError(w, http.StatusForbidden, "origin_not_allowed", "EVM read proof requires the exact Finance browser origin")
		return
	}
	var input struct {
		Proof json.RawMessage `json:"proof"`
	}
	if decodeStrict(w, r, &input) != nil || len(input.Proof) == 0 || len(input.Proof) > maxWalletLoginChallengeBytes {
		writeError(w, http.StatusBadRequest, "invalid_evm_read_proof", "An exact EVM read login proof is required")
		return
	}
	var selector struct {
		Challenge struct {
			Account   string `json:"account"`
			RequestID string `json:"requestId"`
		} `json:"challenge"`
	}
	if json.Unmarshal(input.Proof, &selector) != nil || !accountaddress.IsCanonical(selector.Challenge.Account) || !walletLoginRequestID.MatchString(selector.Challenge.RequestID) {
		writeError(w, http.StatusUnauthorized, "evm_read_rejected", "EVM proof does not select a server-issued challenge")
		return
	}
	challenge, err := s.service.Store.EVMReadChallenge(selector.Challenge.Account, selector.Challenge.RequestID)
	if err != nil || challenge.ConsumedAt != nil || !challenge.ExpiresAt.After(s.now().UTC()) {
		writeError(w, http.StatusUnauthorized, "evm_read_rejected", "EVM challenge is missing, consumed or expired")
		return
	}
	if err := s.service.Store.ReserveEVMReadVerification(challenge.Account, challenge.RequestID, challenge.Nonce, s.now().UTC()); err != nil {
		writeError(w, http.StatusTooManyRequests, "evm_read_attempts_exhausted", "EVM challenge verification attempts are exhausted")
		return
	}
	sessionID, err := evmReadRandomToken()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "random_unavailable", "Secure EVM session cannot be issued")
		return
	}
	now := s.now().UTC().Truncate(time.Millisecond)
	issue := map[string]any{"sessionId": sessionID, "expiresAt": evmReadTime(now.Add(5 * time.Minute))}
	committed := false
	var committedSession string
	result, err := s.cfg.EVMReadAuthority.Invoke(r.Context(), map[string]any{"action": "issue", "proof": input.Proof, "expectedChallenge": json.RawMessage(challenge.ExactChallenge), "issue": issue, "at": evmReadTime(now)}, "issue", func(raw json.RawMessage) bool {
		var proposal struct {
			Nonce     string          `json:"nonce"`
			State     string          `json:"state"`
			RequestID string          `json:"requestId"`
			Session   json.RawMessage `json:"session"`
		}
		var bound struct {
			SessionID string    `json:"sessionId"`
			RequestID string    `json:"requestId"`
			Account   string    `json:"account"`
			ChainID   int       `json:"chainId"`
			IssuedAt  time.Time `json:"issuedAt"`
			ExpiresAt time.Time `json:"expiresAt"`
		}
		if json.Unmarshal(raw, &proposal) != nil || json.Unmarshal(proposal.Session, &bound) != nil || proposal.Nonce != challenge.Nonce || proposal.State != challenge.State || proposal.RequestID != challenge.RequestID || bound.SessionID != sessionID || bound.RequestID != challenge.RequestID || bound.Account != challenge.Account || bound.ChainID != 6423 {
			return false
		}
		record := EVMReadSessionRecord{SessionID: bound.SessionID, RequestID: bound.RequestID, Account: bound.Account, ExactSession: string(proposal.Session), IssuedAt: bound.IssuedAt, ExpiresAt: bound.ExpiresAt, ChainID: bound.ChainID, Connected: true}
		if s.service.Store.CommitEVMReadSession(record, challenge.Nonce, challenge.State, now) != nil {
			return false
		}
		committed = true
		committedSession = string(proposal.Session)
		return true
	})
	var issued struct {
		Kind    string          `json:"kind"`
		Session json.RawMessage `json:"session"`
	}
	if err != nil || !committed || json.Unmarshal(result, &issued) != nil || issued.Kind != "result" || string(issued.Session) != committedSession {
		writeError(w, http.StatusUnauthorized, "evm_read_rejected", "EVM signature, device binding or durable session issuance was rejected")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{"schemaVersion": "finance-evm-read-session-v1", "session": issued.Session, "evmAccountReadAuthorized": true, "privateFinanceAuthorized": false, "authorityModel": "last-verified-session", "extensionLiveStateAttested": false})
}

func evmReadProofFromHeader(r *http.Request) (json.RawMessage, string, string, time.Time, error) {
	values := r.Header.Values(evmReadProofHeader)
	if len(values) != 1 || len(values[0]) > maxWalletLoginChallengeBytes {
		return nil, "", "", time.Time{}, io.ErrUnexpectedEOF
	}
	raw, err := base64.RawURLEncoding.DecodeString(values[0])
	if err != nil || len(raw) == 0 || len(raw) > maxWalletLoginChallengeBytes {
		return nil, "", "", time.Time{}, io.ErrUnexpectedEOF
	}
	var selector struct {
		SessionID string `json:"sessionId"`
		Account   string `json:"account"`
		Nonce     string `json:"nonce"`
		ExpiresAt string `json:"expiresAt"`
	}
	if json.Unmarshal(raw, &selector) != nil || !evmReadToken.MatchString(selector.SessionID) || !accountaddress.IsCanonical(selector.Account) || !evmReadToken.MatchString(selector.Nonce) {
		return nil, "", "", time.Time{}, io.ErrUnexpectedEOF
	}
	expires, err := time.Parse("2006-01-02T15:04:05.000Z", selector.ExpiresAt)
	if err != nil || evmReadTime(expires) != selector.ExpiresAt {
		return nil, "", "", time.Time{}, io.ErrUnexpectedEOF
	}
	return json.RawMessage(raw), selector.SessionID, selector.Account, expires, nil
}

func (s *Server) evmReadPortfolio(w http.ResponseWriter, r *http.Request) {
	if !s.evmReadAvailable(w) {
		return
	}
	if !s.evmReadOriginAllowed(r) {
		writeError(w, http.StatusForbidden, "origin_not_allowed", "EVM account read requires the exact Finance browser origin")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1)
	if body, err := io.ReadAll(r.Body); err != nil || len(body) != 0 {
		writeError(w, http.StatusBadRequest, "invalid_evm_read_body", "EVM read request body must be empty")
		return
	}
	proof, sessionID, account, proofExpires, err := evmReadProofFromHeader(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "evm_read_proof_required", "A device-bound EVM read proof is required")
		return
	}
	session, err := s.service.Store.EVMReadSession(sessionID)
	if err != nil || session.Account != account || session.RevokedAt != nil || !session.ExpiresAt.After(s.now().UTC()) {
		writeError(w, http.StatusUnauthorized, "evm_read_session_unavailable", "EVM read session is absent, revoked or expired")
		return
	}
	target := r.RequestURI
	if target == "" {
		target = r.URL.RequestURI()
	}
	request := map[string]any{"origin": BrowserFinanceOrigin, "method": "GET", "target": target, "bodyDigest": evmReadEmptyBodyDigest, "requiredScope": "finance.account.read", "allowedTargets": []string{evmReadPortfolioPath}}
	authority := map[string]any{"currentAccount": session.Account, "currentChainId": session.ChainID, "connected": session.Connected, "revoked": false}
	committed := false
	result, err := s.cfg.EVMReadAuthority.Invoke(r.Context(), map[string]any{"action": "read", "proof": proof, "session": json.RawMessage(session.ExactSession), "request": request, "authority": authority, "at": evmReadTime(s.now().UTC().Truncate(time.Millisecond))}, "read", func(raw json.RawMessage) bool {
		var proposal struct {
			SessionID string `json:"sessionId"`
			Nonce     string `json:"nonce"`
			ExpiresAt string `json:"expiresAt"`
		}
		if json.Unmarshal(raw, &proposal) != nil || proposal.SessionID != sessionID || proposal.ExpiresAt != evmReadTime(proofExpires) {
			return false
		}
		var selected struct {
			Nonce string `json:"nonce"`
		}
		if json.Unmarshal(proof, &selected) != nil || proposal.Nonce != selected.Nonce {
			return false
		}
		if s.service.Store.ConsumeEVMReadProof(account, sessionID, proposal.Nonce, proofExpires, s.now().UTC()) != nil {
			return false
		}
		committed = true
		return true
	})
	var verified struct {
		Kind       string `json:"kind"`
		Authorized struct {
			Authorized bool   `json:"authorized"`
			Account    string `json:"account"`
			SessionID  string `json:"sessionId"`
		} `json:"authorized"`
	}
	if err != nil || !committed || json.Unmarshal(result, &verified) != nil || verified.Kind != "result" || !verified.Authorized.Authorized || verified.Authorized.Account != account || verified.Authorized.SessionID != sessionID {
		writeError(w, http.StatusUnauthorized, "evm_read_rejected", "EVM read proof was rejected")
		return
	}
	portfolio := s.service.Upstreams.Portfolio(r.Context(), account, nil)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"schemaVersion": "finance-evm-account-read-v1", "account": account, "portfolio": portfolio, "evmAccountReadAuthorized": true, "privateFinanceAuthorized": false, "authorityModel": "last-verified-session", "extensionLiveStateAttested": false, "sessionExpiresAt": evmReadTime(session.ExpiresAt)})
}

func (s *Server) evmReadRevoke(w http.ResponseWriter, r *http.Request) {
	if !s.evmReadAvailable(w) {
		return
	}
	if !s.evmReadOriginAllowed(r) {
		writeError(w, http.StatusForbidden, "origin_not_allowed", "EVM revoke requires the exact Finance browser origin")
		return
	}
	if target := r.URL.RequestURI(); target != evmReadRevokePath {
		writeError(w, http.StatusBadRequest, "invalid_evm_revoke_target", "EVM revoke target must be exact")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1)
	body, err := io.ReadAll(r.Body)
	if err != nil || len(body) != 0 {
		writeError(w, http.StatusBadRequest, "invalid_evm_revoke_body", "EVM revoke body must be empty and exactly signed")
		return
	}
	proof, sessionID, account, proofExpires, err := evmReadProofFromHeader(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "evm_revoke_proof_required", "A device-bound EVM revoke proof is required")
		return
	}
	session, err := s.service.Store.EVMReadSession(sessionID)
	if err != nil || session.Account != account || session.RevokedAt != nil || !session.ExpiresAt.After(s.now().UTC()) {
		writeError(w, http.StatusUnauthorized, "evm_read_session_unavailable", "EVM read session is absent, revoked or expired")
		return
	}
	committed := false
	result, err := s.cfg.EVMReadAuthority.Invoke(r.Context(), map[string]any{"action": "revoke", "proof": proof, "session": json.RawMessage(session.ExactSession), "request": map[string]any{"origin": BrowserFinanceOrigin, "method": "POST", "target": evmReadRevokePath, "bodyDigest": evmReadEmptyBodyDigest}, "at": evmReadTime(s.now().UTC().Truncate(time.Millisecond))}, "revoke", func(raw json.RawMessage) bool {
		var proposal struct {
			SessionID string `json:"sessionId"`
			Account   string `json:"account"`
			Nonce     string `json:"nonce"`
			ExpiresAt string `json:"expiresAt"`
		}
		if json.Unmarshal(raw, &proposal) != nil || proposal.SessionID != sessionID || proposal.Account != account || proposal.ExpiresAt != evmReadTime(proofExpires) {
			return false
		}
		var selected struct {
			Nonce string `json:"nonce"`
		}
		if json.Unmarshal(proof, &selected) != nil || proposal.Nonce != selected.Nonce {
			return false
		}
		if s.service.Store.RevokeEVMReadSession(account, sessionID, proposal.Nonce, proofExpires, s.now().UTC()) != nil {
			return false
		}
		committed = true
		return true
	})
	var verified struct {
		Kind    string `json:"kind"`
		Revoked struct {
			Revoked   bool   `json:"revoked"`
			Account   string `json:"account"`
			SessionID string `json:"sessionId"`
		} `json:"revoked"`
	}
	if err != nil || !committed || json.Unmarshal(result, &verified) != nil || verified.Kind != "result" || !verified.Revoked.Revoked || verified.Revoked.Account != account || verified.Revoked.SessionID != sessionID {
		writeError(w, http.StatusUnauthorized, "evm_revoke_rejected", "EVM revoke proof was rejected")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"schemaVersion": "finance-evm-read-revoke-v1", "revoked": true, "standardWalletUnchanged": true})
}
