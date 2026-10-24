package developerauthority

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"sync"
	"testing"
	"time"
)

// Actual database/sql calls and atomic-statement uniqueness protocol. This is
// an explicit PUBLIC driver, not PostgreSQL or production restart durability.
type publisherCaptureDB struct {
	mu                      sync.Mutex
	rows                    map[string][]driver.Value
	nonces                  map[string]bool
	heads                   map[string][]driver.Value
	writes, queries, closes int
	schema                  int64
	lost, panicAfter        bool
	afterInsert             func()
}
type publisherCaptureConnector struct{ s *publisherCaptureDB }
type publisherCaptureDriver struct{}
type publisherCaptureConn struct{ s *publisherCaptureDB }

func (publisherCaptureDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("PUBLIC connector only")
}
func (c publisherCaptureConnector) Connect(context.Context) (driver.Conn, error) {
	return &publisherCaptureConn{c.s}, nil
}
func (publisherCaptureConnector) Driver() driver.Driver { return publisherCaptureDriver{} }
func (c *publisherCaptureConn) Close() error {
	c.s.mu.Lock()
	defer c.s.mu.Unlock()
	c.s.closes++
	return nil
}
func (*publisherCaptureConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("PUBLIC no prepare")
}
func (*publisherCaptureConn) Begin() (driver.Tx, error) {
	return nil, errors.New("PUBLIC atomic statement only")
}
func (c *publisherCaptureConn) QueryContext(ctx context.Context, q string, a []driver.NamedValue) (driver.Rows, error) {
	s := c.s
	s.mu.Lock()
	defer s.mu.Unlock()
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	if q == `SELECT revision FROM public.auth_ide_control_capture_schema WHERE singleton=1` || q == `SELECT revision FROM public.auth_ide_publisher_capture_schema WHERE singleton=1` {
		return &approvalRows{v: [][]driver.Value{{s.schema}}, n: 1}, nil
	}
	s.queries++
	if q == originalPublisherCaptureInsertSQL {
		if len(a) != 24 {
			return nil, errors.New("PUBLIC wrong fixed SQL parameters")
		}
		v := make([]driver.Value, len(a))
		for i, x := range a {
			v[i] = x.Value
			if b, ok := v[i].([]byte); ok {
				v[i] = append([]byte(nil), b...)
			}
		}
		prefix := v[0].(string) + "/" + v[1].(string)
		key := prefix + "/" + v[7].(string)
		nk := prefix + "/" + v[9].(string)
		if old, ok := s.heads[prefix]; ok {
			if old[3].(int64) > v[3].(int64) || old[4].(int64) > v[4].(int64) || old[5].(int64) > v[5].(int64) || (old[3] == v[3] && old[2] != v[2]) || (old[4] == v[4] && old[6] != v[6]) {
				return &approvalRows{n: 14}, nil
			}
		}
		s.heads[prefix] = append([]driver.Value(nil), v[:7]...)
		if _, ok := s.rows[key]; ok || s.nonces[nk] {
			return &approvalRows{n: 14}, nil
		}
		row := []driver.Value{v[8], v[7], v[9], v[10], v[11], v[12], v[13], v[2], v[6], "captured", int64(1), v[16], v[14], v[15]}
		s.rows[key] = row
		s.nonces[nk] = true
		s.writes++
		if s.afterInsert != nil {
			s.afterInsert()
		}
		if s.panicAfter {
			panic("PUBLIC durable insert response panic")
		}
		if s.lost {
			return nil, errors.New("PUBLIC durable insert response lost")
		}
		return &approvalRows{v: [][]driver.Value{append([]driver.Value(nil), row...)}, n: 14}, nil
	}
	if q == originalPublisherCaptureObserveSQL {
		key := a[0].Value.(string) + "/" + a[1].Value.(string) + "/" + a[2].Value.(string)
		row, ok := s.rows[key]
		if !ok || row[0] != a[3].Value {
			return &approvalRows{n: 14}, nil
		}
		return &approvalRows{v: [][]driver.Value{append([]driver.Value(nil), row...)}, n: 14}, nil
	}
	if q == originalPublisherCaptureObserveBindingSQL {
		key := a[0].Value.(string) + "/" + a[1].Value.(string) + "/" + a[2].Value.(string)
		row, ok := s.rows[key]
		if !ok {
			return &approvalRows{n: 14}, nil
		}
		for i, j := range []int{2, 3, 4, 5, 6} {
			if row[j] != a[i+3].Value {
				return &approvalRows{n: 14}, nil
			}
		}
		return &approvalRows{v: [][]driver.Value{append([]driver.Value(nil), row...)}, n: 14}, nil
	}
	return nil, errors.New("PUBLIC unknown query: no alternate SQL permitted")
}
func newPublisherCaptureStoreFixture(t *testing.T) (*originalPublisherCaptureStore, *publisherCaptureDB, *originalPublisherCurrent, Principal, Command, []byte, []byte, string) {
	t.Helper()
	o, input, p, c, public, proof, caller := publisherCurrentProcessFixture(t, "")
	r, e := o.invokeOriginalProtectedPublisherCurrent(context.Background(), input, p, c, public, proof, caller)
	if e != nil || r == nil {
		t.Fatal(e, o.FailurePhase())
	}
	state := &publisherCaptureDB{rows: map[string][]driver.Value{}, nonces: map[string]bool{}, heads: map[string][]driver.Value{}, schema: 1}
	db := sql.OpenDB(publisherCaptureConnector{state})
	t.Cleanup(func() { db.Close() })
	store, e := openOriginalPublisherCaptureStore(context.Background(), db)
	if e != nil || store == nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { store.Close() })
	return store, state, r, p, c, public, proof, caller
}

func TestOriginalPublisherCaptureActualSQLOnceConcurrentAndCallerCopies(t *testing.T) {
	s, state, r, p, c, public, proof, caller := newPublisherCaptureStoreFixture(t)
	a, e := s.retainOriginal(r, p, c, public, proof, caller)
	if e != nil || a == nil {
		t.Fatal(e)
	}
	savedPublic := append([]byte(nil), a.public...)
	savedProof := append([]byte(nil), a.proof...)
	public[0] ^= 1
	proof[0] ^= 1
	var wg sync.WaitGroup
	results := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() { defer wg.Done(); results <- s.capture(context.Background(), a) }()
	}
	wg.Wait()
	close(results)
	for e := range results {
		if e != nil {
			t.Fatal(e)
		}
	}
	if state.writes != 1 || state.queries != 1 || !bytes.Equal(a.public, savedPublic) || !bytes.Equal(a.proof, savedProof) || a.receipt == nil || a.receipt.state != "captured" {
		t.Fatal("once/copy/receipt")
	}
	receipt, e := s.observeOriginal(context.Background(), a)
	if e != nil || !receipt.matches(a) {
		t.Fatal("original execution readback", e)
	}
}

func TestOriginalPublisherCaptureLostResponseIsUnknownNoRetryAndReadbackDoesNotApprove(t *testing.T) {
	s, state, r, p, c, public, proof, caller := newPublisherCaptureStoreFixture(t)
	state.lost = true
	a, e := s.retainOriginal(r, p, c, public, proof, caller)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.capture(context.Background(), a); e != ErrUnknown || a.receipt == nil || a.firstCause == nil {
		t.Fatal("lost receipt not retained", e)
	}
	first := a.firstCause
	state.lost = false
	if e = s.capture(context.Background(), a); e != ErrUnknown || state.writes != 1 || state.queries != 1 || a.firstCause != first {
		t.Fatal("UNKNOWN retried or first cause lost", e)
	}
	receipt, e := s.observeOriginal(context.Background(), a)
	if e != nil || receipt.state != "captured" || a.result != ErrUnknown || a.firstCause != first {
		t.Fatal("reconciliation cleared UNKNOWN/promoted", e)
	}
}

func TestOriginalPublisherCaptureLateCompletionExpiryPreservesCommittedOriginal(t *testing.T) {
	s, state, r, p, c, public, proof, caller := newPublisherCaptureStoreFixture(t)
	a, e := s.retainOriginal(r, p, c, public, proof, caller)
	if e != nil {
		t.Fatal(e)
	}
	state.afterInsert = func() { r.mu.Lock(); r.projection.ExpiresMS = time.Now().UnixMilli(); r.mu.Unlock() }
	if e = s.capture(context.Background(), a); e != ErrUnknown || state.writes != 1 || a.receipt == nil || len(a.observation.original) == 0 {
		t.Fatal("post SQL expiry accepted/lost", e)
	}
	if e = s.capture(context.Background(), a); e != ErrUnknown || state.queries != 1 {
		t.Fatal("expired durable operation retried")
	}
}

func TestOriginalPublisherCaptureConflictAndMonotonicHeadFailClosed(t *testing.T) {
	s, state, r, p, c, public, proof, caller := newPublisherCaptureStoreFixture(t)
	a, e := s.retainOriginal(r, p, c, public, proof, caller)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.capture(context.Background(), a); e != nil {
		t.Fatal(e)
	}
	duplicate, e := s.retainOriginal(r, p, c, public, proof, caller)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.capture(context.Background(), duplicate); e != ErrConflict || state.writes != 1 {
		t.Fatal("duplicate ref/nonce accepted", e)
	}
	rollback, e := s.retainOriginal(r, p, c, public, proof, caller)
	if e != nil {
		t.Fatal(e)
	}
	// Explicit PUBLIC durable-head fixture, not altering a real authority.
	state.mu.Lock()
	state.heads[a.source+"/"+a.instance][4] = int64(a.sequence + 1)
	state.mu.Unlock()
	if e = s.capture(context.Background(), rollback); e != ErrConflict || state.writes != 1 {
		t.Fatal("Source head rollback accepted", e)
	}
}

func TestOriginalPublisherCapturePanicRetainsFirstCauseAndNeverReenters(t *testing.T) {
	s, state, r, p, c, public, proof, caller := newPublisherCaptureStoreFixture(t)
	state.panicAfter = true
	a, e := s.retainOriginal(r, p, c, public, proof, caller)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.capture(context.Background(), a); e != ErrUnknown || a.panicCause == nil || a.receipt == nil || state.writes != 1 {
		t.Fatal("actual panic/partial lost", e)
	}
	if e = s.capture(context.Background(), a); e != ErrUnknown || state.queries != 1 {
		t.Fatal("panic entered a second write")
	}
}

func TestOriginalPublisherCaptureFailedEntropyAndClosedStoreDoNotWrite(t *testing.T) {
	s, state, r, p, c, public, proof, caller := newPublisherCaptureStoreFixture(t)
	a, e := s.retainOriginalWithEntropy(r, p, c, public, proof, caller, bytes.NewReader(nil))
	if e != ErrUnknown || a == nil || a.firstCause == nil {
		t.Fatal("entropy partial lost")
	}
	if s.capture(context.Background(), a) != ErrUnknown || state.queries != 0 {
		t.Fatal("failed entropy entered SQL")
	}
	a, e = s.retainOriginal(r, p, c, public, proof, caller)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	if s.capture(context.Background(), a) != ErrUnknown || state.queries != 0 || state.closes != 0 {
		t.Fatal("closed store wrote or closed borrowed pool")
	}
}

func TestOriginalPublisherCaptureFreshStoreReconcilesOriginalBindingWithoutMemoryExecution(t *testing.T) {
	s, state, r, p, c, public, proof, caller := newPublisherCaptureStoreFixture(t)
	state.lost = true
	a, e := s.retainOriginalWithEntropy(r, p, c, public, proof, caller, bytes.NewReader(bytes.Repeat([]byte{7}, 32)))
	if e != nil {
		t.Fatal(e)
	}
	if s.capture(context.Background(), a) != ErrUnknown {
		t.Fatal("lost original did not stay UNKNOWN")
	}
	// Independent store owner, same borrowed original durable database. This is
	// not a PostgreSQL restart claim; it proves execution-id-independent reads.
	other, e := openOriginalPublisherCaptureStore(context.Background(), s.db)
	if e != nil {
		t.Fatal(e)
	}
	defer other.Close()
	b, e := other.retainOriginalWithEntropy(r, p, c, public, proof, caller, bytes.NewReader(bytes.Repeat([]byte{8}, 32)))
	if e != nil {
		t.Fatal(e)
	}
	if b.execution == a.execution {
		t.Fatal("fixture did not exercise fresh execution")
	}
	receipt, e := other.observeOriginalBinding(context.Background(), b)
	if e != nil || receipt.execution != a.execution || a.result != ErrUnknown || b.entered || state.writes != 1 {
		t.Fatal("binding reconciliation wrote/promoted or lost original", e)
	}
	b.public[0] ^= 1
	if _, e = other.observeOriginalBinding(context.Background(), b); e == nil {
		t.Fatal("sibling public binding read original")
	}
}
