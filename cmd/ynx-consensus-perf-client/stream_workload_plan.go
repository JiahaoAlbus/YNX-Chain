package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmt "github.com/cometbft/cometbft/types"
)

type streamingWorkloadPlan struct {
	TerminalEncoding            string                   `json:"terminalEncoding,omitempty"`
	Kind                        string                   `json:"kind"`
	Profile                     string                   `json:"profile"`
	Fixture                     readySenderJournalHeader `json:"fixture"`
	InitialSignedHashes         []string                 `json:"initialSignedHashes"`
	Senders                     int                      `json:"senders"`
	Rounds                      int                      `json:"rounds"`
	PlannedRecords              int                      `json:"plannedRecords"`
	RequiredBalancePerSender    int64                    `json:"requiredBalancePerSender"`
	EncodedEvidenceBudget       int64                    `json:"encodedEvidenceBudget"`
	DurableStoreByteLimit       int64                    `json:"durableStoreByteLimit"`
	DurableCacheInputByteBudget int64                    `json:"durableCacheInputByteBudget"`
	TimeoutMs                   int64                    `json:"timeoutMs"`
}

// Exclusive durable plan precedes dispatch. It contains public identities only;
// losing observations never permits reopening this fixture for submission.
func persistStreamingWorkloadPlan(o options, manifest []byte, m consensus.EphemeralNetworkManifest, initial []cmt.Tx) (string, string, error) {
	if !o.streamingWorkload {
		return "", "", errors.New("streaming plan requires explicit profile")
	}
	total, _, err := plannedWorkload(o, len(initial))
	if err != nil {
		return "", "", err
	}
	storeLimit, cacheBudget, err := durableReadLimits(o)
	if err != nil {
		return "", "", err
	}
	plan := streamingWorkloadPlan{DurableStoreByteLimit: storeLimit, DurableCacheInputByteBudget: cacheBudget, Kind: "YNX_LOCAL_STREAM_WORKLOAD_PLAN_V1", Profile: "scoped_streaming_v1", Fixture: readySenderJournalHeader{"YNX_LOCAL_READY_SENDER_V1", fmt.Sprintf("%x", sha256.Sum256(manifest)), m.MigrationStateHash, m.GenesisHash}, Senders: len(initial), Rounds: o.rounds, PlannedRecords: total, RequiredBalancePerSender: int64(o.rounds) * 2, EncodedEvidenceBudget: o.evidenceByteBudget, TimeoutMs: o.timeout.Milliseconds()}
	for _, raw := range initial {
		plan.InitialSignedHashes = append(plan.InitialSignedHashes, fmt.Sprintf("%X", raw.Hash()))
	}
	if o.terminalGzip {
		plan.TerminalEncoding = "gzip"
	}
	raw, err := json.Marshal(plan)
	if err != nil {
		return "", "", err
	}
	raw = append(raw, '\n')
	if len(raw) > 1<<20 {
		return "", "", errors.New("streaming plan byte bound")
	}
	path, err := filepath.Abs(o.output + ".streaming-plan.json")
	if err != nil {
		return "", "", err
	}
	if err := persistTerminalSegment(path, raw); err != nil {
		return path, "", err
	}
	return path, fmt.Sprintf("%x", sha256.Sum256(raw)), nil
}
