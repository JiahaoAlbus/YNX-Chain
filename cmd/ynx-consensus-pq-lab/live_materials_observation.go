//go:build unix

package main

import (
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// This is a signal tap for the one normal request process, not a cancellation
// controller. After a bounded CANCEL observation, restore and re-deliver the
// same default termination signal. Never turn it into a successful return or
// claim that publisher/descriptor debt has drained. SIGKILL is not observable.
func pqLabObserveRequestSignals(observation *consensus.PQLabLiveRequestObservation) func() {
	var watched []os.Signal
	for _, sig := range []os.Signal{os.Interrupt, syscall.SIGTERM} {
		if !signal.Ignored(sig) {
			watched = append(watched, sig)
		}
	}
	if len(watched) == 0 {
		return func() {}
	}
	signals := make(chan os.Signal, 1)
	finished := make(chan struct{})
	done := make(chan struct{})
	signal.Notify(signals, watched...)
	go func() {
		defer close(done)
		var observed os.Signal
		select {
		case observed = <-signals:
		case <-finished:
		}
		signal.Stop(signals)
		// Stop guarantees no further delivery. A signal queued at the normal
		// return boundary must not disappear because finished won the select.
		if observed == nil {
			select {
			case observed = <-signals:
			default:
			}
		}
		if observed == nil {
			return
		}
		sig := observed.(syscall.Signal)
		switch sig {
		case syscall.SIGINT:
			observation.CancelObserved(consensus.PQLabLiveObservationInterrupt)
		case syscall.SIGTERM:
			observation.CancelObserved(consensus.PQLabLiveObservationTerminate)
		}
		signal.Reset(observed)
		if err := syscall.Kill(os.Getpid(), sig); err != nil {
			// The OS refused its original signal. Do not claim default signal
			// completion or let a completed diagnostic turn into exit zero.
			os.Exit(1)
		}
		// Normal return joins this worker. Keep it pending until the original
		// signal actually terminates the process, rather than racing exit zero.
		select {}
	}()
	var once sync.Once
	return func() {
		once.Do(func() { close(finished) })
		<-done
	}
}
