package developerauthority

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/lib/pq"
)

// These errors intentionally do not wrap driver/connection errors, which may
// contain credentials. The caller must not log ConnectionURL or whole config.
var ErrCatalogConfiguration = errors.New("developer catalog configuration rejected")
var ErrCatalogStartup = errors.New("developer catalog startup unconfirmed")
var ErrCatalogClosed = errors.New("developer catalog owner closed or not ready")
var ErrCatalogCloseUnknown = errors.New("developer catalog pool close unconfirmed")

// Supplied only by the original service config owner, never HTTP/renderer data.
// This constructor does not provision a database, create users or migrate it.
type PostgresCatalogConfig struct {
	ConnectionURL                            string `json:"-"`
	MaxOpen, MaxIdle                         int
	ConnectTimeout, MaxIdleTime, MaxLifetime time.Duration
}

type PostgresCatalogOwner struct {
	mu        sync.Mutex
	closeOnce sync.Once
	db        *sql.DB
	catalog   *Catalog
	ready     bool
	closeErr  error
	// Original errors remain private custody. Never stringify them in public
	// status/logging; a cleanup error cannot replace the startup first cause.
	firstCause   error
	closeCause   error
	failurePhase string
}

func (*PostgresCatalogOwner) String() string {
	return "PostgresCatalogOwner{protected diagnostics redacted}"
}
func (o *PostgresCatalogOwner) GoString() string { return o.String() }
func (o *PostgresCatalogOwner) FailurePhase() string {
	if o == nil {
		return "UNAVAILABLE"
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.failurePhase
}
func (o *PostgresCatalogOwner) remember(phase string, cause error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.firstCause == nil && cause != nil {
		o.firstCause = cause
		o.failurePhase = phase
	}
}

// Keep ordinary fmt/JSON diagnostics from accidentally serializing the URL.
func (PostgresCatalogConfig) String() string {
	return "PostgresCatalogConfig{protected connection URL redacted}"
}
func (c PostgresCatalogConfig) GoString() string { return c.String() }

func catalogConnection(c PostgresCatalogConfig) (string, error) {
	if c.MaxOpen < 1 || c.MaxOpen > 64 || c.MaxIdle < 0 || c.MaxIdle > c.MaxOpen || c.ConnectTimeout < time.Second || c.ConnectTimeout > 30*time.Second || c.MaxIdleTime < time.Second || c.MaxIdleTime > time.Hour || c.MaxLifetime < c.MaxIdleTime || c.MaxLifetime > 24*time.Hour {
		return "", ErrCatalogConfiguration
	}
	u, e := url.Parse(c.ConnectionURL)
	if e != nil || u == nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Hostname() == "" || u.User == nil || u.User.Username() == "" || u.Fragment != "" || u.Opaque != "" || u.RawPath != "" || !strings.HasPrefix(u.Path, "/") || len(u.Path) < 2 || strings.Contains(u.Path[1:], "/") {
		return "", ErrCatalogConfiguration
	}
	password, hasPassword := u.User.Password()
	port, e := strconv.Atoi(u.Port())
	if e != nil || port < 1 || port > 65535 || !hasPassword || password == "" {
		return "", ErrCatalogConfiguration
	}
	q, e := url.ParseQuery(u.RawQuery)
	if e != nil {
		return "", ErrCatalogConfiguration
	}
	for key, values := range q {
		if len(values) != 1 || (key != "sslmode" && key != "sslrootcert") {
			return "", ErrCatalogConfiguration
		}
	}
	if q.Get("sslmode") != "verify-full" {
		return "", ErrCatalogConfiguration
	}
	// Explicitly override relevant lib/pq ENV defaults; no arbitrary PGOPTIONS,
	// driver name, application name or connect timeout comes from a request.
	q.Set("options", "")
	q.Set("application_name", "ynx-auth-developer-catalog")
	q.Set("connect_timeout", strconv.Itoa(int((c.ConnectTimeout+time.Second-1)/time.Second)))
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// Package-private test seam only. Production always uses the fixed lib/pq
// connector, not a caller-supplied sql.DB/driver/factory or alternate store.
func openPostgresCatalog(ctx context.Context, c PostgresCatalogConfig, source OriginalSource, open func(string) (*sql.DB, error)) (*PostgresCatalogOwner, error) {
	connection, e := catalogConnection(c)
	if e != nil || ctx == nil || source == nil {
		return nil, ErrCatalogConfiguration
	}
	v := reflect.ValueOf(source)
	switch v.Kind() {
	case reflect.Pointer, reflect.Interface, reflect.Map, reflect.Func, reflect.Slice, reflect.Chan:
		if v.IsNil() {
			return nil, ErrCatalogConfiguration
		}
	}
	bounded, cancel := context.WithTimeout(ctx, c.ConnectTimeout)
	defer cancel()
	if bounded.Err() != nil || source.AssertSourceCurrent(bounded) != nil || bounded.Err() != nil {
		return nil, ErrCatalogStartup
	}
	db, e := open(connection)
	// Preserve a real partial pool BEFORE examining an error; caller always
	// receives its owner if one existed, including a close-UNKNOWN result.
	if db == nil {
		return nil, ErrCatalogStartup
	}
	owner := &PostgresCatalogOwner{db: db}
	fail := func(phase string, cause error) (*PostgresCatalogOwner, error) {
		owner.remember(phase, cause)
		_ = owner.Close()
		return owner, ErrCatalogStartup
	}
	if e != nil {
		return fail("OPEN", e)
	}
	db.SetMaxOpenConns(c.MaxOpen)
	db.SetMaxIdleConns(c.MaxIdle)
	db.SetConnMaxIdleTime(c.MaxIdleTime)
	db.SetConnMaxLifetime(c.MaxLifetime)
	if e = db.PingContext(bounded); e != nil {
		return fail("PING", e)
	}
	if e = verifyCatalogReadSchema(bounded, db); e != nil {
		return fail("READ_SCHEMA", e)
	}
	if e = bounded.Err(); e != nil {
		return fail("CONTEXT", e)
	}
	if e = source.AssertSourceCurrent(bounded); e != nil {
		return fail("POST_SOURCE_CURRENT", e)
	}
	catalog, e := NewCatalog(db, source)
	if e != nil {
		return fail("CATALOG", e)
	}
	if e = bounded.Err(); e != nil {
		return fail("CONTEXT", e)
	}
	owner.mu.Lock()
	owner.catalog = catalog
	owner.ready = true
	owner.mu.Unlock()
	return owner, nil
}

func OpenPostgresCatalog(ctx context.Context, c PostgresCatalogConfig, source OriginalSource) (*PostgresCatalogOwner, error) {
	return openPostgresCatalog(ctx, c, source, func(connection string) (*sql.DB, error) {
		connector, e := pq.NewConnector(connection)
		if e != nil {
			return nil, ErrCatalogConfiguration
		}
		return sql.OpenDB(connector), nil
	})
}

// Checks read compatibility only, not migration approval or database identity.
// Existing schema.sql remains an EXPLICIT owner migration, never startup SQL.
var catalogReadSchema = []string{
	"SELECT revision FROM developer_catalog_current WHERE singleton=1",
	"SELECT id,owner_account,revision,revoked,runtime_origin FROM developer_projects LIMIT 0",
	"SELECT id,owner_account,revision,revoked FROM developer_teams LIMIT 0",
	"SELECT team_id,account,revision,expires_ms,revoked FROM developer_team_members LIMIT 0",
	"SELECT project_id,account,can_read,can_publish,can_runtime,revision,expires_ms,revoked FROM developer_project_members LIMIT 0",
	"SELECT project_id,team_id,can_read,can_publish,can_runtime,revision,expires_ms,revoked FROM developer_project_teams LIMIT 0",
	"SELECT project_id,publisher_id,account,key_role,public_original,public_sha256,registration_ref,revision,expires_ms,revoked FROM developer_publishers LIMIT 0",
	"SELECT account,request_id,binding_sha256,proof_sha256,confirmation_ref,revocation_ref,principal_original,command_original,action,object_id,state,revision,expires_ms FROM developer_control_operations LIMIT 0",
	"SELECT account,request_id,binding_sha256,request_original,proof_sha256,confirmation_ref,revocation_ref,state,result_original,result_sha256 FROM developer_identity_recoveries LIMIT 0",
}

func verifyCatalogReadSchema(ctx context.Context, db *sql.DB) error {
	var revision int64
	if e := db.QueryRowContext(ctx, catalogReadSchema[0]).Scan(&revision); e != nil {
		return e
	}
	if revision < 1 {
		return ErrCatalogStartup
	}
	for _, query := range catalogReadSchema[1:] {
		rows, e := db.QueryContext(ctx, query)
		if e != nil {
			return e
		}
		closeError := rows.Close()
		if closeError != nil {
			return closeError
		}
		if e := rows.Err(); e != nil {
			return e
		}
	}
	return nil
}
func (o *PostgresCatalogOwner) Catalog() (*Catalog, error) {
	if o == nil {
		return nil, ErrCatalogClosed
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.ready || o.catalog == nil {
		return nil, ErrCatalogClosed
	}
	return o.catalog, nil
}
func (o *PostgresCatalogOwner) Close() error {
	if o == nil {
		return ErrCatalogClosed
	}
	o.closeOnce.Do(func() {
		o.mu.Lock()
		o.ready = false
		o.mu.Unlock()
		if o.db != nil {
			if e := o.db.Close(); e != nil {
				o.mu.Lock()
				o.closeCause = e
				o.closeErr = ErrCatalogCloseUnknown
				if o.firstCause == nil {
					o.firstCause = e
					o.failurePhase = "CLOSE"
				}
				o.mu.Unlock()
			}
		}
	})
	return o.closeErr
}
