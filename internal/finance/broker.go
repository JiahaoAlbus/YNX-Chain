package finance

import "net/http"

// Public capability/configuration diagnostics only, never account IDs, balances,
// credentials or live provider calls. Wallet connection remains independent.
func (s *Server) brokerStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"schema": "ynx-finance-broker-status-v1", "status": s.cfg.BrokerConfig.Status(), "walletOrderApproval": "unsupported_pending_shared_protocol", "accountLink": "not_configured", "marketData": "not_verified", "funding": "simulated_USD_only_no_YNXT_conversion"})
}
