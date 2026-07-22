package datafabricpostgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

type Dispatcher struct {
	Store       *Store
	Publisher   datafabric.Publisher
	Owner       string
	BatchSize   int
	Lease       time.Duration
	MaxAttempts uint32
	Now         func() time.Time
}

func (d Dispatcher) DispatchOnce(ctx context.Context) (datafabric.DispatchReport, error) {
	if d.Store == nil || d.Publisher == nil || d.Owner == "" {
		return datafabric.DispatchReport{}, errors.New("PostgreSQL dispatcher requires store, publisher, and stable owner")
	}
	if d.BatchSize <= 0 {
		d.BatchSize = 100
	}
	if d.Lease <= 0 {
		d.Lease = 30 * time.Second
	}
	if d.MaxAttempts == 0 {
		d.MaxAttempts = 8
	}
	if d.Now == nil {
		d.Now = time.Now
	}
	now := d.Now().UTC()
	records, err := d.Store.ClaimOutbox(ctx, d.Owner, now, d.Lease, d.BatchSize)
	if err != nil {
		return datafabric.DispatchReport{}, err
	}
	report := datafabric.DispatchReport{Selected: uint64(len(records))}
	for _, record := range records {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		event, exists, err := d.Store.Event(ctx, record.EventID)
		if err != nil {
			return report, fmt.Errorf("load claimed Outbox event %s: %w", record.EventID, err)
		}
		if !exists {
			return report, fmt.Errorf("load claimed Outbox event %s: canonical event is missing", record.EventID)
		}
		payload, err := json.Marshal(event)
		if err != nil {
			return report, err
		}
		if err := d.Publisher.Publish(ctx, "ynx.events."+event.EventType, record.PartitionKey, payload); err != nil {
			report.Failed++
			if record.Attempt+1 >= d.MaxAttempts {
				report.DeadLetter++
			}
			if markErr := d.Store.MarkPublishFailure(ctx, record.EventID, d.Owner, err.Error(), now, d.MaxAttempts); markErr != nil {
				return report, markErr
			}
			continue
		}
		if err := d.Store.MarkPublished(ctx, record.EventID, d.Owner, now); err != nil {
			return report, err
		}
		report.Published++
	}
	return report, nil
}
