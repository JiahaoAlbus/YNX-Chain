package quantlab

import (
	"errors"
	"path/filepath"
	"testing"
)

type conflictQuantStateStore struct{}

func (conflictQuantStateStore) load() (state, bool, error)   { return newQuantState(), true, nil }
func (conflictQuantStateStore) save(*state) error            { return errStateConflict }
func (conflictQuantStateStore) close() error                 { return nil }
func (conflictQuantStateStore) backend() string              { return "postgresql" }
func (conflictQuantStateStore) multiInstance() bool          { return true }
func (conflictQuantStateStore) requiresFilesystemLock() bool { return false }

func TestPostgreSQLConfigurationRequiresStableNamespace(t *testing.T) {
	_, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), DatabaseURL: "postgres://example.invalid/quant"})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("err=%v", err)
	}
}

func TestStateStoreConflictFailsClosedAndRestoresFreshState(t *testing.T) {
	service := &Service{store: conflictQuantStateStore{}, state: newQuantState()}
	service.state.Sequence = 9
	if err := service.save(); !errors.Is(err, ErrConflict) {
		t.Fatalf("save err=%v", err)
	}
	if service.state.Sequence != 0 || service.state.Integrity != "" {
		t.Fatalf("state was not restored after durable conflict: %+v", service.state)
	}
	status := service.StorageStatus()
	if status["backend"] != "postgresql" || status["multiInstance"] != true || status["productionDatabaseRequired"] != false || status["crossProcessSharedFilesystem"] != false {
		t.Fatalf("storage status=%#v", status)
	}
	if service.StorageSource() != "ynx-quant-authoritative-postgresql-state" {
		t.Fatalf("source=%q", service.StorageSource())
	}
}
