package developerauthority

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"net/http"
	"strings"
	"testing"
)

// Executes the real Catalog read continuation with one real HTTP credential
// authentication, subsequent original-current calls, real SQL API transactions
// and the actual factory publisher reader. ACL rows remain PUBLIC fixtures.
type r216CatalogReadConnector struct{ s *r216ReaderDB }
type r216CatalogReadConn struct{ r216ReaderConn }
type r216CatalogReadTx struct{}

func (c r216CatalogReadConnector) Connect(context.Context) (driver.Conn, error) {
	return &r216CatalogReadConn{r216ReaderConn{c.s}}, nil
}
func (r216CatalogReadConnector) Driver() driver.Driver   { return controlDriver{} }
func (c *r216CatalogReadConn) Begin() (driver.Tx, error) { return r216CatalogReadTx{}, nil }
func (c *r216CatalogReadConn) BeginTx(ctx context.Context, o driver.TxOptions) (driver.Tx, error) {
	if ctx.Err() != nil || o.Isolation != driver.IsolationLevel(sql.LevelSerializable) {
		return nil, errors.New("PUBLIC original serializable required")
	}
	return r216CatalogReadTx{}, nil
}
func (r216CatalogReadTx) Commit() error   { return nil }
func (r216CatalogReadTx) Rollback() error { return nil }
func (c *r216CatalogReadConn) QueryContext(ctx context.Context, q string, a []driver.NamedValue) (driver.Rows, error) {
	k := c.s.key
	if q == "SELECT revision FROM developer_catalog_current WHERE singleton=1 FOR SHARE" {
		return &approvalRows{n: 1, v: [][]driver.Value{{int64(1)}}}, nil
	}
	if q == "SELECT owner_account,runtime_origin,revision,revoked FROM developer_projects WHERE id=$1" {
		return &approvalRows{n: 4, v: [][]driver.Value{{k.Account, "", int64(1), false}}}, nil
	}
	if strings.HasPrefix(q, "SELECT 'direct',account,revision,0,") {
		return &approvalRows{n: 8, v: [][]driver.Value{{"direct", k.Account, int64(1), int64(0), true, true, false, k.ExpiresMS}}}, nil
	}
	if q == "SELECT account,key_role,public_original,public_sha256,registration_ref,revision,expires_ms,revoked FROM developer_publishers WHERE project_id=$1 AND publisher_id=$2" {
		return &approvalRows{n: 8, v: [][]driver.Value{{k.Account, k.KeyRole, k.PublicOriginal, k.PublicSHA256, k.RegistrationRef, int64(k.Revision), k.ExpiresMS, false}}}, nil
	}
	return c.r216ReaderConn.QueryContext(ctx, q, a)
}

type r216CatalogReadSource struct {
	*catalogPublisherSourceFixture
	factory         *OriginalDeveloperSourceFactory
	authentications int
}

func (s *r216CatalogReadSource) CurrentExistingPrincipal(ctx context.Context, r *http.Request) (Principal, error) {
	s.authentications++
	return s.factory.principal.CurrentExistingPrincipal(ctx, r)
}
func (s *r216CatalogReadSource) AssertPrincipalCurrent(ctx context.Context, p Principal) error {
	return s.factory.principal.AssertPrincipalCurrent(ctx, p)
}
func (s *r216CatalogReadSource) AssertPublisherCurrent(ctx context.Context, p Principal, k Publisher) error {
	return s.factory.AssertPublisherCurrent(ctx, p, k)
}
func TestR216CatalogCurrentPublisherRechecksWithoutReplayingHTTPAuthentication(t *testing.T) {
	f, s, p, k := r216ReaderFixture(t, "")
	db := sql.OpenDB(r216CatalogReadConnector{s})
	defer db.Close()
	source := &r216CatalogReadSource{catalogPublisherSourceFixture: &catalogPublisherSourceFixture{p: p}, factory: f}
	c, e := NewCatalog(db, source)
	if e != nil {
		t.Fatal(e)
	}
	r := actualPrincipalRequest()
	r.Header.Set("x-request-id", "req_PUBLIC_READER_CONTINUATION_12345")
	actual, e := c.CurrentPublisher(context.Background(), r, k.ProjectID, k.PublisherID)
	if e != nil || actual.Revision != k.Revision || actual.RegistrationRef != k.RegistrationRef {
		t.Fatal("normal read continuation failed", e)
	}
	if source.authentications != 1 || s.reads != 4 {
		t.Fatal("HTTP proof replay or missing final current read", source.authentications, s.reads)
	}
}
