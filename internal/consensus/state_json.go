package consensus

import (
	"bytes"
	"encoding/json"
	"errors"
)

// Encoder passes its encoded value directly to this writer, avoiding Marshal's
// extra owned copy of the compact JSON before indentation. Indent preserves the
// Encoder's trailing newline, matching the existing snapshot format exactly.
type committedStateJSONBuffer struct {
	buffer bytes.Buffer
	wrote  bool
}

func (w *committedStateJSONBuffer) Write(payload []byte) (int, error) {
	// Encode currently writes one complete value. Fail closed if a future
	// encoder changes that behavior; never return a partially framed snapshot.
	if w.wrote {
		return 0, errors.New("committed state encoder wrote multiple JSON fragments")
	}
	w.wrote = true
	if err := json.Indent(&w.buffer, payload, "", "  "); err != nil {
		return 0, err
	}
	return len(payload), nil
}

func encodeCommittedStateJSON(state CommittedState) ([]byte, error) {
	var writer committedStateJSONBuffer
	if err := json.NewEncoder(&writer).Encode(state); err != nil {
		return nil, err
	}
	if !writer.wrote {
		return nil, errors.New("committed state encoder produced no JSON value")
	}
	return writer.buffer.Bytes(), nil
}
