// Package loadmetrics provides bounded local load-driver statistics. It does
// not decide whether an observation is an authenticated business final commit.
package loadmetrics

import (
	"errors"
	"time"
)

const (
	Resolution          = time.Millisecond
	LatencyLimit        = 60 * time.Second
	MaxSamples   uint64 = 1_000_000
	bucketCount         = int(LatencyLimit/Resolution) + 1
)

// Histogram is single-owner. At most 480,008 bytes of bucket storage are kept
// regardless of sample count. The final bucket retains all >=60s samples;
// they are never discarded or silently reported as exactly 60s.
type Histogram struct {
	buckets  [bucketCount]uint64
	samples  uint64
	min, max time.Duration
}

// Quantile is a closed interval containing the exact nearest-rank value.
// Ordinary buckets have width <1ms. Overflow buckets retain a wider interval,
// bounded above by the exact maximum observed duration. Valid=false means empty.
type Quantile struct {
	Valid    bool  `json:"valid"`
	LowerNs  int64 `json:"lowerNs"`
	UpperNs  int64 `json:"upperNs"`
	Overflow bool  `json:"overflow"`
}

type Distribution struct {
	Samples         uint64   `json:"samples"`
	ResolutionNs    int64    `json:"resolutionNs"`
	OverflowSamples uint64   `json:"overflowSamples"`
	MinNs           int64    `json:"minNs"`
	MaxNs           int64    `json:"maxNs"`
	P50             Quantile `json:"p50"`
	P95             Quantile `json:"p95"`
	P99             Quantile `json:"p99"`
}

func (h *Histogram) Add(duration time.Duration) error {
	if duration < 0 {
		return errors.New("negative monotonic duration")
	}
	if h.samples >= MaxSamples {
		return errors.New("latency sample bound exceeded")
	}
	bucket := int(duration / Resolution)
	if duration >= LatencyLimit {
		bucket = bucketCount - 1
	}
	if h.samples == 0 || duration < h.min {
		h.min = duration
	}
	if h.samples == 0 || duration > h.max {
		h.max = duration
	}
	h.buckets[bucket]++
	h.samples++
	return nil
}

func (h *Histogram) Summary() Distribution {
	out := Distribution{Samples: h.samples, ResolutionNs: int64(Resolution), OverflowSamples: h.buckets[bucketCount-1], MinNs: int64(h.min), MaxNs: int64(h.max)}
	if h.samples == 0 {
		return out
	}
	// Integer nearest ranks avoid float rounding and never select a zero sample.
	ranks := [3]uint64{(h.samples*50 + 99) / 100, (h.samples*95 + 99) / 100, (h.samples*99 + 99) / 100}
	values := [3]Quantile{}
	var seen uint64
	next := 0
	for bucket, count := range h.buckets {
		seen += count
		for next < len(ranks) && seen >= ranks[next] {
			lower := time.Duration(bucket) * Resolution
			upper := lower + Resolution - 1
			overflow := bucket == bucketCount-1
			if overflow {
				upper = h.max
			}
			// Tighten outermost bounds to actual observations without retaining samples.
			if lower < h.min {
				lower = h.min
			}
			if upper > h.max {
				upper = h.max
			}
			values[next] = Quantile{true, int64(lower), int64(upper), overflow}
			next++
		}
		if next == len(ranks) {
			break
		}
	}
	out.P50, out.P95, out.P99 = values[0], values[1], values[2]
	return out
}
