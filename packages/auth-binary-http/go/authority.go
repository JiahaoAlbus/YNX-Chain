package binaryhttpsource

import (
	"context"
	"io"
	"net/http"
)

// SDK owns the formal binary byte/body Bind formats and the new Host route.
// The SDK V5 callee is real; Root admission rows remain EMPTY. No caller can
// inject an expected hash, approved bool, result DTO or verification callback.
// A supplied real SDK successor must construct this private record only after
// the genuine original PS principal verification, and retain its own original
// current capability, not reconstruct authority from these DATA fields.
type verifiedBinaryPrincipal struct{ original *originalBinaryPrincipalV5 }

func (c *Capture) VerifyOriginalBinaryRequest(ctx context.Context, r *http.Request) error {
	if c == nil || ctx == nil || ctx.Err() != nil {
		return errRequest
	}
	if e := c.CurrentOriginalRequest(r); e != nil {
		return e
	}
	c.mu.Lock()
	if c.verifyEntered {
		c.mu.Unlock()
		return errDuplicate
	}
	c.verifyEntered = true
	c.mu.Unlock()
	verified, e := verifyOriginalSDKBinaryBodyAndPSPrincipal(ctx, r, c)
	c.mu.Lock()
	defer c.mu.Unlock()
	if verified != nil {
		c.verified = verified
	} // adopt actual verifier partial first
	if e != nil {
		if c.cause == nil {
			c.cause = e
		}
		if e != errNotSupplied || verified != nil {
			return c.fail(e)
		}
		return e
	}
	if verified == nil || verified.original == nil {
		return c.fail(errNotSupplied)
	}
	if e = c.checkOriginalLocked(r); e != nil {
		return c.fail(e)
	}
	if e = verified.original.assertOriginalBinaryRequestCurrent(ctx, r, c); e != nil {
		return c.fail(e)
	}
	c.verified = verified
	return nil
}

// Trusted borrow requires the SAME live original principal record/current and
// same request/capture, and latches before returning any body Reader. The
// positive path requires the genuine V5 Root callee and selected Root material.
func (c *Capture) BorrowOriginalBinaryRequestOnce(ctx context.Context, r *http.Request) (*Borrow, error) {
	if c == nil || ctx == nil || ctx.Err() != nil {
		return nil, errRequest
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.recovered {
		return nil, errRecovery
	}
	if c.verified == nil || c.verified.original == nil {
		return nil, errNotSupplied
	}
	if e := c.checkOriginalLocked(r); e != nil {
		return nil, c.fail(e)
	}
	if c.borrowEntered {
		return nil, errDuplicate
	}
	if e := c.verified.original.assertOriginalBinaryRequestCurrent(ctx, r, c); e != nil {
		return nil, c.fail(e)
	}
	c.borrowEntered = true
	c.borrowed = true
	b := &Borrow{capture: c, request: r, ctx: ctx}
	c.originalBorrow = b
	if e := c.checkOriginalLocked(r); e != nil {
		return b, c.fail(e)
	}
	if e := c.verified.original.assertOriginalBinaryRequestCurrent(ctx, r, c); e != nil {
		return b, c.fail(e)
	}
	return b, nil
}

type Borrow struct {
	capture *Capture
	request *http.Request
	ctx     context.Context
	offset  int64
	closed  bool
	first   error
}

func (*Borrow) String() string { return "OriginalBinaryRequestBorrow{private same-request custody}" }
func (b *Borrow) Read(p []byte) (int, error) {
	if b == nil || b.capture == nil {
		return 0, errClosed
	}
	c := b.capture
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.originalBorrow != b || b.closed || b.first != nil || !c.borrowed || b.ctx.Err() != nil {
		return 0, errClosed
	}
	if e := c.checkOriginalIdentityLocked(b.request); e != nil {
		b.first = c.fail(e)
		return 0, b.first
	}
	if e := c.verified.original.assertOriginalBinaryRequestCurrent(b.ctx, b.request, c); e != nil {
		b.first = c.fail(e)
		return 0, b.first
	}
	if b.offset >= c.size {
		return 0, io.EOF
	}
	limit := int64(len(p))
	if limit > c.size-b.offset {
		limit = c.size - b.offset
	}
	// The full actual FD was triple-hashed and copied before Root V5 verification.
	// This private immutable copy is never exposed; identity/ctime/current are
	// fenced for every chunk, while every explicit Root recheck rehashes the FD.
	temp := make([]byte, int(limit))
	defer clear(temp)
	o := c.verified.original
	o.mu.Lock()
	if int64(len(o.body)) != c.size {
		o.mu.Unlock()
		return 0, c.fail(errChanged)
	}
	n := copy(temp, o.body[b.offset:b.offset+limit])
	o.mu.Unlock()
	if after := c.checkOriginalIdentityLocked(b.request); after != nil {
		b.first = c.fail(after)
		return 0, b.first
	}
	if after := c.verified.original.assertOriginalBinaryRequestCurrent(b.ctx, b.request, c); after != nil {
		b.first = c.fail(after)
		return 0, b.first
	}
	if after := b.ctx.Err(); after != nil {
		b.first = c.fail(after)
		return 0, b.first
	}
	copy(p, temp[:n])
	b.offset += int64(n)
	return n, nil
}
func (b *Borrow) Close() error {
	if b == nil || b.capture == nil {
		return nil
	}
	c := b.capture
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.originalBorrow != b {
		return errChanged
	}
	if b.closed {
		return b.first
	}
	b.closed = true
	c.borrowed = false
	return b.first
}
