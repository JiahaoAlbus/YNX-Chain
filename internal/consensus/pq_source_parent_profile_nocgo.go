//go:build !cgo && (linux || darwin)

package consensus

// The ordinary observer remains buildable without Cgo. The optional protected
// profile has an explicit unsupported implementation, never a trust fallback.
type pqSourceCodeProfile struct{}
type pqSourceCodeDrain struct {
	failure      error
	physicalDone bool
}

func acquirePQOriginalSourceCodeProfile() (*pqSourceCodeProfile, error) {
	return nil, ErrPQOriginalSourceNativeBridgeUnavailable
}
func (*pqSourceCodeProfile) Current() error { return ErrPQOriginalSourceNativeBridgeUnavailable }
func (*pqSourceCodeProfile) ReadOriginalImagesDATA() ([3][32]byte, error) {
	return [3][32]byte{}, ErrPQOriginalSourceNativeBridgeUnavailable
}
func (*pqSourceCodeProfile) Retire() {}
func (*pqSourceCodeProfile) Close() pqSourceCodeDrain {
	return pqSourceCodeDrain{failure: ErrPQOriginalSourceNativeBridgeUnavailable, physicalDone: true}
}
