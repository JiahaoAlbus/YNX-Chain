package developerauthority

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

type r216ReaderDB struct {
	mu          sync.Mutex
	watermarks  controlDBFixture
	key         Publisher
	active      bool
	reads       int
	afterFirst  func()
	afterSecond func()
}
type r216ReaderConnector struct{ s *r216ReaderDB }
type r216ReaderConn struct{ s *r216ReaderDB }

func (c r216ReaderConnector) Connect(context.Context) (driver.Conn, error) {
	return &r216ReaderConn{c.s}, nil
}
func (r216ReaderConnector) Driver() driver.Driver { return controlDriver{} }
func (*r216ReaderConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("PUBLIC fixed queries only")
}
func (*r216ReaderConn) Close() error              { return nil }
func (*r216ReaderConn) Begin() (driver.Tx, error) { return nil, errors.New("PUBLIC no transaction") }
func (c *r216ReaderConn) QueryContext(ctx context.Context, q string, a []driver.NamedValue) (driver.Rows, error) {
	if q == originalControlSourceObserveSQL {
		return (&controlConn{&c.s.watermarks}).QueryContext(ctx, q, a)
	}
	if q != originalFactoryPublisherBindingSQL {
		return nil, errors.New("PUBLIC unknown query")
	}
	s := c.s
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reads++
	if len(a) != 8 || a[0].Value != s.key.ProjectID || a[1].Value != s.key.PublisherID || a[2].Value != s.key.Account || a[3].Value != s.key.PublicSHA256 || a[4].Value != s.key.RegistrationRef || a[5].Value != int64(s.key.Revision) || a[6].Value != s.key.ExpiresMS || hash(a[7].Value.([]byte)) != s.key.PublicSHA256 {
		return nil, errors.New("PUBLIC exact eight original bindings required")
	}
	active := s.active
	if s.reads == 1 && s.afterFirst != nil {
		s.afterFirst()
	}
	if s.reads == 2 && s.afterSecond != nil {
		s.afterSecond()
	}
	if !active {
		return &approvalRows{n: 1}, nil
	}
	return &approvalRows{v: [][]driver.Value{{int64(3)}}, n: 1}, nil
}

func r216ReaderFixture(t *testing.T, mutation string) (*OriginalDeveloperSourceFactory, *r216ReaderDB, Principal, Publisher) {
	t.Helper()
	at := time.Now().UnixMilli()
	p := Principal{"PUBLIC_ACCOUNT", "PUBLIC_DEVICE", "PUBLIC_SESSION", "PUBLIC_CURRENT", 9007199254740993, 18446744073709551615, at + 28000}
	public := []byte("PUBLIC_READER_REGISTERED_KEY")
	k := Publisher{Account: p.Account, ProjectID: "PUBLIC_PROJECT", PublisherID: "PUBLIC_PUBLISHER", KeyRole: "ide-artifact-publisher", PublicSHA256: hash(public), PublicOriginal: public, RegistrationRef: "PUBLIC_REG", Revision: 9007199254740993, ExpiresMS: at + 26000}
	snapshot := r216ProjectProjection(p, k)
	b, _ := json.Marshal(map[string]any{"projection": snapshot, "currentRaw": "PUBLIC_NOT_SIGNED"})
	verifier, _, _ := openFixtureProcess(t, fixtureRead+"const out="+string(b)+";out.projection.timeFloor=Date.now();"+mutation+"process.stdout.write(JSON.stringify(out)+'\\n');")
	var input map[string]any
	_ = json.Unmarshal(fixtureCurrentInput(), &input)
	input["profileRaw"] = "PUBLIC_PROJECT_PROFILE"
	input["policy"] = map[string]any{"signatureContract": map[string]any{"purpose": "ide-project-authority-v1"}}
	source, _ := json.Marshal(input)
	s := &r216ReaderDB{key: k, active: true}
	db := sql.OpenDB(r216ReaderConnector{s})
	t.Cleanup(func() { db.Close() })
	f := &OriginalDeveloperSourceFactory{principal: r216Principal(t, p), control: &OriginalProjectControlRuntime{db: db, verifier: verifier, now: time.Now}, publisher: &originalFactoryPublisher{store: &originalPublisherCaptureStore{db: db, ready: true}, projectSource: source, projectProfile: snapshot.Profile, pending: map[string]*originalFactoryPublisherPending{}}}
	t.Cleanup(func() { f.Close() })
	return f, s, p, k
}

func TestR216FactoryActualPublisherCurrentPinnedSourceHTTPAndSQL(t *testing.T) {
	f, s, p, k := r216ReaderFixture(t, "")
	if e := f.AssertPublisherCurrent(context.Background(), p, k); e != nil {
		t.Fatal(e)
	}
	if s.reads != 2 || len(s.watermarks.heads) != 1 || len(f.publisher.lastProjectOriginal) == 0 || len(f.publisher.projectOriginals) != 2 {
		t.Fatal("actual two-sided reader/watermark/original missing")
	}
	if _, ok := any(f).(OriginalSource); !ok {
		t.Fatal("normal Catalog factory incomplete")
	}
	if strings.Contains(string(f.publisher.lastProjectOriginal), "authorized\":true") {
		t.Fatal("DATA became consent")
	}
}

func TestR216FactoryPublisherCurrentRevocationDuringSourceReadFails(t *testing.T) {
	f, s, p, k := r216ReaderFixture(t, "")
	s.afterFirst = func() { s.active = false }
	if e := f.AssertPublisherCurrent(context.Background(), p, k); e != ErrUnknown {
		t.Fatal("durable binding revoked during Source read", e)
	}
	if s.reads != 2 {
		t.Fatal("missing final binding reread")
	}
}

func TestR216FactoryPublisherCurrentAbsentBindingCannotPromoteSourceDATA(t *testing.T) {
	f, s, p, k := r216ReaderFixture(t, "")
	s.active = false
	if e := f.AssertPublisherCurrent(context.Background(), p, k); e == nil {
		t.Fatal("signed DATA without committed Catalog binding accepted")
	}
	if s.reads != 1 {
		t.Fatal("unexpected binding reads")
	}
}

func TestR216FactoryPublisherCurrentRejectsWrongDedicatedSourceBeforeBinding(t *testing.T) {
	f, s, p, k := r216ReaderFixture(t, "out.projection.profileDigest='b'.repeat(64);")
	if e := f.AssertPublisherCurrent(context.Background(), p, k); e == nil || s.reads != 0 {
		t.Fatal("foreign profile accepted", e)
	}
}

func TestR216FactoryPublisherCurrentFinalDBLatencyCannotRenewExpiry(t *testing.T) {
	f, s, p, k := r216ReaderFixture(t, "")
	// Advance the existing PRIVATE clock seam only after the actual last SQL
	// call; signed bounds remain unchanged and production still uses time.Now.
	s.afterSecond = func() { f.control.now = func() time.Time { return time.UnixMilli(k.ExpiresMS) } }
	if e := f.AssertPublisherCurrent(context.Background(), p, k); e == nil {
		t.Fatal("post-DB expiry accepted")
	}
}
