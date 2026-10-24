package main

import (
	"reflect"
	"runtime"
	"testing"
	"weak"
)

func TestNativeStreamingFinishedReaderReleasesActualCachesAndPreservesStats(t *testing.T) {
	for _, release := range []bool{false, true} {
		name := "original_defer_retains_cache"
		if release {
			name = "finished_before_evidence_readback"
		}
		t.Run(name, func(t *testing.T) {
			reader, _, path, _, _, _ := currentInputFixture(t)
			before := reader.stats()
			if before.ReaderBudget == nil || before.ReaderBudget.CachedInputBytes == 0 || before.TransactionVerifications != 2 {
				t.Fatal("real signed caches were not populated")
			}
			readerWeak := weak.Make(reader)
			prefixWeak := weak.Make(reader.prefixDecoder)
			slotWeak := weak.Make(reader.slots[path])
			inputWeak := weak.Make(&reader.slots[path].capturedInput[0])
			var saved durableReaderStats
			defer finishDurableReader(&reader, &saved)
			if release {
				finishDurableReader(&reader, &saved)
			}
			// Collection is a test observation only. Runtime does not force GC or
			// change GOGC, any resource limit or evidence verification work.
			for pass := 0; pass < 3; pass++ {
				runtime.GC()
				runtime.Gosched()
			}
			alive := readerWeak.Value() != nil || prefixWeak.Value() != nil || slotWeak.Value() != nil || inputWeak.Value() != nil
			if release && alive {
				t.Fatal("measurement reader/cache still retained during evidence phase")
			}
			if !release && !alive {
				t.Fatal("positive retention control did not keep real caches")
			}
			if release {
				if !reflect.DeepEqual(before, saved) {
					t.Fatal("saved reader statistics changed")
				}
				finishDurableReader(&reader, &saved)
				if !reflect.DeepEqual(before, saved) {
					t.Fatal("repeat/deferred finish overwrote saved statistics")
				}
				t.Logf("actual signed cache became unreachable before evidence readback; retained input snapshot=%d bytes; no RSS claim", saved.ReaderBudget.CachedInputBytes)
			}
			runtime.KeepAlive(reader)
			runtime.KeepAlive(saved)
		})
	}
}
