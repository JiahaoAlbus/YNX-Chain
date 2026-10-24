package developerauthority

// Real original startup/custody and SQL/HTTP APIs; PUBLIC metadata only, not
// release/Root/Source commissioning. No server, provider or private key created.
import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"sync"
	"testing"
	"time"
)

type r234Connector struct {
	control *controlDBFixture
	read    *r216ReaderDB
}
type r234Conn struct {
	control *controlConn
	read    *r216CatalogReadConn
}

func (c r234Connector) Connect(context.Context) (driver.Conn, error) {
	return &r234Conn{&controlConn{c.control}, &r216CatalogReadConn{r216ReaderConn{c.read}}}, nil
}
func (r234Connector) Driver() driver.Driver               { return controlDriver{} }
func (c *r234Conn) Prepare(s string) (driver.Stmt, error) { return c.control.Prepare(s) }
func (c *r234Conn) Close() error                          { return c.control.Close() }
func (c *r234Conn) Begin() (driver.Tx, error)             { return c.read.Begin() }
func (c *r234Conn) BeginTx(ctx context.Context, o driver.TxOptions) (driver.Tx, error) {
	return c.read.BeginTx(ctx, o)
}
func (c *r234Conn) QueryContext(ctx context.Context, q string, a []driver.NamedValue) (driver.Rows, error) {
	if q == originalControlSourceObserveSQL || q == `SELECT revision FROM public.auth_ide_control_capture_schema WHERE singleton=1` || q == `SELECT revision FROM public.auth_ide_publisher_capture_schema WHERE singleton=1` || q == `SELECT revision FROM public.auth_ide_publisher_catalog_schema WHERE singleton=1` {
		return c.control.QueryContext(ctx, q, a)
	}
	return c.read.QueryContext(ctx, q, a)
}
func r234Runtime(t *testing.T) (*OriginalDeveloperCatalogRuntime, *sql.DB, *controlDBFixture, Principal) {
	t.Helper()
	owner, input, p, _, _, _, caller := controlCurrentFixture(t, "")
	var fields map[string]json.RawMessage
	json.Unmarshal(input, &fields)
	control := &controlDBFixture{rows: map[string][]driver.Value{}}
	key := Publisher{Account: p.Account, ProjectID: "PUBLIC_PROJECT", ExpiresMS: p.ExpiresMS}
	read := &r216ReaderDB{key: key, active: true}
	db := sql.OpenDB(r234Connector{control, read})
	t.Cleanup(func() { db.Close() })
	config := OriginalDeveloperSourceFactoryConfig{Principal: OriginalDeveloperHTTPAuthorityConfig{SPKISHA256: hash([]byte("PUBLIC_NOT_RELEASED"))}, Control: OriginalProjectControlRuntimeConfig{Verifier: owner.config, OriginalSource: fields["source"], WalletCodeIdentity: caller}, ProjectOriginalSource: []byte(`{"profileRaw":"PUBLIC_PROJECT_PROFILE","policy":{"signatureContract":{"purpose":"ide-project-authority-v1"}}}`)}
	o, e := OpenOriginalDeveloperCatalogRuntime(context.Background(), db, config)
	if e != nil {
		t.Fatal("actual composition", e)
	}
	t.Cleanup(func() { o.Close() })
	// Original production constructor is exercised above. Replace only PUBLIC
	// TLS endpoint for this fixture; close its unused prior child first.
	if e = o.source.principal.Close(); e != nil {
		t.Fatal(e)
	}
	o.source.principal = r216Principal(t, p)
	return o, db, control, p
}
func TestR234ActualStartupSameFactoryCatalogDBAndNormalRead(t *testing.T) {
	o, db, state, p := r234Runtime(t)
	if o.source == nil || o.catalog == nil || o.catalog.source != o.source || o.catalog.db != db || o.source.control.db != db {
		t.Fatal("separate source/DB or facade-only constructor")
	}
	req := actualPrincipalRequest()
	req.Header.Set("x-request-id", "req_PUBLIC_R234_NORMAL_READ_12345")
	a, e := o.CurrentProject(context.Background(), req, "PUBLIC_PROJECT")
	if e != nil || a.Principal != p || !a.Read || a.ProjectID != "PUBLIC_PROJECT" {
		t.Fatal("actual normal runtime read", e)
	}
	if o.source.publication != nil {
		t.Fatal("missing publication source silently supplied")
	}
	if e = o.Close(); e != nil {
		t.Fatal(e)
	}
	if o.Close() != e || !o.source.closeSelected || !o.source.publisher.closed {
		t.Fatal("child cleanup/first result")
	}
	if _, e = o.CurrentProject(context.Background(), req, "PUBLIC_PROJECT"); e != ErrUnknown {
		t.Fatal("closed owner admitted call", e)
	}
	var revision int
	if e = db.QueryRow(`SELECT revision FROM public.auth_ide_control_capture_schema WHERE singleton=1`).Scan(&revision); e != nil || revision != 1 || state.closes != 0 {
		t.Fatal("borrowed DB retired", e)
	}
}
func TestR234PartialOwnerAndFirstCloseRetainOriginalCause(t *testing.T) {
	state := &controlDBFixture{rows: map[string][]driver.Value{}}
	db := sql.OpenDB(controlConnector{state})
	defer db.Close()
	o, e := OpenOriginalDeveloperCatalogRuntime(context.Background(), db, OriginalDeveloperSourceFactoryConfig{})
	if o == nil || e == nil || o.source == nil || o.openCause != e || o.catalog != nil {
		t.Fatal("partial acquisition lost")
	}
	first := o.openCause
	if _, e = o.CurrentProject(context.Background(), actualPrincipalRequest(), "PUBLIC"); e != ErrUnknown {
		t.Fatal(e)
	}
	if e = o.Close(); e != ErrUnknown || o.Close() != e || o.openCause != first {
		t.Fatal("first close/first cause changed", e)
	}
	var revision int
	if e = db.QueryRow(`SELECT revision FROM public.auth_ide_control_capture_schema WHERE singleton=1`).Scan(&revision); e != nil || state.closes != 0 {
		t.Fatal("partial cleanup closed borrowed pool", e)
	}
}
func TestR234RuntimeCloseWaitsForOriginalActiveCall(t *testing.T) {
	o, _, _, _ := r234Runtime(t)
	c, e := o.begin(context.Background())
	if e != nil || c != o.catalog {
		t.Fatal(e)
	}
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() { close(started); done <- o.Close() }()
	<-started
	select {
	case <-done:
		t.Fatal("Close retired active normal call")
	case <-time.After(10 * time.Millisecond):
	}
	o.source.mu.Lock()
	closed := o.source.closeSelected
	o.source.mu.Unlock()
	if closed {
		t.Fatal("source closed under active lifetime")
	}
	o.mu.RUnlock()
	select {
	case e = <-done:
		if e != nil {
			t.Fatal(e)
		}
	case <-time.After(time.Second):
		t.Fatal("same owner Close never joined")
	}
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if e := o.Close(); e != nil {
				t.Error("repeat close changed", e)
			}
		}()
	}
	wg.Wait()
}
func TestR234MalformedAndCancelledCallsCannotEnterChildren(t *testing.T) {
	var nilOwner *OriginalDeveloperCatalogRuntime
	if _, e := nilOwner.CurrentProject(context.Background(), nil, "PUBLIC"); e != ErrDenied {
		t.Fatal(e)
	}
	if p, e := nilOwner.AuthorizePublication(context.Background(), nil, nil, nil); p != nil || e != ErrDenied {
		t.Fatal(e)
	}
	if e := nilOwner.Close(); e != nil {
		t.Fatal(e)
	}
	o, _, _, _ := r234Runtime(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	pid := o.source.control.verifier.processPID
	if _, e := o.CurrentProject(ctx, actualPrincipalRequest(), "PUBLIC_PROJECT"); e != ErrDenied || o.source.control.verifier.processPID != pid {
		t.Fatal("cancelled call entered process", e)
	}
	if p, e := o.AuthorizePublication(context.Background(), actualPrincipalRequest(), []byte(`{}`), []byte(`{}`)); p != nil || e == nil {
		t.Fatal("malformed packet admitted")
	}
}
