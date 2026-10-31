// Package authgrant implements PRIVATE Auth policy at the original Go resource
// boundary. It is not OPEN WIRE, a crypto provider, an authority DB or a public
// provider-registration API. Interfaces below must be supplied by the original
// protected verifier/held Source adapter, never from request JSON or a "verified"
// boolean. The repository does not yet install that production adapter.
package authgrant

import (
	"context"
	"errors"
	"fmt"
	"math/bits"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Code string

const (
	Unavailable  Code = "UNAVAILABLE"
	Invalid      Code = "INVALID"
	Denied       Code = "DENIED"
	Expired      Code = "EXPIRED"
	Retired      Code = "RETIRED"
	Stale        Code = "STALE"
	OriginalOnly Code = "ORIGINAL_OPERATION_ONLY"
)

// PolicyError carries only bounded public classification/original operation
// reference. It never logs proofs, Source handles, hidden rows or credentials.
type PolicyError struct {
	Code       Code
	Field      string
	OriginalOp string
	Cause      error
}

func (e *PolicyError) Error() string     { return string(e.Code) + ": " + e.Field }
func (e *PolicyError) Unwrap() error     { return e.Cause }
func refusal(c Code, field string) error { return &PolicyError{Code: c, Field: field} }

type FenceScope string

const (
	// This scope requires a genuine Source/resource authority fence spanning the
	// final check AND effect. A local P08 mutex alone is never such a fence.
	SameAuthorityResourceFence FenceScope = "same-authority-resource-fence"
	// A verified held Source can constrain this local read/egress gate but cannot
	// claim atomic revocation at an independently committing remote authority.
	EgressOnlyReadFence FenceScope = "egress-only-read-fence"
)

type Ref struct{ Realm, Tenant, Kind, ID, Revision string }
type Bind struct{ Bytes, SHA3_512, SHA512 string }
type Tool struct {
	ID, Version, Operation, Purpose, Risk string
	Schema                                Bind
}
type Sink struct{ Service, Tenant, Origin, Path, Region, Operation string }
type Source struct {
	Resource Ref
	Fields   []string
	Label    string
	Binding  Bind
}

// TaskEffectBinding is PRIVATE DATA selected from the actual original resource
// request and signed Grant/Invoke decoding. Existing product IDs are preserved.
// P08's ai.conversation.read/version1 is not aliased to shop.order.read.
type TaskEffectBinding struct {
	Realm, Tenant, Account, Audience        string
	GrantID, GrantRevision                  string
	Task                                    Ref
	Generation, StepID                      string
	Holder                                  Ref
	HolderEpoch                             string
	SessionID, SessionEpoch, ChannelBinding string
	Tool                                    Tool
	Input                                   Bind
	Fields                                  []string
	Target                                  Sink
	Resources                               []Ref
	Sources                                 []Source
	// Nil means no actual approved egress bytes exist. It cannot authorize an
	// external output even when an earlier private read was allowed.
	EgressActual *Bind
}

type SemanticSlot struct{ Realm, Tenant, Account, TaskID, Generation, StepID, Operation string }

func (b TaskEffectBinding) Slot() SemanticSlot {
	return SemanticSlot{b.Realm, b.Tenant, b.Account, b.Task.ID, b.Generation, b.StepID, b.Tool.Operation}
}

// Proof bytes are opaque to this package. The original verifier must decode
// the sole shared schema and verify BOTH original PQ branches, exact full
// payload and typed purpose against genuinely current registered identities.
type Proof struct {
	Payload, Wire []byte
	Purpose       string
}
type SourceVersion struct{ Authority, Revision, PolicyRevision string }
type PrincipalState struct {
	Ref                 Ref
	Epoch, Status, Role string
}
type TaskState struct {
	Ref                 Ref
	Generation          string
	Holder              Ref
	HolderEpoch, Status string
}
type SessionState struct {
	ID, Epoch, ChannelBinding string
	Holder                    Ref
	HolderEpoch, Status       string
}
type CatalogState struct {
	Tool             Tool
	Audience, Status string
	Egress           bool
}
type BudgetState struct {
	Status, Cap, SingleMax, Spent, Reserved, Requested string
	// Spent/reserved EXCLUDE this exact slot; Requested counts its original
	// claim once. UNKNOWN is not released and is denied below, not reissued.
	Slot SemanticSlot
}
type EffectState struct {
	State, OriginalOp string
	Slot              SemanticSlot
}
type DisclosureState struct {
	Status, GrantID, GrantRevision string
	Holder                         Ref
	HolderEpoch, Purpose, Expires  string
	Target                         Sink
	Sources                        []Source
	Actual                         Bind
}
type GrantState struct {
	ID, Revision, Status                            string
	Issuer                                          Ref
	IssuerEpoch                                     string
	Holder                                          Ref
	HolderEpoch, ValidFrom, Expires, Cap, SingleMax string
	NonDelegable                                    bool
	Binding                                         TaskEffectBinding
}
type Snapshot struct {
	Version             SourceVersion
	ObservedAt, Expires string
	Issuer, Holder      PrincipalState
	Grant               GrantState
	Task                TaskState
	Session             SessionState
	Catalog             CatalogState
	AuthorizedResources []Ref
	Sources             []Source
	Budget              BudgetState
	Effect              EffectState
	Disclosure          *DisclosureState
}

// OriginalTaskGrantVerifier is an original private composition operand. Do not
// implement a network endpoint accepting one, or turn a serialized callback or
// caller's "verified=true" into this interface. Nil always fails unavailable.
// A non-nil partial guard returned alongside error remains owned by the result.
type OriginalTaskGrantVerifier interface {
	OpenTaskGrantSource(context.Context, TaskEffectBinding, Proof, Proof) (HeldTaskGrantSource, error)
}
type HeldTaskGrantSource interface {
	Snapshot(context.Context) (Snapshot, error)
	AssertCurrent(context.Context, SourceVersion) error
	FenceScope() FenceScope
	Retire() error
	Join() error
	Close() error
}

// Decision is an in-process policy result only, NOT a bearer token, an effect
// receipt or proof of global/cross-service atomicity. Keep its held check owner
// alive until the original resource finishes its fenced read/write.
type Decision struct {
	Scope                  FenceScope
	Version                SourceVersion
	GrantID, GrantRevision string
	Slot                   SemanticSlot
}

type TaskGrantCheck struct {
	mu                      sync.Mutex
	source                  HeldTaskGrantSource
	expected                TaskEffectBinding
	selected                SourceVersion
	scope                   FenceScope
	deadline                uint64
	clock                   func() time.Time
	floor                   uint64
	ready, retired, closing bool
	first                   error
	retireOnce, closeOnce   sync.Once
	retireError, closeError error
}

// OpenTaskGrantAtEffect verifies through the original protected adapter and
// retains that guard. It returns a non-nil partial owner on later errors so the
// caller can always Retire/Close it. This does not install a production Source.
func OpenTaskGrantAtEffect(ctx context.Context, verifier OriginalTaskGrantVerifier, expected TaskEffectBinding, grantProof, holderProof Proof) (*TaskGrantCheck, error) {
	return openWithClock(ctx, verifier, expected, grantProof, holderProof, time.Now)
}

// Only tests in this package can substitute the clock; no public clock/setter.
func openWithClock(ctx context.Context, verifier OriginalTaskGrantVerifier, expected TaskEffectBinding, grantProof, holderProof Proof, clock func() time.Time) (*TaskGrantCheck, error) {
	if ctx == nil || nilInterface(verifier) {
		return nil, refusal(Unavailable, "original-protected-verifier")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	expected = cloneBinding(expected)
	if err := validateBinding(expected); err != nil {
		return nil, err
	}
	g, err := cloneProof(grantProof)
	if err != nil {
		return nil, err
	}
	h, err := cloneProof(holderProof)
	if err != nil {
		return nil, err
	}
	check := &TaskGrantCheck{expected: expected, clock: clock}
	guard, err := verifier.OpenTaskGrantSource(ctx, cloneBinding(expected), g, h)
	check.source = guard // Adopt original partial BEFORE inspecting the error.
	if err != nil {
		check.first = err
		return check, err
	}
	if nilInterface(guard) {
		err = refusal(Unavailable, "held-source")
		check.first = err
		return check, err
	}
	if err = check.initialize(ctx); err != nil {
		check.mu.Lock()
		check.first = err
		check.mu.Unlock()
		return check, err
	}
	return check, nil
}

func (c *TaskGrantCheck) initialize(ctx context.Context) error {
	s, err := c.source.Snapshot(ctx)
	if err != nil {
		return err
	}
	s = cloneSnapshot(s)
	now, err := c.now()
	if err != nil {
		return err
	}
	scope := c.source.FenceScope()
	if !validScope(scope) {
		return refusal(Unavailable, "source-fence-scope")
	}
	if err = validateSnapshot(c.expected, s, scope, now); err != nil {
		return err
	}
	deadline, _ := uint64Value(s.Expires)
	grantEnd, _ := uint64Value(s.Grant.Expires)
	if grantEnd < deadline {
		deadline = grantEnd
	}
	if s.Catalog.Egress {
		end, _ := uint64Value(s.Disclosure.Expires)
		if end < deadline {
			deadline = end
		}
	}
	if err = c.source.AssertCurrent(ctx, s.Version); err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	now, err = c.now()
	if err != nil {
		return err
	}
	if now >= deadline {
		return refusal(Expired, "selected-deadline")
	}
	if c.source.FenceScope() != scope {
		return refusal(Stale, "source-fence-scope")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.retired || c.closing {
		return refusal(Retired, "owner")
	}
	c.selected = s.Version
	c.scope = scope
	c.deadline = deadline
	c.ready = true
	return nil
}

// CheckTaskGrantAtEffect is synchronous and is called inside P08's ORIGINAL
// commitTaskReadAtEffectFence mutex callback immediately before the real read.
// The held Source guard must span this callback through the effect; do not
// release it when this function returns and then claim global atomicity.
func (c *TaskGrantCheck) CheckTaskGrantAtEffect(ctx context.Context) (Decision, error) {
	if c == nil {
		return Decision{}, refusal(Unavailable, "held-source-owner")
	}
	if ctx == nil {
		return Decision{}, c.record(refusal(Invalid, "context"))
	}
	if err := ctx.Err(); err != nil {
		return Decision{}, c.record(err)
	}
	if err := c.alive(); err != nil {
		return Decision{}, err
	}
	s, err := c.source.Snapshot(ctx)
	if err != nil {
		return Decision{}, c.record(err)
	}
	s = cloneSnapshot(s)
	if err = c.alive(); err != nil {
		return Decision{}, err
	}
	now, err := c.now()
	if err != nil {
		return Decision{}, c.record(err)
	}
	c.mu.Lock()
	selected, scope, deadline := c.selected, c.scope, c.deadline
	c.mu.Unlock()
	if s.Version != selected || c.source.FenceScope() != scope {
		return Decision{}, c.record(refusal(Stale, "source-version"))
	}
	if now >= deadline {
		return Decision{}, c.record(refusal(Expired, "selected-deadline"))
	}
	if c.source.FenceScope() != scope {
		return Decision{}, c.record(refusal(Stale, "source-fence-scope"))
	}
	if err = validateSnapshot(c.expected, s, scope, now); err != nil {
		return Decision{}, c.record(err)
	}
	currentDeadline, err := snapshotDeadline(s)
	if err != nil {
		return Decision{}, c.record(err)
	}
	if currentDeadline < deadline {
		deadline = currentDeadline
		c.mu.Lock()
		if deadline < c.deadline {
			c.deadline = deadline
		}
		c.mu.Unlock()
	}
	if err = c.source.AssertCurrent(ctx, selected); err != nil {
		return Decision{}, c.record(err)
	}
	// Read/verify may have awaited a Source/RPC boundary. Retirement, cancellation
	// and time are checked again at the final local authorization boundary.
	if err = ctx.Err(); err != nil {
		return Decision{}, c.record(err)
	}
	if err = c.alive(); err != nil {
		return Decision{}, err
	}
	now, err = c.now()
	if err != nil {
		return Decision{}, c.record(err)
	}
	if now >= deadline {
		return Decision{}, c.record(refusal(Expired, "selected-deadline"))
	}
	if c.source.FenceScope() != scope {
		return Decision{}, c.record(refusal(Stale, "source-fence-scope"))
	}
	if err = validateSnapshot(c.expected, s, scope, now); err != nil {
		return Decision{}, c.record(err)
	}
	if err = ctx.Err(); err != nil {
		return Decision{}, c.record(err)
	}
	if err = c.alive(); err != nil {
		return Decision{}, err
	}
	now, err = c.now()
	if err != nil {
		return Decision{}, c.record(err)
	}
	if now >= deadline {
		return Decision{}, c.record(refusal(Expired, "final-deadline"))
	}
	return Decision{Scope: scope, Version: selected, GrantID: c.expected.GrantID, GrantRevision: c.expected.GrantRevision, Slot: c.expected.Slot()}, nil
}

// Function form for resource packages that prefer a package-level final gate.
func CheckTaskGrantAtEffect(ctx context.Context, c *TaskGrantCheck) (Decision, error) {
	return c.CheckTaskGrantAtEffect(ctx)
}

func (c *TaskGrantCheck) alive() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.first != nil {
		return c.first
	}
	if c.retired || c.closing {
		return refusal(Retired, "owner")
	}
	if !c.ready || nilInterface(c.source) {
		return refusal(Unavailable, "held-source-owner")
	}
	return nil
}
func (c *TaskGrantCheck) record(err error) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.first == nil {
		c.first = err
	}
	return c.first
}
func (c *TaskGrantCheck) now() (uint64, error) {
	ms := c.clock().UnixMilli()
	if ms < 0 {
		return 0, refusal(Invalid, "clock")
	}
	n := uint64(ms)
	c.mu.Lock()
	defer c.mu.Unlock()
	if n < c.floor {
		return 0, refusal(Stale, "clock-rollback")
	}
	c.floor = n
	return n, nil
}
func (c *TaskGrantCheck) Retire() error {
	if c == nil {
		return nil
	}
	c.retireOnce.Do(func() {
		c.mu.Lock()
		c.retired = true
		c.mu.Unlock()
		if !nilInterface(c.source) {
			c.retireError = c.source.Retire()
		}
	})
	return c.retireError
}
func (c *TaskGrantCheck) Close() error {
	if c == nil {
		return nil
	}
	c.closeOnce.Do(func() {
		c.mu.Lock()
		c.closing = true
		c.mu.Unlock()
		var first error
		for _, fn := range []func() error{c.Retire, func() error {
			if nilInterface(c.source) {
				return nil
			}
			return c.source.Join()
		}, func() error {
			if nilInterface(c.source) {
				return nil
			}
			return c.source.Close()
		}} {
			if err := fn(); err != nil && first == nil {
				first = err
			}
		}
		c.closeError = first
	})
	return c.closeError
}

func validScope(v FenceScope) bool {
	return v == SameAuthorityResourceFence || v == EgressOnlyReadFence
}
func snapshotDeadline(s Snapshot) (uint64, error) {
	end, err := uint64Value(s.Expires)
	if err != nil {
		return 0, err
	}
	other, err := uint64Value(s.Grant.Expires)
	if err != nil {
		return 0, err
	}
	if other < end {
		end = other
	}
	if s.Catalog.Egress {
		if s.Disclosure == nil {
			return 0, refusal(Denied, "independent-disclosure-required")
		}
		other, err = uint64Value(s.Disclosure.Expires)
		if err != nil {
			return 0, err
		}
		if other < end {
			end = other
		}
	}
	return end, nil
}
func nilInterface(v any) bool {
	if v == nil {
		return true
	}
	k := reflect.ValueOf(v)
	switch k.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return k.IsNil()
	}
	return false
}
func uint64Value(v string) (uint64, error) {
	if v == "" || len(v) > 20 || len(v) > 1 && v[0] == '0' {
		return 0, refusal(Invalid, "uint64")
	}
	for _, c := range v {
		if c < '0' || c > '9' {
			return 0, refusal(Invalid, "uint64")
		}
	}
	n, e := strconv.ParseUint(v, 10, 64)
	if e != nil {
		return 0, refusal(Invalid, "uint64")
	}
	return n, nil
}
func identifier(v string) bool {
	if len(v) < 1 || len(v) > 256 {
		return false
	}
	for _, c := range v {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || strings.ContainsRune("._:/-", c)) {
			return false
		}
	}
	return true
}
func validRef(v Ref) bool {
	if !identifier(v.Realm) || !identifier(v.Tenant) || !identifier(v.Kind) || !identifier(v.ID) {
		return false
	}
	_, err := uint64Value(v.Revision)
	return err == nil
}
func validBind(v Bind) bool {
	if _, err := uint64Value(v.Bytes); err != nil {
		return false
	}
	for _, s := range []string{v.SHA3_512, v.SHA512} {
		if len(s) != 128 {
			return false
		}
		for _, c := range s {
			if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
				return false
			}
		}
	}
	return true
}
func stringSet(values []string) bool {
	if len(values) > 1024 {
		return false
	}
	seen := map[string]bool{}
	for _, v := range values {
		if len(v) < 1 || len(v) > 256 || seen[v] {
			return false
		}
		seen[v] = true
	}
	return true
}
func validateBinding(b TaskEffectBinding) error {
	for _, v := range []string{b.Realm, b.Tenant, b.Account, b.Audience, b.GrantID, b.StepID, b.SessionID, b.ChannelBinding, b.Tool.ID, b.Tool.Operation, b.Tool.Purpose, b.Target.Service, b.Target.Tenant, b.Target.Origin, b.Target.Path, b.Target.Region, b.Target.Operation} {
		if !identifier(v) {
			return refusal(Invalid, "binding-id")
		}
	}
	for _, v := range []string{b.GrantRevision, b.Generation, b.HolderEpoch, b.SessionEpoch, b.Tool.Version} {
		if _, e := uint64Value(v); e != nil {
			return e
		}
	}
	if !validRef(b.Task) || !validRef(b.Holder) || b.Holder.Kind != "agent" || b.Task.Realm != b.Realm || b.Task.Tenant != b.Tenant || b.Holder.Realm != b.Realm || b.Holder.Tenant != b.Tenant || b.Target.Service != b.Audience || b.Target.Tenant != b.Tenant || b.Target.Operation != b.Tool.Operation {
		return refusal(Denied, "binding-scope")
	}
	if !validBind(b.Input) || !validBind(b.Tool.Schema) || b.EgressActual != nil && !validBind(*b.EgressActual) || !stringSet(b.Fields) || len(b.Fields) == 0 {
		return refusal(Invalid, "binding-fields")
	}
	if b.Tool.Risk != "read" && b.Tool.Risk != "write" && b.Tool.Risk != "asset" {
		return refusal(Invalid, "tool-risk")
	}
	if len(b.Resources) == 0 || len(b.Resources) > 1024 || len(b.Sources) == 0 || len(b.Sources) > 1024 {
		return refusal(Invalid, "resources")
	}
	seen := map[Ref]bool{}
	for _, r := range b.Resources {
		if !validRef(r) || r.Realm != b.Realm || r.Tenant != b.Tenant || seen[r] {
			return refusal(Denied, "resource-scope")
		}
		seen[r] = true
	}
	seenSources := map[Ref]bool{}
	covered := map[string]bool{}
	for _, s := range b.Sources {
		if !validRef(s.Resource) || s.Resource.Realm != b.Realm || s.Resource.Tenant != b.Tenant || !seen[s.Resource] || seenSources[s.Resource] || !stringSet(s.Fields) || len(s.Fields) == 0 || !validBind(s.Binding) {
			return refusal(Denied, "source-binding")
		}
		seenSources[s.Resource] = true
		for _, f := range s.Fields {
			covered[f] = true
		}
		if s.Label != "PUBLIC" && s.Label != "TENANT" && s.Label != "RESTRICTED" && s.Label != "VAULT" {
			return refusal(Denied, "source-label")
		}
	}
	for _, f := range b.Fields {
		if !covered[f] {
			return refusal(Denied, "unlabelled-field")
		}
	}
	return nil
}

func validateSnapshot(b TaskEffectBinding, s Snapshot, scope FenceScope, now uint64) error {
	if !identifier(s.Version.Authority) {
		return refusal(Unavailable, "authority-version")
	}
	for _, v := range []string{s.Version.Revision, s.Version.PolicyRevision} {
		if _, e := uint64Value(v); e != nil {
			return e
		}
	}
	observed, e := uint64Value(s.ObservedAt)
	if e != nil {
		return e
	}
	end, e := uint64Value(s.Expires)
	if e != nil {
		return e
	}
	if observed > now || now >= end {
		return refusal(Expired, "source-window")
	}
	if s.Issuer.Status != "active" || !validRef(s.Issuer.Ref) || (s.Issuer.Role != "human" && s.Issuer.Role != "organization" && s.Issuer.Role != "service") || s.Issuer.Ref.Kind != s.Issuer.Role || s.Issuer.Ref.Realm != b.Realm || s.Issuer.Ref.Tenant != b.Tenant || s.Issuer.Ref != s.Grant.Issuer || s.Issuer.Epoch != s.Grant.IssuerEpoch {
		return refusal(Denied, "issuer-current")
	}
	if s.Holder.Status != "active" || s.Holder.Ref != b.Holder || s.Holder.Epoch != b.HolderEpoch || s.Grant.Holder != b.Holder || s.Grant.HolderEpoch != b.HolderEpoch {
		return refusal(Stale, "holder-epoch")
	}
	if s.Grant.ID != b.GrantID || s.Grant.Revision != b.GrantRevision || s.Grant.Status != "active" || !s.Grant.NonDelegable {
		return refusal(Denied, "grant-current")
	}
	start, e := uint64Value(s.Grant.ValidFrom)
	if e != nil {
		return e
	}
	end, e = uint64Value(s.Grant.Expires)
	if e != nil {
		return e
	}
	if now < start || now >= end {
		return refusal(Expired, "grant-window")
	}
	if !reflect.DeepEqual(b, s.Grant.Binding) {
		return refusal(Denied, "grant-exact-binding")
	}
	if s.Task.Ref != b.Task || s.Task.Generation != b.Generation || s.Task.Holder != b.Holder || s.Task.HolderEpoch != b.HolderEpoch || (s.Task.Status != "READY" && s.Task.Status != "WORKING") {
		return refusal(Stale, "task-current")
	}
	if s.Session.ID != b.SessionID || s.Session.Epoch != b.SessionEpoch || s.Session.ChannelBinding != b.ChannelBinding || s.Session.Holder != b.Holder || s.Session.HolderEpoch != b.HolderEpoch || s.Session.Status != "active" {
		return refusal(Stale, "session-current")
	}
	if s.Catalog.Status != "active" || s.Catalog.Audience != b.Audience || s.Catalog.Tool != b.Tool {
		return refusal(Denied, "registered-tool")
	}
	if b.Tool.Risk == "asset" || b.Tool.Operation == "wallet.approve" {
		return refusal(Denied, "separate-asset-approval-required")
	}
	if scope == EgressOnlyReadFence && b.Tool.Risk != "read" {
		return refusal(Unavailable, "joint-source-resource-fence-required")
	}
	if !validScope(scope) {
		return refusal(Unavailable, "source-fence-required")
	}
	if len(s.AuthorizedResources) > 1024 {
		return refusal(Invalid, "resource-count")
	}
	allowed := map[Ref]bool{}
	for _, r := range s.AuthorizedResources {
		if !validRef(r) || r.Realm != b.Realm || r.Tenant != b.Tenant {
			return refusal(Denied, "resource-control")
		}
		allowed[r] = true
	}
	for _, r := range b.Resources {
		if !allowed[r] {
			return refusal(Denied, "resource-control")
		}
	}
	if !reflect.DeepEqual(b.Sources, s.Sources) {
		return refusal(Stale, "source-version-or-label")
	}
	for _, source := range b.Sources {
		if source.Label == "VAULT" {
			return refusal(Denied, "vault")
		}
	}
	if s.Budget.Status != "ready" || s.Budget.Slot != b.Slot() || s.Effect.Slot != b.Slot() {
		return refusal(Stale, "semantic-slot")
	}
	if s.Effect.State != "NEW" {
		return &PolicyError{Code: OriginalOnly, Field: "no-replay", OriginalOp: s.Effect.OriginalOp}
	}
	if s.Budget.Cap != s.Grant.Cap || s.Budget.SingleMax != s.Grant.SingleMax {
		return refusal(Denied, "budget-grant-binding")
	}
	cap, e := uint64Value(s.Budget.Cap)
	if e != nil {
		return e
	}
	max, e := uint64Value(s.Budget.SingleMax)
	if e != nil {
		return e
	}
	spent, e := uint64Value(s.Budget.Spent)
	if e != nil {
		return e
	}
	reserved, e := uint64Value(s.Budget.Reserved)
	if e != nil {
		return e
	}
	amount, e := uint64Value(s.Budget.Requested)
	if e != nil {
		return e
	}
	sum, carry := bits.Add64(spent, reserved, 0)
	total, carry2 := bits.Add64(sum, amount, 0)
	if carry != 0 || carry2 != 0 || amount > max || total > cap {
		return refusal(Denied, "budget")
	}
	if s.Catalog.Egress {
		d := s.Disclosure
		if d == nil || b.EgressActual == nil || d.Status != "active" || d.GrantID != b.GrantID || d.GrantRevision != b.GrantRevision || d.Holder != b.Holder || d.HolderEpoch != b.HolderEpoch || d.Purpose != b.Tool.Purpose || d.Target != b.Target || !reflect.DeepEqual(d.Sources, b.Sources) || d.Actual != *b.EgressActual {
			return refusal(Denied, "independent-disclosure-required")
		}
		end, e := uint64Value(d.Expires)
		if e != nil {
			return e
		}
		if now >= end {
			return refusal(Expired, "disclosure-window")
		}
	}
	return nil
}

func cloneBinding(b TaskEffectBinding) TaskEffectBinding {
	b.Fields = append([]string(nil), b.Fields...)
	b.Resources = append([]Ref(nil), b.Resources...)
	b.Sources = cloneSources(b.Sources)
	if b.EgressActual != nil {
		v := *b.EgressActual
		b.EgressActual = &v
	}
	return b
}
func cloneSources(s []Source) []Source {
	out := append([]Source(nil), s...)
	for i := range out {
		out[i].Fields = append([]string(nil), out[i].Fields...)
	}
	return out
}
func cloneSnapshot(s Snapshot) Snapshot {
	s.Grant.Binding = cloneBinding(s.Grant.Binding)
	s.AuthorizedResources = append([]Ref(nil), s.AuthorizedResources...)
	s.Sources = cloneSources(s.Sources)
	if s.Disclosure != nil {
		d := *s.Disclosure
		d.Sources = cloneSources(d.Sources)
		s.Disclosure = &d
	}
	return s
}
func cloneProof(p Proof) (Proof, error) {
	if !identifier(p.Purpose) || len(p.Payload) < 1 || len(p.Payload) > 1048576 || len(p.Wire) < 1 || len(p.Wire) > 1048576 {
		return Proof{}, refusal(Invalid, "typed-proof")
	}
	p.Payload = append([]byte(nil), p.Payload...)
	p.Wire = append([]byte(nil), p.Wire...)
	return p, nil
}

// Classified allows original resource code to retain the original operation
// reference without guessing success or retrying UNKNOWN.
func Classified(err error) (Code, string) {
	var e *PolicyError
	if errors.As(err, &e) {
		return e.Code, e.OriginalOp
	}
	return Unavailable, ""
}
func (b TaskEffectBinding) String() string {
	return fmt.Sprintf("task=%s gen=%s step=%s", b.Task.ID, b.Generation, b.StepID)
}
