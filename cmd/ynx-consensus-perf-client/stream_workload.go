package main

import (
	"errors"
	"fmt"
	"time"
)

type readyWorkloadLimits struct {
	rounds, records            int
	timeout                    time.Duration
	intentBytes, terminalBytes int64
}

func workloadLimits(o options) (readyWorkloadLimits, error) {
	limits := readyWorkloadLimits{32, maxTransactions, 30 * time.Second, 8 << 20, 16 << 20}
	if !o.streamingWorkload {
		if o.evidenceByteBudget != 0 {
			return limits, errors.New("evidence budget requires explicit streaming workload")
		}
		return limits, nil
	}
	if o.senderMode != "ready-pool" || o.inclusionMode != "block-scan" || !o.reuseResultSlots || !o.terminalStream || !o.segmentedIntents || o.observers != 4 || o.output == "" || o.evidenceByteBudget < 1 || o.evidenceByteBudget > 2<<30 {
		return limits, errors.New("streaming workload requires ready-pool/block-scan/four observers/slots/both streams/new output and explicit positive evidence budget <=2GiB")
	}
	return readyWorkloadLimits{4096, terminalStreamRecordLimit, 15 * time.Minute, 1 << 30, 1 << 30}, nil
}

type readyEvidenceBudgetReport struct {
	LimitBytes     int64 `json:"limitBytes"`
	AttemptedBytes int64 `json:"attemptedBytes"`
	Poisoned       bool  `json:"poisoned"`
}

// The sole sender controller owns this shared budget. Charge before persistence:
// a failed/uncertain write is never refunded or retried. This counts encoded
// evidence bytes; the external resource window separately caps allocated disk.
func (b *readyEvidenceBudgetReport) persist(write func(string, []byte) error) func(string, []byte) error {
	return func(name string, raw []byte) error {
		if b.Poisoned {
			return errors.New("stream evidence budget poisoned; reconcile only")
		}
		if b.LimitBytes < 1 || int64(len(raw)) > b.LimitBytes-b.AttemptedBytes {
			b.Poisoned = true
			return errors.New("combined signed/terminal evidence byte budget")
		}
		b.AttemptedBytes += int64(len(raw))
		err := write(name, raw)
		if err != nil {
			b.Poisoned = true
		}
		return err
	}
}

type streamingWorkloadReport struct {
	Name               string  `json:"name"`
	PlannedRecords     int     `json:"plannedRecords"`
	Rounds             int     `json:"rounds"`
	MaxRuntimeMs       int64   `json:"maxRuntimeMs"`
	EvidenceByteBudget int64   `json:"evidenceByteBudget"`
	EvidenceVerified   bool    `json:"evidenceVerified"`
	EvidenceReadbackMs float64 `json:"evidenceReadbackMs"`
}

func plannedWorkload(o options, senders int) (int, readyWorkloadLimits, error) {
	limits, err := workloadLimits(o)
	if err != nil {
		return 0, limits, err
	}
	if senders < 1 || senders > maxTransactions || o.rounds < 1 || o.rounds > limits.rounds || o.rounds > limits.records/senders {
		return 0, limits, fmt.Errorf("workload exceeds scoped %d-record/%d-round bounds", limits.records, limits.rounds)
	}
	return senders * o.rounds, limits, nil
}
