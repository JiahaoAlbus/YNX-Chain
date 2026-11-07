//go:build unix

package consensus

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestPQLabSenderHeldInputStatsOriginalCountsAndNoCacheGrowth(t *testing.T) {
	var public *os.File
	if path := os.Getenv("YNX_PQ_HELD_INPUT_FOOTPRINT_OUT"); path != "" {
		var err error
		public, err = os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			t.Fatal(err)
		}
		defer public.Close()
	}
	for _, large := range []bool{false, true} {
		p, pin, _ := checkpointReadFixture(t, 1)
		if large {
			raw, err := os.ReadFile(p.MigrationFile)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(p.MigrationFile, append(bytes.Repeat([]byte(" "), 33<<20), raw...), 0600); err != nil {
				t.Fatal(err)
			}
		}
		actual, err := heldStatsOriginalCheckpoint(p.Nodes[0].StatePath)
		if err != nil {
			t.Fatal(err)
		}
		s := NewPQLabSenderCheckpointSource()
		t.Cleanup(func() { _ = s.Close() })
		if _, err := s.Load(p.RootDir, pin, "", actual.Height, actual.AppHash, nil); err != nil {
			t.Fatal(err)
		}
		before := s.CacheStats()
		stats := s.SourceStats()
		var originals []*proofHostOriginal
		if large {
			originals = s.inputs.uncached.originals
		} else {
			originals = s.cache.entry.originals
		}
		var originalBytes int64
		for _, f := range originals {
			raw, err := os.ReadFile(f.path)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(raw, f.raw) {
				t.Fatal("fixture changed original file")
			}
			originalBytes += int64(len(raw))
		}
		if stats.StaticOriginalFiles != 12 || stats.StaticOriginalBytes != originalBytes || stats.ActivationOriginalFiles != 0 || stats.ActivationOriginalBytes != 0 || !stats.SnapshotOnly {
			t.Fatal("actual retained original footprint differs", stats)
		}
		if large {
			if stats.State != "INVOCATION_HELD" || stats.CacheAdmissionReason != "BYTE_BOUND" || stats.CacheRetained || stats.StaticOriginalBytes <= 32<<20 || before.Entries != 0 || before.OriginalBytes != 0 {
				t.Fatal("uncached held inputs confused with empty originals or enlarged cache", stats, before)
			}
		} else if stats.State != "CACHE_ENTRY" || stats.CacheAdmissionReason != "WITHIN_BOUNDS" || !stats.CacheRetained || stats.StaticOriginalBytes != before.OriginalBytes {
			t.Fatal("normal cache footprint differs", stats, before)
		}
		if after := s.CacheStats(); !reflect.DeepEqual(before, after) {
			t.Fatal("observation modified cache admission", before, after)
		}
		raw, err := json.Marshal(stats)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(raw, []byte(p.RootDir)) || bytes.Contains(raw, []byte(pin)) {
			t.Fatal("footprint exposed original paths or source identity")
		}
		if public != nil {
			if err := json.NewEncoder(public).Encode(map[string]any{"sourceInputs": stats, "staticCache": before}); err != nil {
				t.Fatal(err)
			}
		}
		if err := s.Close(); err != nil {
			t.Fatal(err)
		}
		closed := s.SourceStats()
		if closed.State != "CLOSED" || closed.StaticOriginalFiles != 0 || closed.StaticOriginalBytes != 0 || closed.ActivationOriginalFiles != 0 || closed.CacheRetained {
			t.Fatal("closed source reported retained originals", closed)
		}
	}
}

func TestPQLabSenderHeldInputStatsNeverLoadsOrValidatesSources(t *testing.T) {
	var missing *PQLabSenderCheckpointSource
	s := NewPQLabSenderCheckpointSource()
	defer s.Close()
	before := s.CacheStats()
	if !reflect.DeepEqual(missing.SourceStats(), s.SourceStats()) || !reflect.DeepEqual(before, s.CacheStats()) || s.inputs != nil {
		t.Fatal("diagnostic implicitly loaded or changed source")
	}
	p, pin, _ := checkpointReadFixture(t, 1)
	actual, err := heldStatsOriginalCheckpoint(p.Nodes[0].StatePath)
	if err != nil {
		t.Fatal(err)
	}
	cp, err := s.Load(p.RootDir, pin, "", actual.Height, actual.AppHash, nil)
	if err != nil {
		t.Fatal(err)
	}
	before = s.CacheStats()
	footprint := s.SourceStats()
	raw, err := os.ReadFile(p.MigrationFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p.MigrationFile, append(raw, ' '), 0600); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(footprint, s.SourceStats()) {
		t.Fatal("memory snapshot pretended to check external file changes")
	}
	if cp.current() == nil {
		t.Fatal("unchanged diagnostic footprint granted current checkpoint permission")
	}
	if !reflect.DeepEqual(before, s.CacheStats()) {
		t.Fatal("diagnostic changed cache counters")
	}
}

func heldStatsOriginalCheckpoint(path string) (CommittedState, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return CommittedState{}, err
	}
	var state CommittedState
	err = json.Unmarshal(raw, &state)
	return state, err
}
