package developerauthority

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

// The real Catalog.ApplyControl and database/sql transaction API run below.
// Source/DB are explicit PUBLIC fixtures, not Root/crypto/PostgreSQL evidence.
type catalogBindingFixture struct {
	project, publisher, account, sha, ref, source, instance, execution, state string
	publisherRevision                                                         uint64
	grant, revision                                                           int64
}
type catalogPublisherDB struct {
	mu                                sync.Mutex
	core                              *publisherCaptureDB
	owner                             string
	publisher                         Publisher
	binding                           *catalogBindingFixture
	operations                        map[string]bool
	catalogRevision                   uint64
	commits, rollbacks, bindingWrites int
	trace                             []string
	lostCommit                        bool
	panicBinding                      bool
}
type catalogPublisherConnector struct{ s *catalogPublisherDB }
type catalogPublisherDriver struct{}
type catalogPublisherConn struct {
	s         *catalogPublisherDB
	tx        bool
	publisher Publisher
	binding   *catalogBindingFixture
	ops       map[string]bool
	revision  uint64
}
type catalogPublisherTx struct{ c *catalogPublisherConn }

func (catalogPublisherDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("PUBLIC connector only")
}
func (c catalogPublisherConnector) Connect(context.Context) (driver.Conn, error) {
	return &catalogPublisherConn{s: c.s}, nil
}
func (catalogPublisherConnector) Driver() driver.Driver { return catalogPublisherDriver{} }
func (*catalogPublisherConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("PUBLIC no prepare")
}
func (*catalogPublisherConn) Close() error { return nil }
func (c *catalogPublisherConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{Isolation: driver.IsolationLevel(sql.LevelSerializable)})
}
func cloneCatalogBinding(v *catalogBindingFixture) *catalogBindingFixture {
	if v == nil {
		return nil
	}
	r := *v
	return &r
}
func (c *catalogPublisherConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	if ctx.Err() != nil || opts.Isolation != driver.IsolationLevel(sql.LevelSerializable) || c.tx {
		return nil, errors.New("PUBLIC expected original serializable transaction")
	}
	c.s.mu.Lock()
	defer c.s.mu.Unlock()
	c.tx = true
	c.publisher = c.s.publisher
	c.publisher.PublicOriginal = append([]byte(nil), c.publisher.PublicOriginal...)
	c.binding = cloneCatalogBinding(c.s.binding)
	c.revision = c.s.catalogRevision
	c.ops = map[string]bool{}
	for k, v := range c.s.operations {
		c.ops[k] = v
	}
	c.s.trace = append(c.s.trace, "begin-serializable")
	return &catalogPublisherTx{c}, nil
}
func (t *catalogPublisherTx) Commit() error {
	c := t.c
	c.s.mu.Lock()
	defer c.s.mu.Unlock()
	if !c.tx {
		return errors.New("PUBLIC no transaction")
	}
	c.tx = false
	c.s.publisher = c.publisher
	c.s.binding = cloneCatalogBinding(c.binding)
	c.s.operations = c.ops
	c.s.catalogRevision = c.revision
	c.s.commits++
	c.s.trace = append(c.s.trace, "commit")
	if c.s.lostCommit {
		return errors.New("PUBLIC committed but response lost")
	}
	return nil
}
func (t *catalogPublisherTx) Rollback() error {
	c := t.c
	c.s.mu.Lock()
	defer c.s.mu.Unlock()
	if c.tx {
		c.tx = false
		c.s.rollbacks++
		c.s.trace = append(c.s.trace, "rollback")
	}
	return nil
}
func (c *catalogPublisherConn) QueryContext(ctx context.Context, q string, a []driver.NamedValue) (driver.Rows, error) {
	if !c.tx {
		return (&publisherCaptureConn{c.s.core}).QueryContext(ctx, q, a)
	}
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	switch q {
	case "SELECT revision FROM developer_catalog_current WHERE singleton=1 FOR UPDATE":
		return &approvalRows{v: [][]driver.Value{{int64(c.revision)}}, n: 1}, nil
	case "SELECT owner_account,revoked FROM developer_projects WHERE id=$1 FOR UPDATE":
		c.s.trace = append(c.s.trace, "owner-acl")
		return &approvalRows{v: [][]driver.Value{{c.s.owner, false}}, n: 2}, nil
	case "SELECT revision FROM developer_publishers WHERE project_id=$1 AND publisher_id=$2 FOR UPDATE":
		return &approvalRows{v: [][]driver.Value{{int64(c.publisher.Revision)}}, n: 1}, nil
	case originalPublisherCatalogRowSQL:
		p := c.publisher
		return &approvalRows{v: [][]driver.Value{{p.Account, p.KeyRole, append([]byte(nil), p.PublicOriginal...), p.PublicSHA256, p.RegistrationRef, int64(p.Revision), p.ExpiresMS, p.Revoked}}, n: 8}, nil
	case originalPublisherCatalogActivateSQL:
		if len(a) != 20 {
			return nil, errors.New("PUBLIC wrong activation arity")
		}
		c.s.core.mu.Lock()
		row := append([]driver.Value(nil), c.s.core.rows[a[6].Value.(string)+"/"+a[7].Value.(string)+"/"+a[4].Value.(string)]...)
		c.s.core.mu.Unlock()
		if len(row) != 14 {
			return &approvalRows{n: 1}, nil
		}
		for _, pair := range [][2]int{{0, 10}, {1, 4}, {2, 19}, {3, 13}, {4, 14}, {5, 3}, {6, 15}, {7, 8}, {8, 9}, {12, 17}, {13, 18}} {
			if row[pair[0]] != a[pair[1]].Value {
				return &approvalRows{n: 1}, nil
			}
		}
		if row[9] != "captured" || row[10] != int64(1) || row[13].(int64) <= a[16].Value.(int64) {
			return &approvalRows{n: 1}, nil
		}
		revision := int64(1)
		if c.binding != nil {
			if c.binding.publisherRevision != uint64(a[12].Value.(int64)) {
				return &approvalRows{n: 1}, nil
			}
			revision = c.binding.revision + 1
		}
		c.binding = &catalogBindingFixture{project: a[0].Value.(string), publisher: a[1].Value.(string), account: a[2].Value.(string), sha: a[3].Value.(string), ref: a[4].Value.(string), publisherRevision: uint64(a[5].Value.(int64)), source: a[6].Value.(string), instance: a[7].Value.(string), execution: a[10].Value.(string), grant: a[11].Value.(int64), state: "active", revision: revision}
		c.s.bindingWrites++
		c.s.trace = append(c.s.trace, "registry-activate")
		if c.s.panicBinding {
			panic("PUBLIC pending registry statement response panic")
		}
		return &approvalRows{v: [][]driver.Value{{revision}}, n: 1}, nil
	case originalPublisherCatalogRevokeSQL:
		b := c.binding
		if b == nil || b.state != "active" || b.project != a[1].Value || b.publisher != a[2].Value || b.account != a[3].Value || b.sha != a[4].Value || b.publisherRevision != uint64(a[5].Value.(int64)) || b.ref != a[6].Value || b.grant != a[7].Value {
			return &approvalRows{n: 1}, nil
		}
		b.state = "revoked"
		b.publisherRevision = uint64(a[0].Value.(int64))
		b.revision++
		c.s.bindingWrites++
		c.s.trace = append(c.s.trace, "registry-revoke")
		return &approvalRows{v: [][]driver.Value{{b.revision}}, n: 1}, nil
	}
	return nil, errors.New("PUBLIC unexpected query within Catalog transaction")
}
func (c *catalogPublisherConn) ExecContext(ctx context.Context, q string, a []driver.NamedValue) (driver.Result, error) {
	if !c.tx || ctx.Err() != nil {
		return nil, errors.New("PUBLIC expected same active Catalog transaction")
	}
	if strings.HasPrefix(q, "SELECT pg_advisory_xact_lock") {
		return driver.RowsAffected(1), nil
	}
	if strings.HasPrefix(q, "INSERT INTO developer_control_operations") {
		key := a[0].Value.(string) + "/" + a[1].Value.(string)
		if c.ops[key] {
			return driver.RowsAffected(0), nil
		}
		c.ops[key] = true
		c.s.trace = append(c.s.trace, "control-operation")
		return driver.RowsAffected(1), nil
	}
	if strings.HasPrefix(q, "INSERT INTO developer_publishers") {
		if c.publisher.Revision != uint64(a[8].Value.(int64)) {
			return driver.RowsAffected(0), nil
		}
		c.publisher = Publisher{ProjectID: a[0].Value.(string), PublisherID: a[1].Value.(string), Account: a[2].Value.(string), KeyRole: "ide-artifact-publisher", PublicOriginal: append([]byte(nil), a[3].Value.([]byte)...), PublicSHA256: a[4].Value.(string), RegistrationRef: a[5].Value.(string), Revision: c.publisher.Revision + 1, ExpiresMS: a[6].Value.(int64), Revoked: a[7].Value.(bool)}
		c.s.trace = append(c.s.trace, "catalog-activate")
		return driver.RowsAffected(1), nil
	}
	if strings.HasPrefix(q, "UPDATE developer_publishers SET revoked=true") {
		if c.publisher.ProjectID != a[0].Value || c.publisher.PublisherID != a[1].Value || c.publisher.Account != a[2].Value || c.publisher.PublicSHA256 != a[3].Value || c.publisher.Revision != uint64(a[4].Value.(int64)) {
			return driver.RowsAffected(0), nil
		}
		c.publisher.Revoked = true
		c.publisher.Revision++
		c.s.trace = append(c.s.trace, "catalog-revoke")
		return driver.RowsAffected(1), nil
	}
	if q == "UPDATE developer_catalog_current SET revision=revision+1 WHERE singleton=1" {
		c.revision++
		return driver.RowsAffected(1), nil
	}
	return nil, errors.New("PUBLIC unexpected Catalog mutation")
}

type catalogPublisherSourceFixture struct {
	p                                    Principal
	c                                    Command
	proof                                []byte
	store                                *originalPublisherCaptureStore
	attempt                              *originalPublisherCaptureAttempt
	db                                   *catalogPublisherDB
	bindCalls                            int
	failAfterBinding, expireAfterBinding bool
	repeatBind                           bool
}

func (s *catalogPublisherSourceFixture) CurrentExistingPrincipal(context.Context, *http.Request) (Principal, error) {
	return s.p, nil
}
func (s *catalogPublisherSourceFixture) AuthorizeProjectControl(_ context.Context, p Principal, c Command, proof []byte) (Approval, error) {
	return Approval{objectHash(p), objectHash(c), hash(proof), "PUBLIC_CONFIRM", "PUBLIC_REVOKE", c.ExpiresMS}, nil
}
func (*catalogPublisherSourceFixture) AssertSourceCurrent(context.Context) error { return nil }
func (*catalogPublisherSourceFixture) AssertPrincipalCurrent(context.Context, Principal) error {
	return nil
}
func (*catalogPublisherSourceFixture) AssertCatalogAuthorityCurrent(context.Context, Principal) error {
	return nil
}
func (s *catalogPublisherSourceFixture) AssertControlCurrent(_ context.Context, p Principal, a Approval) error {
	if s.failAfterBinding && s.bindCalls > 0 {
		return ErrDenied
	}
	if !validApproval(a, p, s.c, s.proof, time.Now().UnixMilli()) {
		return ErrDenied
	}
	return nil
}
func (s *catalogPublisherSourceFixture) VerifyProtectedPublisherOriginal(_ context.Context, p Principal, c Command, public []byte) (ProtectedPublisher, error) {
	a := s.attempt
	if a == nil || a.principal != p || a.command != c || !bytes.Equal(a.public, public) {
		return ProtectedPublisher{}, ErrDenied
	}
	return ProtectedPublisher{Account: c.SubjectAccount, ProjectID: c.ProjectID, PublisherID: c.PublisherID, KeyRole: "ide-artifact-publisher", PublicSHA256: hash(public), RegistrationRef: a.registration, ExpiresMS: a.grantExpires}, nil
}
func (*catalogPublisherSourceFixture) AssertPublisherCurrent(context.Context, Principal, Publisher) error {
	return nil
}
func (s *catalogPublisherSourceFixture) bindOriginalPublisherCatalog(ctx context.Context, o *originalPublisherCatalogOperation) error {
	s.bindCalls++
	var a *originalPublisherCaptureAttempt
	if !o.command.Revoke {
		a = s.attempt
	}
	e := s.store.bindCatalogTransaction(ctx, o, a)
	if e == nil && s.repeatBind {
		e = s.store.bindCatalogTransaction(ctx, o, a)
	}
	if e == nil && s.expireAfterBinding && a != nil {
		a.observation.mu.Lock()
		a.observation.projection.ExpiresMS = time.Now().UnixMilli()
		a.observation.mu.Unlock()
	}
	return e
}
func catalogPublisherFixture(t *testing.T) (*Catalog, *catalogPublisherSourceFixture, *catalogPublisherDB) {
	t.Helper()
	verifier, input, p, c, public, proof, caller := publisherCurrentProcessFixture(t, "")
	r, e := verifier.invokeOriginalProtectedPublisherCurrent(context.Background(), input, p, c, public, proof, caller)
	if e != nil {
		t.Fatal(e, verifier.FailurePhase())
	}
	core := &publisherCaptureDB{rows: map[string][]driver.Value{}, nonces: map[string]bool{}, heads: map[string][]driver.Value{}, schema: 1}
	old := []byte("PUBLIC_OLD_KEY")
	state := &catalogPublisherDB{core: core, owner: p.Account, publisher: Publisher{Account: c.SubjectAccount, ProjectID: c.ProjectID, PublisherID: c.PublisherID, KeyRole: "ide-artifact-publisher", PublicOriginal: old, PublicSHA256: hash(old), RegistrationRef: "PUBLIC_OLD", Revision: 1, ExpiresMS: c.GrantExpiresMS}, operations: map[string]bool{}, catalogRevision: 1}
	db := sql.OpenDB(catalogPublisherConnector{state})
	t.Cleanup(func() { db.Close() })
	store, e := openOriginalPublisherCaptureStore(context.Background(), db)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { store.Close() })
	a, e := store.retainOriginal(r, p, c, public, proof, caller)
	if e != nil {
		t.Fatal(e)
	}
	if e = store.capture(context.Background(), a); e != nil {
		t.Fatal(e)
	}
	source := &catalogPublisherSourceFixture{p: p, c: c, proof: []byte("PUBLIC_EXPLICIT_CONTROL_APPROVAL_NOT_ROOT"), store: store, attempt: a, db: state}
	catalog, e := NewCatalog(db, source)
	if e != nil {
		t.Fatal(e)
	}
	return catalog, source, state
}

func TestOriginalPublisherCatalogActualACLTransactionActivationAndRevoke(t *testing.T) {
	catalog, source, state := catalogPublisherFixture(t)
	result, e := catalog.ApplyControl(context.Background(), &http.Request{}, source.c, source.proof, source.attempt.public)
	if e != nil || result == nil || !result.Committed || state.binding == nil || state.binding.state != "active" || state.publisher.Revision != 2 || state.commits != 1 {
		t.Fatal("activation not atomically committed", e, state.trace)
	}
	order := strings.Join(state.trace, "|")
	if strings.Index(order, "owner-acl") > strings.Index(order, "registry-activate") || strings.Index(order, "catalog-activate") > strings.Index(order, "registry-activate") {
		t.Fatal("binding preceded original ACL/row", order)
	}
	source.c.RequestID = "PUBLIC_EXPLICIT_REVOKE"
	source.c.Revoke = true
	source.c.ExpectedRevision = 2
	source.c.GrantExpiresMS = 0
	result, e = catalog.ApplyControl(context.Background(), &http.Request{}, source.c, source.proof, nil)
	if e != nil || !result.Committed || state.binding.state != "revoked" || !state.publisher.Revoked || state.publisher.Revision != 3 || state.commits != 2 {
		t.Fatal("revoke not atomic", e, state.trace)
	}
}

func TestOriginalPublisherCatalogOriginalACLFailureCannotRevokeOrActivate(t *testing.T) {
	catalog, source, state := catalogPublisherFixture(t)
	state.owner = "OTHER_PROJECT_OWNER"
	if _, e := catalog.ApplyControl(context.Background(), &http.Request{}, source.c, source.proof, source.attempt.public); e == nil || source.bindCalls != 0 || state.bindingWrites != 0 || state.commits != 0 || state.publisher.Revision != 1 {
		t.Fatal("capture bypassed owner ACL", e, state.trace)
	}
}

func TestOriginalPublisherCatalogLateCurrentAndCompletionRefusalRollbackBoth(t *testing.T) {
	for _, failure := range []string{"current", "expiry"} {
		t.Run(failure, func(t *testing.T) {
			catalog, source, state := catalogPublisherFixture(t)
			source.failAfterBinding = failure == "current"
			source.expireAfterBinding = failure == "expiry"
			if _, e := catalog.ApplyControl(context.Background(), &http.Request{}, source.c, source.proof, source.attempt.public); e == nil || state.binding != nil || state.publisher.Revision != 1 || state.commits != 0 || state.rollbacks != 1 {
				t.Fatal("late failure committed either half", e, state.trace)
			}
		})
	}
}

func TestOriginalPublisherCatalogLostCommitReceiptRetainsUnknownNoManualRollback(t *testing.T) {
	catalog, source, state := catalogPublisherFixture(t)
	state.lostCommit = true
	result, e := catalog.ApplyControl(context.Background(), &http.Request{}, source.c, source.proof, source.attempt.public)
	if !errors.Is(e, ErrUnknown) || result == nil || result.Committed || state.binding == nil || state.binding.state != "active" || state.publisher.Revision != 2 || state.commits != 1 || state.rollbacks != 0 {
		t.Fatal("lost commit misreported/reversed", e, state.trace)
	}
}

func TestOriginalPublisherCatalogRejectsUnownedTransactionTokenBeforeSQL(t *testing.T) {
	_, source, state := catalogPublisherFixture(t)
	before := state.bindingWrites
	if source.store.bindCatalogTransaction(context.Background(), &originalPublisherCatalogOperation{}, source.attempt) == nil || state.bindingWrites != before {
		t.Fatal("fabricated unowned token accepted")
	}
}

type sourceWithoutPublisherParticipant struct{ OriginalSource }

func TestOriginalPublisherCatalogRequiresOwnedParticipantAndOriginalPool(t *testing.T) {
	t.Run("no_participant", func(t *testing.T) {
		catalog, source, state := catalogPublisherFixture(t)
		catalog.source = sourceWithoutPublisherParticipant{source}
		if _, e := catalog.ApplyControl(context.Background(), &http.Request{}, source.c, source.proof, source.attempt.public); e == nil || source.bindCalls != 0 || state.bindingWrites != 0 || len(state.trace) != 0 {
			t.Fatal("legacy Source bypassed protected transaction requirement", e, state.trace)
		}
	})
	t.Run("foreign_pool", func(t *testing.T) {
		catalog, source, state := catalogPublisherFixture(t)
		foreign := sql.OpenDB(catalogPublisherConnector{state})
		defer foreign.Close()
		catalog.db = foreign
		if _, e := catalog.ApplyControl(context.Background(), &http.Request{}, source.c, source.proof, source.attempt.public); e == nil || state.binding != nil || state.commits != 0 || state.publisher.Revision != 1 {
			t.Fatal("foreign pool minted registration", e, state.trace)
		}
	})
}

func TestOriginalPublisherCatalogRejectsChangedCaptureInsideActualTransaction(t *testing.T) {
	for _, mutation := range []string{"revoked", "proof"} {
		t.Run(mutation, func(t *testing.T) {
			catalog, source, state := catalogPublisherFixture(t)
			a := source.attempt
			state.core.mu.Lock()
			row := state.core.rows[a.source+"/"+a.instance+"/"+a.registration]
			if mutation == "revoked" {
				row[9] = "revoked"
				row[10] = int64(2)
			} else {
				row[6] = strings.Repeat("f", 64)
			}
			state.core.mu.Unlock()
			if _, e := catalog.ApplyControl(context.Background(), &http.Request{}, source.c, source.proof, a.public); e == nil || state.binding != nil || state.publisher.Revision != 1 || state.commits != 0 || state.rollbacks != 1 {
				t.Fatal("changed durable capture was activated", e, state.trace)
			}
		})
	}
}

func TestOriginalPublisherCatalogRegistryResponsePanicRollsBackBoth(t *testing.T) {
	catalog, source, state := catalogPublisherFixture(t)
	state.panicBinding = true
	if _, e := catalog.ApplyControl(context.Background(), &http.Request{}, source.c, source.proof, source.attempt.public); e != ErrUnknown || state.binding != nil || state.publisher.Revision != 1 || state.commits != 0 || state.rollbacks != 1 {
		t.Fatal("pending registry panic lost or committed", e, state.trace)
	}
}

func TestOriginalPublisherCatalogSameTokenAndCommandCannotDoubleActivate(t *testing.T) {
	catalog, source, state := catalogPublisherFixture(t)
	source.repeatBind = true
	if _, e := catalog.ApplyControl(context.Background(), &http.Request{}, source.c, source.proof, source.attempt.public); e != nil || state.bindingWrites != 1 {
		t.Fatal("same token duplicated binding", e, state.trace)
	}
	// PUBLIC negative only, not retrying any real UNKNOWN operation.
	if _, e := catalog.ApplyControl(context.Background(), &http.Request{}, source.c, source.proof, source.attempt.public); e == nil || state.bindingWrites != 1 || state.commits != 1 {
		t.Fatal("same command activated twice", e, state.trace)
	}
}

func TestOriginalPublisherCatalogInflightCaptureRefusedBeforeReceiptReadOrStoreWait(t *testing.T) {
	catalog, source, state := catalogPublisherFixture(t)
	old := source.attempt
	pending, e := source.store.retainOriginal(old.observation, old.principal, old.command, old.public, old.proof, old.caller)
	if e != nil {
		t.Fatal(e)
	}
	// PUBLIC first-capture scheduling model: reset only the fixture's capture
	// table, then hold its actual SQL response while Catalog tries to consume it.
	entered, release := make(chan struct{}), make(chan struct{})
	state.core.mu.Lock()
	state.core.rows = map[string][]driver.Value{}
	state.core.nonces = map[string]bool{}
	state.core.afterInsert = func() { close(entered); <-release }
	state.core.mu.Unlock()
	result := make(chan error, 1)
	go func() { result <- source.store.capture(context.Background(), pending) }()
	<-entered
	source.attempt = pending
	_, e = catalog.ApplyControl(context.Background(), &http.Request{}, source.c, source.proof, pending.public)
	close(release)
	captureError := <-result
	if e == nil || captureError != nil || state.binding != nil || state.publisher.Revision != 1 || state.commits != 0 || state.rollbacks != 1 {
		t.Fatal("inflight receipt authorized or blocked store release", e, captureError, state.trace)
	}
}
