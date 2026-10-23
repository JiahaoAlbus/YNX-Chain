package main

import (
	"encoding/hex"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"strconv"
	"time"
)

// Absolute nanoseconds are decimal strings: JavaScript numbers cannot retain
// Unix nanosecond precision. Monotonic offsets and wall-clock drift remain
// explicit so later readers can refuse cross-process latency correlation.
type phaseNodeClock struct {
	OriginUnixNs  string `json:"originUnixNs"`
	EmittedUnixNs string `json:"emittedUnixNs"`
	WallDriftNs   int64  `json:"wallDriftNs"`
}
type phaseNodePoint struct {
	UnixNs      string `json:"unixNs"`
	ElapsedNs   int64  `json:"elapsedNs"`
	WallDriftNs int64  `json:"wallDriftNs"`
}
type phaseBlockExecution struct {
	BlockHash            string         `json:"blockHash,omitempty"`
	Height               int64          `json:"height"`
	AppHash              string         `json:"appHash"`
	Transactions         int            `json:"transactions"`
	CodeZeroTransactions int            `json:"codeZeroTransactions"`
	FinalizeReturned     phaseNodePoint `json:"finalizeReturned"`
	CommitReturned       phaseNodePoint `json:"commitReturned"`
}

func (r *phaseRecorder) nodeClock(now time.Time) *phaseNodeClock {
	return &phaseNodeClock{OriginUnixNs: strconv.FormatInt(r.started.UnixNano(), 10), EmittedUnixNs: strconv.FormatInt(now.UnixNano(), 10), WallDriftNs: now.UnixNano() - r.started.UnixNano() - now.Sub(r.started).Nanoseconds()}
}
func (r *phaseRecorder) nodePoint(now time.Time) phaseNodePoint {
	return phaseNodePoint{UnixNs: strconv.FormatInt(now.UnixNano(), 10), ElapsedNs: now.Sub(r.started).Nanoseconds(), WallDriftNs: now.UnixNano() - r.started.UnixNano() - now.Sub(r.started).Nanoseconds()}
}

// One bounded current block only. This does not change ABCI responses or state,
// and FinalizeBlock completion alone never claims consensus finality.
func (a *phaseTimedApplication) recordFinalizedPoint(req *abci.RequestFinalizeBlock, res *abci.ResponseFinalizeBlock, err error, now time.Time) {
	a.blockPointMu.Lock()
	defer a.blockPointMu.Unlock()
	a.lastBlockPoint = nil
	if err != nil || req == nil || res == nil || req.Height <= 0 || len(res.AppHash) != 32 || len(req.Txs) != len(res.TxResults) {
		return
	}
	zero := 0
	for _, result := range res.TxResults {
		if result != nil && result.Code == 0 {
			zero++
		}
	}
	a.lastBlockPoint = &phaseBlockExecution{Height: req.Height, AppHash: hex.EncodeToString(res.AppHash), Transactions: len(req.Txs), CodeZeroTransactions: zero, FinalizeReturned: a.recorder.nodePoint(now)}
	if len(req.Hash) == 32 {
		a.lastBlockPoint.BlockHash = hex.EncodeToString(req.Hash)
	}
}
func (a *phaseTimedApplication) committedPoint(sample *consensus.CommitTimingSample, failed bool, now time.Time) *phaseBlockExecution {
	a.blockPointMu.Lock()
	defer a.blockPointMu.Unlock()
	prior := a.lastBlockPoint
	a.lastBlockPoint = nil
	if failed || sample == nil || !sample.Durable || prior == nil || sample.Height != prior.Height {
		return nil
	}
	point := *prior
	point.CommitReturned = a.recorder.nodePoint(now)
	if point.CommitReturned.ElapsedNs < point.FinalizeReturned.ElapsedNs {
		return nil
	}
	return &point
}
