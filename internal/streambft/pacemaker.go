package streambft

import (
	"errors"
	"sort"
	"time"
)

type PacemakerConfig struct {
	Minimum time.Duration
	Maximum time.Duration
	Factor  uint64
}

func (c PacemakerConfig) Validate() error {
	if c.Minimum <= 0 || c.Maximum < c.Minimum || c.Factor < 1 {
		return errors.New("invalid pacemaker bounds")
	}
	return nil
}

// AdaptiveTimeout is deterministic for the same committed latency sample. It
// uses the nearest-rank p95 and an integer factor, then clamps to safe bounds.
func AdaptiveTimeout(config PacemakerConfig, committedLatencies []time.Duration) (time.Duration, error) {
	if err := config.Validate(); err != nil {
		return 0, err
	}
	if len(committedLatencies) == 0 {
		return config.Minimum, nil
	}
	samples := append([]time.Duration(nil), committedLatencies...)
	for _, sample := range samples {
		if sample <= 0 {
			return 0, errors.New("pacemaker latency samples must be positive")
		}
	}
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	index := (95*len(samples) + 99) / 100
	if index == 0 {
		index = 1
	}
	timeout := samples[index-1] * time.Duration(config.Factor)
	if timeout < config.Minimum {
		return config.Minimum, nil
	}
	if timeout > config.Maximum {
		return config.Maximum, nil
	}
	return timeout, nil
}
