package contribution

import (
	"context"
	"encoding/binary"
	"time"
)

// independentHistogram is the receipt verifier's Go implementation. It neither
// calls the WASM worker nor trusts any worker counters. This task counts bytes
// of a bounded public JSON object, not block-header or transaction validity.
func independentHistogram(ctx context.Context, input []byte, cpu uint64) ([]byte, Usage, error) {
	var usage Usage
	if len(input) == 0 || len(input) > HistogramMaxInputBytes || cpu == 0 || cpu > 1000 {
		return nil, usage, ErrLimit
	}
	var counts [256]uint32
	start := time.Now()
	var active time.Duration
	for pos := 0; pos < len(input); {
		if err := ctx.Err(); err != nil {
			usage.WallMicros = uint64(time.Since(start).Microseconds())
			return nil, usage, err
		}
		end := pos + chunkBytes
		if end > len(input) {
			end = len(input)
		}
		before := time.Now()
		for _, b := range input[pos:end] {
			counts[b]++
		}
		active += time.Since(before)
		usage.BytesRead += uint64(end - pos)
		pos = end
		delay := time.Duration(int64(active)*1000/int64(cpu)) - time.Since(start)
		if delay > 0 {
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				if !timer.Stop() {
					<-timer.C
				}
				usage.WallMicros = uint64(time.Since(start).Microseconds())
				return nil, usage, ctx.Err()
			case <-timer.C:
			}
		}
	}
	usage.WallMicros = uint64(time.Since(start).Microseconds())
	if err := ctx.Err(); err != nil {
		return nil, usage, err
	}
	output := make([]byte, HistogramOutputBytes)
	for i, n := range counts {
		binary.LittleEndian.PutUint32(output[i*4:], n)
	}
	return output, usage, nil
}
