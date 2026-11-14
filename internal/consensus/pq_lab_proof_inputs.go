package consensus

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
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

// Keep the v1 JSON field order and its original base64 encoding. Only the
// history-sized base64 value is streamed; smaller fields use encoding/json.
func pqLabProofMaterialFrame(m PQLabProofMaterials) ([]byte, []byte, error) {
	n := len(m.Migration)
	if n > MaxPQLabProofMaterialsBytes {
		return nil, nil, errors.New("canonical migration exceeds the original lab proof frame")
	}
	m.Migration = nil
	raw, err := json.Marshal(m)
	if err != nil {
		return nil, nil, err
	}
	const prefix = `,"migration":`
	at := bytes.Index(raw, []byte(prefix+"null,"))
	if at < 0 {
		return nil, nil, errors.New("lab proof frame lacks its original migration field")
	}
	at += len(prefix)
	if len(raw)-4+2+base64.StdEncoding.EncodedLen(n) > MaxPQLabProofMaterialsBytes {
		return nil, nil, errors.New("public live proof materials exceed transport bound")
	}
	return raw[:at], raw[at+4:], nil
}

// Both the producer and the cold consumer use the same canonical encoder.
func writePQLabProofMaterialBytes(output io.Writer, head, migration, tail []byte) error {
	if _, err := output.Write(head); err != nil {
		return err
	}
	if _, err := io.WriteString(output, "\""); err != nil {
		return err
	}
	encoder := base64.NewEncoder(base64.StdEncoding, output)
	if _, err := encoder.Write(migration); err != nil {
		return err
	}
	if err := encoder.Close(); err != nil {
		return err
	}
	if _, err := io.WriteString(output, "\""); err != nil {
		return err
	}
	_, err := output.Write(tail)
	return err
}

func validPQLabProofMaterialFrame(raw []byte, m PQLabProofMaterials) bool {
	if m.Migration == nil {
		// Keep the existing v1 syntax for an unset member. Consumers that
		// verify proofs still require a nonempty complete migration.
		canonical, err := json.Marshal(m)
		return err == nil && bytes.Equal(raw, canonical)
	}
	head, tail, err := pqLabProofMaterialFrame(m)
	if err != nil {
		return false
	}
	got := pqLabCanonicalComparison{original: raw}
	return writePQLabProofMaterialBytes(&got, head, m.Migration, tail) == nil && got.offset == len(raw)
}
