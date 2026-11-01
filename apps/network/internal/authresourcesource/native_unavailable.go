//go:build !darwin || !cgo || !ynx_network_source_native

package networkresourcesource

import (
	"fmt"
	"runtime"
)

type unavailable struct{}

func normalNative() native { return unavailable{} }
func (unavailable) acquire() (handle, error) {
	return handle{}, fmt.Errorf("%w: platform=%s; original Native archive/Root qualifier not installed", ErrNotSupplied, runtime.GOOS)
}
func (unavailable) current(handle) error                        { return ErrNotSupplied }
func (unavailable) read(handle, uint32) ([]byte, error)         { return nil, ErrNotSupplied }
func (unavailable) verify(handle, uint32, []byte, []byte) error { return ErrNotSupplied }
func (unavailable) retire(handle) error                         { return ErrNotSupplied }
func (unavailable) join(handle) drain                           { return drain{false, ErrNotSupplied} }
func (unavailable) close(handle) drain                          { return drain{false, ErrNotSupplied} }
