package consensus

import (
	"bytes"
	"encoding/json"
	"errors"
)

// The prepared decoder already owns and normalizes this closed native state.
// Reuse the existing exact-byte fee encoder and standard indenter without a
// full compact-history buffer. This never changes the state hash backend.
func encodePreparedNativeStateJSON(state CommittedState) ([]byte, error) {
	if len(state.FeeEvents) == 0 {
		return encodeCommittedStateJSON(state)
	}
	fees := state.FeeEvents
	state.FeeEvents = []BFTFeeEvent{{}}
	writer := preparedFeeSnapshotWriter{fees: fees}
	if err := json.NewEncoder(&writer).Encode(state); err != nil {
		return nil, err
	}
	if !writer.wrote {
		return nil, errors.New("prepared state encoder produced no JSON value")
	}
	return writer.payload, nil
}

type preparedFeeSnapshotWriter struct {
	fees    []BFTFeeEvent
	payload []byte
	wrote   bool
}

func (w *preparedFeeSnapshotWriter) Write(raw []byte) (int, error) {
	if w.wrote || len(w.fees) == 0 || len(raw) < 3 || raw[len(raw)-1] != '\n' {
		return 0, errors.New("prepared snapshot requires one framed JSON scaffold")
	}
	w.wrote = true
	var scaffold committedStateJSONBuffer
	if _, err := scaffold.Write(raw); err != nil {
		return 0, err
	}
	pretty := scaffold.buffer.Bytes()
	start, end, err := feeArrayBounds(pretty)
	if err != nil {
		return 0, err
	}
	var out bytes.Buffer
	// A capacity hint only, never a history/byte acceptance limit.
	out.Grow(len(pretty) + len(w.fees)*768)
	_, _ = out.Write(pretty[:start])
	_, _ = out.WriteString("[\n")
	var clock feeJSONTimeCache
	encoded := make([]byte, 0, 1024)
	for index, event := range w.fees {
		encoded, err = appendCachedFeeJSON(encoded[:0], event, &clock)
		if err != nil {
			return 0, err
		}
		_, _ = out.WriteString("    ")
		if err = json.Indent(&out, encoded, "    ", "  "); err != nil {
			return 0, err
		}
		if index+1 < len(w.fees) {
			_ = out.WriteByte(',')
		}
		_ = out.WriteByte('\n')
	}
	_, _ = out.WriteString("  ]")
	_, _ = out.Write(pretty[end:])
	w.payload = out.Bytes()
	return len(raw), nil
}
