package datafabric

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// EventLogPublisher is the durable single-node testnet event bus. Each publish
// appends and fsyncs one canonical envelope. It deliberately allows duplicate
// delivery; consumers must use their Inbox before applying local effects.
type EventLogPublisher struct {
	Path string
	Now  func() time.Time
	mu   sync.Mutex
}

type EventLogRecord struct {
	Topic        string          `json:"topic"`
	PartitionKey string          `json:"partitionKey"`
	EventID      string          `json:"eventId"`
	EventDigest  string          `json:"eventDigest"`
	PublishedAt  time.Time       `json:"publishedAt"`
	Payload      json.RawMessage `json:"payload"`
	RecordHash   string          `json:"recordHash"`
}

func (p *EventLogPublisher) Publish(ctx context.Context, topic, partitionKey string, payload []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !filepath.IsAbs(p.Path) || !strings.HasPrefix(topic, "ynx.events.") || partitionKey == "" {
		return errors.New("event log path, topic, or partition key is invalid")
	}
	event, err := DecodeEnvelopeStrict(bytes.NewReader(payload))
	if err != nil {
		return err
	}
	if topic != "ynx.events."+event.EventType || partitionKey != event.PartitionKey() {
		return errors.New("event topic or partition key does not match the canonical envelope")
	}
	now := time.Now
	if p.Now != nil {
		now = p.Now
	}
	record := EventLogRecord{Topic: topic, PartitionKey: partitionKey, EventID: event.EventID, EventDigest: event.Integrity.Digest, PublishedAt: now().UTC(), Payload: append(json.RawMessage(nil), payload...)}
	material, _ := json.Marshal(record)
	digest := sha256.Sum256(material)
	record.RecordHash = hex.EncodeToString(digest[:])
	line, err := json.Marshal(record)
	if err != nil {
		return err
	}
	line = append(line, '\n')

	p.mu.Lock()
	defer p.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(p.Path), 0o700); err != nil {
		return err
	}
	file, err := os.OpenFile(p.Path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return err
	}
	if _, err := file.Write(line); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func DecodeEventLogRecord(line []byte) (EventLogRecord, error) {
	decoder := json.NewDecoder(bytes.NewReader(line))
	decoder.DisallowUnknownFields()
	var record EventLogRecord
	if err := decoder.Decode(&record); err != nil {
		return EventLogRecord{}, err
	}
	want := record.RecordHash
	record.RecordHash = ""
	material, _ := json.Marshal(record)
	digest := sha256.Sum256(material)
	if want == "" || want != hex.EncodeToString(digest[:]) {
		return EventLogRecord{}, ErrTampered
	}
	record.RecordHash = want
	return record, nil
}
