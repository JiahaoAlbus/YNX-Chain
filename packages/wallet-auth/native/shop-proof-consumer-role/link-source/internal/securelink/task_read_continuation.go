package securelink

import (
	"context"
	"fmt"
	"net/http"
)

// OriginalTaskReadContinuation is a transport capability bound to the original
// request minted by NewOriginalTaskReadContinuationServer. It is not an Auth
// Source, reservation verifier, receipt or permission to execute.
type OriginalTaskReadContinuation struct{ state *taskReadContinuationState }

// OriginalTaskReadContinuationRemoteError preserves error presence separately
// from a signed numeric code (including zero). Kind 2 means the original raw
// error remains owned by Node; it does not manufacture that JS value in Go.
type OriginalTaskReadContinuationRemoteError struct {
	Kind uint8
	Code int32
}

func (e *OriginalTaskReadContinuationRemoteError) Error() string {
	return fmt.Sprintf("LINK original task continuation remote error kind=%d code=%d", e.Kind, e.Code)
}

type OriginalTaskReadContinuationLifetime struct {
	Retired, Joined, Closed, ClaimSelected, CleanupUnknown bool
	Calls, Sequence                                        int
	FirstCause                                             error
	DataOnly, SourceVerified, OperationVerified            bool
}

// Exact request identity is mandatory here. A copied request with the genuine
// context does not acquire another continuation. Context derivation is allowed
// only through the original private LocalCaller inventory below.
func OriginalTaskReadContinuationFromOriginalRequest(r *http.Request) (*OriginalTaskReadContinuation, error) {
	c, err := LocalCallerFromRequest(r)
	if err != nil {
		return nil, err
	}
	return c.state.originalTaskReadContinuation(r.Context())
}

func OriginalTaskReadContinuationFromContext(ctx context.Context) (*OriginalTaskReadContinuation, error) {
	c, err := LocalCallerFromContext(ctx)
	if err != nil {
		return nil, err
	}
	return c.state.originalTaskReadContinuation(ctx)
}

func (c *OriginalTaskReadContinuation) Current(ctx context.Context) error {
	if c == nil || c.state == nil {
		return ErrDenied
	}
	_, err := c.state.call(ctx, 'C')
	return err
}

func (c *OriginalTaskReadContinuation) ReadOriginalRequestDATA(ctx context.Context) ([]byte, error) {
	if c == nil || c.state == nil {
		return nil, ErrDenied
	}
	return c.state.call(ctx, 'D')
}

// ClaimAtOriginalResourceFence performs exactly one bounded F roundtrip. It
// does not make another C request or call back into the resource Store. The
// actual Auth/Go adapter still owns all policy and reservation verification.
func (c *OriginalTaskReadContinuation) ClaimAtOriginalResourceFence(ctx context.Context) error {
	if c == nil || c.state == nil {
		return ErrDenied
	}
	_, err := c.state.call(ctx, 'F')
	return err
}

func (c *OriginalTaskReadContinuation) Retire() error {
	if c == nil || c.state == nil {
		return ErrDenied
	}
	return c.state.retire()
}
func (c *OriginalTaskReadContinuation) Join(ctx context.Context) error {
	if c == nil || c.state == nil {
		return ErrDenied
	}
	return c.state.join(ctx)
}
func (c *OriginalTaskReadContinuation) Close() error {
	if c == nil || c.state == nil {
		return ErrDenied
	}
	return c.state.close()
}
func (c *OriginalTaskReadContinuation) Lifetime() OriginalTaskReadContinuationLifetime {
	if c == nil || c.state == nil {
		return OriginalTaskReadContinuationLifetime{Retired: true, DataOnly: true}
	}
	return c.state.lifetime()
}
