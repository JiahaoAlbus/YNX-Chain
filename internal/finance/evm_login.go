package finance

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

const financeEVMLoginScope = "finance.account.read"

func (s *Server) walletLoginChallenge(w http.ResponseWriter, r *http.Request) {
	if s.cfg.EVMLoginAuthority == nil {
		writeError(w, http.StatusServiceUnavailable, "wallet_login_unavailable", "Wallet identity verification is not configured; Standard Wallet remains available")
		return
	}
	origin := r.Header.Get("Origin")
	if origin == "" || !s.originAllowed(r) {
		writeError(w, http.StatusForbidden, "origin_not_allowed", "Wallet login requires a registered browser origin")
		return
	}
	parsedOrigin, err := url.Parse(origin)
	if err != nil || parsedOrigin.Scheme != "https" || parsedOrigin.Host == "" || parsedOrigin.Path != "" || parsedOrigin.User != nil || parsedOrigin.RawQuery != "" || parsedOrigin.Fragment != "" {
		writeError(w, http.StatusForbidden, "origin_not_allowed", "Wallet login requires a canonical HTTPS origin")
		return
	}
	var input struct {
		Account      string `json:"account"`
		ProviderKind string `json:"providerKind"`
	}
	if err := decodeStrict(w, r, &input); err != nil || !accountaddress.IsCanonical(input.Account) || (input.ProviderKind != "ynx-wallet" && input.ProviderKind != "metamask") {
		writeError(w, http.StatusBadRequest, "invalid_wallet_login", "A selected canonical EVM account and Wallet provider are required")
		return
	}
	remoteHost, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remoteHost = r.RemoteAddr
	}
	if !s.allow("wallet-login:"+remoteHost+":"+input.Account, http.MethodPost) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Wallet login challenge rate limit exceeded")
		return
	}
	nonceBytes, requestBytes := make([]byte, 16), make([]byte, 16)
	if _, err := rand.Read(nonceBytes); err != nil {
		writeError(w, http.StatusServiceUnavailable, "random_unavailable", "Wallet login cannot issue a secure challenge")
		return
	}
	if _, err := rand.Read(requestBytes); err != nil {
		writeError(w, http.StatusServiceUnavailable, "random_unavailable", "Wallet login cannot issue a secure challenge")
		return
	}
	now := s.now().UTC().Truncate(time.Millisecond)
	expires := now.Add(5 * time.Minute)
	requestID := "finance-login-" + hex.EncodeToString(requestBytes)
	challengeInput := map[string]any{
		"domain": parsedOrigin.Host, "uri": origin + "/auth/wallet", "account": input.Account,
		"accountType": "eoa", "chainId": 6423, "nonce": hex.EncodeToString(nonceBytes),
		"issuedAt": now.Format("2006-01-02T15:04:05.000Z"), "notBefore": now.Format("2006-01-02T15:04:05.000Z"),
		"expirationTime": expires.Format("2006-01-02T15:04:05.000Z"), "requestId": requestID,
		"statement": "Sign in to YNX Finance.", "productId": "finance", "scopes": []string{financeEVMLoginScope},
		"providerKind": input.ProviderKind,
	}
	issued, err := s.cfg.EVMLoginAuthority.Create(r.Context(), challengeInput)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "wallet_login_authority_unavailable", "Wallet login challenge authority is unavailable")
		return
	}
	var canonical struct {
		Account        string `json:"account"`
		Nonce          string `json:"nonce"`
		RequestID      string `json:"requestId"`
		ProviderKind   string `json:"providerKind"`
		ExpirationTime string `json:"expirationTime"`
	}
	if json.Unmarshal(issued.Challenge, &canonical) != nil || canonical.Account != input.Account || canonical.Nonce != challengeInput["nonce"] || canonical.RequestID != requestID || canonical.ProviderKind != input.ProviderKind || canonical.ExpirationTime != challengeInput["expirationTime"] || len(issued.SigningRequest.Params) != 2 || issued.SigningRequest.Params[1] != input.Account {
		writeError(w, http.StatusServiceUnavailable, "wallet_login_authority_invalid", "Wallet login authority did not preserve the issued binding")
		return
	}
	record := WalletLoginChallengeRecord{RequestID: requestID, Nonce: canonical.Nonce, Account: input.Account, ExactChallenge: string(issued.Challenge), IssuedAt: now, ExpiresAt: expires}
	if err := s.service.Store.PutWalletLoginChallenge(record, now); err != nil {
		writeError(w, http.StatusConflict, "wallet_login_challenge_not_persisted", "Wallet login challenge could not be persisted")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{"schemaVersion": "finance-evm-login-challenge-v1", "challenge": json.RawMessage(issued.Challenge), "signingRequest": issued.SigningRequest, "privateFinanceAuthorized": false})
}

func (s *Server) walletLoginVerify(w http.ResponseWriter, r *http.Request) {
	if s.cfg.EVMLoginAuthority == nil {
		writeError(w, http.StatusServiceUnavailable, "wallet_login_unavailable", "Wallet identity verification is not configured; Standard Wallet remains available")
		return
	}
	if r.Header.Get("Origin") == "" || !s.originAllowed(r) {
		writeError(w, http.StatusForbidden, "origin_not_allowed", "Wallet login requires a registered browser origin")
		return
	}
	var input struct {
		Proof json.RawMessage `json:"proof"`
	}
	if err := decodeStrict(w, r, &input); err != nil || len(input.Proof) == 0 || len(input.Proof) > maxWalletLoginChallengeBytes {
		writeError(w, http.StatusBadRequest, "invalid_wallet_login", "An exact Wallet login proof is required")
		return
	}
	var selector struct {
		Challenge struct {
			Account   string `json:"account"`
			RequestID string `json:"requestId"`
		} `json:"challenge"`
	}
	if json.Unmarshal(input.Proof, &selector) != nil || !accountaddress.IsCanonical(selector.Challenge.Account) || !walletLoginRequestID.MatchString(selector.Challenge.RequestID) {
		writeError(w, http.StatusUnauthorized, "wallet_login_rejected", "Wallet login proof does not select an issued challenge")
		return
	}
	remoteHost, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remoteHost = r.RemoteAddr
	}
	if !s.allow("wallet-login-verify:"+remoteHost+":"+selector.Challenge.Account, http.MethodPost) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Wallet login verification rate limit exceeded")
		return
	}
	record, err := s.service.Store.WalletLoginChallenge(selector.Challenge.Account, selector.Challenge.RequestID)
	if err != nil || record.ConsumedAt != nil || !record.ExpiresAt.After(s.now().UTC()) {
		writeError(w, http.StatusUnauthorized, "wallet_login_rejected", "Wallet login challenge is missing, consumed, or expired")
		return
	}
	var issuedOrigin struct {
		URI string `json:"uri"`
	}
	if json.Unmarshal([]byte(record.ExactChallenge), &issuedOrigin) != nil || issuedOrigin.URI != r.Header.Get("Origin")+"/auth/wallet" {
		writeError(w, http.StatusForbidden, "origin_not_allowed", "Wallet login proof must return from its issued origin")
		return
	}
	verified, err := s.cfg.EVMLoginAuthority.Verify(r.Context(), input.Proof, json.RawMessage(record.ExactChallenge), s.now().UTC())
	if err != nil || verified.Account != record.Account || verified.RequestID != record.RequestID || verified.Nonce != record.Nonce || verified.ProductID != "finance" || verified.ChainID != 6423 || verified.AccountType != "eoa" || len(verified.Scopes) != 1 || verified.Scopes[0] != financeEVMLoginScope || (verified.ProviderKind != "ynx-wallet" && verified.ProviderKind != "metamask") {
		writeError(w, http.StatusUnauthorized, "wallet_login_rejected", "Wallet login signature or exact binding was rejected")
		return
	}
	if err := s.service.Store.ConsumeWalletLoginChallenge(record.Account, record.RequestID, record.Nonce, s.now().UTC()); err != nil {
		writeError(w, http.StatusConflict, "wallet_login_replay", "Wallet login challenge was already consumed or expired")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"schemaVersion": "finance-evm-login-verification-v1", "verified": true, "account": verified.Account, "providerKind": verified.ProviderKind, "chainId": verified.ChainID, "scopes": verified.Scopes, "requestId": verified.RequestID, "privateFinanceAuthorized": false, "standardWalletUnchanged": true, "message": "Wallet identity was verified once. Private Finance still requires its separate Product Session."})
}
