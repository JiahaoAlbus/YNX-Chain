package main

import (
	"sync/atomic"
	"time"
)

type submissionOccupancyStats struct {
	CallbackStarted      int64  `json:"callbackStarted"`
	CallbackReturned     int64  `json:"callbackReturned"`
	ActiveCallbacksAtEnd int64  `json:"activeCallbacksAtEnd"`
	PeakActiveCallbacks  int64  `json:"peakActiveCallbacks"`
	CallbackBusyNs       int64  `json:"callbackBusyNs"`
	QueueWaitSamples     int64  `json:"queueWaitSamples"`
	QueueWaitNs          int64  `json:"queueWaitNs"`
	PeakQueueWaitNs      int64  `json:"peakQueueWaitNs"`
	MeasurementWallNs    int64  `json:"measurementWallNs"`
	Scope                string `json:"scope"`
}
type submissionOccupancyRecorder struct {
	started, returned, active, peak, busy, waitSamples, waitNs, peakWait atomic.Int64
}

func (r *submissionOccupancyRecorder) begin() time.Time {
	r.started.Add(1)
	atomicMaximum(&r.peak, r.active.Add(1))
	return time.Now()
}
func (r *submissionOccupancyRecorder) end(began, start, offered time.Time) {
	r.busy.Add(time.Since(began).Nanoseconds())
	r.active.Add(-1)
	r.returned.Add(1)
	if !start.IsZero() {
		wait := start.Sub(offered).Nanoseconds()
		r.waitSamples.Add(1)
		r.waitNs.Add(wait)
		atomicMaximum(&r.peakWait, wait)
	}
}
func (r *submissionOccupancyRecorder) snapshot(wall time.Duration) *submissionOccupancyStats {
	if r == nil {
		return nil
	}
	return &submissionOccupancyStats{CallbackStarted: r.started.Load(), CallbackReturned: r.returned.Load(), ActiveCallbacksAtEnd: r.active.Load(), PeakActiveCallbacks: r.peak.Load(), CallbackBusyNs: r.busy.Load(), QueueWaitSamples: r.waitSamples.Load(), QueueWaitNs: r.waitNs.Load(), PeakQueueWaitNs: r.peakWait.Load(), MeasurementWallNs: wall.Nanoseconds(), Scope: "Original paced submit callback entry/return wall occupancy across workers; busy durations overlap and are not pure server/network/CPU. Queue wait sums actual offered-to-submit monotonic intervals for callbacks with a start timestamp; unfinished/unoffered inputs are not invented."}
}
