//go:build darwin && cgo && ynx_network_source_native

package networkresourcesource

// NativeLinked is a build observation, never a Source or consent grant.
func NativeLinked() bool { return true }
