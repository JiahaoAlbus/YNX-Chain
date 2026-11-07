//go:build unix

package consensus

import (
	"context"
	"errors"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

var ErrPQCommittedAccountCaptureSelected = errors.New("original account capture has already been selected")

// PQCommittedAccountHandler is one purpose-closed, same-engine account-proof
// operation owned by the normal launcher. It has no FD, engine-reference map,
// checkpoint/path input, Root/current boolean, arbitrary provider or signer.
// Copies share every selection, first failure and close/debt state.
//
// This is the owning Go host implementation, not transport authentication or a
// Native receipt. The original launcher must retain the actual App/Node owner,
// bind its independently qualified peer and retire/join/close this child before
// releasing that owner. Auth still selects Root/Source and checks its window.
type PQCommittedAccountHandler struct{ core *pqCommittedAccountHandler }

type pqCommittedAccountHandler struct {
	app                                *Application
	source                             *PQWalletPolicyLiveSource
	ctx                                context.Context
	cancel                             context.CancelFunc
	mu                                 sync.Mutex
	selected, running, retired, closed bool
	firstCause                         error
	reader                             *PQCommittedAccountReader
	wg                                 sync.WaitGroup
}

// NewPQCommittedAccountHandler is called at the normal host's owning App
// boundary, after the original Node constructor has bound that exact App.
// It captures the real pointers, never resolves a caller string to an App and
// never starts/reopens a Node or installs another proof consumer. A nonnil
// partial must be adopted before interpreting err, then Close'd.
func NewPQCommittedAccountHandler(parent context.Context, app *Application) (h *PQCommittedAccountHandler, err error) {
	if parent == nil || app == nil {
		return nil, errors.New("original launcher context and owning application required")
	}
	source, err := app.WalletPolicyLiveSource()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	c := &pqCommittedAccountHandler{app: app, source: source, ctx: ctx, cancel: cancel}
	h = &PQCommittedAccountHandler{core: c}
	if err = c.sameSource(); err != nil {
		c.fail(err)
	}
	return h, err
}

func (c *pqCommittedAccountHandler) sameSource() error {
	if err := c.ctx.Err(); err != nil {
		return err
	}
	source, err := c.app.WalletPolicyLiveSource()
	if err != nil {
		return err
	}
	if source != c.source {
		return ErrPQCommittedAccountRetired
	}
	return c.ctx.Err()
}
func (c *pqCommittedAccountHandler) fail(err error) {
	if err == nil || err == ErrPQCommittedAccountNotReady {
		return
	}
	c.mu.Lock()
	if c.firstCause == nil {
		c.firstCause = err
	}
	c.retired = true
	c.mu.Unlock()
	c.cancel()
}

// Selection precedes every actual capture access, including a failed original
// owner validation. A malformed/UNKNOWN first capture cannot be changed/retried.
func (c *pqCommittedAccountHandler) begin(capture bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.firstCause != nil {
		return c.firstCause
	}
	if c.retired || c.closed {
		return ErrPQCommittedAccountRetired
	}
	if err := c.ctx.Err(); err != nil {
		return err
	}
	if c.running {
		return ErrPQCommittedAccountBusy
	}
	if capture {
		if c.selected {
			return ErrPQCommittedAccountCaptureSelected
		}
		c.selected = true
	} else if !c.selected || c.reader == nil {
		return errors.New("original account capture is required before read")
	}
	c.running = true
	c.wg.Add(1)
	return nil
}
func (c *pqCommittedAccountHandler) finish(out **PQCommittedAccountProof, err *error) {
	c.mu.Lock()
	if c.retired || c.ctx.Err() != nil {
		if *err == nil || *err == ErrPQCommittedAccountNotReady {
			*err = c.ctx.Err()
			if *err == nil {
				*err = ErrPQCommittedAccountRetired
			}
		}
	}
	if *err != nil && *err != ErrPQCommittedAccountNotReady {
		if c.firstCause == nil {
			c.firstCause = *err
		}
		c.retired = true
	}
	if *err != nil {
		*out = nil
	}
	retired := c.retired
	c.running = false
	c.wg.Done()
	c.mu.Unlock()
	if retired {
		c.cancel()
	}
}

// Capture selects one canonical owner exactly once. It opens the original
// reader and attempts its real H/H+1 proof. NotReady retains this SAME capture
// for an explicit later Read within the original context; there is no timer,
// polling, automatic wait/retry, recapture or implicit readiness promotion.
func (h *PQCommittedAccountHandler) Capture(owner string) (out *PQCommittedAccountProof, err error) {
	if h == nil || h.core == nil {
		return nil, ErrPQCommittedAccountRetired
	}
	c := h.core
	if err = c.begin(true); err != nil {
		if err != ErrPQCommittedAccountBusy {
			c.fail(err)
		}
		return nil, err
	}
	defer func() {
		if recover() != nil {
			err = errors.New("original account handler capture failed")
		}
		c.finish(&out, &err)
	}()
	if !accountaddress.IsCanonical(owner) {
		return nil, errors.New("canonical original account required")
	}
	if err = c.sameSource(); err != nil {
		return nil, err
	}
	reader, openErr := OpenPQCommittedAccountReader(c.ctx, c.app, owner)
	// Publish every nonnil partial before looking at openErr. A simultaneous
	// Retire/Join therefore cannot lose the child created in this window.
	c.mu.Lock()
	c.reader = reader
	retired := c.retired
	c.mu.Unlock()
	if retired && reader != nil {
		_ = reader.Retire()
	}
	if openErr != nil {
		return nil, openErr
	}
	if reader == nil {
		return nil, errors.New("original reader missing without failure")
	}
	if reader.core.source != c.source {
		return nil, ErrPQCommittedAccountRetired
	}
	out, err = reader.Read()
	if err == nil || err == ErrPQCommittedAccountNotReady {
		if currentErr := c.sameSource(); currentErr != nil {
			return nil, currentErr
		}
	}
	return out, err
}

func (h *PQCommittedAccountHandler) read(current bool) (out *PQCommittedAccountProof, err error) {
	if h == nil || h.core == nil {
		return nil, ErrPQCommittedAccountRetired
	}
	c := h.core
	if err = c.begin(false); err != nil {
		if err != ErrPQCommittedAccountBusy {
			c.fail(err)
		}
		return nil, err
	}
	defer func() {
		if recover() != nil {
			err = errors.New("original account handler read failed")
		}
		c.finish(&out, &err)
	}()
	if err = c.sameSource(); err != nil {
		return nil, err
	}
	c.mu.Lock()
	reader := c.reader
	c.mu.Unlock()
	if current {
		out, err = reader.Current()
	} else {
		out, err = reader.Read()
	}
	if err == nil || err == ErrPQCommittedAccountNotReady {
		if currentErr := c.sameSource(); currentErr != nil {
			return nil, currentErr
		}
	}
	return out, err
}
func (h *PQCommittedAccountHandler) Read() (*PQCommittedAccountProof, error) { return h.read(false) }

// Current returns the original proof plus separate actual current engine/owner
// facts. It does not equate unchanged policy JSON with unchanged ledger nonce,
// or rename the historical revision/execution height as current authority.
func (h *PQCommittedAccountHandler) Current() (*PQCommittedAccountProof, error) { return h.read(true) }

func (h *PQCommittedAccountHandler) Retire() error {
	if h == nil || h.core == nil {
		return ErrPQCommittedAccountRetired
	}
	c := h.core
	c.mu.Lock()
	c.retired = true
	reader := c.reader
	first := c.firstCause
	c.mu.Unlock()
	c.cancel()
	if reader != nil {
		_ = reader.Retire()
	}
	return first
}

// Join covers the entire handler operation (including Open and publication of
// a late partial), then the original reader. Waiting for only its math debt
// would miss a concurrent capture which has not published its reader yet.
func (h *PQCommittedAccountHandler) Join() error {
	if h == nil || h.core == nil {
		return ErrPQCommittedAccountRetired
	}
	c := h.core
	c.mu.Lock()
	retired := c.retired
	c.mu.Unlock()
	if !retired {
		return errors.New("retire original account handler before join")
	}
	c.wg.Wait()
	c.mu.Lock()
	reader := c.reader
	c.mu.Unlock()
	if reader != nil {
		_ = reader.Retire()
		if err := reader.Join(); err != nil {
			c.fail(err)
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.firstCause
}
func (h *PQCommittedAccountHandler) Close() error {
	if h == nil || h.core == nil {
		return ErrPQCommittedAccountRetired
	}
	c := h.core
	_ = h.Retire()
	_ = h.Join()
	c.mu.Lock()
	reader := c.reader
	c.mu.Unlock()
	if reader != nil {
		if err := reader.Close(); err != nil {
			c.fail(err)
		}
	}
	c.mu.Lock()
	c.closed = true
	err := c.firstCause
	c.mu.Unlock()
	return err
}
func (h *PQCommittedAccountHandler) IsClosed() bool {
	if h == nil || h.core == nil {
		return false
	}
	c := h.core
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closed && c.retired && !c.running && (c.reader == nil || c.reader.IsClosed())
}
