//go:build !darwin || !cgo || !ynx_network_source_native

package networkresourcesource

func NativeLinked() bool { return false }
