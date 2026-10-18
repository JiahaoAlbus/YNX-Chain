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
	if len(doc.FeeEvents) > stateHashFeeChunk {
		return hashFeeChunkedDocument(doc)
	}
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

// Marshal the unchanged surrounding document once, then encode the original
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
	scaffold, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	start, end, err := feeArrayBounds(scaffold)
	if err != nil {
		return err
	}
	if err := writeStateHashPiece(destination, scaffold[:start]); err != nil {
		return err
	}
	if err := writeStateHashPiece(destination, []byte{'['}); err != nil {
		return err
	}
	writer := feeChunkHashWriter{digest: destination, first: true}
	encoder := json.NewEncoder(&writer)
	for offset := 0; offset < len(fees); offset += stateHashFeeChunk {
		limit := offset + stateHashFeeChunk
		if limit > len(fees) {
			limit = len(fees)
		}
		if err := encoder.Encode(fees[offset:limit]); err != nil {
			return err
		}
	}
	if err := writeStateHashPiece(destination, []byte{']'}); err != nil {
		return err
	}
	return writeStateHashPiece(destination, scaffold[end:])
}

// Decode only top-level field boundaries. A string or nested field named
// feeEvents cannot be mistaken for the committed history array.
func feeArrayBounds(raw []byte) (int, int, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return 0, 0, errors.New("state hash scaffold is not an object")
	}
	for decoder.More() {
		name, err := decoder.Token()
		if err != nil {
			return 0, 0, err
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return 0, 0, err
		}
		if name == "feeEvents" {
			if len(value) < 2 || value[0] != '[' || value[len(value)-1] != ']' {
				return 0, 0, errors.New("state hash scaffold fee field is not an array")
			}
			end := int(decoder.InputOffset())
			return end - len(value), end, nil
		}
	}
	return 0, 0, errors.New("state hash scaffold has no fee array")
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
