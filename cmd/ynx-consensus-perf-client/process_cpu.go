package main

import (
	"errors"
	"time"
)

type processCPUUsage struct{ UserNs, SystemNs int64 }
type processCPUReport struct {
	Available               bool    `json:"available"`
	Samples                 int     `json:"samples"`
	UserNs                  int64   `json:"userNs"`
	SystemNs                int64   `json:"systemNs"`
	TotalNs                 int64   `json:"totalNs"`
	MeasurementWallNs       int64   `json:"measurementWallNs"`
	SampleBracketWallNs     int64   `json:"sampleBracketWallNs"`
	SampleBracketOverheadNs int64   `json:"sampleBracketOverheadNs"`
	CPUPercentOfOneCore     float64 `json:"cpuPercentOfOneCore"`
	Error                   string  `json:"error,omitempty"`
	Scope                   string  `json:"scope"`
}
type processCPUProbe struct {
	began      time.Time
	initial    processCPUUsage
	initialErr error
	read       func() (processCPUUsage, error)
}

func startProcessCPUProbe(enabled bool, read func() (processCPUUsage, error)) *processCPUProbe {
	if !enabled {
		return nil
	}
	p := &processCPUProbe{began: time.Now(), read: read}
	p.initial, p.initialErr = read()
	return p
}
func (p *processCPUProbe) finish(wall time.Duration) *processCPUReport {
	if p == nil {
		return nil
	}
	out := &processCPUReport{MeasurementWallNs: wall.Nanoseconds(), Scope: "RUSAGE_SELF process user/system CPU includes client HTTP, observer, decoder, Go runtime and GC; excludes separate nodes/other processes. Two cumulative samples bracket the client measurement; neither CPU nor wall durations are additive phase attribution."}
	current, err := p.read()
	out.SampleBracketWallNs = time.Since(p.began).Nanoseconds()
	out.SampleBracketOverheadNs = out.SampleBracketWallNs - out.MeasurementWallNs
	if p.initialErr != nil {
		err = p.initialErr
	}
	if err == nil && (p.initial.UserNs < 0 || p.initial.SystemNs < 0 || current.UserNs < p.initial.UserNs || current.SystemNs < p.initial.SystemNs || out.MeasurementWallNs <= 0 || out.SampleBracketOverheadNs < 0) {
		err = errors.New("process CPU counters or monotonic sample bracket regressed")
	}
	if err != nil {
		out.Error = err.Error()
		return out
	}
	out.Available = true
	out.Samples = 2
	out.UserNs = current.UserNs - p.initial.UserNs
	out.SystemNs = current.SystemNs - p.initial.SystemNs
	out.TotalNs = out.UserNs + out.SystemNs
	out.CPUPercentOfOneCore = 100 * float64(out.TotalNs) / float64(out.SampleBracketWallNs)
	return out
}
