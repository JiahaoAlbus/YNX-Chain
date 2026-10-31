package originalclient

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	native "github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
	runtime "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
	"reflect"
	"sync"
	"time"
)

// PRIVATE Root-selected narrowing material. This does not itself approve a
// caller/grant: actual OS LocalCaller, original runtime math/policy and distinct
// registered whole-response issuer/current all remain independently required.
type authorityCallerDocument struct {
	Version, Authority, Realm, Tenant, ObservedAt, Expires string
	Request                                                runtime.OriginalTaskRequest
	LocalService                                           string
	LocalUID                                               uint32
	LocalPID                                               int
	LocalEffectPath, LocalQueryPath                        string
	EffectOperation, QueryOperation                        string
	Actions                                                []string
}
type protectedAuthorityRelease struct {
	Caller, PeerProfile, ResponseIssuer protectedRef
	TLS                                 native.Config
}

var admittedProtectedAuthorityReleases = [...]protectedAuthorityRelease{}

type pendingOriginalCall struct {
	call          TaskAuthorityCall
	action, nonce string
	body, wire    []byte
	channel       link.AuthenticatedChannel
	entered       bool
}
type protectedAuthoritySource struct {
	mu                      sync.Mutex
	active                  sync.WaitGroup
	retired                 bool
	lastTime                int64
	closeOnce               sync.Once
	closeErr                error
	callerHeld, profileHeld *heldDocument
	caller                  authorityCallerDocument
	profile                 link.FixedPeerProfile
	runtimes                originalCallerRuntimes
	verifier                *OriginalWholeResponseVerifier
	pending                 map[*link.LocalCaller]*pendingOriginalCall
}

func acquireProtectedOriginalAuthorityClient() (authorityClientSelection, error) {
	if len(admittedProtectedAuthorityReleases) != 1 {
		return authorityClientSelection{}, ErrUnavailable
	}
	for _, r := range admittedProtectedAuthorityReleases {
		return openProtectedAuthorityClient(r)
	}
	return authorityClientSelection{}, ErrUnavailable
}
func openProtectedAuthorityClient(r protectedAuthorityRelease) (selection authorityClientSelection, err error) {
	s := &protectedAuthoritySource{pending: map[*link.LocalCaller]*pendingOriginalCall{}}
	selection.Source = s
	s.callerHeld, err = holdDocument(r.Caller)
	if err != nil {
		return selection, err
	}
	if err = decodePrivate(s.callerHeld.raw, &s.caller); err != nil {
		return selection, err
	}
	s.profileHeld, err = holdDocument(r.PeerProfile)
	if err != nil {
		return selection, err
	}
	if err = decodePrivate(s.profileHeld.raw, &s.profile); err != nil {
		return selection, err
	}
	issuer, e := openResponseIssuer(r.ResponseIssuer)
	s.verifier = &OriginalWholeResponseVerifier{issuer: issuer}
	if e != nil {
		return selection, e
	}
	if err = s.check(context.Background()); err != nil {
		return selection, err
	}
	s.runtimes, err = openNormalCallerRuntimes(s.caller.Actions)
	if err != nil {
		return selection, err
	}
	// Use only the actual original FixedPeerClient/nativeTLS; no HTTP fallback or
	// alternate local caller/TLS implementation. Root tables are empty normally.
	selection.Peer, err = link.NewFixedPeerClient(link.FixedPeerClientConfig{Profile: s.profile, TLS: r.TLS, Timeout: 30 * time.Second})
	if err != nil {
		return selection, err
	}
	for _, a := range s.caller.Actions {
		if a == "effect" {
			selection.EffectOperation = s.caller.EffectOperation
		}
		if a == "query" {
			selection.QueryOperation = s.caller.QueryOperation
		}
	}
	return selection, nil
}
func (s *protectedAuthoritySource) enter(ctx context.Context) error {
	if s == nil || ctx == nil {
		return ErrUnavailable
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.retired {
		return ErrSourceRetired
	}
	s.active.Add(1)
	return nil
}
func (s *protectedAuthoritySource) check(ctx context.Context) error {
	if s == nil || ctx == nil {
		return ErrUnavailable
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	s.mu.Lock()
	retired := s.retired
	s.mu.Unlock()
	if retired {
		return ErrSourceRetired
	}
	if s.callerHeld == nil || s.profileHeld == nil || s.verifier == nil {
		return ErrUnavailable
	}
	if e := s.callerHeld.current(); e != nil {
		return e
	}
	if e := s.profileHeld.current(); e != nil {
		return e
	}
	if e := s.verifier.Current(ctx); e != nil {
		return e
	}
	d := s.caller
	if d.Version != "AUTH-ORIGINAL-AUTHORITY-CALLER/private-v1" || d.Authority == "" || d.Realm == "" || d.Tenant == "" || d.Request.Realm != d.Realm || d.Request.Tenant != d.Tenant || d.LocalUID == 0 || d.LocalPID < 1 || d.LocalService == "" || len(d.Actions) < 1 || len(d.Actions) > 2 {
		return ErrUnavailable
	}
	seen := map[string]bool{}
	for _, a := range d.Actions {
		if a != "effect" && a != "query" || seen[a] {
			return ErrUnavailable
		}
		seen[a] = true
	}
	if seen["effect"] && (d.EffectOperation == "" || d.LocalEffectPath == "") || seen["query"] && (d.QueryOperation == "" || d.LocalQueryPath == "") {
		return ErrUnavailable
	}
	if e := validateFormalOperations(d, s.profile); e != nil {
		return e
	}
	s.mu.Lock()
	now := time.Now().UnixMilli()
	if s.retired || now < s.lastTime {
		s.mu.Unlock()
		return ErrSourceCurrent
	}
	s.lastTime = now
	s.mu.Unlock()
	a, e := sourceUint(d.ObservedAt)
	if e != nil {
		return e
	}
	b, e := sourceUint(d.Expires)
	if e != nil || now < 0 || uint64(now) < a || uint64(now) >= b {
		return ErrSourceCurrent
	}
	reg := s.verifier.issuer.registration
	if reg.Authority != d.Authority || reg.Realm != d.Realm || reg.Tenant != d.Tenant || reg.Service != s.profile.Service {
		return ErrBinding
	}
	return ctx.Err()
}
func (s *protectedAuthoritySource) Current(ctx context.Context) error {
	if e := s.enter(ctx); e != nil {
		return e
	}
	defer s.active.Done()
	if e := s.check(ctx); e != nil {
		return e
	}
	return s.check(ctx)
}
func (s *protectedAuthoritySource) qualifiedCaller(ctx context.Context, call TaskAuthorityCall) (*link.LocalCaller, link.LocalCallerMaterial, error) {
	c, e := link.LocalCallerFromContext(ctx)
	if e != nil {
		return nil, link.LocalCallerMaterial{}, e
	}
	m, e := c.Current(ctx)
	if e != nil {
		return nil, m, e
	}
	d := s.caller
	history := call.OriginalOperation != ""
	wantedAction := "effect"
	if history {
		wantedAction = "query"
	}
	allowed := false
	for _, a := range d.Actions {
		if a == wantedAction {
			allowed = true
		}
	}
	if !allowed {
		return nil, m, ErrUnavailable
	}
	path := d.LocalEffectPath
	if history {
		path = d.LocalQueryPath
	}
	body, e := originalAuthorityBodyDATA(call, history)
	if e != nil {
		return nil, m, e
	}
	if m.Service != d.LocalService || m.PeerUID != d.LocalUID || m.PeerPID != d.LocalPID || m.Method != "POST" || m.Path != path || m.ContentType != "application/json" || m.ContentLength != int64(len(body)) || !bytes.Equal(m.RequestBody, body) {
		return nil, m, ErrBinding
	}
	if s.runtimes == nil {
		return nil, m, ErrUnavailable
	}
	if e = s.runtimes.AssertCall(ctx, d, call); e != nil {
		return nil, m, e
	}
	if e = s.check(ctx); e != nil {
		return nil, m, e
	}
	return c, m, nil
}
func (s *protectedAuthoritySource) AssertOriginalCallerAndBinding(ctx context.Context, call TaskAuthorityCall) error {
	if e := s.enter(ctx); e != nil {
		return e
	}
	defer s.active.Done()
	if e := s.check(ctx); e != nil {
		return e
	}
	_, _, e := s.qualifiedCaller(ctx, call)
	return e
}

func (s *protectedAuthoritySource) PrepareOriginalAuthorityWire(ctx context.Context, actual link.AuthenticatedChannel, action string, call TaskAuthorityCall) (link.WireRequest, error) {
	var zero link.WireRequest
	if e := s.enter(ctx); e != nil {
		return zero, e
	}
	defer s.active.Done()
	if e := s.check(ctx); e != nil {
		return zero, e
	}
	caller, _, e := s.qualifiedCaller(ctx, call)
	if e != nil {
		return zero, e
	}
	history := call.OriginalOperation != ""
	if action != "effect" && action != "query" || history != (action == "query") {
		return zero, ErrBinding
	}
	if actual.ConnectionID == (native.ConnectionID{}) || len(actual.Exporter) != 32 || actual.LocalSAN != s.profile.LocalSAN {
		return zero, ErrBinding
	}
	body, e := originalAuthorityBodyDATA(call, history)
	if e != nil {
		return zero, e
	}
	nonce := make([]byte, 32)
	if _, e = rand.Read(nonce); e != nil {
		return zero, e
	}
	n := hex.EncodeToString(nonce)
	wire, e := originalRequestDATABytes(OriginalWholeResponseExpected{Call: call, History: history, Nonce: n, Account: s.caller.Request.Account, CurrentTaskRevision: s.caller.Request.TaskRevision, CurrentGeneration: s.caller.Request.Generation, SourceExpires: s.caller.Expires})
	if e != nil {
		return zero, e
	}
	opID := s.caller.EffectOperation
	if history {
		opID = s.caller.QueryOperation
	}
	var op *link.ServiceOperation
	for i := range s.profile.Operations {
		if s.profile.Operations[i].ID == opID {
			op = &s.profile.Operations[i]
		}
	}
	if op == nil || op.Method != "POST" || int64(len(wire)) > op.MaxRequestBytes {
		return zero, ErrWholeResponseLimit
	}
	copyCall, e := authorityCall(call, history)
	if e != nil {
		return zero, e
	}
	s.mu.Lock()
	if s.retired {
		s.mu.Unlock()
		return zero, ErrSourceRetired
	}
	if _, exists := s.pending[caller]; exists {
		s.mu.Unlock()
		return zero, ErrWholeResponse
	}
	s.pending[caller] = &pendingOriginalCall{call: copyCall, action: action, nonce: n, body: bytes.Clone(body), wire: bytes.Clone(wire), channel: actual, entered: true}
	entry := s.pending[caller]
	s.mu.Unlock()
	context.AfterFunc(ctx, func() {
		s.mu.Lock()
		if s.pending[caller] == entry {
			delete(s.pending, caller)
		}
		s.mu.Unlock()
	})
	if e = s.check(ctx); e != nil {
		return zero, e
	}
	if _, e = caller.Current(ctx); e != nil {
		return zero, e
	}
	return link.WireRequest{Body: bytes.Clone(wire), ContentType: "application/json"}, nil
}
func (s *protectedAuthoritySource) VerifyOriginalAuthorityResponse(ctx context.Context, action string, call TaskAuthorityCall, response link.WireResponse) (TaskAuthorityResult, error) {
	var zero TaskAuthorityResult
	if e := s.enter(ctx); e != nil {
		return zero, e
	}
	defer s.active.Done()
	if e := s.check(ctx); e != nil {
		return zero, e
	}
	caller, _, e := s.qualifiedCaller(ctx, call)
	if e != nil {
		return zero, e
	}
	sealed, e := link.ProtectedExchangeFromResponse(ctx, response)
	if e != nil {
		return zero, e
	}
	m, e := sealed.Current(ctx)
	if e != nil {
		return zero, e
	}
	s.mu.Lock()
	p := s.pending[caller]
	// One verifier consumes one original pending exchange; lifecycle/UNKNOWN
	// recovery lives in original Source/SQL, not an unbounded in-process cache.
	if p != nil {
		delete(s.pending, caller)
	}
	s.mu.Unlock()
	if p == nil || p.action != action || !reflect.DeepEqual(p.call, call) || !reflect.DeepEqual(m.Profile, s.profile) || !bytes.Equal(m.Request.Body, p.wire) || m.Request.ContentType != "application/json" || m.ContentType != "application/json" || m.Channel.ConnectionID != p.channel.ConnectionID || !bytes.Equal(m.Channel.Exporter, p.channel.Exporter) {
		return zero, ErrBinding
	}
	evidence, e := DecodeOriginalWholeResponseDATA(m.ResponseBody, int(m.Operation.MaxResponseBytes))
	if e != nil {
		return zero, e
	}
	expected := OriginalWholeResponseExpected{RequestOriginal: bytes.Clone(p.wire), Call: p.call, History: action == "query", Authority: s.caller.Authority, Nonce: p.nonce, Account: s.caller.Request.Account, CurrentTaskRevision: s.caller.Request.TaskRevision, CurrentGeneration: s.caller.Request.Generation, SourceExpires: s.caller.Expires, Transport: OriginalResponseTransportFacts{Method: m.Operation.Method, Action: action, Path: m.Operation.Path, Service: m.Profile.Service, Origin: m.Profile.Origin, ContentType: "application/json", StatusCode: m.StatusCode}}
	result, e := s.verifier.Verify(ctx, expected, evidence)
	if e != nil {
		return authorityObservationPartial(result), e
	}
	if _, e = sealed.Current(ctx); e != nil {
		return authorityObservationPartial(result), e
	}
	if e = s.check(ctx); e != nil {
		return authorityObservationPartial(result), e
	}
	if e = s.runtimes.AssertCall(ctx, s.caller, call); e != nil {
		return authorityObservationPartial(result), e
	}
	result.OriginalServiceResponse = bytes.Clone(evidence.OriginalBody)
	return result, nil
}
func (s *protectedAuthoritySource) Retire() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	s.retired = true
	s.mu.Unlock()
	if s.runtimes != nil {
		return s.runtimes.Retire()
	}
	return nil
}
func (s *protectedAuthoritySource) Join() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	retired := s.retired
	s.mu.Unlock()
	if !retired {
		return ErrSourceRetired
	}
	s.active.Wait()
	if s.runtimes != nil {
		return s.runtimes.Join()
	}
	return nil
}
func (s *protectedAuthoritySource) Close() error {
	if s == nil {
		return nil
	}
	s.closeOnce.Do(func() {
		s.closeErr = errors.Join(s.Retire(), s.Join())
		if s.runtimes != nil {
			s.closeErr = errors.Join(s.closeErr, s.runtimes.Close())
		}
		if s.verifier != nil && s.verifier.issuer != nil {
			s.closeErr = errors.Join(s.closeErr, s.verifier.issuer.held.close())
		}
		for _, h := range []*heldDocument{s.profileHeld, s.callerHeld} {
			if h != nil {
				s.closeErr = errors.Join(s.closeErr, h.close())
			}
		}
	})
	return s.closeErr
}
