package datafabric

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"
)

func TestEventLogPublisherDurableDuplicateAndTamperEvidence(t *testing.T) {
	path := t.TempDir() + "/bus/events.jsonl"
	event := signedEvent(t, "event.pay.log.published.0001", 1)
	payload, _ := json.Marshal(event)
	now := time.Date(2026, 7, 22, 17, 0, 0, 0, time.UTC)
	publisher := &EventLogPublisher{Path: path, Now: func() time.Time { return now }}
	for i := 0; i < 2; i++ {
		if err := publisher.Publish(context.Background(), "ynx.events.pay.invoice.state_changed", event.PartitionKey(), payload); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines := bytes.Split(bytes.TrimSpace(data), []byte("\n"))
	if len(lines) != 2 {
		t.Fatalf("duplicate delivery was hidden: %d", len(lines))
	}
	record, err := DecodeEventLogRecord(lines[0])
	if err != nil || record.EventID != event.EventID || record.EventDigest != event.Integrity.Digest {
		t.Fatalf("invalid record: %+v %v", record, err)
	}
	tampered := bytes.Replace(lines[0], []byte(event.EventID), []byte("event.pay.log.tampered.0001"), 1)
	if _, err := DecodeEventLogRecord(tampered); !errors.Is(err, ErrTampered) {
		t.Fatalf("record tamper was not detected: %v", err)
	}
}
