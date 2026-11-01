//go:build ynx_live_wire_observation

package main

import (
	"encoding/json"
	"errors"

	"github.com/cometbft/cometbft/mempool"
)

// This tag is only buildable with the separately pinned matching LINK fork.
// An ordinary fork deliberately has no inferred/reflected fallback getter.
const operatorWireLiveLinked = true

func newOperatorWireLiveGetter(reactor *mempool.Reactor) (operatorWireLiveGetter, error) {
	if reactor == nil {
		return nil, errors.New("original typed mempool reactor required")
	}
	return func() (operatorWireLiveSample, error) {
		original := reactor.LiveWireObservation()
		raw, err := json.Marshal(original)
		if err != nil {
			return operatorWireLiveSample{}, err
		}
		if len(raw) > operatorWireLiveLimit {
			return operatorWireLiveSample{}, errors.New("original typed live output exceeds fixed bound")
		}
		s := operatorWireLiveSample{raw: raw, pid: original.ProducerPID, reactor: original.ReactorLifetimeID, generation: original.LifecycleGeneration, reason: original.Reason}
		if original.ObserverLifetimeID != nil {
			s.observer = *original.ObserverLifetimeID
		}
		if original.StartMonotonicNs != nil {
			s.start = *original.StartMonotonicNs
		}
		if original.EndMonotonicNs != nil {
			s.end = *original.EndMonotonicNs
		}
		s.complete = original.Schema == mempool.LiveWireObservationSchema && original.Status == "OBSERVED" && original.Complete && original.ReactorRunningAtStart && original.ReactorRunningAtEnd && original.Clock == "CLOCK_MONOTONIC" && original.ClockStatus == "OBSERVED" && original.ClockError == "" && original.NonAtomic && original.CompletedCallsOnly && original.InFlightExcluded && original.EndpointOnly && !original.PhysicalBytesMeasured && original.Wire != nil && original.WireStatus.Attached && original.WireStatus.Complete && !original.WireStatus.Overflow
		return s, nil
	}, nil
}
