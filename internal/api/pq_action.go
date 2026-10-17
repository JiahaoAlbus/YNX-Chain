package api

import (
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func (s *Server) handlePQAction(w http.ResponseWriter, r *http.Request) {
	wire, ok := readPQBody(w, r, chain.MaxPQActionMemberBytes)
	if !ok {
		return
	}
	tx, replayed, err := s.devnet.SubmitPQAction(wire)
	decimal := s.pqDecimalFields(tx)
	if err != nil {
		if writePQUncertainMutation(w, tx, err, decimal) {
			return
		}
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"transaction": tx, "wireHash": tx.Hash, "decimalFields": decimal, "replayed": replayed, "status": "accepted"})
}
