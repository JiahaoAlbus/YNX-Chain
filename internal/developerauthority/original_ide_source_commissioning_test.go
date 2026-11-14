package developerauthority

// Actual production decoder/serializable transaction/resolve lifecycle. The SQL
// driver is explicitly PUBLIC; this is NOT real PG, Root or Native admission.
import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
	"time"
)

type ideCommissionState struct {
	role                                 string
	rows                                 map[string][]byte
	pending                              map[string][]byte
	fail                                 string
	commits, rollbacks, inserts, selects int
}
type ideCommissionConnector struct{ s *ideCommissionState }

func (c ideCommissionConnector) Connect(context.Context) (driver.Conn, error) {
	return &ideCommissionConn{c.s}, nil
}
func (ideCommissionConnector) Driver() driver.Driver { return ideSourceDriver{} }

type ideCommissionConn struct{ s *ideCommissionState }

func (*ideCommissionConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("PUBLIC no prepare")
}
func (*ideCommissionConn) Close() error { return nil }
func (*ideCommissionConn) Begin() (driver.Tx, error) {
	return nil, errors.New("must use serializable BeginTx")
}
func (c *ideCommissionConn) BeginTx(_ context.Context, opt driver.TxOptions) (driver.Tx, error) {
	if opt.Isolation != driver.IsolationLevel(sql.LevelSerializable) || opt.ReadOnly {
		return nil, errors.New("wrong tx mode")
	}
	c.s.pending = map[string][]byte{}
	for k, v := range c.s.rows {
		c.s.pending[k] = bytes.Clone(v)
	}
	return &ideCommissionTx{c.s}, nil
}

type ideCommissionTx struct{ s *ideCommissionState }

func (t *ideCommissionTx) Commit() error {
	t.s.commits++
	if t.s.fail == "commit-unknown" {
		return errors.New("PUBLIC commit UNKNOWN")
	}
	t.s.rows = t.s.pending
	t.s.pending = nil
	return nil
}
func (t *ideCommissionTx) Rollback() error { t.s.rollbacks++; t.s.pending = nil; return nil }
func (c *ideCommissionConn) QueryContext(_ context.Context, q string, a []driver.NamedValue) (driver.Rows, error) {
	c.s.selects++
	s := func(i int) string { return a[i].Value.(string) }
	if q == "SELECT current_user" {
		return &ideSourceRows{values: []driver.Value{c.s.role}}, nil
	}
	var k string
	switch q {
	case originalIDEHeadRead + " FOR UPDATE":
		k = "head:" + s(2)
	case originalIDEApprovalHeadRead + " FOR UPDATE":
		k = "approval:" + s(2) + ":" + s(3)
	case originalIDECommissioningReceiptRead:
		if s(4) != c.s.role {
			return &ideSourceRows{done: true}, nil
		}
		k = "observation:" + s(2)
	default:
		return nil, errors.New("PUBLIC unexpected query")
	}
	rows := c.s.rows
	if c.s.pending != nil {
		rows = c.s.pending
	}
	b := rows[k]
	if b == nil {
		return &ideSourceRows{done: true}, nil
	}
	return &ideSourceRows{values: []driver.Value{bytes.Clone(b), hash(b)}}, nil
}
func (c *ideCommissionConn) ExecContext(_ context.Context, q string, a []driver.NamedValue) (driver.Result, error) {
	s := func(i int) string { return a[i].Value.(string) }
	var k string
	var raw []byte
	switch {
	case strings.HasPrefix(q, "INSERT INTO public.auth_ide_original_source_heads"):
		k = "head:" + s(2)
		raw = a[3].Value.([]byte)
	case strings.HasPrefix(q, "INSERT INTO public.auth_ide_original_approval_heads"):
		k = "approval:" + s(2) + ":" + s(3)
		raw = a[4].Value.([]byte)
	case strings.HasPrefix(q, "INSERT INTO public.auth_ide_original_source_records"):
		k = "record:" + s(2) + ":" + s(3) + ":" + s(4)
		raw = a[5].Value.([]byte)
	case strings.HasPrefix(q, "INSERT INTO public.auth_ide_original_source_observations"):
		if strings.Contains(q, "'source'") {
			k = "observation:" + s(2)
			raw = a[3].Value.([]byte)
		} else {
			k = "observation:" + s(2) + ":" + s(3)
			raw = a[4].Value.([]byte)
		}
	default:
		return nil, errors.New("PUBLIC unexpected exec")
	}
	if c.s.fail == "observation" && strings.HasPrefix(k, "observation:") {
		return nil, errors.New("PUBLIC observation write failed")
	}
	if _, ok := c.s.pending[k]; ok {
		return driver.RowsAffected(0), nil
	}
	c.s.pending[k] = bytes.Clone(raw)
	c.s.inserts++
	return driver.RowsAffected(1), nil
}
func ideCommissionFixture(t *testing.T) (*sql.DB, *ideCommissionState, originalIDERelease, *originalIDESourceRecord, []byte) {
	t.Helper()
	s := &ideCommissionState{role: "auth_source_custodian", rows: map[string][]byte{}}
	db := sql.OpenDB(ideCommissionConnector{s})
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	c := originalIDERelease{SourceID: "PUBLIC_SOURCE", InstanceID: "PUBLIC_INSTANCE", CatalogBinding: strings.Repeat("c", 64), Templates: map[string]originalIDETemplate{"catalog": {}}}
	previous := mustIDEJSON(t, map[string]any{"sequence": 1, "floor": 0, "head": strings.Repeat("1", 64), "timeFloor": time.Now().Add(-time.Second).UnixMilli(), "executionHeight": "0"})
	input := mustIDEJSON(t, originalIDESourceInput{Root: "PUBLIC-ROOT-NOT-ADMISSION", Enrollment: "PUBLIC-E", Profile: "PUBLIC-P", Head: "PUBLIC-H", Attachment: []byte(`{}`)})
	b := originalIDECommissioningCapture{Version: "YNX-IDE-SOURCE-CAPTURE/v1", SourceID: c.SourceID, InstanceID: c.InstanceID, Kind: "catalog", Binding: c.CatalogBinding, Original: string(input), Previous: string(previous)}
	raw := mustIDEJSON(t, b)
	_, r, e := originalIDECommissioningDecode(raw, c)
	if e != nil {
		t.Fatal(e)
	}
	return db, s, c, r, raw
}
func TestIDECommissioningAtomicOriginalHistoryAndReadOnlyResolve(t *testing.T) {
	db, s, c, r, raw := ideCommissionFixture(t)
	calls := 0
	e := originalIDECommissioningCommit(context.Background(), db, s.role, c, r, nil, raw, []byte("PUBLIC-current"), func() error { calls++; return nil })
	if e != nil || s.commits != 1 || s.rollbacks != 0 || len(s.rows) != 4 || calls != 2 {
		t.Fatalf("atomic result %v commits%d rollback%d rows%d fences%d", e, s.commits, s.rollbacks, len(s.rows), calls)
	}
	if !bytes.Equal(s.rows["head:"+r.profile], r.previous) {
		t.Fatal("commissioning advanced/replaced original history")
	}
	o := &OriginalIDECommissioningOwner{source: &OriginalIDEPublicationSourceOwner{db: db}, config: originalIDECommissioningAdmission{SourceID: c.SourceID, InstanceID: c.InstanceID, DatabaseRole: s.role}, selected: true, raw: raw, first: ErrUnknown}
	before := s.inserts
	receipt, e := o.ResolveSelected(context.Background())
	if e != nil || !receipt.Committed || receipt.CaptureSHA256 != hash(raw) || s.inserts != before {
		t.Fatal("same selected readback rewrote/failed", e)
	}
	e = originalIDECommissioningCommit(context.Background(), db, s.role, c, r, nil, raw, []byte("PUBLIC-current"), func() error { return nil })
	if !errors.Is(e, ErrConflict) || s.commits != 1 {
		t.Fatal("duplicate permitted", e)
	}
}
func TestIDECommissioningConflictRoleAndObservationFailureRollback(t *testing.T) {
	for _, kind := range []string{"role", "prior", "observation", "late"} {
		t.Run(kind, func(t *testing.T) {
			db, s, c, r, raw := ideCommissionFixture(t)
			if kind == "prior" {
				s.rows["head:"+r.profile] = []byte("FOREIGN-HISTORY")
			}
			if kind == "observation" {
				s.fail = kind
			}
			role := s.role
			if kind == "role" {
				role = "other"
			}
			count := 0
			e := originalIDECommissioningCommit(context.Background(), db, role, c, r, nil, raw, []byte("PUBLIC-current"), func() error {
				count++
				if kind == "late" && count == 2 {
					return ErrDenied
				}
				return nil
			})
			want := 0
			if kind == "prior" {
				want = 1
			}
			if e == nil || s.commits != 0 || s.rollbacks != 1 || len(s.rows) != want || s.pending != nil {
				t.Fatal("partial survived", e, s.commits, s.rollbacks, len(s.rows))
			}
		})
	}
}
func TestIDECommissioningCommitUnknownNeverReportsCommitted(t *testing.T) {
	db, s, c, r, raw := ideCommissionFixture(t)
	s.fail = "commit-unknown"
	e := originalIDECommissioningCommit(context.Background(), db, s.role, c, r, nil, raw, []byte("PUBLIC-current"), func() error { return nil })
	if !errors.Is(e, ErrUnknown) || s.commits != 1 {
		t.Fatal(e)
	}
	o := &OriginalIDECommissioningOwner{source: &OriginalIDEPublicationSourceOwner{db: db}, config: originalIDECommissioningAdmission{SourceID: c.SourceID, InstanceID: c.InstanceID, DatabaseRole: s.role}, selected: true, raw: raw, first: e}
	// A missing receipt is UNKNOWN, not automatic second insert.
	s.pending = nil
	before := s.inserts
	if _, e = o.ResolveSelected(context.Background()); !errors.Is(e, ErrUnknown) || s.inserts != before {
		t.Fatal("unknown readback retried", e)
	}
}
func TestIDECommissioningDecoderRejectsSyntheticOrForeignHistory(t *testing.T) {
	_, _, c, _, raw := ideCommissionFixture(t)
	var original originalIDECommissioningCapture
	if jsonUnmarshalCommission(raw, &original) != nil {
		t.Fatal("fixture")
	}
	for _, kind := range []string{"zero", "head", "time", "height", "namespace", "catalog-binding", "extra", "null-original", "approval-on-catalog", "duplicate"} {
		t.Run(kind, func(t *testing.T) {
			b := original
			switch kind {
			case "zero":
				b.Previous = strings.Replace(b.Previous, `"sequence":1`, `"sequence":0`, 1)
			case "head":
				b.Previous = strings.Replace(b.Previous, strings.Repeat("1", 64), "", 1)
			case "time":
				b.Previous = strings.Replace(b.Previous, `"timeFloor":`, `"timeFloor":-`, 1)
			case "height":
				b.Previous = strings.Replace(b.Previous, `"executionHeight":"0"`, `"executionHeight":"00"`, 1)
			case "namespace":
				b.InstanceID = "OTHER"
			case "catalog-binding":
				b.Binding = strings.Repeat("a", 64)
			case "null-original":
				b.Original = "null"
			case "approval-on-catalog":
				b.ApprovalPrevious = "{}"
			}
			out := mustIDEJSON(t, b)
			if kind == "extra" {
				out = append([]byte(`{"extra":true,`), out[1:]...)
			}
			if kind == "duplicate" {
				out = append([]byte(`{"version":"EVIL",`), out[1:]...)
			}
			if _, _, e := originalIDECommissioningDecode(out, c); e == nil {
				t.Fatal("accepted", kind)
			}
		})
	}
}
func jsonUnmarshalCommission(raw []byte, out *originalIDECommissioningCapture) error {
	return originalIDEStrict(raw, out)
}
func TestIDECommissioningApprovalHeadAtomicAndNoReset(t *testing.T) {
	db, s, c, r, raw := ideCommissionFixture(t)
	r.kind = "artifact"
	a := &originalIDECommissionedApproval{ref: "PUBLIC-ref", previous: []byte("PUBLIC-admitted-history"), current: []byte("PUBLIC-independent-current")}
	if e := originalIDECommissioningCommit(context.Background(), db, s.role, c, r, a, raw, []byte("PUBLIC-source-current"), func() error { return nil }); e != nil || len(s.rows) != 6 {
		t.Fatal("approval atomic", e, len(s.rows))
	}
	if !bytes.Equal(s.rows["approval:artifact:PUBLIC-ref"], a.previous) {
		t.Fatal("rewrote history")
	}
	// Another capture can never roll a previously advanced head backwards.
	s.rows["approval:artifact:PUBLIC-ref"] = []byte("LATER-ORIGINAL")
	r.binding = "different"
	if e := originalIDECommissioningCommit(context.Background(), db, s.role, c, r, a, []byte("other-capture"), []byte("PUBLIC-current"), func() error { return nil }); !errors.Is(e, ErrConflict) {
		t.Fatal("reset approval head", e)
	}
}
func TestIDECommissioningPartialFirstCloseAndNoDatabaseOwnership(t *testing.T) {
	db, _, _, _, _ := ideCommissionFixture(t)
	o := &OriginalIDECommissioningOwner{source: &OriginalIDEPublicationSourceOwner{db: db}, first: ErrUnknown}
	first := o.Close()
	if first == nil || o.Close() != first {
		t.Fatal("first close result lost")
	}
	if e := db.Ping(); e != nil {
		t.Fatal("borrowed pool closed", e)
	}
	if owner, e := OpenOriginalIDECommissioning(nil, db, OriginalIDECommissioningConfig{}); e == nil || owner != nil {
		t.Fatal("invalid startup accepted")
	}
}

func TestIDECommissioningIndependentApprovalHistoryFormat(t *testing.T) {
	raw := string(mustIDEJSON(t, map[string]any{"sequence": "4", "floor": "3", "decision": "approved", "requestState": "returned", "resultOriginalSHA256": strings.Repeat("a", 64), "scopeSHA256": strings.Repeat("b", 64), "timeFloor": time.Now().Add(-time.Second).UnixMilli()}))
	if e := originalIDECommissioningApprovalPrevious(raw); e != nil {
		t.Fatal(e)
	}
	for _, bad := range []string{`{}`, strings.Replace(raw, `"sequence":"4"`, `"sequence":"0"`, 1), strings.Replace(raw, `"sequence":"4"`, `"sequence":"04"`, 1), strings.Replace(raw, `"floor":"3"`, `"floor":"5"`, 1), strings.Replace(raw, `"decision":"approved"`, `"decision":"pending"`, 1), `{"sequence":"1",` + raw[1:]} {
		if e := originalIDECommissioningApprovalPrevious(bad); e == nil {
			t.Fatal("accepted foreign/synthetic approval history")
		}
	}
}
func TestIDECommissioningReceiptBoundRoleAndMissingDoesNotRetry(t *testing.T) {
	db, s, c, r, raw := ideCommissionFixture(t)
	if e := originalIDECommissioningCommit(context.Background(), db, s.role, c, r, nil, raw, []byte("PUBLIC-current"), func() error { return nil }); e != nil {
		t.Fatal(e)
	}
	o := &OriginalIDECommissioningOwner{source: &OriginalIDEPublicationSourceOwner{db: db}, config: originalIDECommissioningAdmission{SourceID: c.SourceID, InstanceID: c.InstanceID, DatabaseRole: "foreign"}, selected: true, raw: raw}
	before := s.inserts
	if _, e := o.ResolveSelected(context.Background()); !errors.Is(e, ErrUnknown) || s.inserts != before {
		t.Fatal("foreign receipt role accepted or retried", e)
	}
}

func TestIDECommissioningSourceReleaseSameFivePurposes(t *testing.T) {
	templates := map[string]originalIDETemplate{}
	for kind, purpose := range map[string]string{"catalog": "ide-project-authority-v1", "project": "ide-project-authority-v1", "control": "ide-project-control-authority-v1", "artifact": "ide-publication-approval-authority-v1", "resource": "ide-publication-approval-authority-v1"} {
		templates[kind] = originalIDETemplate{SourceID: "PUBLIC_SOURCE", InstanceID: "PUBLIC_INSTANCE", Policy: mustIDEJSON(t, map[string]any{"signatureContract": map[string]string{"purpose": purpose}}), Node: []byte(`{}`)}
	}
	c := originalIDERelease{Version: "YNX-IDE-PUBLICATION-SOURCE/v1", SourceID: "PUBLIC_SOURCE", InstanceID: "PUBLIC_INSTANCE", CallerIdentity: "PUBLIC-caller", PrincipalSPKI: strings.Repeat("a", 64), CatalogBinding: strings.Repeat("b", 64), Templates: templates}
	if parsed, e := originalIDEParseRelease(mustIDEJSON(t, c)); e != nil || len(parsed.Templates) != 5 {
		t.Fatal("original release shape changed", e)
	}
	for _, kind := range []string{"catalog", "project", "control", "artifact", "resource"} {
		original := templates[kind]
		altered := original
		altered.Policy = []byte(`{"signatureContract":{"purpose":"OTHER"}}`)
		templates[kind] = altered
		if _, e := originalIDEParseRelease(mustIDEJSON(t, c)); e == nil {
			t.Fatal("purpose substituted", kind)
		}
		templates[kind] = original
	}
	delete(templates, "resource")
	if _, e := originalIDEParseRelease(mustIDEJSON(t, c)); e == nil {
		t.Fatal("missing template accepted")
	}
}
