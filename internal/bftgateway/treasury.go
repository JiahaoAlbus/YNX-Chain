package bftgateway

import (
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func (g *Gateway) handleTreasurySnapshot(w http.ResponseWriter, r *http.Request) {
	var snapshot consensus.BFTTreasurySnapshot
	if err := g.queryABCIJSON(r.Context(), "/treasury/snapshot", &snapshot); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error(), "source": "ynx-consensus-abci", "failure": true})
		return
	}
	if snapshot.Source != "ynx-consensus-abci" || !snapshot.Reconciled || snapshot.TransferExecutionEnabled || snapshot.SecretMarketSupport {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "Treasury snapshot violated fail-closed invariants", "source": "ynx-consensus-abci", "failure": true})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schemaVersion": 1, "source": snapshot.Source, "asOf": map[string]any{"blockHeight": snapshot.AsOfBlockHeight}, "version": snapshot.PolicyVersion, "coverage": map[string]any{"balances": "exact_configured_accounts_only", "counterparties": snapshot.CounterpartyCoverage, "runway": snapshot.RunwayCoverage}, "failure": false, "treasury": snapshot})
}
