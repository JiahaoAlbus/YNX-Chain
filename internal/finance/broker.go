package finance

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
)

type brokerChallengeInput struct {
	AccountPublicKey string                `json:"accountPublicKey"`
	Draft            BrokerOrderDraftInput `json:"draft"`
}

func (s *Server) brokerQuote(w http.ResponseWriter, r *http.Request) {
	quote, err := s.broker.Quote(r.Context(), r.URL.Query().Get("symbol"))
	if err != nil {
		code := brokerage.ErrorCode(err)
		status := http.StatusBadGateway
		if code == "BROKER_NOT_CONFIGURED" {
			status = http.StatusServiceUnavailable
		} else if code == "MARKET_DATA_REQUEST_INVALID" {
			status = http.StatusBadRequest
		}
		writeError(w, status, strings.ToLower(code), "Sandbox quote is unavailable; no price was substituted")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"schema": "ynx-finance-broker-quote-v1", "quote": quote, "source": "alpaca_market_data_sandbox", "officialSandboxVerified": false})
}

func (s *Server) brokerSnapshot(w http.ResponseWriter, r *http.Request, session Session) {
	snapshot, err := s.broker.Reconcile(r.Context(), session.Account, s.service.Store)
	if err != nil {
		code := brokerage.ErrorCode(err)
		status := http.StatusBadGateway
		if code == "BROKER_NOT_CONFIGURED" || code == "ACCOUNT_NOT_LINKED" {
			status = http.StatusServiceUnavailable
		}
		writeError(w, status, strings.ToLower(code), "Broker Sandbox data is unavailable; no balance, position, or order was substituted")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"schema": "ynx-finance-broker-snapshot-v1", "snapshot": snapshot, "officialSandboxVerified": false, "source": "provider_read_through"})
}

func (s *Server) brokerOrders(w http.ResponseWriter, _ *http.Request, session Session) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"schema": "ynx-finance-broker-workspace-v1", "workspace": s.service.Store.BrokerWorkspace(session.Account, s.now()), "providerWriteAttempted": false})
}

func (s *Server) brokerChallenge(w http.ResponseWriter, r *http.Request, session Session) {
	var input brokerChallengeInput
	if err := decodeStrict(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	order, err := BuildBrokerOrderDraft(input.Draft, s.cfg.BrokerMaxFeeUSD, s.cfg.BrokerFeeBoundSource)
	if err != nil || strings.TrimSpace(s.cfg.BrokerFeeEvidenceRef) == "" {
		writeError(w, http.StatusServiceUnavailable, "fee_bound_unavailable", "A trusted server-side Sandbox fee bound is unavailable; no Wallet approval request was created")
		return
	}
	challenge, err := s.service.Store.CreateBrokerOrderChallenge(session.Account, BrokerChallengeRequest{AccountPublicKey: input.AccountPublicKey, Order: order, FeeEvidenceRef: s.cfg.BrokerFeeEvidenceRef, FeeBoundEstablished: true, Lifetime: 5 * time.Minute}, s.now())
	if err != nil {
		writeError(w, http.StatusConflict, "challenge_rejected", err.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{"schema": "ynx-finance-order-approval-challenge-v1", "challenge": challenge, "providerWriteAttempted": false})
}

func (s *Server) brokerCallback(w http.ResponseWriter, r *http.Request, session Session) {
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_callback", "Finance approval callback exceeds the exact transport limit")
		return
	}
	callback, err := ParseFinanceOrderApprovalCallbackV1(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_callback", err.Error())
		return
	}
	var result any
	switch callback.Status {
	case "approved":
		result, err = s.service.Store.VerifyAndConsumeBrokerOrder(session.Account, *callback.Approval, s.now())
	case "rejected":
		result, err = s.service.Store.RejectBrokerOrder(session.Account, callback.RequestID, callback.CallbackStateHash, s.now())
	case "revoked":
		result, err = s.service.Store.RevokeBrokerOrder(session.Account, *callback.Revocation, s.now())
	default:
		err = errors.New("Finance approval callback status is unsupported")
	}
	if err != nil {
		writeError(w, http.StatusConflict, "callback_rejected", err.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"schema": "ynx-finance-order-approval-consume-v1", "status": callback.Status, "result": result, "providerWriteAttempted": false})
}

// Public capability/configuration diagnostics only, never account IDs, balances,
// credentials or live provider calls. Wallet connection remains independent.
func (s *Server) brokerStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"schema": "ynx-finance-broker-status-v1", "status": s.cfg.BrokerConfig.Status(),
		"walletOrderApproval": "frozen_contract_internal_only_no_public_submit_route",
		"durableOrderJournal": "implemented_state_v2", "providerPost": "operator_worker_only_not_public",
		"accountLink": "requires_authenticated_persistent_mapping", "marketData": "not_verified",
		"funding": "simulated_USD_only_no_YNXT_conversion",
	})
}
