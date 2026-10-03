package quantlab

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type absentQuantStateStore struct{ conflictQuantStateStore }

func (absentQuantStateStore) load() (state, bool, error) { return state{}, false, nil }

func TestAbsentMultiInstanceStateCannotClaimReadiness(t *testing.T) {
	s := &Service{cfg: Config{Now: time.Now}, state: newQuantState(), store: absentQuantStateStore{}}
	if !errors.Is(s.checkDurableStateReadable(), ErrUnavailable) {
		t.Fatal("missing row became readable authority")
	}
	w := httptest.NewRecorder()
	NewServer(s).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/ready", nil))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("ready=%d", w.Code)
	}
	w = httptest.NewRecorder()
	NewServer(s).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/health", nil))
	var body map[string]any
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &body) != nil || body["ready"] != false {
		t.Fatalf("empty store liveness overclaimed readiness: %s", w.Body.String())
	}
}

func TestObservedQuantStateAbsenceBlocksCachedMutationAndRecoversExactFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	cfg := Config{StatePath: path}
	first, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	if first.Snapshot()["failure"] != nil {
		t.Fatal("new workspace could not be read")
	}
	if _, err := first.RunBacktest(request()); err != nil {
		t.Fatal(err)
	}
	second, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	before := hash(first.state)
	parked := path + ".retained"
	if err := os.Rename(path, parked); err != nil {
		t.Fatal(err)
	}
	for _, s := range []*Service{first, second} {
		if s.Snapshot()["failure"] == nil {
			t.Fatal("missing observed state promoted cached snapshot")
		}
		if _, err := s.Kill("must not recreate missing authority"); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("kill=%v", err)
		}
		if _, err := s.Reconcile(1, 0); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("reconcile=%v", err)
		}
		if _, err := s.RunBacktest(request()); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("research=%v", err)
		}
		if hash(s.state) != before {
			t.Fatal("refused mutation changed cached state")
		}
		w := httptest.NewRecorder()
		NewServer(s).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/health", nil))
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("health=%d", w.Code)
		}
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("cached operation recreated authority")
	}
	if err := os.Rename(parked, path); err != nil {
		t.Fatal(err)
	}
	for _, s := range []*Service{first, second} {
		if s.Snapshot()["failure"] != nil || hash(s.state) != before {
			t.Fatal("restored original file did not recover exact state")
		}
		w := httptest.NewRecorder()
		NewServer(s).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/health", nil))
		if w.Code != http.StatusOK {
			t.Fatalf("restored health=%d", w.Code)
		}
	}
}
