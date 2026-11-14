package developerauthority

// PUBLIC original-Source and database/sql driver seams. Actual Catalog code
// executes; no real PostgreSQL, Root, N1, key, grant or user approval is proved.
import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const publicNow int64 = 1000000

func publicPrincipal() Principal {
	return Principal{Account: "existing-account", DeviceID: "original-device", SessionRef: "original-session", CurrentRef: "original-current", AccountGeneration: 2, SessionGeneration: 3, ExpiresMS: publicNow + 10000}
}

type publicSource struct {
	p                                                                 Principal
	denyApproval, denyPrincipal, denyCatalog, denyControl, badBinding bool
	publisher                                                         ProtectedPublisher
	verifyKeyCalls, approvals                                         int
}

func (s *publicSource) AssertSourceCurrent(context.Context) error {
	if s.denyCatalog {
		return ErrDenied
	}
	return nil
}

func (s *publicSource) CurrentExistingPrincipal(context.Context, *http.Request) (Principal, error) {
	return s.p, nil
}
func (s *publicSource) AuthorizeProjectControl(_ context.Context, p Principal, c Command, proof []byte) (Approval, error) {
	s.approvals++
	if s.denyApproval {
		return Approval{}, ErrDenied
	}
	a := Approval{objectHash(p), objectHash(c), hash(proof), "PUBLIC-actual-confirmation-ref", "PUBLIC-revocation-ref", publicNow + 1000}
	if s.badBinding {
		a.BindingSHA256 = strings.Repeat("0", 64)
	}
	return a, nil
}
func (s *publicSource) AssertPrincipalCurrent(context.Context, Principal) error {
	if s.denyPrincipal {
		return ErrDenied
	}
	return nil
}
func (s *publicSource) AssertCatalogAuthorityCurrent(context.Context, Principal) error {
	if s.denyCatalog {
		return ErrDenied
	}
	return nil
}
func (s *publicSource) AssertControlCurrent(context.Context, Principal, Approval) error {
	if s.denyControl {
		return ErrDenied
	}
	return nil
}
func (s *publicSource) VerifyProtectedPublisherOriginal(context.Context, Principal, Command, []byte) (ProtectedPublisher, error) {
	s.verifyKeyCalls++
	return s.publisher, nil
}
func (s *publicSource) AssertPublisherCurrent(context.Context, Principal, Publisher) error {
	return nil
}

type publicSQL struct {
	queries                    [][][]driver.Value
	executed                   []string
	args                       [][]driver.NamedValue
	begins, commits, rollbacks int
	duplicate                  bool
	commitError                error
}

var publicDrivers sync.Map
var publicSequence atomic.Uint64

type publicDriver struct{}
type publicConn struct{ s *publicSQL }
type publicTx struct{ s *publicSQL }
type publicRows struct {
	rows  [][]driver.Value
	index int
}

func init() { sql.Register("PUBLIC-developer-catalog", publicDriver{}) }
func (publicDriver) Open(name string) (driver.Conn, error) {
	s, ok := publicDrivers.Load(name)
	if !ok {
		return nil, errors.New("PUBLIC unknown SQL fixture")
	}
	return &publicConn{s.(*publicSQL)}, nil
}
func (c *publicConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected Prepare")
}
func (*publicConn) Close() error                { return nil }
func (c *publicConn) Begin() (driver.Tx, error) { c.s.begins++; return &publicTx{c.s}, nil }
func (c *publicConn) BeginTx(_ context.Context, o driver.TxOptions) (driver.Tx, error) {
	if o.Isolation != driver.IsolationLevel(sql.LevelSerializable) {
		return nil, errors.New("missing serializable")
	}
	return c.Begin()
}
func (c *publicConn) ExecContext(_ context.Context, q string, a []driver.NamedValue) (driver.Result, error) {
	c.s.executed = append(c.s.executed, q)
	c.s.args = append(c.s.args, append([]driver.NamedValue(nil), a...))
	if c.s.duplicate && (strings.HasPrefix(q, "INSERT INTO developer_control_operations") || strings.HasPrefix(q, "INSERT INTO developer_identity_recoveries")) {
		return driver.RowsAffected(0), nil
	}
	return driver.RowsAffected(1), nil
}
func (c *publicConn) QueryContext(_ context.Context, q string, a []driver.NamedValue) (driver.Rows, error) {
	c.s.executed = append(c.s.executed, q)
	if len(c.s.queries) == 0 {
		return nil, errors.New("unexpected SQL query: " + q)
	}
	rows := c.s.queries[0]
	c.s.queries = c.s.queries[1:]
	return &publicRows{rows: rows}, nil
}
func (t *publicTx) Commit() error   { t.s.commits++; return t.s.commitError }
func (t *publicTx) Rollback() error { t.s.rollbacks++; return nil }
func (r *publicRows) Columns() []string {
	n := 1
	if len(r.rows) > 0 {
		n = len(r.rows[0])
	}
	cols := make([]string, n)
	for i := range cols {
		cols[i] = fmt.Sprint(i)
	}
	return cols
}
func (*publicRows) Close() error { return nil }
func (r *publicRows) Next(out []driver.Value) error {
	if r.index >= len(r.rows) {
		return io.EOF
	}
	copy(out, r.rows[r.index])
	r.index++
	return nil
}
func publicCatalog(t *testing.T, s *publicSQL, source *publicSource) *Catalog {
	t.Helper()
	name := fmt.Sprint(publicSequence.Add(1))
	publicDrivers.Store(name, s)
	db, e := sql.Open("PUBLIC-developer-catalog", name)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close(); publicDrivers.Delete(name) })
	c, e := NewCatalog(db, source)
	if e != nil {
		t.Fatal(e)
	}
	c.now = func() time.Time { return time.UnixMilli(publicNow) }
	return c
}
func publicRequest() *http.Request {
	r, _ := http.NewRequest("POST", "https://original.invalid/internal", nil)
	return r
}
func publicCreate() Command {
	return Command{RequestID: "original-request", Action: "project.create", ProjectID: "project", ExpiresMS: publicNow + 2000}
}
func writes(s *publicSQL) int {
	n := 0
	for _, q := range s.executed {
		if strings.HasPrefix(q, "INSERT") || strings.HasPrefix(q, "UPDATE") {
			n++
		}
	}
	return n
}

func TestCatalogOwnerNeverImpliesPublish(t *testing.T) {
	a, e := projectAccess(publicPrincipal(), "project", "existing-account", "", 1, 1, nil, publicNow)
	if e != nil || a.Publish || a.Read || a.Runtime {
		t.Fatal("implicit owner grant", e)
	}
}
func TestCatalogExplicitRolesAndCurrentRevision(t *testing.T) {
	p := publicPrincipal()
	rows := []grantRow{{Kind: "direct", ID: p.Account, Revision: 1, Read: true, ExpiresMS: publicNow + 5000}, {Kind: "team", ID: "team", Revision: 4, MembershipRevision: 5, Publish: true, ExpiresMS: publicNow + 4000}}
	a, e := projectAccess(p, "project", "owner", "", 2, 10, rows, publicNow)
	if e != nil || !a.Read || !a.Publish || a.Runtime || a.ExpiresMS != publicNow+4000 {
		t.Fatal(a, e)
	}
	rows[1].MembershipRevision++
	b, e := projectAccess(p, "project", "owner", "", 2, 10, rows, publicNow)
	if e != nil || a.CurrentReference == b.CurrentReference {
		t.Fatal("membership revoke/version not bound")
	}
	b, e = projectAccess(p, "project", "owner", "", 2, 11, rows, publicNow)
	if e != nil || a.CurrentReference == b.CurrentReference {
		t.Fatal("catalog change not bound")
	}
}
func TestCatalogRejectsStaleForeignAndDuplicateRows(t *testing.T) {
	p := publicPrincipal()
	for _, rows := range [][]grantRow{{{Kind: "direct", ID: "other-account", Revision: 1, Publish: true, ExpiresMS: publicNow + 1}}, {{Kind: "team", ID: "team", Revision: 1, MembershipRevision: 0, Publish: true, ExpiresMS: publicNow + 1}}, {{Kind: "direct", ID: p.Account, Revision: 1, Publish: true, ExpiresMS: publicNow}}, {{Kind: "file-owner", ID: p.Account, Revision: 1, Publish: true, ExpiresMS: publicNow + 1}}, {{Kind: "direct", ID: p.Account, Revision: 1, ExpiresMS: publicNow + 1}, {Kind: "direct", ID: p.Account, Revision: 1, ExpiresMS: publicNow + 1}}} {
		if _, e := projectAccess(p, "project", "owner", "", 1, 1, rows, publicNow); e == nil {
			t.Fatal("untrusted role accepted")
		}
	}
}
func TestCatalogCommandsBindObjectActionExpiry(t *testing.T) {
	for _, change := range []func(*Command){func(c *Command) { c.Action = "file-save" }, func(c *Command) { c.RequestID = "" }, func(c *Command) { c.Publish = true }, func(c *Command) { c.ExpiresMS = publicNow }, func(c *Command) { c.ExpectedRevision = 1 }, func(c *Command) { c.GrantExpiresMS = publicNow + 1000 }} {
		c := publicCreate()
		change(&c)
		if c.valid(publicNow) {
			t.Fatal("unexpected command admitted", c)
		}
	}
	for _, o := range []string{"http://runtime.invalid", "https://user@runtime.invalid", "https://runtime.invalid/", "https://runtime.invalid?q=1", "https://runtime.invalid/#x"} {
		if canonicalOrigin(o) {
			t.Fatal("noncanonical origin", o)
		}
	}
}
func TestCatalogControlApprovalExactBinding(t *testing.T) {
	p := publicPrincipal()
	c := publicCreate()
	s := &publicSource{}
	a, _ := s.AuthorizeProjectControl(context.Background(), p, c, []byte("PUBLIC-N1"))
	if !validApproval(a, p, c, []byte("PUBLIC-N1"), publicNow) {
		t.Fatal("PUBLIC shape fixture rejected")
	}
	for _, mutate := range []func(*Approval){func(a *Approval) { a.BindingSHA256 = "other" }, func(a *Approval) { a.PrincipalSHA256 = "other" }, func(a *Approval) { a.ProofSHA256 = "other" }, func(a *Approval) { a.ConfirmationRef = "" }, func(a *Approval) { a.RevocationRef = "" }, func(a *Approval) { a.ExpiresMS = publicNow }} {
		bad := a
		mutate(&bad)
		if validApproval(bad, p, c, []byte("PUBLIC-N1"), publicNow) {
			t.Fatal("approval widened")
		}
	}
}
func TestCatalogControlTransactionAndUncertainCommit(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			s := &publicSQL{queries: [][][]driver.Value{{{int64(1)}}}}
			if fail {
				s.commitError = io.ErrUnexpectedEOF
			}
			c := publicCatalog(t, s, &publicSource{p: publicPrincipal()})
			result, e := c.ApplyControl(context.Background(), publicRequest(), publicCreate(), []byte("PUBLIC-N1"), nil)
			if fail {
				if !errors.Is(e, ErrUnknown) || result == nil || result.Committed {
					t.Fatal(result, e)
				}
			} else if e != nil || result == nil || !result.Committed {
				t.Fatal(result, e)
			}
			if s.commits != 1 || writes(s) != 3 {
				t.Fatal("not atomic control/journal/revision transaction", s.commits, s.executed)
			}
		})
	}
}
func TestCatalogDeniedProofTouchesNoDB(t *testing.T) {
	for _, source := range []*publicSource{{p: publicPrincipal(), denyApproval: true}, {p: publicPrincipal(), badBinding: true}, {p: Principal{Account: "caller-asserted"}}} {
		s := &publicSQL{}
		c := publicCatalog(t, s, source)
		if _, e := c.ApplyControl(context.Background(), publicRequest(), publicCreate(), []byte("PUBLIC-unverified"), nil); e == nil || s.begins != 0 {
			t.Fatal("unverified source reached SQL", e)
		}
	}
}
func TestCatalogMissingCASRefusesBeforeInsert(t *testing.T) {
	s := &publicSQL{queries: [][][]driver.Value{{{int64(1)}}, {{"existing-account", false}}, nil}}
	c := publicCatalog(t, s, &publicSource{p: publicPrincipal()})
	cmd := Command{RequestID: "request", Action: "project.member", ProjectID: "project", SubjectAccount: "member", Read: true, ExpectedRevision: 7, ExpiresMS: publicNow + 2000, GrantExpiresMS: publicNow + 3600000}
	if _, e := c.ApplyControl(context.Background(), publicRequest(), cmd, []byte("PUBLIC-N1"), nil); !errors.Is(e, ErrConflict) || writes(s) != 0 || s.commits != 0 {
		t.Fatal("nonzero missing revision became create", e, s.executed)
	}
}
func TestCatalogDuplicateOperationDoesNotReapply(t *testing.T) {
	s := &publicSQL{queries: [][][]driver.Value{{{int64(1)}}}, duplicate: true}
	c := publicCatalog(t, s, &publicSource{p: publicPrincipal()})
	if _, e := c.ApplyControl(context.Background(), publicRequest(), publicCreate(), []byte("PUBLIC-N1"), nil); !errors.Is(e, ErrConflict) || s.commits != 0 || writes(s) != 1 {
		t.Fatal("duplicate applied", e, s.executed)
	}
}
func TestCatalogCurrentProjectionAndRevocationAuthority(t *testing.T) {
	for _, deny := range []bool{false, true} {
		t.Run(fmt.Sprint(deny), func(t *testing.T) {
			s := &publicSQL{queries: [][][]driver.Value{{{int64(2)}}, {{"owner", "https://project.runtime.invalid", int64(1), false}}, {{"direct", "existing-account", int64(3), int64(0), true, false, false, publicNow + 5000}}}}
			c := publicCatalog(t, s, &publicSource{p: publicPrincipal(), denyCatalog: deny})
			a, e := c.CurrentProject(context.Background(), publicRequest(), "project")
			if deny {
				if e == nil || s.commits != 0 {
					t.Fatal("catalog Root revocation ignored")
				}
			} else if e != nil || !a.Read || a.Publish || a.Runtime || s.commits != 1 {
				t.Fatal(a, e)
			}
		})
	}
}
func TestCatalogPublisherCannotSelfAttest(t *testing.T) {
	s := &publicSQL{}
	source := &publicSource{p: publicPrincipal()}
	c := publicCatalog(t, s, source)
	raw := []byte("PUBLIC self-attested key, not registered")
	cmd := Command{RequestID: "request", Action: "project.publisher", ProjectID: "project", SubjectAccount: "existing-account", PublisherID: "publisher", ExpiresMS: publicNow + 2000, GrantExpiresMS: publicNow + 3600000, PublicOriginalSHA256: hash(raw)}
	if _, e := c.ApplyControl(context.Background(), publicRequest(), cmd, []byte("PUBLIC-N1"), raw); e == nil || s.begins != 0 || source.verifyKeyCalls != 1 {
		t.Fatal("self-attested key accepted", e)
	}
}
func TestCatalogObserveMissingNeverMeansNotExecuted(t *testing.T) {
	s := &publicSQL{queries: [][][]driver.Value{nil}}
	c := publicCatalog(t, s, &publicSource{p: publicPrincipal()})
	if _, e := c.ObserveControl(context.Background(), publicRequest(), "original-request", strings.Repeat("0", 64)); !errors.Is(e, ErrUnknown) || writes(s) != 0 {
		t.Fatal("missing was dispatchable", e)
	}
}

func TestCatalogOriginRegistrationIsNotUserAccess(t *testing.T) {
	s := &publicSQL{queries: [][][]driver.Value{{{"project", int64(1), false}}}}
	c := publicCatalog(t, s, &publicSource{p: Principal{}})
	if e := c.AssertProjectRuntimeOrigin(context.Background(), "https://project.runtime.invalid"); e != nil {
		t.Fatal(e)
	}
	if s.begins != 0 || writes(s) != 0 {
		t.Fatal("origin check mutated")
	}
	if _, e := c.Principal(context.Background(), publicRequest()); e == nil {
		t.Fatal("origin admitted an unregistered account")
	}
}
