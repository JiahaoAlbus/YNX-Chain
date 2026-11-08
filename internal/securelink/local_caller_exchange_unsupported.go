//go:build !darwin && !linux

package securelink

import "context"

type originalLocalCallerExchangeState struct{}

func (*LocalCallerClient) CallOriginalOwned(context.Context, string, string, string, []byte, LocalCallerExpectedProcess) (*OriginalLocalCallerExchange, LocalCallerResponse, error) {
	return nil, LocalCallerResponse{}, ErrUnavailable
}
func (*originalLocalCallerExchangeState) current(context.Context) error { return ErrUnavailable }
func (*originalLocalCallerExchangeState) retire() error                 { return ErrUnavailable }
func (*originalLocalCallerExchangeState) join(context.Context) error    { return ErrUnavailable }
func (*originalLocalCallerExchangeState) close() error                  { return ErrUnavailable }
func (*originalLocalCallerExchangeState) assertClosed() error           { return ErrUnavailable }
func (*originalLocalCallerExchangeState) lifetime() OriginalLocalCallerExchangeLifetime {
	return OriginalLocalCallerExchangeLifetime{FirstCause: ErrUnavailable}
}
