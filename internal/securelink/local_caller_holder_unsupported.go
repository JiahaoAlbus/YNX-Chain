//go:build !cgo || (!linux && !darwin)

package securelink

import (
	"context"
	"unsafe"
)

type NativeLocalCallerRegistration struct{}

func RegisterNativeLocalCallerClient(context.Context, *LocalCallerClient, [5]NativeLocalCallerBinding) (*NativeLocalCallerRegistration, error) {
	return nil, ErrUnavailable
}
func (*NativeLocalCallerRegistration) NativeRegistrationPointer() unsafe.Pointer { return nil }
func (*NativeLocalCallerRegistration) BorrowNativeRegistrationPointer() (unsafe.Pointer, error) {
	return nil, ErrUnavailable
}
func (*NativeLocalCallerRegistration) Retire() error              { return ErrUnavailable }
func (*NativeLocalCallerRegistration) Join(context.Context) error { return ErrUnavailable }
func (*NativeLocalCallerRegistration) Close() error               { return ErrUnavailable }
