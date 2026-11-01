//go:build !linux

package contribution

import (
	"os/exec"
)

type linuxBackend struct{}
type linuxOperation struct{}

func NewLinuxContainedWASMExecutor(string, string, string) (*PinnedWASMExecutor, error) {
	return nil, ErrUnsupported
}
func (*linuxBackend) prepare(Limits) (*linuxOperation, error)                { return nil, ErrUnsupported }
func (*linuxBackend) close() error                                           { return nil }
func (*linuxBackend) checkPins() error                                       { return ErrUnsupported }
func (*linuxOperation) configure(*exec.Cmd, *processLimitPipe, string) error { return ErrUnsupported }
func (*linuxOperation) verify(*OSControls) error                             { return ErrUnsupported }
func (*linuxOperation) kill() error                                          { return ErrUnsupported }
func (*linuxOperation) finish() (*LinuxGroupUsage, error)                    { return nil, ErrUnsupported }
func (*linuxOperation) cleanup() error                                       { return nil }
