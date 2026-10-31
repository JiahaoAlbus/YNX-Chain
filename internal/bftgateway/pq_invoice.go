package bftgateway

import (
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// The complete original invoice and its signed history come from one current
// committed ABCI query. This endpoint observes the configured RPC; it does not
// manufacture transaction inclusion, independent finality or payment authority.
func (g *Gateway) handlePQInvoice(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.RawQuery != "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invoice query does not accept query parameters"})
		return
	}
	merchant, id := r.PathValue("merchant"), r.PathValue("invoice")
	// The consensus codec checks the canonical subject as well as every signed
	// prefix. Limit the route before issuing any RPC, including encoded slashes.
	_, subjectErr := ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceSettle, ynxauth.InvoiceSettlePayload{Merchant: merchant, InvoiceID: id, TermsHash: []byte{1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, Amount: 1})
	if subjectErr != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "canonical merchant and invoice ID are required"})
		return
	}
	var v consensus.PQInvoiceView
	h, err := g.queryPQWalletJSON(r.Context(), consensus.PQInvoiceQueryPath+merchant+"/"+id, &v)
	if err == nil {
		err = consensus.ValidatePQInvoiceView(v, merchant, id, h)
	}
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error(), "source": "comet-rpc"})
		return
	}
	writeJSON(w, http.StatusOK, v)
}
