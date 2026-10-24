package consensus

import (
	"encoding/json"
	"errors"
)

// Encoder owns this buffer until Write returns. The visitor must finish all
// payload use synchronously and must not retain the borrowed slice. Exclude only
// Encoder's framing newline, preserving the original json.Marshal byte contract.
func visitBlockCheckpointPayload(state CommittedState, visit func([]byte) error) error {
	writer := blockCheckpointPayloadWriter{visit: visit}
	if err := json.NewEncoder(&writer).Encode(blockJournalRecord{Kind: "checkpoint", Snapshot: &state}); err != nil {
		return err
	}
	if !writer.wrote {
		return errors.New("checkpoint encoder produced no payload")
	}
	return nil
}

type blockCheckpointPayloadWriter struct {
	visit func([]byte) error
	wrote bool
}

func (w *blockCheckpointPayloadWriter) Write(payload []byte) (int, error) {
	if w.wrote || len(payload) < 2 || payload[len(payload)-1] != '\n' {
		return 0, errors.New("checkpoint encoder requires one newline-framed value")
	}
	w.wrote = true
	if err := w.visit(payload[:len(payload)-1]); err != nil {
		return 0, err
	}
	return len(payload), nil
}
