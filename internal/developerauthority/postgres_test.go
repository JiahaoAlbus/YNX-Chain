package developerauthority

// PUBLIC driver/current seams; real pool lifecycle and Catalog constructor.
// No actual Postgres/credentials/Source admission/migration is exercised.
import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func poolConfig() PostgresCatalogConfig {
	return PostgresCatalogConfig{ConnectionURL: "postgres://PUBLIC:SECRET_MUST_NOT_LEAK@db.invalid:5432/catalog?sslmode=verify-full", MaxOpen: 3, MaxIdle: 1, ConnectTimeout: time.Second, MaxIdleTime: time.Minute, MaxLifetime: time.Hour}
}

type poolSource struct {
	publicSource
	calls     int
	failAfter int
}

func (s *poolSource) AssertSourceCurrent(context.Context) error {
	s.calls++
	if s.failAfter > 0 && s.calls >= s.failAfter {
		return ErrDenied
	}
	return nil
}

type poolFixture struct {
	closes, queries                                          atomic.Int32
	pingFailure, queryFailure, rowCloseFailure, closeFailure bool
	deadline                                                 bool
}
type poolConnector struct{ fixture *poolFixture }

func (c poolConnector) Connect(context.Context) (driver.Conn, error) {
	return &poolConnection{f: c.fixture}, nil
}
func (c poolConnector) Driver() driver.Driver { return poolDriver{c.fixture} }

type poolDriver struct{ f *poolFixture }

func (d poolDriver) Open(string) (driver.Conn, error) { return &poolConnection{f: d.f}, nil }

type poolConnection struct{ f *poolFixture }

func (c *poolConnection) Prepare(string) (driver.Stmt, error) { return nil, ErrDenied }
func (c *poolConnection) Begin() (driver.Tx, error)           { return nil, ErrDenied }
func (c *poolConnection) Close() error {
	c.f.closes.Add(1)
	if c.f.closeFailure {
		return errors.New("SECRET_MUST_NOT_LEAK close")
	}
	return nil
}
func (c *poolConnection) Ping(ctx context.Context) error {
	_, c.f.deadline = ctx.Deadline()
	if c.f.pingFailure {
		return errors.New("SECRET_MUST_NOT_LEAK ping")
	}
	return ctx.Err()
}
func (c *poolConnection) QueryContext(_ context.Context, q string, _ []driver.NamedValue) (driver.Rows, error) {
	c.f.queries.Add(1)
	known := false
	for _, allowed := range catalogReadSchema {
		if q == allowed {
			known = true
		}
	}
	if !known || c.f.queryFailure {
		return nil, errors.New("SECRET_MUST_NOT_LEAK query")
	}
	return &poolRows{first: q == catalogReadSchema[0], closeFailure: c.f.rowCloseFailure}, nil
}

type poolRows struct{ first, done, closeFailure bool }

func (r *poolRows) Columns() []string { return []string{"revision"} }
func (r *poolRows) Close() error {
	if r.closeFailure {
		return errors.New("SECRET_MUST_NOT_LEAK rows")
	}
	return nil
}
func (r *poolRows) Next(v []driver.Value) error {
	if r.first && !r.done {
		r.done = true
		v[0] = int64(1)
		return nil
	}
	return io.EOF
}
func poolOpen(f *poolFixture) func(string) (*sql.DB, error) {
	return func(string) (*sql.DB, error) { return sql.OpenDB(poolConnector{f}), nil }
}
func TestPostgresCatalogDeltaLifecycle(t *testing.T) {
	f := &poolFixture{}
	s := &poolSource{}
	o, e := openPostgresCatalog(context.Background(), poolConfig(), s, poolOpen(f))
	if e != nil || o == nil {
		t.Fatal(e)
	}
	c, e := o.Catalog()
	if e != nil || c == nil || c.source != s || f.queries.Load() != 9 || !f.deadline || s.calls != 2 || o.db.Stats().MaxOpenConnections != 3 {
		t.Fatal("not exact bounded normal constructor")
	}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if o.Close() != nil {
				t.Error("close")
			}
		}()
	}
	wg.Wait()
	if f.closes.Load() != 1 {
		t.Fatal("close duplicated")
	}
	if _, e = o.Catalog(); e != ErrCatalogClosed {
		t.Fatal("closed became ready")
	}
}
func TestPostgresCatalogDeltaFailuresDrainWithoutLeaking(t *testing.T) {
	for _, kind := range []string{"ping", "query", "rows", "post-current", "close"} {
		t.Run(kind, func(t *testing.T) {
			f := &poolFixture{}
			s := &poolSource{}
			switch kind {
			case "ping":
				f.pingFailure = true
			case "query":
				f.queryFailure = true
			case "rows":
				f.rowCloseFailure = true
			case "post-current":
				s.failAfter = 2
			case "close":
				f.pingFailure = true
				f.closeFailure = true
			}
			o, e := openPostgresCatalog(context.Background(), poolConfig(), s, poolOpen(f))
			if e != ErrCatalogStartup || o == nil || strings.Contains(e.Error(), "SECRET") {
				t.Fatal("startup privacy/custody")
			}
			if _, e = o.Catalog(); e != ErrCatalogClosed {
				t.Fatal("failure became ready")
			}
			a, b := o.Close(), o.Close()
			if a != b || f.closes.Load() != 1 {
				t.Fatal("first close lost/retried")
			}
			if kind == "close" && a != ErrCatalogCloseUnknown {
				t.Fatal("close UNKNOWN lost")
			}
		})
	}
}
func TestPostgresCatalogDeltaConfigAndPartial(t *testing.T) {
	config := poolConfig()
	encoded, err := json.Marshal(config)
	if err != nil || strings.Contains(string(encoded), "SECRET") || strings.Contains(fmt.Sprintf("%+v %#v", config, config), "SECRET") {
		t.Fatal("config diagnostics leak")
	}
	cases := []string{"postgres://PUBLIC:SECRET@db.invalid:5432/catalog?sslmode=require", "postgres://PUBLIC:SECRET@db.invalid:5432/catalog?sslmode=verify-full&sslmode=disable", "postgres://PUBLIC:SECRET@db.invalid:5432/catalog?sslmode=verify-full&options=unsafe", "postgres://PUBLIC:SECRET@db.invalid/catalog?sslmode=verify-full", "postgres://PUBLIC@db.invalid:5432/catalog?sslmode=verify-full"}
	for _, u := range cases {
		c := config
		c.ConnectionURL = u
		if _, e := catalogConnection(c); e != ErrCatalogConfiguration {
			t.Fatal("bad DSN accepted")
		}
	}
	normalized, e := catalogConnection(config)
	if e != nil || !strings.Contains(normalized, "application_name=ynx-auth-developer-catalog") || !strings.Contains(normalized, "options=") {
		t.Fatal("explicit driver config missing")
	}
	calls := 0
	opener := func(string) (*sql.DB, error) { calls++; return nil, ErrDenied }
	var nilSource *poolSource
	if o, e := openPostgresCatalog(context.Background(), config, nilSource, opener); o != nil || e != ErrCatalogConfiguration || calls != 0 {
		t.Fatal("typed nil Source opened DB")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if o, e := openPostgresCatalog(ctx, config, &poolSource{}, opener); o != nil || e != ErrCatalogStartup || calls != 0 {
		t.Fatal("canceled context opened DB")
	}
	db := sql.OpenDB(poolConnector{&poolFixture{}})
	o, e := openPostgresCatalog(context.Background(), config, &poolSource{}, func(string) (*sql.DB, error) { return db, errors.New("SECRET_MUST_NOT_LEAK open partial") })
	if o == nil || e != ErrCatalogStartup || o.Close() != nil {
		t.Fatal("partial db owner discarded")
	}
	if e = db.Ping(); e == nil {
		t.Fatal("partial pool not drained")
	}
}
