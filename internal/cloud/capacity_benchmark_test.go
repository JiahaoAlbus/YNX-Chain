package cloud

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sort"
	"testing"
	"time"
)

func syntheticMetadataService(n int) *Service {
	state := newState()
	now := time.Unix(1_800_000_000, 0).UTC()
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("obj_%07d", i)
		state.Objects[id] = Object{ID: id, Owner: owner, Kind: KindFile, Name: id + ".bin", Size: 1024, Hash: "0000000000000000000000000000000000000000000000000000000000000000", Version: 1, CreatedAt: now, UpdatedAt: now}
	}
	return &Service{cfg: Config{Now: func() time.Time { return now }, QuotaBytes: 1 << 60}, state: state, cancels: map[string]context.CancelFunc{}}
}

func benchmarkMetadataService(b *testing.B, n int) *Service {
	b.Helper()
	b.StopTimer()
	s := syntheticMetadataService(n)
	b.Cleanup(func() { s = nil })
	b.StartTimer()
	return s
}

func TestMillionObjectCapacityProfile(t *testing.T) {
	if os.Getenv("YNX_CAPACITY_PROFILE") != "1" {
		t.Skip("set YNX_CAPACITY_PROFILE=1 for the explicit capacity profile")
	}
	const samples = 100
	s := syntheticMetadataService(1_000_000)
	durations := make([]int64, 0, samples)
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	started := time.Now()
	for i := 0; i < samples; i++ {
		at := time.Now()
		page, err := s.ListPage(owner, ListOptions{Limit: 200})
		if err != nil || len(page.Items) != 200 || page.Scanned != 1_000_000 {
			t.Fatalf("sample %d: %#v %v", i, page, err)
		}
		durations = append(durations, time.Since(at).Nanoseconds())
	}
	elapsed := time.Since(started)
	runtime.ReadMemStats(&after)
	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	percentile := func(p float64) int64 {
		index := int(float64(samples)*p+0.999999) - 1
		if index < 0 {
			index = 0
		}
		if index >= samples {
			index = samples - 1
		}
		return durations[index]
	}
	result := map[string]any{"schemaVersion": 1, "objects": 1_000_000, "pageSize": 200, "samples": samples, "p50Milliseconds": float64(percentile(.50)) / 1e6, "p95Milliseconds": float64(percentile(.95)) / 1e6, "p99Milliseconds": float64(percentile(.99)) / 1e6, "minMilliseconds": float64(durations[0]) / 1e6, "maxMilliseconds": float64(durations[len(durations)-1]) / 1e6, "pagesPerSecond": float64(samples) / elapsed.Seconds(), "totalAllocatedBytes": after.TotalAlloc - before.TotalAlloc, "heapObjectDelta": int64(after.HeapObjects) - int64(before.HeapObjects), "goVersion": runtime.Version(), "goos": runtime.GOOS, "goarch": runtime.GOARCH, "gomaxprocs": runtime.GOMAXPROCS(0), "coverage": "single-process in-memory metadata scan; excludes persistence, network, provider and multi-user contention"}
	encoded, _ := json.Marshal(result)
	t.Log(string(encoded))
}

func BenchmarkMetadataListOneMillion(b *testing.B) {
	s := benchmarkMetadataService(b, 1_000_000)
	b.ReportMetric(1_000_000, "objects/op")
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		page, err := s.ListPage(owner, ListOptions{Limit: 200})
		if err != nil || len(page.Items) != 200 || page.Scanned != 1_000_000 || page.NextCursor == "" {
			b.Fatalf("list page: %#v %v", page, err)
		}
	}
}

func BenchmarkMetadataGetFromOneMillion(b *testing.B) {
	s := benchmarkMetadataService(b, 1_000_000)
	b.ReportMetric(1_000_000, "resident_objects")
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		id := fmt.Sprintf("obj_%07d", i%1_000_000)
		if _, err := s.Get(owner, id); err != nil {
			b.Fatal(err)
		}
	}
}
