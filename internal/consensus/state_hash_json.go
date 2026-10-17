package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash"
)

// Encoder still constructs the complete compact JSON internally. Hash its
// borrowed write buffer directly, avoiding Marshal's additional owned copy.
// Exclude exactly Encoder's final framing newline: the canonical state hash
// remains SHA-256(json.Marshal(document)), including normal HTML escaping.
type committedStateHashWriter struct {
	digest hash.Hash
	wrote  bool
}

func (w *committedStateHashWriter) Write(payload []byte) (int, error) {
	if w.wrote || len(payload) < 2 || payload[len(payload)-1] != '\n' {
		return 0, errors.New("state hash encoder requires one newline-framed JSON value")
	}
	w.wrote = true
	w.digest = sha256.New()
	_, err := w.digest.Write(payload[:len(payload)-1])
	if err != nil {
		return 0, err
	}
	return len(payload), nil
}

func hashCommittedStateDocument(doc committedStateHashDocument) (string, error) {
	var writer committedStateHashWriter
	if err := json.NewEncoder(&writer).Encode(doc); err != nil {
		return "", err
	}
	if !writer.wrote || writer.digest == nil {
		return "", errors.New("state hash encoder produced no document")
	}
	return hex.EncodeToString(writer.digest.Sum(nil)), nil
}
