package securelink

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
)

const (
	LocalCallerDarwinProcessStart uint32 = 1
	LocalCallerLinuxProcessStart  uint32 = 2
)

// LocalCallerExpectedProcess is independently registered server DATA. It is
// never inferred from the connected peer, a response or the caller's process.
// UID/PID must also equal the immutable original LocalCallerClient config.
// Possessing this DATA does not supply Source, account or business authority.
type LocalCallerExpectedProcess struct {
	UID         uint32
	PID         int
	StartKind   uint32
	StartA      uint64
	StartB      uint64
	ImagePath   string
	ImageBytes  uint64
	ImageSHA256 [32]byte
}

// LocalCallerPeerObservation describes only the original connection's kernel
// and process observations. Completed HTTP plus EOF is not fresh liveness or
// Source approval. Process/peer failures still deny use and preserve raw DATA.
type LocalCallerPeerObservation struct {
	PeerIdentityAvailable    bool
	ProcessIdentityAvailable bool
	SameOriginalConnection   bool
	TerminalEOFObserved      bool
	LivenessProved           bool
}

var ErrOriginalLocalCallerCloseUnknown = errors.New("LINK original local caller physical close unknown")

// OriginalLocalCallerExchange retains one original client's one actual socket
// and process/image lease. There is no FD, destination or Source setter, and no
// second HTTP attempt. Adopt every nonnil partial before inspecting the error.
type OriginalLocalCallerExchange struct {
	state *originalLocalCallerExchangeState
}

type OriginalLocalCallerExchangeLifetime struct {
	Retired, Joined, Closed, CleanupUnknown bool
	CallComplete, DispatchPossible          bool
	Active                                  int
	FirstCause                              error
	Peer                                    LocalCallerPeerObservation
}

func validateLocalCallerExpectedProcess(p LocalCallerExpectedProcess) error {
	if p.UID == 0 || p.PID <= 0 || p.PID > 1<<31-1 || p.StartA == 0 || (p.StartKind != LocalCallerDarwinProcessStart && p.StartKind != LocalCallerLinuxProcessStart) ||
		(p.StartKind == LocalCallerDarwinProcessStart && p.StartB >= 1000000) || (p.StartKind == LocalCallerLinuxProcessStart && p.StartB != 0) ||
		!filepath.IsAbs(p.ImagePath) || filepath.Clean(p.ImagePath) != p.ImagePath || strings.ContainsRune(p.ImagePath, 0) || p.ImageSHA256 == ([32]byte{}) {
		return ErrDenied
	}
	if p.ImageBytes == 0 || p.ImageBytes > 128<<20 || len(p.ImagePath) > 4096 {
		return ErrBounds
	}
	return nil
}

// Current checks the SAME held connection/process. After complete HTTP it may
// accept observed terminal EOF, explicitly without claiming fresh liveness.
// Auth's original full Source Current remains an independent required check.
func (x *OriginalLocalCallerExchange) Current(ctx context.Context) error {
	if x == nil || x.state == nil {
		return ErrDenied
	}
	return x.state.current(ctx)
}

func (x *OriginalLocalCallerExchange) Retire() error {
	if x == nil || x.state == nil {
		return ErrDenied
	}
	return x.state.retire()
}

// Join waits only this exchange's original call and cancellation work. It does
// not release a response held by Auth or close any borrowed Source parent.
func (x *OriginalLocalCallerExchange) Join(ctx context.Context) error {
	if x == nil || x.state == nil {
		return ErrDenied
	}
	return x.state.join(ctx)
}

// Close selects physical socket/process-FD cleanup once, after Join. Operation
// first cause and actual closure are separate. UNKNOWN is never re-closed.
func (x *OriginalLocalCallerExchange) Close() error {
	if x == nil || x.state == nil {
		return ErrDenied
	}
	return x.state.close()
}

// AssertOriginalClosed is an error-only physical witness from this actual
// opaque owner, not a caller-supplied bool or permission to drop an Auth loan.
func (x *OriginalLocalCallerExchange) AssertOriginalClosed() error {
	if x == nil || x.state == nil {
		return ErrDenied
	}
	return x.state.assertClosed()
}

func (x *OriginalLocalCallerExchange) Lifetime() OriginalLocalCallerExchangeLifetime {
	if x == nil || x.state == nil {
		return OriginalLocalCallerExchangeLifetime{FirstCause: ErrDenied}
	}
	return x.state.lifetime()
}

func (x *OriginalLocalCallerExchange) FirstCause() error { return x.Lifetime().FirstCause }
