package cloud

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func benchmarkMetadataService(b *testing.B, n int) *Service {
	b.Helper()
	b.StopTimer()
	state := newState()
	now := time.Unix(1_800_000_000, 0).UTC()
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("obj_%07d", i)
		state.Objects[id] = Object{ID: id, Owner: owner, Kind: KindFile, Name: id + ".bin", Size: 1024, Hash: "0000000000000000000000000000000000000000000000000000000000000000", Version: 1, CreatedAt: now, UpdatedAt: now}
	}
	s := &Service{cfg: Config{Now: func() time.Time { return now }, QuotaBytes: 1 << 60}, state: state, cancels: map[string]context.CancelFunc{}}
	b.Cleanup(func() { s = nil })
	b.StartTimer()
	return s
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
