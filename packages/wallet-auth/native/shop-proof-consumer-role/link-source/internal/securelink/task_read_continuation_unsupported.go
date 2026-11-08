//go:build !linux && !darwin

package securelink

import "context"

type taskReadContinuationState struct{}

func NewOriginalTaskReadContinuationServer(LocalCallerServerConfig) (*LocalCallerServer, error) {
	return nil, ErrUnavailable
}
func (*localCallerState) originalTaskReadContinuation(context.Context) (*OriginalTaskReadContinuation, error) {
	return nil, ErrUnavailable
}
func (*taskReadContinuationState) call(context.Context, byte) ([]byte, error) {
	return nil, ErrUnavailable
}
func (*taskReadContinuationState) retire() error              { return ErrUnavailable }
func (*taskReadContinuationState) join(context.Context) error { return ErrUnavailable }
func (*taskReadContinuationState) close() error               { return ErrUnavailable }
func (*taskReadContinuationState) lifetime() OriginalTaskReadContinuationLifetime {
	return OriginalTaskReadContinuationLifetime{Retired: true, DataOnly: true}
}
