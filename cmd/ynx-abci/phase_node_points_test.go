package main

import (
	"bytes"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"testing"
	"time"
)

func TestPhaseTimingBlockPointsRejectFailedOrMismatchedCommit(t *testing.T) {
	r := newPhaseRecorder(&bytes.Buffer{})
	a := &phaseTimedApplication{recorder: r}
	req := &abci.RequestFinalizeBlock{Height: 2}
	res := &abci.ResponseFinalizeBlock{AppHash: make([]byte, 32)}
	good := &consensus.CommitTimingSample{Height: 2, Durable: true}
	for _, sample := range []*consensus.CommitTimingSample{nil, {Height: 3, Durable: true}, {Height: 2, Durable: false}} {
		a.recordFinalizedPoint(req, res, nil, r.started.Add(time.Millisecond))
		if a.committedPoint(sample, false, r.started.Add(2*time.Millisecond)) != nil {
			t.Fatal("unbound/failed persistence promoted")
		}
		if a.committedPoint(good, false, r.started.Add(3*time.Millisecond)) != nil {
			t.Fatal("stale finalize remained after rejected commit")
		}
	}
	a.recordFinalizedPoint(req, res, nil, r.started.Add(time.Millisecond))
	if a.committedPoint(good, true, r.started.Add(2*time.Millisecond)) != nil {
		t.Fatal("failed response promoted")
	}
	a.recordFinalizedPoint(req, res, nil, r.started.Add(time.Millisecond))
	a.recordFinalizedPoint(req, res, errors.New("actual finalize failed"), r.started.Add(2*time.Millisecond))
	if a.committedPoint(good, false, r.started.Add(3*time.Millisecond)) != nil {
		t.Fatal("failed finalize reused prior successful state")
	}
	a.recordFinalizedPoint(req, res, nil, r.started.Add(time.Millisecond))
	point := a.committedPoint(good, false, r.started.Add(2*time.Millisecond))
	if point == nil || point.FinalizeReturned.ElapsedNs != int64(time.Millisecond) || point.CommitReturned.ElapsedNs != int64(2*time.Millisecond) || point.CommitReturned.WallDriftNs != 0 {
		t.Fatal("bounded point clock differs", point)
	}
	if a.committedPoint(good, false, r.started.Add(3*time.Millisecond)) != nil {
		t.Fatal("one finalize promoted twice")
	}
}
