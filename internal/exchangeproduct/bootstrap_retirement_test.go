package exchangeproduct

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
)

// This driver executes the real repository SQL control flow, not PostgreSQL.
// Real PostgreSQL deployment/multi-instance acceptance remains a separate gate.
type bootstrapScriptDriver struct{ script *bootstrapScript }
type bootstrapScript struct {
	mu              sync.Mutex
	mode            string
	firstRow        []byte
	queries, writes int
}
type bootstrapScriptConn struct{ script *bootstrapScript }
type bootstrapScriptRows struct {
	columns []string
	values  []driver.Value
}

var bootstrapDriverSequence atomic.Uint64

func (d bootstrapScriptDriver) Open(string) (driver.Conn, error) {
	return bootstrapScriptConn{d.script}, nil
}
func (bootstrapScriptConn) Prepare(string) (driver.Stmt, error) {
	return nil, fmt.Errorf("unexpected prepare")
}
func (bootstrapScriptConn) Close() error { return nil }
func (bootstrapScriptConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("unexpected transaction")
}
func (c bootstrapScriptConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	c.script.mu.Lock()
	defer c.script.mu.Unlock()
	c.script.queries++
	rows := &bootstrapScriptRows{columns: []string{"state_json"}}
	if c.script.mode == "revision" {
		rows.columns = []string{"revision", "payload"}
	}
	if c.script.queries == 1 && c.script.firstRow != nil {
		rows.values = []driver.Value{c.script.firstRow}
		if c.script.mode == "revision" {
			rows.values = []driver.Value{int64(1), c.script.firstRow}
		}
	}
	return rows, nil
}
func (c bootstrapScriptConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	c.script.mu.Lock()
	defer c.script.mu.Unlock()
	c.script.writes++
	return driver.RowsAffected(1), nil
}
func (r *bootstrapScriptRows) Columns() []string { return r.columns }
func (*bootstrapScriptRows) Close() error        { return nil }
func (r *bootstrapScriptRows) Next(dest []driver.Value) error {
	if r.values == nil {
		return io.EOF
	}
	copy(dest, r.values)
	r.values = nil
	return nil
}

func TestPostgresRunningRepositoryNeverReimportsSeedAfterAuthorityDisappears(t *testing.T) {
	for _, mode := range []string{"integrity", "revision"} {
		for _, initial := range []string{"existing_row", "startup_import"} {
			t.Run(mode+"/"+initial, func(t *testing.T) {
				path := filepath.Join(t.TempDir(), "retained-seed.json")
				seed := newState()
				seed.Sequence = 7
				if err := saveState(path, &seed); err != nil {
					t.Fatal(err)
				}
				script := &bootstrapScript{mode: mode}
				if initial == "existing_row" {
					raw, err := json.Marshal(seed)
					if err != nil {
						t.Fatal(err)
					}
					script.firstRow = raw
				}
				name := fmt.Sprintf("exchange-bootstrap-script-%d", bootstrapDriverSequence.Add(1))
				sql.Register(name, bootstrapScriptDriver{script})
				db, err := sql.Open(name, "")
				if err != nil {
					t.Fatal(err)
				}
				defer db.Close()
				repository := &postgresStateRepository{db: db, bootstrapPath: path, schemaMode: mode}
				loaded, exists, err := repository.Load()
				if err != nil || !exists || loaded.Sequence != 7 {
					t.Fatalf("initial authority: exists=%v err=%v", exists, err)
				}
				wantWrites := 0
				if initial == "startup_import" {
					wantWrites = 1
				}
				for i := 0; i < 3; i++ {
					_, exists, err = repository.Load()
					if err != nil || exists {
						t.Fatalf("missing authority was reimported: exists=%v err=%v", exists, err)
					}
				}
				if script.writes != wantWrites {
					t.Fatalf("unexpected import writes=%d want=%d", script.writes, wantWrites)
				}
				service := &Service{state: loaded, stateRepository: repository}
				if err := service.refreshState(); err == nil {
					t.Fatal("missing database authority accepted as cached state")
				}
				if service.state.IntegrityHash != loaded.IntegrityHash {
					t.Fatal("failed refresh changed cached authority")
				}
			})
		}
	}
}
