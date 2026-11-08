//go:build unix

package consensus

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func publicLiveObservationFile(t *testing.T) *os.File {
	t.Helper()
	f, err := os.OpenFile(filepath.Join(t.TempDir(), "PUBLIC-stages.jsonl"), os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = f.Close() })
	return f
}

func readPublicLiveObservations(t *testing.T, f *os.File) []pqLabLiveObservationRecord {
	t.Helper()
	raw, err := os.ReadFile(f.Name())
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) > MaxPQLabLiveObservationRecords*MaxPQLabLiveObservationRecordBytes {
		t.Fatal("observation exceeded closed total byte bound")
	}
	lines := bytes.Split(bytes.TrimSpace(raw), []byte{'\n'})
	var out []pqLabLiveObservationRecord
	for i, line := range lines {
		var record pqLabLiveObservationRecord
		var keys map[string]json.RawMessage
		if len(line)+1 > MaxPQLabLiveObservationRecordBytes || json.Unmarshal(line, &record) != nil || json.Unmarshal(line, &keys) != nil || len(keys) != 8 {
			t.Fatal("observation is not the bounded closed record")
		}
		if record.Version != PQLabLiveObservationVersion || record.Sequence != uint16(i+1) || record.ElapsedNS < 0 || record.AuthorityGranted {
			t.Fatal("observation version/order/elapsed or authority differs")
		}
		out = append(out, record)
	}
	return out
}

func TestPQLabLiveObservationClosedStagesAndBounds(t *testing.T) {
	t.Run("measured-existing-stages-no-parameters", func(t *testing.T) {
		f := publicLiveObservationFile(t)
		metrics, observation, err := NewPQLabLiveRequestObservation(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, stage := range []string{"live.publishTotal", "live.policyLoadTotal", "live.configLoadTotal", "lab.loadStaticTotal", "lab.migrationFullRead", "lab.migrationFullDecode", "lab.bootstrapFullValidation", "lab.staticOwnerHitRevalidateSources", "live.heldStaticWitnessCurrent", "live.anchorFullValidation", "live.anchorStateFullValidation", "live.anchorRegistryFullReplay", "live.anchorCommitFullVerification", "live.controlDurablePublish"} {
			pqLabMeasure(metrics, stage)()
		}
		const privateMarker = "DO-NOT-EMIT/private-senders/body-or-error"
		pqLabMeasure(metrics, privateMarker)()
		observation.CancelObserved(255)
		observation.Finish()
		observation.Finish()
		records := readPublicLiveObservations(t, f)
		if len(records) != 30 || records[0].Stage != "REQUEST" || records[29].Event != "END" || records[29].Stage != "REQUEST" {
			t.Fatal("normal intervals were missing or duplicated")
		}
		for i := 1; i < 29; i += 2 {
			a, b := records[i], records[i+1]
			if a.Event != "BEGIN" || a.ElapsedNS != 0 || b.Event != "END" || a.Stage != b.Stage || a.Span != b.Span || a.Stage == privateMarker {
				t.Fatal("closed matched interval differs")
			}
		}
		raw, _ := os.ReadFile(f.Name())
		if bytes.Contains(raw, []byte(privateMarker)) || bytes.Contains(raw, []byte(f.Name())) {
			t.Fatal("observation emitted original parameters, path or raw error")
		}
		if got := metrics.Snapshot(); got.Version != "YNX-PQ-LAB-CALLEE-ELAPSED/v1" || got.Stages["live.publishTotal"].Calls != 1 || got.Stages[privateMarker].Calls != 1 || !got.IntervalsOverlap {
			t.Fatal("existing timing snapshot contract changed")
		}
	})
	t.Run("fixed-truncation", func(t *testing.T) {
		f := publicLiveObservationFile(t)
		m, observation, err := NewPQLabLiveRequestObservation(f)
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 200; i++ {
			pqLabObserve(m, "live.observe.transaction")()
		}
		observation.CancelObserved(PQLabLiveObservationTerminate)
		observation.Finish()
		records := readPublicLiveObservations(t, f)
		last := records[len(records)-1]
		if len(records) != MaxPQLabLiveObservationRecords || last.Event != "TRUNCATED" || last.Stage != "OBSERVATION" || last.Reason != "RECORD_BOUND" {
			t.Fatal("closed cap did not leave its one truncation marker")
		}
	})
	t.Run("cancel-observed-is-not-completion", func(t *testing.T) {
		f := publicLiveObservationFile(t)
		m, observation, err := NewPQLabLiveRequestObservation(f)
		if err != nil {
			t.Fatal(err)
		}
		end := pqLabObserve(m, "live.observe.transactionCleanup")
		observation.CancelObserved(PQLabLiveObservationInterrupt)
		records := readPublicLiveObservations(t, f)
		if len(records) != 3 || records[2].Event != "CANCEL" || records[2].Reason != "SIGINT" || records[2].Stage != "REQUEST" {
			t.Fatal("cancel did not retain an unfinished interval")
		}
		end()
		end()
		observation.Finish()
		if records = readPublicLiveObservations(t, f); len(records) != 5 || records[3].Event != "END" {
			t.Fatal("interval exit is not observed exactly once")
		}
	})
}

type publicObservationBrokenWriter struct{ calls int }

func (w *publicObservationBrokenWriter) Write([]byte) (int, error) {
	w.calls++
	return 0, io.ErrClosedPipe
}

func TestPQLabLiveObservationDisabledAndOutputFailure(t *testing.T) {
	t.Run("disabled", func(t *testing.T) {
		pqLabObserve(nil, "live.observe.transaction")()
		m := &PQLabMetrics{}
		pqLabObserve(m, "live.observe.transaction")()
		if len(m.Snapshot().Stages) != 0 {
			t.Fatal("disabled observation modified original timing state")
		}
	})
	t.Run("bad-sinks", func(t *testing.T) {
		read, write, err := os.Pipe()
		if err != nil {
			t.Fatal(err)
		}
		defer read.Close()
		defer write.Close()
		closed := publicLiveObservationFile(t)
		closed.Close()
		readonly, err := os.Open(publicLiveObservationFile(t).Name())
		if err != nil {
			t.Fatal(err)
		}
		defer readonly.Close()
		for _, sink := range []*os.File{nil, write, closed, readonly} {
			if m, o, e := NewPQLabLiveRequestObservation(sink); e == nil || m != nil || o != nil {
				t.Fatal("invalid sink started the observed request")
			}
		}
	})
	t.Run("late-write-failure-not-retried", func(t *testing.T) {
		broken := &publicObservationBrokenWriter{}
		o := &PQLabLiveRequestObservation{sink: broken}
		o.begin("live.publishTotal")()
		o.CancelObserved(PQLabLiveObservationTerminate)
		o.Finish()
		if broken.calls != 1 || !o.stopped {
			t.Fatal("failed diagnostics were retried or became an operation result")
		}
	})
}
