package social

import (
	"bytes"
	"io"
	"net/http"
	"unicode/utf8"
)

// encoding/json repairs invalid UTF-8. Reject it before decoding a signed
// contact intent, so the stored note cannot differ from the actual wire text.
func decodeContactIntent(w http.ResponseWriter, r *http.Request, in *contactRequestDiscoveryInput) bool {
	const limit = 16 * 1024
	body := http.MaxBytesReader(w, r.Body, limit)
	raw, err := io.ReadAll(body)
	body.Close()
	if err != nil || !utf8.Valid(raw) {
		writeError(w, http.StatusBadRequest, "invalid contact request encoding or size")
		return false
	}
	r.Body = io.NopCloser(bytes.NewReader(raw))
	return decodeRequest(w, r, in, limit)
}
