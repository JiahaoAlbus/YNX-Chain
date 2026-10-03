package quantlab

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPostgreSQLObservedRowDisappearanceRejectsMutationAndExactRestoreRecovers(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if url == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	cfg := Config{StatePath: filepath.Join(t.TempDir(), "unused.json"), DatabaseURL: url, StateNamespace: fmt.Sprintf("quant-absent-it-%d", time.Now().UnixNano())}
	first, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	if _, err := first.RunBacktest(request()); err != nil {
		t.Fatal(err)
	}
	second, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	store := first.store.(*postgresStateStore)
	defer store.db.Exec(`DELETE FROM ynx_quant_state WHERE state_key=$1`, cfg.StateNamespace)
	var revision int64
	var payload string
	if err := store.db.QueryRow(`SELECT revision,payload::text FROM ynx_quant_state WHERE state_key=$1`, cfg.StateNamespace).Scan(&revision, &payload); err != nil {
		t.Fatal(err)
	}
	before := hash(second.state)
	if _, err := store.db.Exec(`DELETE FROM ynx_quant_state WHERE state_key=$1`, cfg.StateNamespace); err != nil {
		t.Fatal(err)
	}
	for _, service := range []*Service{first, second} {
		if !errors.Is(service.checkDurableStateReadable(), ErrUnavailable) {
			t.Fatal("missing row reported ready")
		}
		if _, err := service.Kill("must not recreate vanished state"); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("mutation admitted: %v", err)
		}
	}
	var count int
	if err := store.db.QueryRow(`SELECT COUNT(*) FROM ynx_quant_state WHERE state_key=$1`, cfg.StateNamespace).Scan(&count); err != nil || count != 0 {
		t.Fatalf("row recreated: %d %v", count, err)
	}
	if hash(second.state) != before {
		t.Fatal("missing row changed cached state")
	}
	if _, err := store.db.Exec(`INSERT INTO ynx_quant_state(state_key,revision,payload) VALUES($1,$2,$3::jsonb)`, cfg.StateNamespace, revision, payload); err != nil {
		t.Fatal(err)
	}
	for _, service := range []*Service{first, second} {
		if err := service.checkDurableStateReadable(); err != nil {
			t.Fatal(err)
		}
		service.Snapshot()
		if hash(service.state) != before {
			t.Fatal("restored row differs from original state")
		}
	}
}
