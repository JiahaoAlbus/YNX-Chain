package api

import "net/http"

func (s *Server) handleNativeTransferMetadata(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.RawQuery != "" || r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
		writeError(w, http.StatusBadRequest, "native transfer metadata accepts no query or request body")
		return
	}
	metadata, err := s.devnet.NativeTransferMetadata()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"metadata": metadata,
		"source": "native-ledger-config-and-genesis", "independentFinality": false})
}
