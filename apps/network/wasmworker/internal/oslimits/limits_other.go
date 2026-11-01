//go:build !darwin && !linux

package oslimits

// Other platforms retain the original controlled worker; no OS containment
// is advertised or production contribution enabled by this adapter.
func Apply(uint64, uint64) (Report, func(), error) { return Report{}, func() {}, nil }
