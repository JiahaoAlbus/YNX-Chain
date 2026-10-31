package slhdsa

import (
	"bytes"
	"testing"
)

func TestSchedulingWorkerPanicJoinsAndClears(t *testing.T) {
	for _, who := range []string{"caller", "worker"} {
		t.Run(who, func(t *testing.T) {
			_, key, err := GenerateKey(bytes.NewReader(bytes.Repeat([]byte{19}, 96)), SHA2_256f)
			if err != nil {
				t.Fatal(err)
			}
			defer ClearExperimentKey(&key)
			experimentPool.requests.Add(1)
			w := acquireExperimentWorker(&key)
			if w == nil {
				experimentPool.requests.Add(-1)
				t.Fatal("2proc idle worker not admitted")
			}
			entered := make(chan struct{})
			release := make(chan struct{})
			done := make(chan any, 1)
			var retained *statePriv
			go func() {
				defer func() { done <- recover() }()
				w.pair(func(s *statePriv) {
					retained = s
					close(entered)
					<-release
					if who == "worker" {
						panic("public-worker-panic")
					}
				}, func() {
					if who == "caller" {
						panic("public-caller-panic")
					}
				})
			}()
			<-entered
			select {
			case <-done:
				t.Fatal("panic escaped before worker joined")
			default:
			}
			close(release)
			got := <-done
			if got != "public-"+who+"-panic" {
				t.Fatalf("wrong panic: %v", got)
			}
			w.close()
			experimentPool.requests.Add(-1)
			if retained.params != nil || retained.PRF.input != nil || retained.F.input != nil || retained.H.input != nil || retained.T.input != nil {
				t.Fatal("private worker scratch not cleared")
			}
			stats := ExperimentSchedulingStats()
			if stats.Workers != 0 || stats.Requests != 0 {
				t.Fatalf("not joined: %+v", stats)
			}
		})
	}
}

func TestSchedulingRequestPriorityAndNonblockingBudget(t *testing.T) {
	_, key, err := GenerateKey(bytes.NewReader(bytes.Repeat([]byte{23}, 96)), SHA2_256f)
	if err != nil {
		t.Fatal(err)
	}
	defer ClearExperimentKey(&key)
	experimentPool.requests.Add(1)
	w := acquireExperimentWorker(&key)
	if w == nil {
		experimentPool.requests.Add(-1)
		t.Fatal("idle budget unavailable")
	}
	defer func() { w.close(); experimentPool.requests.Add(-1) }()
	// At GOMAXPROCS2 the one global inner slot is occupied. Trying to nest must
	// return immediately rather than waiting while the caller holds a key lock.
	if next := acquireExperimentWorker(&key); next != nil {
		next.close()
		t.Fatal("global token cap exceeded")
	}
	experimentPool.requests.Add(1)
	next := acquireExperimentWorker(&key)
	experimentPool.requests.Add(-1)
	if next != nil {
		next.close()
		t.Fatal("inner work admitted over independent request")
	}
	stats := ExperimentSchedulingStats()
	if stats.Workers != 1 || stats.PeakWorkers > stats.Capacity {
		t.Fatalf("budget violation %+v", stats)
	}
}
