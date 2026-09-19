package finance

import (
	"net/http"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
)

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

// Public capability/configuration diagnostics only, never account IDs, balances,
// credentials or live provider calls. Wallet connection remains independent.
func (s *Server) brokerStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"schema": "ynx-finance-broker-status-v1", "status": s.cfg.BrokerConfig.Status(),
		"walletOrderApproval": "frozen_contract_internal_only_no_public_submit_route",
		"durableOrderJournal": "implemented_state_v2", "providerPost": "disabled_unwired",
		"accountLink": "requires_authenticated_persistent_mapping", "marketData": "not_verified",
		"funding": "simulated_USD_only_no_YNXT_conversion",
	})
}
