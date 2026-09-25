package finance

import (
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

const (
	evmSubjectIdentityPath = "/api/evm-subject/identity"
	evmSubjectRevokePath   = "/api/evm-subject/revoke"
	evmSubjectProofHeader  = "X-YNX-EVM-Subject-Proof"
)

func (s *Server) evmSubjectAvailable(w http.ResponseWriter) bool {
	if s.cfg.EVMSubjectAuthority == nil {
		writeError(w, http.StatusServiceUnavailable, "evm_subject_unavailable", "EVM-only private read is unavailable; Standard Wallet remains available")
		return false
	}
	return true
}

func (s *Server) evmSubjectChallenge(w http.ResponseWriter, r *http.Request) {
	if !s.evmSubjectAvailable(w) {
		return
	}
	if !s.evmReadOriginAllowed(r) {
		writeError(w, http.StatusForbidden, "origin_not_allowed", "Exact Finance origin required")
		return
	}
	var input struct {
		Account     string `json:"account"`
		AccountType string `json:"accountType"`
		DeviceID    string `json:"deviceId"`
		DeviceKey   string `json:"deviceKey"`
	}
	if decodeStrict(w, r, &input) != nil || !accountaddress.IsCanonical(input.Account) || (input.AccountType != "eoa" && input.AccountType != "contract") {
		writeError(w, http.StatusBadRequest, "invalid_evm_subject_challenge", "Canonical EVM account, type and device key required")
		return
	}
	remoteHost, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remoteHost = r.RemoteAddr
	}
	if !s.allow("evm-subject-challenge:"+remoteHost+":"+input.Account, http.MethodPost) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "rate_limited", "EVM subject challenge rate limit exceeded")
		return
	}
	nonce, nonceErr := evmReadRandomToken()
	state, stateErr := evmReadRandomToken()
	requestToken, requestErr := evmReadRandomToken()
	if nonceErr != nil || stateErr != nil || requestErr != nil {
		writeError(w, http.StatusServiceUnavailable, "random_unavailable", "Secure EVM challenge cannot be issued")
		return
	}
	now := s.now().UTC().Truncate(time.Millisecond)
	expires := now.Add(5 * time.Minute)
	requestID := "finance-evm-subject-" + requestToken
	challengeInput := map[string]any{
		"version": "1", "productId": "finance", "subjectNamespace": "evm", "origin": BrowserFinanceOrigin,
		"callback": BrowserFinanceOrigin + "/wallet-auth/callback", "chainId": 6423, "account": input.Account,
		"accountType": input.AccountType, "scope": "finance.evm.private.read", "deviceId": input.DeviceID,
		"deviceAlgorithm": "p256-sha256", "deviceKey": input.DeviceKey, "nonce": nonce,
		"state": state, "requestId": requestID, "issuedAt": evmReadTime(now), "expiresAt": evmReadTime(expires),
	}
	result, err := s.cfg.EVMSubjectAuthority.Invoke(r.Context(), map[string]any{"action": "create", "challenge": challengeInput}, "", nil)
	var issued struct {
		Kind           string          `json:"kind"`
		Challenge      json.RawMessage `json:"challenge"`
		SigningRequest struct {
			Method  string   `json:"method"`
			Params  []string `json:"params"`
			Message string   `json:"message"`
		} `json:"signingRequest"`
	}
	if err != nil || json.Unmarshal(result, &issued) != nil || issued.Kind != "result" || issued.SigningRequest.Method != "personal_sign" || len(issued.SigningRequest.Params) != 2 || issued.SigningRequest.Params[1] != input.Account || issued.SigningRequest.Message == "" {
		writeError(w, http.StatusServiceUnavailable, "evm_subject_authority_unavailable", "EVM subject challenge authority unavailable")
		return
	}
	record := EVMSubjectChallengeRecord{RequestID: requestID, Nonce: nonce, State: state, Account: input.Account, AccountType: input.AccountType, ExactChallenge: string(issued.Challenge), IssuedAt: now, ExpiresAt: expires}
	if s.service.Store.PutEVMSubjectChallenge(record, now) != nil {
		writeError(w, http.StatusConflict, "evm_subject_challenge_not_persisted", "Challenge was not persisted")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{"schemaVersion": "finance-evm-subject-challenge-v1", "challenge": issued.Challenge, "signingRequest": issued.SigningRequest, "brokerAuthorized": false})
}

func (s *Server) evmSubjectIssueSession(w http.ResponseWriter, r *http.Request) {
	if !s.evmSubjectAvailable(w) {
		return
	}
	if !s.evmReadOriginAllowed(r) {
		writeError(w, http.StatusForbidden, "origin_not_allowed", "Exact Finance origin required")
		return
	}
	var input struct {
		Proof json.RawMessage `json:"proof"`
	}
	if decodeStrict(w, r, &input) != nil || len(input.Proof) == 0 || len(input.Proof) > maxWalletLoginChallengeBytes {
		writeError(w, http.StatusBadRequest, "invalid_evm_subject_proof", "Exact EVM-only login proof required")
		return
	}
	var selector struct {
		Challenge struct {
			Account   string `json:"account"`
			RequestID string `json:"requestId"`
		} `json:"challenge"`
	}
	if json.Unmarshal(input.Proof, &selector) != nil || !accountaddress.IsCanonical(selector.Challenge.Account) || !evmSubjectRequestID.MatchString(selector.Challenge.RequestID) {
		writeError(w, http.StatusUnauthorized, "evm_subject_rejected", "Proof does not select a server-issued challenge")
		return
	}
	challenge, err := s.service.Store.EVMSubjectChallenge(selector.Challenge.Account, selector.Challenge.RequestID)
	if err != nil || challenge.ConsumedAt != nil || !challenge.ExpiresAt.After(s.now().UTC()) {
		writeError(w, http.StatusUnauthorized, "evm_subject_rejected", "Challenge is absent, consumed or expired")
		return
	}
	if s.service.Store.ReserveEVMSubjectVerification(challenge.Account, challenge.RequestID, challenge.Nonce, s.now().UTC()) != nil {
		writeError(w, http.StatusTooManyRequests, "evm_subject_attempts_exhausted", "Challenge attempts exhausted")
		return
	}
	sessionID, err := evmReadRandomToken()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "random_unavailable", "Secure EVM session cannot be issued")
		return
	}
	subjectID, err := DeriveFinanceEVMSubjectID(challenge.Account)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "evm_subject_rejected", "EVM subject identity invalid")
		return
	}
	now := s.now().UTC().Truncate(time.Millisecond)
	issue := map[string]any{"sessionId": sessionID, "subjectId": subjectID, "expiresAt": evmReadTime(challenge.ExpiresAt)}
	committed := false
	var committedSession string
	result, err := s.cfg.EVMSubjectAuthority.Invoke(r.Context(), map[string]any{"action": "issue", "proof": input.Proof, "expectedChallenge": json.RawMessage(challenge.ExactChallenge), "issue": issue, "at": evmReadTime(now)}, "issue", func(raw json.RawMessage) bool {
		var proposal struct {
			Nonce     string          `json:"nonce"`
			State     string          `json:"state"`
			RequestID string          `json:"requestId"`
			Session   json.RawMessage `json:"session"`
		}
		var bound struct {
			SessionID   string    `json:"sessionId"`
			SubjectID   string    `json:"subjectId"`
			Account     string    `json:"account"`
			AccountType string    `json:"accountType"`
			IssuedAt    time.Time `json:"issuedAt"`
			ExpiresAt   time.Time `json:"expiresAt"`
		}
		if json.Unmarshal(raw, &proposal) != nil || json.Unmarshal(proposal.Session, &bound) != nil || proposal.Nonce != challenge.Nonce || proposal.State != challenge.State || proposal.RequestID != challenge.RequestID || bound.SessionID != sessionID || bound.SubjectID != subjectID || bound.Account != challenge.Account || bound.AccountType != challenge.AccountType {
			return false
		}
		record := EVMSubjectSessionRecord{SessionID: bound.SessionID, RequestID: challenge.RequestID, SubjectID: bound.SubjectID, Account: bound.Account, AccountType: bound.AccountType, ExactSession: string(proposal.Session), IssuedAt: bound.IssuedAt, ExpiresAt: bound.ExpiresAt}
		if s.service.Store.CommitEVMSubjectSession(record, challenge.Nonce, challenge.State, now) != nil {
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
		writeError(w, http.StatusUnauthorized, "evm_subject_rejected", "EVM wallet/device proof or durable issuance rejected")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{"schemaVersion": "finance-evm-subject-session-v1", "session": issued.Session, "evmSubjectReadAuthorized": true, "nativeAccount": nil, "brokerAuthorized": false})
}

func evmSubjectProofFromHeader(r *http.Request) (json.RawMessage, string, string, string, string, time.Time, error) {
	values := r.Header.Values(evmSubjectProofHeader)
	if len(values) != 1 || len(values[0]) > maxWalletLoginChallengeBytes {
		return nil, "", "", "", "", time.Time{}, io.ErrUnexpectedEOF
	}
	raw, err := base64.RawURLEncoding.DecodeString(values[0])
	if err != nil || len(raw) == 0 || len(raw) > maxWalletLoginChallengeBytes {
		return nil, "", "", "", "", time.Time{}, io.ErrUnexpectedEOF
	}
	var selected struct {
		SessionID string `json:"sessionId"`
		SubjectID string `json:"subjectId"`
		Account   string `json:"account"`
		Nonce     string `json:"nonce"`
		ExpiresAt string `json:"expiresAt"`
	}
	if json.Unmarshal(raw, &selected) != nil || !evmReadToken.MatchString(selected.SessionID) || !accountaddress.IsCanonical(selected.Account) || !evmReadToken.MatchString(selected.Nonce) {
		return nil, "", "", "", "", time.Time{}, io.ErrUnexpectedEOF
	}
	subjectID, err := DeriveFinanceEVMSubjectID(selected.Account)
	if err != nil || subjectID != selected.SubjectID {
		return nil, "", "", "", "", time.Time{}, io.ErrUnexpectedEOF
	}
	expires, err := time.Parse("2006-01-02T15:04:05.000Z", selected.ExpiresAt)
	if err != nil || evmReadTime(expires) != selected.ExpiresAt {
		return nil, "", "", "", "", time.Time{}, io.ErrUnexpectedEOF
	}
	return raw, selected.SessionID, selected.SubjectID, selected.Account, selected.Nonce, expires, nil
}

func (s *Server) evmSubjectIdentity(w http.ResponseWriter, r *http.Request) {
	if !s.evmSubjectAvailable(w) {
		return
	}
	if !s.evmReadOriginAllowed(r) {
		writeError(w, http.StatusForbidden, "origin_not_allowed", "Exact Finance origin required")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1)
	if body, err := io.ReadAll(r.Body); err != nil || len(body) != 0 {
		writeError(w, http.StatusBadRequest, "invalid_evm_subject_body", "Read body must be empty")
		return
	}
	proof, sessionID, subjectID, account, nonce, proofExpires, err := evmSubjectProofFromHeader(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "evm_subject_proof_required", "Device-bound EVM-only proof required")
		return
	}
	session, err := s.service.Store.EVMSubjectSession(sessionID)
	if err != nil || session.Account != account || session.SubjectID != subjectID || session.RevokedAt != nil || !session.ExpiresAt.After(s.now().UTC()) {
		writeError(w, http.StatusUnauthorized, "evm_subject_session_unavailable", "Session absent, revoked or expired")
		return
	}
	target := r.RequestURI
	if target == "" {
		target = r.URL.RequestURI()
	}
	digest := sha256.Sum256(nil)
	request := map[string]any{"origin": BrowserFinanceOrigin, "method": "GET", "target": target, "bodyDigest": hex.EncodeToString(digest[:]), "requiredScope": "finance.evm.private.read", "allowedTargets": []string{evmSubjectIdentityPath}}
	committed := false
	result, err := s.cfg.EVMSubjectAuthority.Invoke(r.Context(), map[string]any{"action": "read", "proof": proof, "session": json.RawMessage(session.ExactSession), "request": request, "at": evmReadTime(s.now().UTC().Truncate(time.Millisecond))}, "read", func(raw json.RawMessage) bool {
		var proposal struct {
			SessionID string `json:"sessionId"`
			SubjectID string `json:"subjectId"`
			Account   string `json:"account"`
			Nonce     string `json:"nonce"`
			ExpiresAt string `json:"expiresAt"`
		}
		if json.Unmarshal(raw, &proposal) != nil || proposal.SessionID != sessionID || proposal.SubjectID != subjectID || proposal.Account != account || proposal.Nonce != nonce || proposal.ExpiresAt != evmReadTime(proofExpires) {
			return false
		}
		if s.service.Store.ConsumeEVMSubjectReadProof(account, subjectID, sessionID, nonce, proofExpires, s.now().UTC()) != nil {
			return false
		}
		committed = true
		return true
	})
	var verified struct {
		Kind       string `json:"kind"`
		Authorized struct {
			Authorized bool   `json:"authorized"`
			SubjectID  string `json:"subjectId"`
			Account    string `json:"account"`
			SessionID  string `json:"sessionId"`
		} `json:"authorized"`
	}
	if err != nil || !committed || json.Unmarshal(result, &verified) != nil || verified.Kind != "result" || !verified.Authorized.Authorized || verified.Authorized.SubjectID != subjectID || verified.Authorized.Account != account || verified.Authorized.SessionID != sessionID {
		writeError(w, http.StatusUnauthorized, "evm_subject_rejected", "Private read proof rejected")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"schemaVersion": "finance-evm-subject-identity-v1", "subjectId": subjectID, "evmAccount": account, "nativeAccount": nil, "brokerAuthorized": false, "sessionExpiresAt": evmReadTime(session.ExpiresAt)})
}

func (s *Server) evmSubjectRevoke(w http.ResponseWriter, r *http.Request) {
	if !s.evmSubjectAvailable(w) {
		return
	}
	if !s.evmReadOriginAllowed(r) || r.URL.RequestURI() != evmSubjectRevokePath {
		writeError(w, http.StatusForbidden, "origin_or_target_not_allowed", "Exact Finance revoke origin and target required")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1)
	if body, err := io.ReadAll(r.Body); err != nil || len(body) != 0 {
		writeError(w, http.StatusBadRequest, "invalid_evm_subject_body", "Revoke body must be empty")
		return
	}
	proof, sessionID, subjectID, account, nonce, _, err := evmSubjectProofFromHeader(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "evm_subject_proof_required", "Device-bound revoke proof required")
		return
	}
	session, err := s.service.Store.EVMSubjectSession(sessionID)
	if err != nil || session.Account != account || session.SubjectID != subjectID || session.RevokedAt != nil || !session.ExpiresAt.After(s.now().UTC()) {
		writeError(w, http.StatusUnauthorized, "evm_subject_session_unavailable", "Session absent, revoked or expired")
		return
	}
	committed := false
	result, err := s.cfg.EVMSubjectAuthority.Invoke(r.Context(), map[string]any{"action": "revoke", "proof": proof, "session": json.RawMessage(session.ExactSession), "request": map[string]any{"origin": BrowserFinanceOrigin, "method": "POST", "target": evmSubjectRevokePath, "bodyDigest": evmReadEmptyBodyDigest}, "at": evmReadTime(s.now().UTC().Truncate(time.Millisecond))}, "revoke", func(raw json.RawMessage) bool {
		var proposal struct {
			SessionID string `json:"sessionId"`
			SubjectID string `json:"subjectId"`
			Account   string `json:"account"`
			Nonce     string `json:"nonce"`
		}
		if json.Unmarshal(raw, &proposal) != nil || proposal.SessionID != sessionID || proposal.SubjectID != subjectID || proposal.Account != account || proposal.Nonce != nonce {
			return false
		}
		if s.service.Store.RevokeEVMSubjectSession(account, subjectID, sessionID, nonce, s.now().UTC()) != nil {
			return false
		}
		committed = true
		return true
	})
	var verified struct {
		Kind    string `json:"kind"`
		Revoked struct {
			Revoked   bool   `json:"revoked"`
			SessionID string `json:"sessionId"`
			SubjectID string `json:"subjectId"`
		} `json:"revoked"`
	}
	if err != nil || !committed || json.Unmarshal(result, &verified) != nil || verified.Kind != "result" || !verified.Revoked.Revoked || verified.Revoked.SessionID != sessionID || verified.Revoked.SubjectID != subjectID {
		writeError(w, http.StatusUnauthorized, "evm_subject_rejected", "Revoke proof rejected")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"schemaVersion": "finance-evm-subject-revoke-v1", "revoked": true, "standardWalletUnchanged": true})
}
