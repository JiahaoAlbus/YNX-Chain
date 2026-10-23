package main

import "runtime"

// Explicit client process only. The default performs no setter call, preserving
// the caller's existing scheduler policy. Restore on every execute return,
// including setup failure; no node environment or resource limit is changed.
func configureClientProcs(selected bool) func() {
	if !selected {
		return func() {}
	}
	previous := runtime.GOMAXPROCS(2)
	return func() { runtime.GOMAXPROCS(previous) }
}
