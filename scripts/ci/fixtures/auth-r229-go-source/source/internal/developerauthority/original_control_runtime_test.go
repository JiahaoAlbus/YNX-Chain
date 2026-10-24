package developerauthority

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// PUBLIC database/sql connector models only the durable uniqueness/readback
// protocol. It is not evidence of a PostgreSQL install, live Root or deployment.
type controlDBFixture struct {
	mu             sync.Mutex
	rows           map[string][]driver.Value
	heads          map[string][]driver.Value
	writes, closes int
	loseInsert     bool
	afterInsert    func()
}
type controlConnector struct{ s *controlDBFixture }
type controlDriver struct{}
type controlConn struct{ s *controlDBFixture }

func (controlDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("PUBLIC connector only")
}
func (c controlConnector) Connect(context.Context) (driver.Conn, error) {
	return &controlConn{c.s}, nil
}
func (controlConnector) Driver() driver.Driver           { return controlDriver{} }
func (c *controlConn) Close() error                      { c.s.mu.Lock(); defer c.s.mu.Unlock(); c.s.closes++; return nil }
func (*controlConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("PUBLIC no prepare") }
func (*controlConn) Begin() (driver.Tx, error)           { return nil, errors.New("PUBLIC atomic query") }
func (c *controlConn) QueryContext(ctx context.Context, q string, a []driver.NamedValue) (driver.Rows, error) {
	c.s.mu.Lock()
	defer c.s.mu.Unlock()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if q == `SELECT revision FROM public.auth_ide_control_capture_schema WHERE singleton=1` || q == `SELECT revision FROM public.auth_ide_publisher_capture_schema WHERE singleton=1` || q == `SELECT revision FROM public.auth_ide_publisher_catalog_schema WHERE singleton=1` {
		return &approvalRows{v: [][]driver.Value{{int64(1)}}, n: 1}, nil
	}
	if q == originalControlSourceObserveSQL {
		if c.s.heads == nil {
			c.s.heads = make(map[string][]driver.Value)
		}
		key := a[0].Value.(string) + "/" + a[1].Value.(string)
		if old, ok := c.s.heads[key]; ok {
			if old[3].(int64) > a[3].Value.(int64) || old[4].(int64) > a[4].Value.(int64) || old[5].(int64) > a[5].Value.(int64) || (old[3] == a[3].Value && old[2] != a[2].Value) || (old[4] == a[4].Value && old[6] != a[6].Value) {
				return &approvalRows{n: 1}, nil
			}
		}
		v := make([]driver.Value, len(a))
		for i := range a {
			v[i] = a[i].Value
		}
		c.s.heads[key] = v
		return &approvalRows{v: [][]driver.Value{{a[6].Value}}, n: 1}, nil
	}
	if q == originalControlCaptureInsertSQL {
		key := a[0].Value.(string) + "/" + a[1].Value.(string) + "/" + a[3].Value.(string)
		if _, ok := c.s.rows[key]; ok {
			return &approvalRows{n: 1}, nil
		}
		v := make([]driver.Value, len(a))
		for i := range a {
			v[i] = a[i].Value
			if b, ok := v[i].([]byte); ok {
				v[i] = append([]byte(nil), b...)
			}
		}
		c.s.rows[key] = v
		c.s.writes++
		if c.s.afterInsert != nil {
			c.s.afterInsert()
		}
		if c.s.loseInsert {
			return nil, errors.New("PUBLIC insert durable but response lost")
		}
		return &approvalRows{v: [][]driver.Value{{v[3]}}, n: 1}, nil
	}
	for _, v := range c.s.rows {
		if v[7] == a[0].Value && v[8] == a[1].Value && v[4] == a[2].Value && v[5] == a[3].Value && v[6] == a[4].Value {
			return &approvalRows{v: [][]driver.Value{{v[11], v[12], v[13], v[3], v[2], v[9], v[10]}}, n: 7}, nil
		}
	}
	return &approvalRows{n: 7}, nil
}

func newControlRuntimeFixture(t *testing.T, mutation string) (*OriginalProjectControlRuntime, *controlDBFixture, Principal, Command, []byte) {
	t.Helper()
	owner, input, p, c, proof, _, caller := controlCurrentFixture(t, mutation)
	var fields map[string]json.RawMessage
	if json.Unmarshal(input, &fields) != nil {
		t.Fatal("input")
	}
	s := &controlDBFixture{rows: make(map[string][]driver.Value)}
	db := sql.OpenDB(controlConnector{s})
	t.Cleanup(func() { db.Close() })
	// Real production constructor creates its own independent pinned child owner.
	o, e := OpenOriginalProjectControlRuntime(context.Background(), db, OriginalProjectControlRuntimeConfig{Verifier: owner.config, OriginalSource: fields["source"], WalletCodeIdentity: caller})
	if e != nil {
		t.Fatalf("open=%v", e)
	}
	t.Cleanup(func() { o.Close() })
	return o, s, p, c, proof
}

func TestOriginalProjectControlRuntimeActualConstructorAndCurrent(t *testing.T) {
	o, s, p, c, proof := newControlRuntimeFixture(t, "")
	a, e := o.AuthorizeProjectControl(context.Background(), p, c, proof)
	if e != nil {
		t.Fatal(e)
	}
	if !validApproval(a, p, c, proof, o.last.projection.ExpiresMS-1) || s.writes != 1 {
		t.Fatal("binding/once")
	}
	if e = o.AssertControlCurrent(context.Background(), p, a); e != nil {
		t.Fatal(e)
	}
	if _, e = o.AuthorizeProjectControl(context.Background(), p, c, proof); e != ErrConflict {
		t.Fatal("capture reused", e)
	}
	changed := p
	changed.Account = "OTHER_TENANT"
	if e = o.AssertControlCurrent(context.Background(), changed, a); e == nil {
		t.Fatal("tenant confusion")
	}
	if e = o.Close(); e != nil {
		t.Fatal(e)
	}
	if e = o.Close(); e != nil {
		t.Fatal(e)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closes != 0 {
		t.Fatal("borrowed DB closed")
	}
}

func TestOriginalProjectControlRuntimeAmbiguousInsertNeverRetries(t *testing.T) {
	o, s, p, c, proof := newControlRuntimeFixture(t, "")
	s.loseInsert = true
	if _, e := o.AuthorizeProjectControl(context.Background(), p, c, proof); e != ErrUnknown {
		t.Fatal(e)
	}
	if _, e := o.AuthorizeProjectControl(context.Background(), p, c, proof); e != ErrUnknown {
		t.Fatal(e)
	}
	if s.writes != 1 || len(s.rows) != 1 {
		t.Fatal("unknown replay/lost custody")
	}
	if e := o.Close(); e != ErrUnknown {
		t.Fatal(e)
	}
	if e := o.Close(); e != ErrUnknown {
		t.Fatal("first close changed", e)
	}
}

func TestOriginalProjectControlRuntimeSignedRejectConsumesCapture(t *testing.T) {
	o, s, p, c, proof := newControlRuntimeFixture(t, "out.projection.decision='reject';out.projection.readyForSourceVerification=false;")
	if _, e := o.AuthorizeProjectControl(context.Background(), p, c, proof); e != ErrDenied {
		t.Fatal(e)
	}
	if _, e := o.AuthorizeProjectControl(context.Background(), p, c, proof); e != ErrConflict {
		t.Fatal(e)
	}
	if s.writes != 1 {
		t.Fatal("reject not retained")
	}
}

func TestOriginalProjectControlRuntimePostDurableFence(t *testing.T) {
	o, s, p, c, proof := newControlRuntimeFixture(t, "")
	s.afterInsert = func() {
		// A pinned actual child image changes while the real DB insert returns.
		// The post-completion Source fence must refuse the already-consumed claim.
		if e := os.WriteFile(filepath.Join(o.verifier.config.SDKRoot, originalVerifierEntry), []byte("PUBLIC_SUBSTITUTED"), 0600); e != nil {
			t.Fatal(e)
		}
	}
	if _, e := o.AuthorizeProjectControl(context.Background(), p, c, proof); e != ErrUnknown {
		t.Fatal("post-completion fence absent", e)
	}
	if s.writes != 1 || len(s.rows) != 1 {
		t.Fatal("lost durable outcome")
	}
	if _, e := o.AuthorizeProjectControl(context.Background(), p, c, proof); e == nil {
		t.Fatal("replayed changed child")
	}
	if s.writes != 1 {
		t.Fatal("second durable write")
	}
}

func TestOriginalDeveloperFactoryNormalStartupPartialAndClose(t *testing.T) {
	owner, input, _, _, _, _, caller := controlCurrentFixture(t, "")
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(input, &fields)
	s := &controlDBFixture{rows: make(map[string][]driver.Value)}
	db := sql.OpenDB(controlConnector{s})
	defer db.Close()
	cfg := OriginalDeveloperSourceFactoryConfig{Principal: OriginalDeveloperHTTPAuthorityConfig{SPKISHA256: hash([]byte("PUBLIC_PIN_NOT_COMMISSIONED"))}, Control: OriginalProjectControlRuntimeConfig{Verifier: owner.config, OriginalSource: fields["source"], WalletCodeIdentity: caller}, ProjectOriginalSource: []byte(`{"profileRaw":"PUBLIC_PROJECT_PROFILE","policy":{"signatureContract":{"purpose":"ide-project-authority-v1"}}}`)}
	o, e := OpenOriginalDeveloperSourceFactory(context.Background(), db, cfg)
	if e != nil || o == nil || o.principal == nil || o.control == nil {
		t.Fatal("normal composition", e)
	}
	if e = o.AssertSourceCurrent(context.Background()); e != nil {
		t.Fatal(e)
	}
	if e = o.Close(); e != nil {
		t.Fatal(e)
	}
	if e = o.Close(); e != nil {
		t.Fatal(e)
	}
	if !o.principal.closed || !o.control.closeSelected || !o.publisher.closed {
		t.Fatal("actual children not closed")
	}
	if e = o.AssertSourceCurrent(context.Background()); e == nil {
		t.Fatal("closed factory usable")
	}
	cfg.Control.OriginalSource = []byte(`{}`)
	partial, e := OpenOriginalDeveloperSourceFactory(context.Background(), db, cfg)
	if e == nil || partial == nil || partial.principal == nil {
		t.Fatal("partial parent lost")
	}
	if e = partial.Close(); e != ErrUnknown {
		t.Fatal(e)
	}
	if e = partial.Close(); e != ErrUnknown {
		t.Fatal("first result changed", e)
	}
	if !partial.principal.closed || s.closes != 0 {
		t.Fatal("partial cleanup or borrowed database")
	}
}

func TestOriginalProjectControlRuntimeIndependentOwnersShareOnce(t *testing.T) {
	o, s, p, c, proof := newControlRuntimeFixture(t, "")
	second, e := OpenOriginalProjectControlRuntime(context.Background(), o.db, OriginalProjectControlRuntimeConfig{Verifier: o.verifier.config, OriginalSource: append([]byte(nil), o.source...), WalletCodeIdentity: o.caller})
	if e != nil {
		t.Fatal(e)
	}
	defer second.Close()
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, owner := range []*OriginalProjectControlRuntime{o, second} {
		go func(v *OriginalProjectControlRuntime) {
			<-start
			_, e := v.AuthorizeProjectControl(context.Background(), p, c, proof)
			results <- e
		}(owner)
	}
	close(start)
	one, two := <-results, <-results
	if !((one == nil && two == ErrConflict) || (two == nil && one == ErrConflict)) {
		t.Fatal("cross-owner once", one, two)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.writes != 1 || len(s.rows) != 1 {
		t.Fatal("multiple durable claims")
	}
}

func TestOriginalProjectControlRuntimeDurableCurrentRollbackRefused(t *testing.T) {
	for _, kind := range []string{"sequence", "floor", "same-sequence-head", "generation"} {
		t.Run(kind, func(t *testing.T) {
			o, s, p, c, proof := newControlRuntimeFixture(t, "")
			s.mu.Lock()
			for _, row := range s.heads {
				switch kind {
				case "sequence":
					row[4] = int64(3)
				case "floor":
					row[5] = int64(2)
				case "same-sequence-head":
					row[6] = hash([]byte("OTHER_HEAD"))
				case "generation":
					row[3] = int64(2)
				}
			}
			s.mu.Unlock()
			if _, e := o.AuthorizeProjectControl(context.Background(), p, c, proof); e != ErrDenied {
				t.Fatal("durable rollback accepted", e)
			}
			if s.writes != 0 {
				t.Fatal("rolled-back capture selected")
			}
		})
	}
}
