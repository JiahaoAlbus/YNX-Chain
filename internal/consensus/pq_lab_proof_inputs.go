package consensus

import (
	"bytes"
	"errors"
)

// Compare the complete normal canonical stream to the supplied original. This
// neither computes a replacement authority hash nor retains another history-
// sized serialization. Full validation remains in WriteDetachedCanonicalJSON.
type pqLabCanonicalComparison struct {
	original []byte
	offset   int
}

func (w *pqLabCanonicalComparison) Write(p []byte) (int, error) {
	if len(p) > len(w.original)-w.offset || !bytes.Equal(p, w.original[w.offset:w.offset+len(p)]) {
		return 0, errors.New("noncanonical original migration")
	}
	w.offset += len(p)
	return len(p), nil
}
