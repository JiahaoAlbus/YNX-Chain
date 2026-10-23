package main

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestNativeSubmit8RequiresExactExplicitOptions(t *testing.T) {
	base := options{manifest: "manifest", transactions: "transactions", concurrency: 8, observers: 4, timeout: 10 * time.Second, poll: 100 * time.Millisecond, rounds: 1, senderMode: "rounds", inclusionMode: "block-scan", offeredRate: 1000, observerPhaseTiming: true, durableStoreByteLimit: durableSnapshotLimit, prefixDurableReplay: true, prefixNativeClone: true, nativeSubmit8: true}
	if err := validateOptions(base); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"flag", "clone", "prefix", "workers4", "workers9", "observers", "rate", "rounds", "sender", "timing", "shared"} {
		o := base
		switch kind {
		case "flag":
			o.nativeSubmit8 = false
		case "clone":
			o.prefixNativeClone = false
		case "prefix":
			o.prefixDurableReplay = false
		case "workers4":
			o.concurrency = 4
		case "workers9":
			o.concurrency = 9
		case "observers":
			o.observers = 8
		case "rate":
			o.offeredRate = 2000
		case "rounds":
			o.rounds = 2
		case "sender":
			o.senderMode = "ready-pool"
		case "timing":
			o.observerPhaseTiming = false
		case "shared":
			o.sharedDurableReplay = true
		}
		if err := validateOptions(o); err == nil {
			t.Fatal("unsupported widened mode accepted", kind)
		}
	}
	base.nativeSubmit8 = false
	base.concurrency = 4
	if err := validateOptions(base); err != nil {
		t.Fatal("original mode changed", err)
	}
	b, err := json.Marshal(report{})
	if err != nil || strings.Contains(string(b), "nativeSubmit8") || strings.Contains(string(b), "pacedWorkers") {
		t.Fatal("default report changed", err)
	}
}

func TestNativeSubmit8ActualWorkerBoundQueueCapacityAndNoUnknownRetry(t *testing.T) {
	for _, workers := range []int{4, 8} {
		t.Run(string(rune('0'+workers)), func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			inventory := new(pacedWorkerInventory)
			occupancy := new(submissionOccupancyRecorder)
			o := options{concurrency: workers, observers: 4, offeredRate: 1e6, pacedWorkerInventory: inventory, submissionOccupancy: occupancy}
			ready := make(chan struct{}, 16)
			release := make(chan struct{})
			done := make(chan struct{})
			var attempts [16]atomic.Int32
			var observed [16]atomic.Int32
			started := time.Now()
			go func() {
				defer close(done)
				runPacedTransactions(ctx, o, started, make([]transactionResult, 16), func(index int) (time.Time, bool) {
					attempts[index].Add(1)
					ready <- struct{}{}
					select {
					case <-release:
					case <-ctx.Done():
						return time.Time{}, false
					}
					return time.Now(), index != 5
				}, func(index int, _ time.Time) { observed[index].Add(1) })
			}()
			for i := 0; i < workers; i++ {
				select {
				case <-ready:
				case <-ctx.Done():
					close(release)
					<-done
					t.Fatal("workers did not reach real callback gate")
				}
			}
			if occupancy.peak.Load() != int64(workers) || occupancy.active.Load() != int64(workers) {
				close(release)
				<-done
				t.Fatal("actual active worker bound differs")
			}
			close(release)
			select {
			case <-done:
			case <-ctx.Done():
				t.Fatal("worker pools failed to finish")
			}
			for i := range attempts {
				if attempts[i].Load() != 1 {
					t.Fatal("duplicate/missing original attempt", i)
				}
				want := int32(1)
				if i == 5 {
					want = 0
				}
				if observed[i].Load() != want {
					t.Fatal("unaccepted/UNKNOWN callback entered observation or successful callback lost", i)
				}
			}
			if inventory.Submitters != workers || inventory.Observers != 4 || inventory.SubmissionQueueCapacity != 16 || !reflect.DeepEqual(inventory.ObservationQueueCapacities, []int{16, 16, 16, 16}) {
				t.Fatal("actual original queue capacities changed", inventory)
			}
			if occupancy.started.Load() != 16 || occupancy.returned.Load() != 16 || occupancy.active.Load() != 0 || occupancy.peak.Load() != int64(workers) {
				t.Fatal("actual callback accounting differs")
			}
			b, err := json.Marshal(map[string]any{"kind": "local_paced_worker_capacity_no_unknown_retry_not_network", "inventory": inventory, "callbacks": occupancy.started.Load(), "returned": occupancy.returned.Load(), "peak": occupancy.peak.Load(), "unacceptedObserved": observed[5].Load()})
			if err != nil {
				t.Fatal(err)
			}
			t.Log(string(b))
		})
	}
}

func TestNativeSuffixSetupRequiresExplicitNative8AndDefaultJSONOmission(t *testing.T) {
	base := options{manifest: "manifest", transactions: "transactions", concurrency: 8, observers: 4, timeout: 10 * time.Second, poll: 100 * time.Millisecond, rounds: 1, senderMode: "rounds", inclusionMode: "block-scan", offeredRate: 1000, observerPhaseTiming: true, durableStoreByteLimit: durableSnapshotLimit, prefixDurableReplay: true, prefixNativeClone: true, nativeSubmit8: true, nativeSuffixSetup: true}
	if err := validateOptions(base); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"submit8", "native", "prefix", "workers", "timing", "rate"} {
		o := base
		switch kind {
		case "submit8":
			o.nativeSubmit8 = false
		case "native":
			o.prefixNativeClone = false
		case "prefix":
			o.prefixDurableReplay = false
		case "workers":
			o.concurrency = 4
		case "timing":
			o.observerPhaseTiming = false
		case "rate":
			o.offeredRate = 500
		}
		if err := validateOptions(o); err == nil {
			t.Fatal("unsupported suffix mode accepted", kind)
		}
	}
	b, err := json.Marshal(report{})
	if err != nil || strings.Contains(string(b), "nativeSuffixSetup") {
		t.Fatal("default report changed", err)
	}
}
