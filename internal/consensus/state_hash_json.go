package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash"
	"io"
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
	// The first chunked candidate regressed the matched real-state benchmark.
	// Keep the measured baseline active; experiments are invoked explicitly.
	return hashSingleBufferDocument(doc)
}

func hashSingleBufferDocument(doc committedStateHashDocument) (string, error) {
	var writer committedStateHashWriter
	if err := json.NewEncoder(&writer).Encode(doc); err != nil {
		return "", err
	}
	if !writer.wrote || writer.digest == nil {
		return "", errors.New("state hash encoder produced no document")
	}
	return hex.EncodeToString(writer.digest.Sum(nil)), nil
}

const stateHashFeeChunk = 256

// Encode the unchanged surrounding document once, then encode the original
// ordered fee array in fixed-size chunks. No history or validation is omitted.
// The SHA receives exactly json.Marshal(doc), without any framing newline.
func hashFeeChunkedDocument(doc committedStateHashDocument) (string, error) {
	digest := sha256.New()
	if err := encodeFeeChunkedDocument(digest, doc); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func encodeFeeChunkedDocument(destination io.Writer, doc committedStateHashDocument) error {
	fees := doc.FeeEvents
	if len(fees) == 0 {
		raw, err := json.Marshal(doc)
		if err != nil {
			return err
		}
		return writeStateHashPiece(destination, raw)
	}
	doc.FeeEvents = []BFTFeeEvent{{}}
	writer := feeScaffoldHashWriter{destination: destination, fees: fees}
	return json.NewEncoder(&writer).Encode(doc)
}

type feeScaffoldHashWriter struct {
	destination io.Writer
	fees        []BFTFeeEvent
	wrote       bool
}

// Borrow Encoder's scaffold buffer during Write, avoiding Marshal's owned
// copy. A nested Encoder owns a different encode state until this Write ends.
func (w *feeScaffoldHashWriter) Write(raw []byte) (int, error) {
	if w.wrote || len(raw) < 3 || raw[len(raw)-1] != '\n' {
		return 0, errors.New("state hash scaffold requires one framed document")
	}
	w.wrote = true
	scaffold := raw[:len(raw)-1]
	start, end, err := feeArrayBounds(scaffold)
	if err != nil {
		return 0, err
	}
	if err := writeStateHashPiece(w.destination, scaffold[:start]); err != nil {
		return 0, err
	}
	if err := writeStateHashPiece(w.destination, []byte{'['}); err != nil {
		return 0, err
	}
	writer := feeChunkHashWriter{digest: w.destination, first: true}
	encoder := json.NewEncoder(&writer)
	for offset := 0; offset < len(w.fees); offset += stateHashFeeChunk {
		limit := offset + stateHashFeeChunk
		if limit > len(w.fees) {
			limit = len(w.fees)
		}
		if err := encoder.Encode(w.fees[offset:limit]); err != nil {
			return 0, err
		}
	}
	if err := writeStateHashPiece(w.destination, []byte{']'}); err != nil {
		return 0, err
	}
	if err := writeStateHashPiece(w.destination, scaffold[end:]); err != nil {
		return 0, err
	}
	return len(raw), nil
}

// Decode only top-level field boundaries. A string or nested field named
// feeEvents cannot be mistaken for the committed history array.
func feeArrayBounds(raw []byte) (int, int, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' || !json.Valid(raw) {
		return 0, 0, errors.New("state hash scaffold is not an object")
	}
	depth := 0
	for i := 0; i < len(raw); i++ {
		switch raw[i] {
		case '{', '[':
			depth++
		case '}', ']':
			depth--
		case '"':
			end := stateHashStringEnd(raw, i)
			if depth == 1 && bytes.Equal(raw[i:end], []byte(`"feeEvents"`)) {
				value := stateHashSkipSpace(raw, end)
				if value < len(raw) && raw[value] == ':' {
					value = stateHashSkipSpace(raw, value+1)
					if value >= len(raw) || raw[value] != '[' {
						return 0, 0, errors.New("state hash scaffold fee field is not an array")
					}
					level := 0
					for cursor := value; cursor < len(raw); cursor++ {
						switch raw[cursor] {
						case '"':
							cursor = stateHashStringEnd(raw, cursor) - 1
						case '{', '[':
							level++
						case '}', ']':
							level--
							if level == 0 {
								return value, cursor + 1, nil
							}
						}
					}
				}
			}
			i = end - 1
		}
	}
	return 0, 0, errors.New("state hash scaffold has no fee array")
}

// Input has already passed json.Valid; escaped quotes must not end a string.
func stateHashStringEnd(raw []byte, start int) int {
	for cursor := start + 1; cursor < len(raw); cursor++ {
		if raw[cursor] == '\\' {
			cursor++
			continue
		}
		if raw[cursor] == '"' {
			return cursor + 1
		}
	}
	return len(raw)
}

func stateHashSkipSpace(raw []byte, start int) int {
	for start < len(raw) && (raw[start] == ' ' || raw[start] == '\n' || raw[start] == '\r' || raw[start] == '\t') {
		start++
	}
	return start
}

type feeChunkHashWriter struct {
	digest io.Writer
	first  bool
}

func (w *feeChunkHashWriter) Write(raw []byte) (int, error) {
	if len(raw) < 4 || raw[0] != '[' || raw[len(raw)-2] != ']' || raw[len(raw)-1] != '\n' {
		return 0, errors.New("state hash fee chunk requires one newline-framed array")
	}
	if !w.first {
		if err := writeStateHashPiece(w.digest, []byte{','}); err != nil {
			return 0, err
		}
	}
	w.first = false
	if err := writeStateHashPiece(w.digest, raw[1:len(raw)-2]); err != nil {
		return 0, err
	}
	return len(raw), nil
}

func writeStateHashPiece(destination io.Writer, payload []byte) error {
	written, err := destination.Write(payload)
	if err == nil && written != len(payload) {
		return io.ErrShortWrite
	}
	return err
}
