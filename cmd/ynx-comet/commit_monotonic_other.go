//go:build !linux

package main

type commitMonotonicClock struct{ source, boot, namespace, reason string }

func newCommitMonotonicClock(source string) commitMonotonicClock {
	return commitMonotonicClock{source: source, reason: "Linux CLOCK_MONOTONIC identity unavailable"}
}
func (c commitMonotonicClock) read() commitMonotonicReading {
	return commitMonotonicReading{Reason: c.reason}
}
