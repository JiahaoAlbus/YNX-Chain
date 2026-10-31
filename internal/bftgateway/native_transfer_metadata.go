package bftgateway

import (
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func (g *Gateway) handleNativeTransferMetadata(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.RawQuery != "" || r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "native transfer metadata accepts no query or request body"})
		return
	}
	// The existing bounded ABCI identity query binds all original genesis and
	// native chain fields to one committed observation. It supplies no trust.
	identity, err := g.pqIdentityQuery(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	metadata, err := chain.NewNativeTransferMetadata(identity.NativeChainID, identity.NativeGenesisHash)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"metadata": metadata,
		"source": "configured-abci-bootstrap", "identity": identity, "independentFinality": false})
}
