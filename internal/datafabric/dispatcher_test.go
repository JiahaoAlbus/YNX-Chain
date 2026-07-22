package datafabric

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

type recordingPublisher struct {
	fail     bool
	topics   []string
	keys     []string
	payloads [][]byte
}

func (p *recordingPublisher) Publish(_ context.Context, topic, key string, payload []byte) error {
	p.topics = append(p.topics, topic)
	p.keys = append(p.keys, key)
	p.payloads = append(p.payloads, append([]byte(nil), payload...))
	if p.fail {
		return errors.New("broker unavailable with internal details that remain bounded")
	}
	return nil
}

func TestDispatcherBrokerOutageDeadLetterAndRequeue(t *testing.T) {
	store, err := OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	event := signedEvent(t, "event.pay.dispatch.failed.0001", 1)
	if err := store.Append(event, testKey); err != nil {
		t.Fatal(err)
	}
	publisher := &recordingPublisher{fail: true}
	now := time.Now().UTC().Add(time.Second)
	dispatcher := Dispatcher{Store: store, Publisher: publisher, BatchSize: 10, MaxAttempts: 2, Now: func() time.Time { return now }}
	report, err := dispatcher.DispatchOnce(context.Background())
	if err != nil || report.Failed != 1 || report.DeadLetter != 0 {
		t.Fatalf("first outage: %+v %v", report, err)
	}
	now = now.Add(10 * time.Second)
	report, err = dispatcher.DispatchOnce(context.Background())
	if err != nil || report.DeadLetter != 1 || len(store.DeadLetters()) != 1 {
		t.Fatalf("dead letter: %+v %v", report, err)
	}
	if len(store.PendingOutbox(now.Add(time.Hour), 10)) != 0 {
		t.Fatal("dead-lettered event remained dispatchable")
	}
	if err := store.RequeueDeadLetter(event.EventID, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	publisher.fail = false
	now = now.Add(time.Minute)
	report, err = dispatcher.DispatchOnce(context.Background())
	if err != nil || report.Published != 1 || len(store.DeadLetters()) != 0 {
		t.Fatalf("requeue publish: %+v %v", report, err)
	}
}

func TestReplayIsLongRunningAndIdempotent(t *testing.T) {
	store, err := OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	for sequence := uint64(1); sequence <= 40; sequence++ {
		event := signedEvent(t, fmt.Sprintf("event.pay.replay.%012d", sequence), sequence)
		if err := store.Append(event, testKey); err != nil {
			t.Fatal(err)
		}
	}
	apply := func(event EventEnvelope, projection map[string]string) (string, error) {
		projection[fmt.Sprintf("replay.%d", event.Sequence)] = event.EventID
		return event.Integrity.Digest, nil
	}
	report, err := store.ReplayProjection("analytics-backfill.v1", 0, 0, apply)
	if err != nil || report.Scanned != 40 || report.Applied != 40 || report.Skipped != 0 {
		t.Fatalf("first replay: %+v %v", report, err)
	}
	report, err = store.ReplayProjection("analytics-backfill.v1", 0, 0, apply)
	if err != nil || report.Scanned != 40 || report.Applied != 0 || report.Skipped != 40 {
		t.Fatalf("idempotent replay: %+v %v", report, err)
	}
	report, err = store.ReplayProjection("analytics-backfill.v2", 30, 5, apply)
	if err != nil || report.Scanned != 5 || report.Applied != 5 {
		t.Fatalf("paged replay: %+v %v", report, err)
	}
}
