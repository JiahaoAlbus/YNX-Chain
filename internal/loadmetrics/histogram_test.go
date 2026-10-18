package loadmetrics

import (
	"sort"
	"testing"
	"time"
	"unsafe"
)

func TestHistogramBoundsContainExactNearestRanks(t *testing.T) {
	var h Histogram
	values := make([]time.Duration, 2048)
	seed := uint64(7)
	for i := range values {
		seed = seed*6364136223846793005 + 1
		values[i] = time.Duration(seed % uint64(75*time.Second))
		if err := h.Add(values[i]); err != nil {
			t.Fatal(err)
		}
	}
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	out := h.Summary()
	if out.Samples != uint64(len(values)) || out.MinNs != int64(values[0]) || out.MaxNs != int64(values[len(values)-1]) {
		t.Fatal("lost sample or exact extremum", out)
	}
	for i, p := range []int{50, 95, 99} {
		q := []Quantile{out.P50, out.P95, out.P99}[i]
		exact := int64(values[(len(values)*p+99)/100-1])
		if !q.Valid || exact < q.LowerNs || exact > q.UpperNs || (!q.Overflow && q.UpperNs-q.LowerNs >= int64(Resolution)) {
			t.Fatalf("P%d exact=%d outside %+v", p, exact, q)
		}
	}
}

func TestHistogramOverflowNotClampedOrExcluded(t *testing.T) {
	var h Histogram
	for i := 0; i < 19; i++ {
		if err := h.Add(time.Second); err != nil {
			t.Fatal(err)
		}
	}
	if err := h.Add(65 * time.Second); err != nil {
		t.Fatal(err)
	}
	s := h.Summary()
	if s.Samples != 20 || s.OverflowSamples != 1 || s.P95.Overflow || !s.P99.Overflow || s.P99.UpperNs != int64(65*time.Second) || s.P99.LowerNs <= int64(3*time.Second) {
		t.Fatal("tail was hidden", s)
	}
	var boundary Histogram
	if err := boundary.Add(LatencyLimit); err != nil {
		t.Fatal(err)
	}
	b := boundary.Summary()
	if !b.P50.Overflow || b.P50.LowerNs != int64(LatencyLimit) || b.P50.UpperNs != int64(LatencyLimit) {
		t.Fatal("overflow boundary differs", b)
	}
}

func TestHistogramEmptyInvalidAndSampleBounds(t *testing.T) {
	var h Histogram
	if s := h.Summary(); s.Samples != 0 || s.P50.Valid || s.P95.Valid || s.P99.Valid {
		t.Fatal("empty histogram invented percentiles")
	}
	if h.Add(-1) == nil || h.samples != 0 {
		t.Fatal("negative latency changed sample count")
	}
	h.samples = MaxSamples
	if h.Add(0) == nil || h.samples != MaxSamples || h.buckets[0] != 0 {
		t.Fatal("sample ceiling mutated counters")
	}
}

func TestHistogramTenMinuteSizedInputHasFixedStorageAndNoPerSampleAllocation(t *testing.T) {
	var h Histogram
	size := unsafe.Sizeof(h)
	for i := 0; i < 600_000; i++ {
		if err := h.Add(time.Duration(i%5000)*time.Millisecond + 987*time.Nanosecond); err != nil {
			t.Fatal(err)
		}
	}
	if unsafe.Sizeof(h) != size || size > 481_000 || h.Summary().Samples != 600_000 {
		t.Fatal("storage changed with lifetime history")
	}
	// This is a statistics component test, not 600k executed business transactions.
	allocations := testing.AllocsPerRun(1000, func() {
		if err := h.Add(time.Second); err != nil {
			panic(err)
		}
	})
	if allocations != 0 {
		t.Fatalf("per-sample allocations=%v", allocations)
	}
}
