package developerauthority

// Actual database/sql path with explicit PUBLIC transactional driver fixtures.
// These tests do not claim PostgreSQL, real process durability or deployment.
import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/base64"
	"errors"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type approvalFixtureRecord struct {
	w       originalApprovalRow
	profile string
}
type approvalFixtureQuery struct {
	state       string
	raw         []byte
	hash, phase string
	sequence    int64
}
type approvalFixture struct {
	mu         sync.Mutex
	records    map[string]approvalFixtureRecord
	history    map[string]bool
	queries    map[string]approvalFixtureQuery
	schema     int64
	failAfter  string
	afterWrite func()
	writes     int
}
type approvalConnector struct{ s *approvalFixture }
type approvalDriver struct{}
type approvalConn struct{ s *approvalFixture }

func (approvalDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("PUBLIC connector only")
}
func (c approvalConnector) Connect(context.Context) (driver.Conn, error) {
	return &approvalConn{c.s}, nil
}
func (approvalConnector) Driver() driver.Driver { return approvalDriver{} }
func (*approvalConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("PUBLIC no prepare")
}
func (*approvalConn) Close() error { return nil }
func (*approvalConn) Begin() (driver.Tx, error) {
	return nil, errors.New("PUBLIC atomic query fixture")
}

type approvalRows struct {
	v [][]driver.Value
	n int
}

func (r *approvalRows) Columns() []string {
	a := make([]string, r.n)
	for i := range a {
		a[i] = "PUBLIC"
	}
	return a
}
func (*approvalRows) Close() error { return nil }
func (r *approvalRows) Next(dst []driver.Value) error {
	if len(r.v) == 0 {
		return io.EOF
	}
	copy(dst, r.v[0])
	r.v = r.v[1:]
	return nil
}
func approvalValues(w originalApprovalRow) []driver.Value {
	return []driver.Value{w.scope.original, w.scope.digest, w.scope.ref, w.scope.confirmation, w.scope.revocation, w.scope.approvedMS, w.scope.expiresMS, w.sequence, w.floor, w.decision, w.requestState, w.resultOriginal, w.resultSHA256, w.stateSHA256, w.observedMS}
}
func (c *approvalConn) QueryContext(ctx context.Context, q string, a []driver.NamedValue) (driver.Rows, error) {
	c.s.mu.Lock()
	defer c.s.mu.Unlock()
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	if strings.Contains(q, "approval_schema") {
		return &approvalRows{[][]driver.Value{{c.s.schema}}, 1}, nil
	}
	s := func(i int) string { return a[i].Value.(string) }
	n := func(i int) int64 { return a[i].Value.(int64) }
	b := func(i int) []byte { return append([]byte(nil), a[i].Value.([]byte)...) }
	empty := func() *approvalRows { return &approvalRows{n: 15} }
	out := func(w originalApprovalRow) (driver.Rows, error) {
		if c.s.afterWrite != nil {
			c.s.afterWrite()
		}
		if c.s.failAfter == q {
			return nil, errors.New("PUBLIC applied result lost")
		}
		return &approvalRows{[][]driver.Value{approvalValues(w)}, 15}, nil
	}
	key := s(0) + "/" + s(1) + "/"
	switch q {
	case approvalInsertSQL:
		key += s(5)
		if _, ok := c.s.records[key]; ok {
			return empty(), nil
		}
		w := originalApprovalRow{scope: originalApprovalScopeDATA{original: b(3), digest: s(4), ref: s(5), confirmation: s(6), revocation: s(7), approvedMS: n(8), expiresMS: n(9)}, sequence: 1, decision: "approved", requestState: "selected", resultOriginal: b(10), stateSHA256: s(11), observedMS: n(12)}
		c.s.records[key] = approvalFixtureRecord{w, s(2)}
		c.s.writes++
		return out(w)
	case approvalReadSQL:
		key += s(3)
		r, ok := c.s.records[key]
		if !ok || r.profile != s(2) {
			return empty(), nil
		}
		return &approvalRows{[][]driver.Value{approvalValues(r.w)}, 15}, nil
	case approvalTransitionSQL:
		key += s(3)
		r, ok := c.s.records[key]
		if !ok || r.profile != s(2) || r.w.stateSHA256 != s(4) || r.w.observedMS > n(11) || r.w.scope.expiresMS <= n(11) {
			return empty(), nil
		}
		hk := key + "/" + s(12)
		if c.s.history[hk] {
			return nil, errors.New("PUBLIC atomic history conflict: no update")
		}
		r.w.sequence++
		r.w.floor = n(5)
		r.w.decision = s(6)
		r.w.requestState = s(7)
		r.w.resultOriginal = b(8)
		r.w.resultSHA256 = s(9)
		r.w.stateSHA256 = s(10)
		r.w.observedMS = n(11)
		c.s.records[key] = r
		c.s.history[hk] = true
		c.s.writes++
		return out(r.w)
	case approvalReserveSQL:
		key += s(3)
		r, ok := c.s.records[key]
		if !ok || r.profile != s(2) || r.w.observedMS > n(5) || r.w.scope.expiresMS <= n(5) {
			return empty(), nil
		}
		r.w.observedMS = n(5)
		c.s.records[key] = r
		qk := key + "/" + s(4)
		if _, exists := c.s.queries[qk]; exists {
			return empty(), nil
		}
		c.s.queries[qk] = approvalFixtureQuery{state: r.w.stateSHA256, phase: "entered", sequence: r.w.sequence}
		c.s.writes++
		return out(r.w)
	case approvalCompleteQuerySQL:
		key += s(2)
		r, ok := c.s.records[key]
		qk := key + "/" + s(3)
		v, exists := c.s.queries[qk]
		if !ok || !exists || v.phase != "entered" || v.state != s(4) || r.w.stateSHA256 != s(4) || r.w.scope.expiresMS <= n(5) {
			return &approvalRows{n: 3}, nil
		}
		v.raw = b(6)
		v.hash = s(7)
		v.phase = "terminal"
		c.s.queries[qk] = v
		c.s.writes++
		if c.s.afterWrite != nil {
			c.s.afterWrite()
		}
		if c.s.failAfter == q {
			return nil, errors.New("PUBLIC complete applied lost")
		}
		return &approvalRows{[][]driver.Value{{v.raw, v.hash, v.phase}}, 3}, nil
	case approvalObserveQuerySQL:
		key += s(3)
		r, ok := c.s.records[key]
		v, exists := c.s.queries[key+"/"+s(4)]
		if !ok || !exists || r.profile != s(2) {
			return &approvalRows{n: 6}, nil
		}
		return &approvalRows{[][]driver.Value{{v.state, v.sequence, v.phase, int64(1000), v.raw, v.hash}}, 6}, nil
	}
	return nil, errors.New("PUBLIC unexpected SQL")
}
func newApprovalFixture(t *testing.T) (*sql.DB, *approvalFixture, originalApprovalStoreConfig) {
	t.Helper()
	s := &approvalFixture{records: map[string]approvalFixtureRecord{}, history: map[string]bool{}, queries: map[string]approvalFixtureQuery{}, schema: 1}
	db := sql.OpenDB(approvalConnector{s})
	db.SetMaxOpenConns(32)
	t.Cleanup(func() { db.Close() })
	return db, s, originalApprovalStoreConfig{"PUBLIC-source", "PUBLIC-instance", strings.Repeat("a", 64)}
}
func openApprovalFixture(t *testing.T, db *sql.DB, c originalApprovalStoreConfig) *originalApprovalStore {
	t.Helper()
	o, e := openOriginalApprovalStore(context.Background(), db, c)
	if e != nil {
		t.Fatal(e)
	}
	o.now = func() time.Time { return time.UnixMilli(1000) }
	return o
}
func publicApprovalScope() originalApprovalScopeDATA {
	raw := []byte(`{"PUBLIC-storage-fixture-not-an-admitted-scope":true}`)
	return originalApprovalScopeDATA{raw, hash(raw), "11111111-1111-4111-8111-111111111111", "PUBLIC-confirm", "PUBLIC-revoke", 1000, 31000}
}
func setupSignedApproval(t *testing.T, o *originalApprovalStore) *originalApprovalRow {
	t.Helper()
	r, e := o.prepare(context.Background(), publicApprovalScope())
	if e != nil {
		t.Fatal(e)
	}
	r, e = o.transition(context.Background(), r.scope.ref, strings.Repeat("b", 64), r.stateSHA256, "approved", "signed-unhanded", 0, []byte("PUBLIC-retained-result"))
	if e != nil {
		t.Fatal(e)
	}
	return r
}
func nonce(i byte) string {
	b := make([]byte, 32)
	b[0] = i
	return base64.RawURLEncoding.EncodeToString(b)
}
func TestApprovalStoreOriginalResultAndRestartNonceFence(t *testing.T) {
	db, s, c := newApprovalFixture(t)
	o := openApprovalFixture(t, db, c)
	r := setupSignedApproval(t, o)
	q, e := o.reserveQuery(context.Background(), r.scope.ref, nonce(1))
	if e != nil {
		t.Fatal(e)
	}
	if e = o.selectQuerySigning(context.Background(), q); e != nil {
		t.Fatal(e)
	}
	if e = o.selectQuerySigning(context.Background(), q); e != ErrConflict {
		t.Fatal("second selected", e)
	}
	if e = o.completeQuery(context.Background(), q, []byte("PUBLIC-signed-envelope-not-a-real-proof")); e != nil {
		t.Fatal(e)
	}
	if e = o.Close(); e != nil {
		t.Fatal(e)
	}
	restart := openApprovalFixture(t, db, c)
	if _, e = restart.reserveQuery(context.Background(), r.scope.ref, nonce(1)); e != ErrConflict {
		t.Fatal("nonce reset on owner restart", e)
	}
	if len(s.queries) != 1 || s.writes != 4 {
		t.Fatal("unexpected effects", s.writes)
	}
	if _, e = db.Exec("PUBLIC-unimplemented"); e == nil {
		t.Fatal("fixture should not implement arbitrary writes")
	}
}
func TestApprovalStoreConcurrentCASAndNonceAcrossOwners(t *testing.T) {
	db, s, c := newApprovalFixture(t)
	first := openApprovalFixture(t, db, c)
	r := setupSignedApproval(t, first)
	owners := make([]*originalApprovalStore, 12)
	for i := range owners {
		owners[i] = openApprovalFixture(t, db, c)
	}
	var wg sync.WaitGroup
	var wins atomic.Int32
	for _, o := range owners {
		wg.Add(1)
		go func(o *originalApprovalStore) {
			defer wg.Done()
			if _, e := o.reserveQuery(context.Background(), r.scope.ref, nonce(2)); e == nil {
				wins.Add(1)
			} else if e != ErrConflict {
				t.Errorf("reserve=%v", e)
			}
		}(o)
	}
	wg.Wait()
	if wins.Load() != 1 || len(s.queries) != 1 {
		t.Fatal("concurrent nonce reused", wins.Load())
	}
	wins.Store(0)
	for i, o := range owners {
		wg.Add(1)
		go func(i int, o *originalApprovalStore) {
			defer wg.Done()
			if _, e := o.transition(context.Background(), r.scope.ref, hash([]byte{byte(i)}), r.stateSHA256, "revoked", "signed-unhanded", 0, r.resultOriginal); e == nil {
				wins.Add(1)
			} else if e != ErrConflict {
				t.Errorf("cas=%v", e)
			}
		}(i, o)
	}
	wg.Wait()
	if wins.Load() != 1 {
		t.Fatal("CAS did not choose exactly one", wins.Load())
	}
}
func TestApprovalStoreAppliedLostNeverRetriesOrResets(t *testing.T) {
	db, s, c := newApprovalFixture(t)
	o := openApprovalFixture(t, db, c)
	s.failAfter = approvalInsertSQL
	if _, e := o.prepare(context.Background(), publicApprovalScope()); e != ErrUnknown {
		t.Fatal(e)
	}
	before := s.writes
	if _, e := o.prepare(context.Background(), publicApprovalScope()); e != ErrUnknown || s.writes != before {
		t.Fatal("replayed unknown")
	}
	observed, e := o.observeOriginal(context.Background(), publicApprovalScope().ref)
	if e != nil || observed.requestState != "selected" || o.firstCause == nil || o.ready {
		t.Fatal("observe cleared UNKNOWN", e)
	}
	s.failAfter = ""
	other := openApprovalFixture(t, db, c)
	if _, e := other.prepare(context.Background(), publicApprovalScope()); e != ErrConflict {
		t.Fatal("cross-owner duplicate", e)
	}
}
func TestApprovalStoreNonceAppliedLostIsDurableAndPartialHeld(t *testing.T) {
	db, s, c := newApprovalFixture(t)
	o := openApprovalFixture(t, db, c)
	r := setupSignedApproval(t, o)
	s.failAfter = approvalReserveSQL
	q, e := o.reserveQuery(context.Background(), r.scope.ref, nonce(3))
	if e != ErrUnknown || q == nil || q != o.lastQuery || len(s.queries) != 1 {
		t.Fatal("query original lost", e)
	}
	s.failAfter = ""
	other := openApprovalFixture(t, db, c)
	if _, e := other.reserveQuery(context.Background(), r.scope.ref, nonce(3)); e != ErrConflict {
		t.Fatal("query replay", e)
	}
}
func TestApprovalStorePostCompletionExpiryAndCloseFirstFailure(t *testing.T) {
	db, s, c := newApprovalFixture(t)
	o := openApprovalFixture(t, db, c)
	r := setupSignedApproval(t, o)
	q, e := o.reserveQuery(context.Background(), r.scope.ref, nonce(4))
	if e != nil {
		t.Fatal(e)
	}
	if e = o.selectQuerySigning(context.Background(), q); e != nil {
		t.Fatal(e)
	}
	s.afterWrite = func() { o.now = func() time.Time { return time.UnixMilli(31000) } }
	if e = o.completeQuery(context.Background(), q, []byte("PUBLIC-result")); e != ErrUnknown || string(q.envelopeOriginal) != "PUBLIC-result" || q.phase != "terminal" {
		t.Fatal("post-expiry original", e)
	}
	db2, _, c2 := newApprovalFixture(t)
	g := openApprovalFixture(t, db2, c2)
	rr := setupSignedApproval(t, g)
	qq, e := g.reserveQuery(context.Background(), rr.scope.ref, nonce(5))
	if e != nil {
		t.Fatal(e)
	}
	g.selectQuerySigning(context.Background(), qq)
	if g.Close() != ErrUnknown || g.Close() != ErrUnknown {
		t.Fatal("close hid unconfirmed signed query")
	}
	if len(g.pending) != 1 {
		t.Fatal("dropped original debt")
	}
}
func TestApprovalStoreRevokeBetweenQueryAndCompletionFailsClosed(t *testing.T) {
	db, _, c := newApprovalFixture(t)
	o := openApprovalFixture(t, db, c)
	r := setupSignedApproval(t, o)
	q, e := o.reserveQuery(context.Background(), r.scope.ref, nonce(6))
	if e != nil {
		t.Fatal(e)
	}
	o.selectQuerySigning(context.Background(), q)
	other := openApprovalFixture(t, db, c)
	rev, e := other.transition(context.Background(), r.scope.ref, strings.Repeat("c", 64), r.stateSHA256, "revoked", "signed-unhanded", 0, r.resultOriginal)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = other.transition(context.Background(), r.scope.ref, strings.Repeat("d", 64), rev.stateSHA256, "approved", "returned", 0, r.resultOriginal); e != ErrDenied {
		t.Fatal("revoked reactivated", e)
	}
	if e = o.completeQuery(context.Background(), q, []byte("PUBLIC-final")); e != ErrUnknown {
		t.Fatal("stale approval completed", e)
	}
}
func TestApprovalStoreIsolationAndInvalidInputsNoDDL(t *testing.T) {
	db, s, c := newApprovalFixture(t)
	o := openApprovalFixture(t, db, c)
	r := setupSignedApproval(t, o)
	for _, n := range []string{"bad", strings.Repeat("A", 43), strings.Repeat("_", 43)} {
		if _, e := o.reserveQuery(context.Background(), r.scope.ref, n); e != ErrDenied {
			t.Fatal("invalid nonce", e)
		}
	}
	otherConfig := c
	otherConfig.profileSHA256 = strings.Repeat("f", 64)
	other := openApprovalFixture(t, db, otherConfig)
	if _, e := other.reserveQuery(context.Background(), r.scope.ref, nonce(7)); e != ErrConflict {
		t.Fatal("profile crossed", e)
	}
	s.schema = 0
	partial, e := openOriginalApprovalStore(context.Background(), db, c)
	if partial == nil || e != ErrUnknown {
		t.Fatal("schema missing", e)
	}
	if s.writes != 2 {
		t.Fatal("unexpected DDL or repair writes")
	}
}
func TestApprovalStoreObserveTerminalOriginalCannotReopenSigning(t *testing.T) {
	db, s, c := newApprovalFixture(t)
	o := openApprovalFixture(t, db, c)
	r := setupSignedApproval(t, o)
	q, e := o.reserveQuery(context.Background(), r.scope.ref, nonce(8))
	if e != nil {
		t.Fatal(e)
	}
	if e = o.selectQuerySigning(context.Background(), q); e != nil {
		t.Fatal(e)
	}
	s.failAfter = approvalCompleteQuerySQL
	if e = o.completeQuery(context.Background(), q, []byte("PUBLIC-exact-original")); e != ErrUnknown {
		t.Fatal(e)
	}
	writes := s.writes
	observed, e := o.observeOriginalQuery(context.Background(), r.scope.ref, nonce(8))
	if e != nil || observed.phase != "terminal" || string(observed.envelopeOriginal) != "PUBLIC-exact-original" {
		t.Fatal("original readback", e)
	}
	if o.ready || o.firstCause == nil || s.writes != writes {
		t.Fatal("observe reactivated or mutated")
	}
	if e = o.selectQuerySigning(context.Background(), observed); e != ErrUnknown {
		t.Fatal("observed handle became signable", e)
	}
	other := openApprovalFixture(t, db, c)
	observed, e = other.observeOriginalQuery(context.Background(), r.scope.ref, nonce(8))
	if e != nil {
		t.Fatal(e)
	}
	if e = other.selectQuerySigning(context.Background(), observed); e != ErrConflict {
		t.Fatal("observed history selected", e)
	}
	if _, e = other.reserveQuery(context.Background(), r.scope.ref, nonce(8)); e != ErrConflict {
		t.Fatal("nonce reset", e)
	}
}
func TestApprovalStoreMutationPartialAndContextCurrent(t *testing.T) {
	db, s, c := newApprovalFixture(t)
	o := openApprovalFixture(t, db, c)
	r := setupSignedApproval(t, o)
	s.failAfter = approvalTransitionSQL
	original := append([]byte(nil), r.resultOriginal...)
	if _, e := o.transition(context.Background(), r.scope.ref, strings.Repeat("e", 64), r.stateSHA256, "approved", "returned", 0, original); e != ErrUnknown {
		t.Fatal(e)
	}
	if o.lastMutation == nil || !strings.Contains(o.lastMutation.phase, "TRANSITION") || o.lastMutation.cause == nil || string(o.lastMutation.expected.resultOriginal) != string(original) {
		t.Fatal("mutation original/first cause lost")
	}
	if _, ok := any(o).(OriginalSource); ok {
		t.Fatal("component promoted to Source facade")
	}
	db2, _, c2 := newApprovalFixture(t)
	g := openApprovalFixture(t, db2, c2)
	rr := setupSignedApproval(t, g)
	q, e := g.reserveQuery(context.Background(), rr.scope.ref, nonce(9))
	if e != nil {
		t.Fatal(e)
	}
	g.selectQuerySigning(context.Background(), q)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if e = g.completeQuery(ctx, q, []byte("PUBLIC-original")); e != ErrUnknown || g.ready {
		t.Fatal("cancellation rearmed selected sign", e)
	}
	if string(q.envelopeOriginal) != "PUBLIC-original" || g.firstCause != context.Canceled {
		t.Fatal("canceled completion lost actual original/cause")
	}
}
func TestApprovalStoreKnownFailedAndRevokedCanBeQueriedWithoutGrantOrReactivation(t *testing.T) {
	db, _, c := newApprovalFixture(t)
	o := openApprovalFixture(t, db, c)
	r, e := o.prepare(context.Background(), publicApprovalScope())
	if e != nil {
		t.Fatal(e)
	}
	failed, e := o.transition(context.Background(), r.scope.ref, strings.Repeat("1", 64), r.stateSHA256, "approved", "failed", 0, nil)
	if e != nil {
		t.Fatal(e)
	}
	q, e := o.reserveQuery(context.Background(), r.scope.ref, nonce(10))
	if e != nil || q.row.requestState != "failed" || len(q.row.resultOriginal) != 0 {
		t.Fatal("failed state was hidden/fabricated", e)
	}
	if _, e = o.transition(context.Background(), r.scope.ref, strings.Repeat("2", 64), failed.stateSHA256, "approved", "signed-unhanded", 0, []byte("PUBLIC-would-resign")); e != ErrDenied {
		t.Fatal("failed effect rearmed", e)
	}
	rev, e := o.transition(context.Background(), r.scope.ref, strings.Repeat("3", 64), failed.stateSHA256, "revoked", "failed", 0, nil)
	if e != nil {
		t.Fatal(e)
	}
	q, e = o.reserveQuery(context.Background(), rev.scope.ref, nonce(11))
	if e != nil || q.row.decision != "revoked" {
		t.Fatal("revoked query", e)
	}
	if e = o.selectQuerySigning(context.Background(), q); e != nil {
		t.Fatal(e)
	}
	if e = o.completeQuery(context.Background(), q, []byte("PUBLIC-negative-current-NOT-A-PERMIT")); e != nil {
		t.Fatal(e)
	}
}
