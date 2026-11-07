//go:build unix

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Same optional timing envelope as live-materials. Without --timings the
// original public result bytes and errors are unchanged. A result remains on
// disk on failed stdout; timing never creates or repeats an operation.
func writePQLabStartupResult(out io.Writer, value any, callErr error, start time.Time, metrics *consensus.PQLabMetrics) error {
	if callErr != nil {
		if metrics == nil {
			return callErr
		}
		measured, _ := json.Marshal(struct {
			Version, Outcome string
			CalleeElapsedNS  int64
			Timings          consensus.PQLabMetricsSnapshot
		}{"YNX-PQ-LAB-CALLEE-FAILURE/v1", "REFUSED_OR_UNKNOWN_NO_RETRY", time.Since(start).Nanoseconds(), metrics.Snapshot()})
		return fmt.Errorf("%w; elapsed=%s", callErr, measured)
	}
	if metrics == nil {
		return json.NewEncoder(out).Encode(value)
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var reply map[string]json.RawMessage
	if err = json.Unmarshal(raw, &reply); err != nil {
		return err
	}
	reply["calleeElapsedNs"], err = json.Marshal(time.Since(start).Nanoseconds())
	if err != nil {
		return err
	}
	reply["timings"], err = json.Marshal(metrics.Snapshot())
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(reply)
}
