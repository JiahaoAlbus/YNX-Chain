//go:build darwin || linux

package grantruntime

// Actual kernel process observation, not a Principal/Source/registration. The
// immutable Root-selected registration and Source are independently required.
type receiverProcess struct {
	PID      int
	UID, GID uint32
	Start    string
	Image    receiverImage
}
type receiverProcessObservation struct {
	Path     string
	UID, GID uint32
	Start    string
}
