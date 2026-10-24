package main

import (
	"encoding/json"
	"io"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Initialization evidence only: it does not report a listening server, business
// execution, finality or later hash attempts. Reading freezes the process mode.
func writeStateHashEncodingStartup(writer io.Writer) error {
	mode, calls, failures := consensus.StateHashEncodingMeasurements()
	raw, err := json.Marshal(struct {
		Schema         int    `json:"schema"`
		Mode           string `json:"mode"`
		CachedAttempts uint64 `json:"cachedAttempts"`
		CachedErrors   uint64 `json:"cachedErrors"`
	}{1, mode, calls, failures})
	if err != nil {
		return err
	}
	frame := "YNX_ABCI_HASH_ENCODING " + string(raw) + "\n"
	n, err := io.WriteString(writer, frame)
	if err == nil && n != len(frame) {
		return io.ErrShortWrite
	}
	return err
}
