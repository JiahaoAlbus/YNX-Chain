package originalclient

import (
	"context"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	"strings"
)

// DATA-only original serializer. Syntax/canonical bytes are not Source approval,
// a caller context, a typed-call lease, a reserve or an effect permit.
func EncodeOriginalAuthorityBodyDATA(call TaskAuthorityCall) ([]byte, error) {
	return originalAuthorityBodyDATA(call, call.OriginalOperation != "")
}

type OriginalLocalCallerRoute struct {
	Method, Path, ContentType string
	MaxBodyBytes              int64
}
type OriginalLocalCallerRegistration struct {
	LocalService  string
	PeerUID       uint32
	PeerPID       int
	Actions       []string
	Effect, Query OriginalLocalCallerRoute
	Expires       string
}

func (s *protectedAuthoritySource) ReadOriginalLocalCallerRegistration(ctx context.Context) (OriginalLocalCallerRegistration, error) {
	var out OriginalLocalCallerRegistration
	if e := s.enter(ctx); e != nil {
		return out, e
	}
	defer s.active.Done()
	if e := s.check(ctx); e != nil {
		return out, e
	}
	d := s.caller
	out = OriginalLocalCallerRegistration{LocalService: d.LocalService, PeerUID: d.LocalUID, PeerPID: d.LocalPID, Actions: append([]string(nil), d.Actions...), Expires: d.Expires}
	// Exact base64/candidate metadata overhead counts against existing remote
	// request budget. Do not widen the fixed LINK operation's registered bound.
	empty, e := open.EncodeTaskAuthorityRequestDATA(open.TaskAuthorityRequestInputDATA{Version: "1", Nonce: strings.Repeat("0", 64), Account: d.Request.Account, CurrentTaskRevision: d.Request.TaskRevision, CurrentGeneration: d.Request.Generation, SourceExpires: d.Expires, OriginalBody: []byte{0}})
	if e != nil {
		return OriginalLocalCallerRegistration{}, e
	}
	for _, action := range d.Actions {
		opID, path := d.EffectOperation, d.LocalEffectPath
		if action == "query" {
			opID, path = d.QueryOperation, d.LocalQueryPath
		}
		var max int64
		for _, op := range s.profile.Operations {
			if op.ID == opID {
				max = op.MaxRequestBytes
			}
		}
		remaining := max - int64(len(empty)-2)
		if remaining < 4 {
			return OriginalLocalCallerRegistration{}, ErrWholeResponseLimit
		}
		budget := 3 * (remaining / 4)
		if budget > 1048576 {
			budget = 1048576
		}
		route := OriginalLocalCallerRoute{Method: "POST", Path: path, ContentType: "application/json", MaxBodyBytes: budget}
		if action == "query" {
			out.Query = route
		} else {
			out.Effect = route
		}
	}
	if e = s.check(ctx); e != nil {
		return OriginalLocalCallerRegistration{}, e
	}
	return out, nil
}
func (s *protectedAuthoritySource) qualifyOriginalPendingCall(ctx context.Context, call TaskAuthorityCall) error {
	if e := s.enter(ctx); e != nil {
		return e
	}
	defer s.active.Done()
	if e := s.check(ctx); e != nil {
		return e
	}
	copyCall, e := authorityCall(call, call.OriginalOperation != "")
	if e != nil {
		return e
	}
	if s.runtimes == nil {
		return ErrUnavailable
	}
	if e = s.runtimes.AssertCall(ctx, s.caller, copyCall); e != nil {
		return e
	}
	return s.check(ctx)
}
func (c *TaskAuthorityClient) ReadOriginalLocalCallerRegistration(ctx context.Context) (OriginalLocalCallerRegistration, error) {
	var zero OriginalLocalCallerRegistration
	if c == nil || ctx == nil {
		return zero, ErrUnavailable
	}
	c.mu.Lock()
	if c.retired || c.selected.Source == nil {
		c.mu.Unlock()
		return zero, ErrUnavailable
	}
	c.active.Add(1)
	c.mu.Unlock()
	defer c.active.Done()
	if e := c.current(ctx); e != nil {
		return zero, e
	}
	source, ok := c.selected.Source.(interface {
		ReadOriginalLocalCallerRegistration(context.Context) (OriginalLocalCallerRegistration, error)
	})
	if !ok {
		return zero, ErrUnavailable
	}
	v, e := source.ReadOriginalLocalCallerRegistration(ctx)
	if e != nil {
		return zero, e
	}
	if e = c.current(ctx); e != nil {
		return zero, e
	}
	v.Actions = append([]string(nil), v.Actions...)
	return v, nil
}
func (c *TaskAuthorityClient) qualifyOriginalPendingCall(ctx context.Context, call TaskAuthorityCall) error {
	if c == nil || ctx == nil {
		return ErrUnavailable
	}
	c.mu.Lock()
	if c.retired || c.selected.Source == nil {
		c.mu.Unlock()
		return ErrUnavailable
	}
	c.active.Add(1)
	c.mu.Unlock()
	defer c.active.Done()
	if e := c.current(ctx); e != nil {
		return e
	}
	source, ok := c.selected.Source.(interface {
		qualifyOriginalPendingCall(context.Context, TaskAuthorityCall) error
	})
	if !ok {
		return ErrUnavailable
	}
	if e := source.qualifyOriginalPendingCall(ctx, call); e != nil {
		return e
	}
	return c.current(ctx)
}
