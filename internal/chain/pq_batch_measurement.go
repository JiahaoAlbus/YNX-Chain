package chain

import (
	"io"
	"time"
)

const PQBatchMeasurementVersion = "ynx-pq-batch-measurement-v1"

// PQPhaseMeasurement records actual calls, including failed calls. Completed
// means that this phase returned nil; it never means business or BFT finality.
// Durations use the process's monotonic clock and sum inclusive call durations.
type PQPhaseMeasurement struct {
	Attempts   uint64 `json:"attempts"`
	Completed  uint64 `json:"completed"`
	Errors     uint64 `json:"errors"`
	DurationNs int64  `json:"durationNs,string"`
}

func (p *PQPhaseMeasurement) begin(enabled bool) time.Time {
	if !enabled {
		return time.Time{}
	}
	p.Attempts++
	return time.Now()
}

func (p *PQPhaseMeasurement) finish(enabled bool, start time.Time, err error) {
	if !enabled {
		return
	}
	p.DurationNs += time.Since(start).Nanoseconds()
	if err != nil {
		p.Errors++
	} else {
		p.Completed++
	}
}

// PQDurableFileMeasurement separates file and containing-directory Sync. Write
// counters are from actual os.File.Write returns, including partial failures.
// A successful FileSync alone does not establish a completed checkpoint.
type PQDurableFileMeasurement struct {
	Total         PQPhaseMeasurement `json:"total"`
	OpenTemp      PQPhaseMeasurement `json:"openTemp"`
	EncodeWrite   PQPhaseMeasurement `json:"encodeWrite"`
	FileSync      PQPhaseMeasurement `json:"fileSync"`
	Close         PQPhaseMeasurement `json:"close"`
	Rename        PQPhaseMeasurement `json:"rename"`
	DirectorySync PQPhaseMeasurement `json:"directorySync"`
	WriteCalls    uint64             `json:"writeCalls"`
	BytesWritten  uint64             `json:"bytesWritten"`
}

type PQLocalCheckpointMeasurement struct {
	Version           string `json:"version"`
	Height            uint64 `json:"height,string"`
	Hash              string `json:"hash"`
	SnapshotIntegrity string `json:"snapshotIntegrity"`
}

// PQSnapshotMeasurement observes the existing snapshot path. Published is set
// only after both durable replacements and the final atomic checkpoint Store.
// Memory-only calls and all rejected batches have zero persistence attempts.
type PQSnapshotMeasurement struct {
	Total               PQPhaseMeasurement            `json:"total"`
	SnapshotBuild       PQPhaseMeasurement            `json:"snapshotBuild"`
	IntegritySeal       PQPhaseMeasurement            `json:"integritySeal"`
	CheckpointBuild     PQPhaseMeasurement            `json:"checkpointBuild"`
	PersistenceLockWait PQPhaseMeasurement            `json:"persistenceLockWait"`
	Mkdir               PQPhaseMeasurement            `json:"mkdir"`
	SnapshotFile        PQDurableFileMeasurement      `json:"snapshotFile"`
	MarkerFile          PQDurableFileMeasurement      `json:"markerFile"`
	CandidateIntegrity  string                        `json:"candidateIntegrity,omitempty"`
	Published           *PQLocalCheckpointMeasurement `json:"published,omitempty"`
}

// PQBatchMeasurement is call-local output, not a collector, callback or receipt
// authority. Result is an independent copy of this call's actual return value.
// Member counts describe admission outcomes even if persistence later fails;
// callers must retain Result.Status and never count them as committed business.
type PQBatchMeasurement struct {
	Version                 string                `json:"version"`
	WireHash                string                `json:"wireHash,omitempty"`
	ExecutionHeight         uint64                `json:"executionHeight,string"`
	Result                  PQBatchResult         `json:"result"`
	Total                   PQPhaseMeasurement    `json:"total"`
	InputCloneHash          PQPhaseMeasurement    `json:"inputCloneHash"`
	LockWait                PQPhaseMeasurement    `json:"lockWait"`
	PolicyValidation        PQPhaseMeasurement    `json:"policyValidation"`
	WireDecode              PQPhaseMeasurement    `json:"wireDecode"`
	WholeAuthentication     PQPhaseMeasurement    `json:"wholeAuthentication"`
	MemberExecution         PQPhaseMeasurement    `json:"memberExecution"`
	Replay                  PQPhaseMeasurement    `json:"replay"`
	VerifierSignatureChecks uint64                `json:"verifierSignatureChecks"`
	MemberAdmitted          uint32                `json:"memberAdmitted"`
	MemberRejected          uint32                `json:"memberRejected"`
	Persistence             PQSnapshotMeasurement `json:"persistence"`
}

// SubmitPQBatchMeasured runs the same executor and persistence implementation as
// SubmitPQBatch. Exact replays measure no new authentication/member execution;
// an original UNKNOWN may measure its existing explicit checkpoint reconfirm.
func (d *Devnet) SubmitPQBatchMeasured(wire []byte) (PQBatchResult, PQBatchMeasurement, error) {
	m := PQBatchMeasurement{Version: PQBatchMeasurementVersion}
	start := m.Total.begin(true)
	out, err := d.submitPQBatch(wire, &m)
	m.Result = out
	m.Result.Results = append([]PQBatchMemberResult(nil), out.Results...)
	m.Total.finish(true, start, err)
	return out, m, err
}

type pqMeasuredWriter struct {
	target io.Writer
	file   *PQDurableFileMeasurement
}

func (w pqMeasuredWriter) Write(payload []byte) (int, error) {
	n, err := w.target.Write(payload)
	w.file.WriteCalls++
	w.file.BytesWritten += uint64(n)
	return n, err
}
