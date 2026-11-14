package developerauthority

import (
	"context"
	"net/http"
	"time"
	binary "ynx.local/auth/binary-http-source"
)

type originalBinaryHTTPRecordV5 struct {
	request   *http.Request
	capture   *binary.Capture
	principal *binary.PrincipalBorrowV5
	body      *binary.Borrow
	value     Principal
	phase     string
	first     error
	cancel    context.CancelFunc
}

func originalBinaryV5Request(r *http.Request) bool {
	if r == nil {
		return false
	}
	_, ok := originalSingleHeader(r.Header, "x-ynx-product-session-proof-v5")
	return ok
}
func (o *OriginalDeveloperHTTPAuthority) currentOriginalBinaryPrincipalV5(ctx context.Context, r *http.Request) (Principal, error) {
	if o == nil || ctx == nil || ctx.Err() != nil || r == nil {
		return Principal{}, ErrDenied
	}
	o.mu.Lock()
	if o.closed {
		o.mu.Unlock()
		return Principal{}, ErrDenied
	}
	if o.binaryRecords == nil {
		o.binaryRecords = map[*http.Request]*originalBinaryHTTPRecordV5{}
	}
	held := o.binaryRecords[r]
	if held != nil {
		if held.phase != "verified" {
			o.mu.Unlock()
			return Principal{}, ErrUnknown
		}
		held.phase = "rechecking"
		o.wg.Add(1)
		o.mu.Unlock()
		defer o.wg.Done()
		e := held.principal.AssertCurrent(ctx, r)
		o.mu.Lock()
		defer o.mu.Unlock()
		if e != nil {
			held.phase = "unknown"
			held.first = e
			return Principal{}, ErrUnknown
		}
		v := held.principal.ViewOriginalDATA()
		if Principal(v) != held.value || o.closed {
			held.phase = "unknown"
			return Principal{}, ErrUnknown
		}
		held.phase = "verified"
		return held.value, nil
	}
	if len(o.binaryRecords) >= 32 {
		o.mu.Unlock()
		return Principal{}, ErrConflict
	}
	held = &originalBinaryHTTPRecordV5{request: r, phase: "selected"}
	o.binaryRecords[r] = held
	o.wg.Add(1)
	if o.binaryStore == nil {
		if o.binaryStoreSelecting {
			o.mu.Unlock()
			defer o.wg.Done()
			return Principal{}, ErrUnknown
		}
		o.binaryStoreSelecting = true
		store, e := binary.OpenOriginalBinaryV5Store()
		o.binaryStore = store
		if e != nil {
			held.phase = "unknown"
			held.first = e
			o.mu.Unlock()
			o.wg.Done()
			return Principal{}, e
		}
	}
	store := o.binaryStore
	ownedCtx, cancel := context.WithCancel(r.Context())
	held.cancel = cancel
	*r = *r.WithContext(ownedCtx)
	o.mu.Unlock()
	defer o.wg.Done()
	capture, e := binary.CaptureOriginalBinaryHTTPRequest(store, r)
	held.capture = capture
	if e == nil {
		e = capture.VerifyOriginalBinaryRequest(ctx, r)
	}
	if e == nil {
		held.principal, e = capture.BorrowOriginalPrincipalV5(ctx, r)
	}
	if e == nil {
		e = held.principal.AssertOriginalRootSPKI(o.binarySPKI)
	}
	if e == nil {
		e = held.principal.AssertCurrent(ctx, r)
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if e != nil {
		held.phase = "unknown"
		held.first = e
		return Principal{}, e
	}
	value := held.principal.ViewOriginalDATA()
	p := Principal(value)
	if !principalValid(p, time.Now().UnixMilli()) || o.closed {
		held.phase = "unknown"
		held.first = ErrDenied
		return Principal{}, ErrUnknown
	}
	held.value = p
	held.phase = "verified"
	return p, nil
}
func (o *OriginalDeveloperHTTPAuthority) recheckOriginalBinaryPrincipalV5(ctx context.Context, p Principal) (bool, error) {
	if o == nil {
		return false, nil
	}
	o.mu.Lock()
	var held *originalBinaryHTTPRecordV5
	for _, r := range o.binaryRecords {
		if r.value == p && r.value != (Principal{}) {
			if r.phase != "verified" {
				o.mu.Unlock()
				return true, ErrUnknown
			}
			if held != nil {
				o.mu.Unlock()
				return true, ErrDenied
			}
			held = r
		}
	}
	if held == nil {
		o.mu.Unlock()
		return false, nil
	}
	request := held.request
	o.mu.Unlock()
	_, e := o.currentOriginalBinaryPrincipalV5(ctx, request)
	return true, e
}

// Product binary branch must consume this original held Reader directly, not
// replace req.Body with an arbitrary wrapper or reopen an upload/file.
func (o *OriginalIDEPublicationSourceOwner) BorrowOriginalBinaryHTTPRequestV5(ctx context.Context, r *http.Request) (*binary.Borrow, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if e := o.check(ctx); e != nil {
		return nil, e
	}
	if _, e := o.principal.currentOriginalBinaryPrincipalV5(ctx, r); e != nil {
		return nil, e
	}
	p := o.principal
	p.mu.Lock()
	held := p.binaryRecords[r]
	if held == nil || held.phase != "verified" || held.body != nil {
		p.mu.Unlock()
		return nil, ErrDenied
	}
	p.wg.Add(1)
	p.mu.Unlock()
	defer p.wg.Done()
	body, e := held.capture.BorrowOriginalBinaryRequestOnce(ctx, r)
	p.mu.Lock()
	held.body = body
	if e != nil {
		held.phase = "unknown"
		held.first = e
	}
	p.mu.Unlock()
	return body, e
}
func (o *OriginalDeveloperHTTPAuthority) closeOriginalBinaryPrincipalV5() error {
	var first error
	for _, r := range o.binaryRecords {
		for _, close := range []func() error{func() error {
			if r.body != nil {
				return r.body.Close()
			}
			return nil
		}, func() error {
			if r.principal != nil {
				return r.principal.Close()
			}
			return nil
		}, func() error {
			if r.capture != nil {
				return r.capture.Close()
			}
			return nil
		}} {
			if e := close(); e != nil && first == nil {
				first = e
			}
		}
	}
	if o.binaryStore != nil {
		if e := o.binaryStore.Close(); e != nil && first == nil {
			first = e
		}
	}
	return first
}
