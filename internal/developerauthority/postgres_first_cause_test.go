package developerauthority

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

// PUBLIC connector seam. No production DB, credentials or Source are used.
type causeConnector struct {
	first, close error
	closes       int
}

func (c *causeConnector) Connect(context.Context) (driver.Conn, error) {
	return &causeConnection{c}, nil
}
func (c *causeConnector) Driver() driver.Driver { return causeDriver{c} }

type causeDriver struct{ c *causeConnector }

func (d causeDriver) Open(string) (driver.Conn, error) { return &causeConnection{d.c}, nil }

type causeConnection struct{ c *causeConnector }

func (c *causeConnection) Prepare(string) (driver.Stmt, error) { return nil, ErrDenied }
func (c *causeConnection) Begin() (driver.Tx, error)           { return nil, ErrDenied }
func (c *causeConnection) Ping(context.Context) error          { return c.c.first }
func (c *causeConnection) Close() error                        { c.c.closes++; return c.c.close }
func TestPostgresFirstCauseDelta(t *testing.T) {
	first := errors.New("PUBLIC_SECRET_FIRST_CAUSE")
	closing := errors.New("PUBLIC_SECRET_CLEANUP_CAUSE")
	fixture := &causeConnector{first: first, close: closing}
	owner, e := openPostgresCatalog(context.Background(), poolConfig(), &poolSource{}, func(string) (*sql.DB, error) { return sql.OpenDB(fixture), nil })
	if owner == nil || e != ErrCatalogStartup {
		t.Fatal("missing actual partial")
	}
	// Reflection lets this same real regression execute against the old owner,
	// rather than merely failing to compile for a new implementation field.
	held := reflect.ValueOf(owner).Elem().FieldByName("firstCause")
	if !held.IsValid() || held.IsNil() || held.Elem().Pointer() != reflect.ValueOf(first).Pointer() {
		t.Fatal("actual startup first cause was discarded/overwritten")
	}
	phase, ok := any(owner).(interface{ FailurePhase() string })
	if !ok || phase.FailurePhase() != "PING" {
		t.Fatal("no fixed safe first phase")
	}
	if owner.Close() != ErrCatalogCloseUnknown || owner.Close() != ErrCatalogCloseUnknown || fixture.closes != 1 {
		t.Fatal("cleanup UNKNOWN retried/lost")
	}
	if held.Elem().Pointer() != reflect.ValueOf(first).Pointer() {
		t.Fatal("cleanup replaced startup cause")
	}
	if strings.Contains(fmt.Sprintf("%v %+v %#v", owner, owner, owner), "PUBLIC_SECRET") {
		t.Fatal("owner diagnostics leak raw errors")
	}
}
