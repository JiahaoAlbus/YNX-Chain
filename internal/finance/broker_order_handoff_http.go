package finance

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"time"
)

var errOpaqueAuthorityResponse = errors.New("confidential Wallet order authority returned an invalid result")

func brokerOpaqueRandomToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func (s *Server) brokerOpaqueAvailable(w http.ResponseWriter) bool {
	if s.cfg.BrokerOpaqueAuthority == nil {
		writeError(w, http.StatusServiceUnavailable, "broker_opaque_unavailable", "Confidential Wallet order handoff is unavailable; no new Wallet approval request was issued")
		return false
	}
	return true
}

func (s *Server) brokerOpaqueTicketHash(r *http.Request, ticket string) (string, error) {
	result, err := s.cfg.BrokerOpaqueAuthority.Invoke(r.Context(), map[string]any{
		"action": "ticket-hash", "ticket": ticket, "at": evmReadTime(s.now().UTC().Truncate(time.Millisecond)),
	}, "", nil)
	if err != nil {
		return "", err
	}
	var value struct {
		Kind       string `json:"kind"`
		TicketHash string `json:"ticketHash"`
	}
	if json.Unmarshal(result, &value) != nil || value.Kind != "result" || !brokerHandoffHex.MatchString(value.TicketHash) {
		return "", errOpaqueAuthorityResponse
	}
	return value.TicketHash, nil
}

func (s *Server) brokerOpaqueIssue(w http.ResponseWriter, r *http.Request, session Session) {
	if !s.brokerOpaqueAvailable(w) {
		return
	}
	var input brokerChallengeInput
	if err := decodeStrict(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Exact Broker Sandbox order draft required")
		return
	}
	if ValidateBrokerFeePolicy(s.cfg.BrokerMaxFeeUSD, s.cfg.BrokerFeeBoundSource, s.cfg.BrokerFeeEvidenceRef) != nil {
		writeError(w, http.StatusServiceUnavailable, "fee_bound_unavailable", "Server-side Sandbox fee bound is unavailable")
		return
	}
	order, err := BuildBrokerOrderDraft(input.Draft, s.cfg.BrokerMaxFeeUSD, s.cfg.BrokerFeeBoundSource)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_order_draft", err.Error())
		return
	}
	publicKey, err := s.service.Store.BrokerWalletPublicKey(session.Account)
	if err != nil || (input.AccountPublicKey != "" && input.AccountPublicKey != publicKey) {
		writeError(w, http.StatusConflict, "wallet_key_unavailable", "Current mapped Wallet key is unavailable")
		return
	}
	ticket, ticketErr := brokerOpaqueRandomToken()
	callbackState, stateErr := brokerOpaqueRandomToken()
	if ticketErr != nil || stateErr != nil {
		writeError(w, http.StatusServiceUnavailable, "random_unavailable", "Confidential ticket could not be created")
		return
	}
	ticketHash, err := s.brokerOpaqueTicketHash(r, ticket)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "broker_opaque_authority_unavailable", "Confidential ticket authority unavailable")
		return
	}
	challenge, err := s.service.Store.CreateBrokerOrderChallengeWithHandoff(session.Account, BrokerChallengeRequest{
		AccountPublicKey: publicKey, CallbackState: callbackState, Order: order, FeeEvidenceRef: s.cfg.BrokerFeeEvidenceRef,
		FeeBoundEstablished: true, Lifetime: 5 * time.Minute,
	}, ticketHash, s.now())
	if err != nil {
		writeError(w, http.StatusConflict, "challenge_rejected", "Confidential order challenge was not persisted")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	writeJSON(w, http.StatusCreated, map[string]any{"version": "2", "ticket": ticket, "ticketHash": ticketHash,
		"challenge": challenge.Unsigned, "serverTime": challenge.ServerTime, "providerWriteAttempted": false})
}

func brokerOpaqueRemoteHost(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) brokerOpaqueClaim(w http.ResponseWriter, r *http.Request) {
	if !s.brokerOpaqueAvailable(w) {
		return
	}
	if !s.allow("broker-opaque-claim:"+brokerOpaqueRemoteHost(r), http.MethodPost) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Confidential order claim rate limit exceeded")
		return
	}
	var input struct {
		Ticket string          `json:"ticket"`
		Claim  json.RawMessage `json:"claim"`
	}
	if decodeStrict(w, r, &input) != nil || len(input.Claim) == 0 || len(input.Claim) > 16<<10 {
		writeError(w, http.StatusBadRequest, "invalid_claim", "Exact signed Wallet ticket claim required")
		return
	}
	hash, err := s.brokerOpaqueTicketHash(r, input.Ticket)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "claim_rejected", "Confidential ticket rejected")
		return
	}
	record, challenge, err := s.service.Store.BrokerOrderHandoffAuthoritySnapshot(hash)
	if err != nil || !record.ExpiresAt.After(s.now().UTC()) {
		writeError(w, http.StatusUnauthorized, "claim_rejected", "Confidential ticket unavailable")
		return
	}
	result, err := s.cfg.BrokerOpaqueAuthority.Invoke(r.Context(), map[string]any{"action": "claim", "proof": input.Claim,
		"expected": map[string]any{"ticket": input.Ticket, "account": record.Account, "accountPublicKey": challenge.AccountPublicKey},
		"at":       evmReadTime(s.now().UTC().Truncate(time.Millisecond))}, "", nil)
	var verified struct {
		Kind       string `json:"kind"`
		Action     string `json:"action"`
		Verified   bool   `json:"verified"`
		TicketHash string `json:"ticketHash"`
		Account    string `json:"account"`
		Nonce      string `json:"nonce"`
	}
	if err != nil || json.Unmarshal(result, &verified) != nil || verified.Kind != "result" || verified.Action != "claim" || !verified.Verified || verified.TicketHash != hash || verified.Account != record.Account {
		writeError(w, http.StatusUnauthorized, "claim_rejected", "Signed Wallet ticket claim rejected")
		return
	}
	unsigned, err := s.service.Store.ClaimBrokerOrderHandoff(record.Account, hash, verified.Nonce, s.now())
	if err != nil || unsigned.RequestID != challenge.RequestID {
		writeError(w, http.StatusConflict, "claim_consumed", "Ticket claim was used or its owner changed")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"version": "2", "ticketHash": hash,
		"challenge": unsigned, "serverTime": evmReadTime(s.now().UTC().Truncate(time.Millisecond))})
}

func (s *Server) brokerOpaqueComplete(w http.ResponseWriter, r *http.Request) {
	if !s.brokerOpaqueAvailable(w) {
		return
	}
	if !s.allow("broker-opaque-complete:"+brokerOpaqueRemoteHost(r), http.MethodPost) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Confidential decision rate limit exceeded")
		return
	}
	var input struct {
		Ticket string          `json:"ticket"`
		Status string          `json:"status"`
		Proof  json.RawMessage `json:"proof"`
	}
	if decodeStrict(w, r, &input) != nil || len(input.Proof) == 0 || len(input.Proof) > 32<<10 {
		writeError(w, http.StatusBadRequest, "invalid_decision", "Exact signed Wallet decision required")
		return
	}
	hash, err := s.brokerOpaqueTicketHash(r, input.Ticket)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "decision_rejected", "Confidential ticket rejected")
		return
	}
	record, challenge, err := s.service.Store.BrokerOrderHandoffAuthoritySnapshot(hash)
	if err != nil || !record.ExpiresAt.After(s.now().UTC()) {
		writeError(w, http.StatusUnauthorized, "decision_rejected", "Confidential ticket unavailable")
		return
	}
	result, err := s.cfg.BrokerOpaqueAuthority.Invoke(r.Context(), map[string]any{"action": "complete", "ticket": input.Ticket,
		"status": input.Status, "proof": input.Proof, "challenge": challenge,
		"at": evmReadTime(s.now().UTC().Truncate(time.Millisecond))}, "", nil)
	var verified struct {
		Kind       string `json:"kind"`
		Action     string `json:"action"`
		Verified   bool   `json:"verified"`
		Status     string `json:"status"`
		TicketHash string `json:"ticketHash"`
		RequestID  string `json:"requestId"`
	}
	if err != nil || json.Unmarshal(result, &verified) != nil || verified.Kind != "result" || verified.Action != "complete" || !verified.Verified ||
		verified.Status != input.Status || verified.TicketHash != hash || verified.RequestID != record.RequestID {
		writeError(w, http.StatusUnauthorized, "decision_rejected", "Signed Wallet decision rejected")
		return
	}
	code, codeErr := brokerOpaqueRandomToken()
	if codeErr != nil {
		writeError(w, http.StatusServiceUnavailable, "random_unavailable", "One-time callback code could not be created")
		return
	}
	codeDigest := sha256.Sum256([]byte(code))
	stored, err := s.service.Store.StoreBrokerOrderHandoffDecision(record.Account, hash, verified.RequestID, verified.Status,
		challenge, input.Proof, hex.EncodeToString(codeDigest[:]), s.now())
	if err != nil {
		writeError(w, http.StatusConflict, "decision_conflict", "Confidential order decision was not stored")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	writeJSON(w, http.StatusOK, map[string]any{"version": "2", "ticketHash": hash, "requestId": stored.RequestID,
		"status": "stored", "code": code, "state": stored.CallbackState,
		"expiresAt": evmReadTime(stored.CodeExpiresAt), "serverTime": evmReadTime(s.now().UTC().Truncate(time.Millisecond))})
}

func (s *Server) brokerOpaqueRecoverLegacy(w http.ResponseWriter, r *http.Request) {
	if !s.brokerOpaqueAvailable(w) {
		return
	}
	if s.cfg.BrokerOpaqueLegacyCutoverAt.IsZero() {
		writeError(w, http.StatusServiceUnavailable, "legacy_recovery_not_enabled", "Pre-cutover recovery requires an operator-bound cutover")
		return
	}
	if !s.allow("broker-opaque-recover:"+brokerOpaqueRemoteHost(r), http.MethodPost) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Confidential recovery rate limit exceeded")
		return
	}
	var input struct {
		RequestID string          `json:"requestId"`
		Claim     json.RawMessage `json:"claim"`
	}
	if decodeStrict(w, r, &input) != nil || !evmSubjectRequestID.MatchString(input.RequestID) || len(input.Claim) == 0 || len(input.Claim) > 16<<10 {
		writeError(w, http.StatusBadRequest, "invalid_recovery", "Fresh signed legacy recovery proof required")
		return
	}
	var identity struct {
		Account   string `json:"account"`
		RequestID string `json:"requestId"`
	}
	if json.Unmarshal(input.Claim, &identity) != nil || identity.RequestID != input.RequestID || identity.Account == "" {
		writeError(w, http.StatusBadRequest, "invalid_recovery", "Legacy recovery identity is invalid")
		return
	}
	challenge, err := s.service.Store.legacyBrokerOrderRecoveryChallenge(identity.Account, identity.RequestID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "recovery_rejected", "Pre-cutover order unavailable")
		return
	}
	result, err := s.cfg.BrokerOpaqueAuthority.Invoke(r.Context(), map[string]any{"action": "recover-legacy", "proof": input.Claim,
		"challenge": challenge, "cutoverAt": evmReadTime(s.cfg.BrokerOpaqueLegacyCutoverAt.UTC().Truncate(time.Millisecond)),
		"at": evmReadTime(s.now().UTC().Truncate(time.Millisecond))}, "", nil)
	var verified struct {
		Kind      string `json:"kind"`
		Action    string `json:"action"`
		Verified  bool   `json:"verified"`
		Account   string `json:"account"`
		RequestID string `json:"requestId"`
		Nonce     string `json:"nonce"`
	}
	if err != nil || json.Unmarshal(result, &verified) != nil || verified.Kind != "result" || verified.Action != "recover-legacy" ||
		!verified.Verified || verified.Account != identity.Account || verified.RequestID != identity.RequestID || !brokerHandoffToken.MatchString(verified.Nonce) {
		writeError(w, http.StatusUnauthorized, "recovery_rejected", "Signed pre-cutover recovery rejected")
		return
	}
	ticket, err := brokerOpaqueRandomToken()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "random_unavailable", "Recovery ticket unavailable")
		return
	}
	ticketHash, err := s.brokerOpaqueTicketHash(r, ticket)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "broker_opaque_authority_unavailable", "Recovery ticket authority unavailable")
		return
	}
	if err := s.service.Store.RecoverLegacyBrokerOrderHandoff(identity.Account, identity.RequestID, ticketHash, challenge, s.now(), s.cfg.BrokerOpaqueLegacyCutoverAt); err != nil {
		writeError(w, http.StatusConflict, "recovery_conflict", "Pre-cutover order changed or was recovered")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	writeJSON(w, http.StatusCreated, map[string]any{"version": "2", "ticket": ticket, "ticketHash": ticketHash, "serverTime": evmReadTime(s.now().UTC().Truncate(time.Millisecond))})
}

func (s *Server) brokerOpaqueExchange(w http.ResponseWriter, r *http.Request, session Session) {
	if !s.brokerOpaqueAvailable(w) {
		return
	}
	var input struct {
		Code  string `json:"code"`
		State string `json:"state"`
	}
	if decodeStrict(w, r, &input) != nil || !brokerHandoffToken.MatchString(input.Code) || !brokerHandoffToken.MatchString(input.State) {
		writeError(w, http.StatusBadRequest, "invalid_callback", "Exact confidential Wallet callback required")
		return
	}
	codeDigest := sha256.Sum256([]byte(input.Code))
	record, challenge, err := s.service.Store.opaqueBrokerOrderCallbackAuthority(session.Account, hex.EncodeToString(codeDigest[:]))
	if err != nil || !record.CodeExpiresAt.After(s.now().UTC()) {
		writeError(w, http.StatusConflict, "callback_unavailable", "Confidential Wallet callback unavailable")
		return
	}
	parsed, err := s.cfg.BrokerOpaqueAuthority.Invoke(r.Context(), map[string]any{"action": "callback-parts", "code": input.Code, "state": input.State,
		"binding": record.CallbackStateBinding, "expected": map[string]string{"requestId": challenge.RequestID, "callbackStateHash": challenge.CallbackStateHash},
		"at": evmReadTime(s.now().UTC().Truncate(time.Millisecond))}, "", nil)
	var verified struct {
		Kind      string `json:"kind"`
		Action    string `json:"action"`
		RequestID string `json:"requestId"`
		Code      string `json:"code"`
		State     string `json:"state"`
	}
	if err != nil || json.Unmarshal(parsed, &verified) != nil || verified.Kind != "result" || verified.Action != "callback-parts" || verified.RequestID != record.RequestID {
		writeError(w, http.StatusUnauthorized, "callback_rejected", "Confidential Wallet callback rejected")
		return
	}
	result, err := s.service.Store.ExchangeBrokerOrderHandoff(session.Account, record.RequestID, verified.Code, verified.State, s.now())
	if err != nil {
		writeError(w, http.StatusConflict, "callback_consumed", "Confidential Wallet callback expired, changed or consumed")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	writeJSON(w, http.StatusOK, map[string]any{"version": "2", "status": result.Status, "result": result, "serverTime": evmReadTime(s.now().UTC().Truncate(time.Millisecond))})
}
