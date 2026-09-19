package finance

import (
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
)

type brokerChallengeInput struct {
	AccountPublicKey string                `json:"accountPublicKey,omitempty"`
	Draft            BrokerOrderDraftInput `json:"draft"`
}

type brokerWatchlistInput struct {
	AssetID  string `json:"assetId"`
	Selected bool   `json:"selected"`
}

func (s *Server) brokerAssets(w http.ResponseWriter, r *http.Request) {
	query := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("query")))
	if len(query) > 64 {
		writeError(w, http.StatusBadRequest, "invalid_asset_query", "Asset search is limited to 64 characters")
		return
	}
	result, err := s.broker.Assets(r.Context())
	if err != nil {
		status := http.StatusBadGateway
		if brokerage.ErrorCode(err) == "BROKER_NOT_CONFIGURED" {
			status = http.StatusServiceUnavailable
		}
		writeError(w, status, strings.ToLower(brokerage.ErrorCode(err)), "Broker Sandbox assets are unavailable; no symbols were substituted")
		return
	}
	assets := make([]brokerage.Asset, 0, 25)
	for _, asset := range result.Assets {
		if !asset.Tradable || asset.Status != "active" || (query != "" && !strings.Contains(asset.Symbol, query) && !strings.Contains(strings.ToUpper(asset.Name), query)) {
			continue
		}
		assets = append(assets, asset)
	}
	sort.Slice(assets, func(i, j int) bool { return assets[i].Symbol < assets[j].Symbol })
	if len(assets) > 25 {
		assets = assets[:25]
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"schema": "ynx-finance-broker-assets-v1", "assets": assets, "query": query, "source": "alpaca_broker_sandbox", "officialSandboxVerified": false})
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

func (s *Server) brokerWatchlist(w http.ResponseWriter, r *http.Request, session Session) {
	var input brokerWatchlistInput
	if err := decodeStrict(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	assets, err := s.broker.Assets(r.Context())
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, strings.ToLower(brokerage.ErrorCode(err)), "Broker assets are unavailable; the watchlist was not changed")
		return
	}
	var selected brokerage.Asset
	for _, asset := range assets.Assets {
		if asset.ID == input.AssetID && asset.Tradable && asset.Status == "active" {
			selected = asset
			break
		}
	}
	if selected.ID == "" {
		writeError(w, http.StatusConflict, "asset_unavailable", "The selected Sandbox asset is not currently active and tradable")
		return
	}
	watchlist, err := s.service.Store.SetBrokerWatchlistItem(session.Account, BrokerWatchlistItem{AssetID: selected.ID, Symbol: selected.Symbol, Name: selected.Name}, input.Selected, s.now())
	if err != nil {
		writeError(w, http.StatusConflict, "watchlist_rejected", err.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"schema": "ynx-finance-broker-watchlist-v1", "watchlist": watchlist, "providerWriteAttempted": false})
}

func (s *Server) brokerReconcile(w http.ResponseWriter, r *http.Request, session Session) {
	dispatcher := BrokerDispatcher{Store: s.service.Store, Adapter: s.broker, Now: s.now}
	snapshot, err := dispatcher.Reconcile(r.Context(), session.Account)
	if err != nil {
		status := http.StatusBadGateway
		if code := brokerage.ErrorCode(err); code == "BROKER_NOT_CONFIGURED" || code == "ACCOUNT_NOT_LINKED" {
			status = http.StatusServiceUnavailable
		}
		writeError(w, status, strings.ToLower(brokerage.ErrorCode(err)), "Broker reconciliation is unavailable; local order state was not replaced")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"schema": "ynx-finance-broker-reconcile-v1", "snapshot": snapshot, "workspace": s.service.Store.BrokerWorkspace(session.Account, s.now()), "providerWriteAttempted": false})
}

func (s *Server) brokerCancelRequest(w http.ResponseWriter, r *http.Request, session Session) {
	orderID := strings.TrimSpace(r.PathValue("id"))
	if !financeUUIDv4Pattern.MatchString(orderID) {
		writeError(w, http.StatusBadRequest, "invalid_order_id", "A canonical Finance order id is required")
		return
	}
	record, err := s.service.Store.RequestBrokerCancel(session.Account, orderID, s.now())
	if err != nil {
		writeError(w, http.StatusConflict, "cancel_request_rejected", err.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusAccepted, map[string]any{"schema": "ynx-finance-broker-cancel-request-v1", "order": record, "providerWriteAttempted": false, "next": "operator_worker_cancel_once"})
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
	walletPublicKey, err := s.service.Store.BrokerWalletPublicKey(session.Account)
	if err != nil || (input.AccountPublicKey != "" && input.AccountPublicKey != walletPublicKey) {
		writeError(w, http.StatusConflict, "wallet_key_unavailable", "The owner mapping has no matching verified Wallet key; manual public-key entry is not accepted")
		return
	}
	challenge, err := s.service.Store.CreateBrokerOrderChallenge(session.Account, BrokerChallengeRequest{AccountPublicKey: walletPublicKey, Order: order, FeeEvidenceRef: s.cfg.BrokerFeeEvidenceRef, FeeBoundEstablished: true, Lifetime: 5 * time.Minute}, s.now())
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
