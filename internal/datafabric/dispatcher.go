package datafabric

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type Publisher interface {
	Publish(context.Context, string, string, []byte) error
}

type Dispatcher struct {
	Store       *Store
	Publisher   Publisher
	BatchSize   int
	MaxAttempts uint32
	Now         func() time.Time
}

type DispatchReport struct {
	Selected   uint64 `json:"selected"`
	Published  uint64 `json:"published"`
	Failed     uint64 `json:"failed"`
	DeadLetter uint64 `json:"deadLetter"`
}

func (d Dispatcher) DispatchOnce(ctx context.Context) (DispatchReport, error) {
	if d.Store == nil || d.Publisher == nil {
		return DispatchReport{}, errors.New("dispatcher requires a store and publisher")
	}
	if d.BatchSize <= 0 {
		d.BatchSize = 100
	}
	if d.MaxAttempts == 0 {
		d.MaxAttempts = 8
	}
	if d.Now == nil {
		d.Now = time.Now
	}
	now := d.Now().UTC()
	records := d.Store.PendingOutbox(now, d.BatchSize)
	report := DispatchReport{Selected: uint64(len(records))}
	for _, record := range records {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		event, exists := d.Store.Event(record.EventID)
		if !exists {
			return report, fmt.Errorf("outbox event %s is missing", record.EventID)
		}
		payload, err := json.Marshal(event)
		if err != nil {
			return report, err
		}
		topic := "ynx.events." + event.EventType
		if err := d.Publisher.Publish(ctx, topic, record.PartitionKey, payload); err != nil {
			report.Failed++
			if record.Attempt+1 >= d.MaxAttempts {
				report.DeadLetter++
			}
			if markErr := d.Store.MarkPublishFailure(record.EventID, boundedFailure(err.Error()), now, d.MaxAttempts); markErr != nil {
				return report, markErr
			}
			continue
		}
		// A crash after Publish and before MarkPublished intentionally causes a
		// duplicate delivery on restart. Consumer Inbox idempotency absorbs it.
		if err := d.Store.MarkPublished(record.EventID, now); err != nil {
			return report, err
		}
		report.Published++
	}
	return report, nil
}

func boundedFailure(message string) string {
	const maximum = 512
	if len(message) > maximum {
		return message[:maximum]
	}
	return message
}
