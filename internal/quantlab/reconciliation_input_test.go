package quantlab

import (
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestReconciliationHTTPRequiresBothExplicitIntegers(t *testing.T) {
	for _, raw := range []string{`{}`, `null`, `{"Cash":0}`, `{"Position":0}`, `{"Cash":null,"Position":0}`, `{"Cash":0,"Position":null}`, `{"Cash":"0","Position":0}`, `{"Cash":0.5,"Position":0}`} {
		t.Run(raw, func(t *testing.T) {
			s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json")})
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			before := s.Snapshot()["paper"].(PaperState)
			r := httptest.NewRequest("POST", "/v1/paper/reconcile", strings.NewReader(raw))
			r.RemoteAddr = "127.0.0.1:12345"
			r.Header.Set("X-YNX-Preview-Mode", "local-paper")
			w := httptest.NewRecorder()
			NewServer(s).ServeHTTP(w, r)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("missing/null/invalid observation accepted: %d", w.Code)
			}
			after := s.Snapshot()["paper"].(PaperState)
			if after.KillSwitch != before.KillSwitch || after.ReconciliationDelta != before.ReconciliationDelta || after.Cash != before.Cash || after.Position != before.Position {
				t.Fatal("invalid observation mutated Paper risk")
			}
		})
	}
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json")})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	r := httptest.NewRequest("POST", "/v1/paper/reconcile", strings.NewReader(`{"Cash":0,"Position":0}`))
	r.RemoteAddr = "127.0.0.1:12345"
	r.Header.Set("X-YNX-Preview-Mode", "local-paper")
	w := httptest.NewRecorder()
	NewServer(s).ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal("explicit integer zeros were rejected")
	}
}

func TestReconciliationRejectsUnrepresentableDeltaWithoutAuditOrRiskMutation(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json")})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	before := s.Snapshot()["paper"].(PaperState)
	for _, observed := range [][2]int64{{math.MinInt64, 0}, {math.MaxInt64, 200000000000}} {
		_, err := s.Reconcile(observed[0], observed[1])
		if !errors.Is(err, ErrInvalid) {
			t.Fatalf("overflow accepted: %v", err)
		}
		after := s.Snapshot()["paper"].(PaperState)
		if after.KillSwitch != before.KillSwitch || after.ReconciliationDelta != before.ReconciliationDelta || len(s.state.Audit) != 0 {
			t.Fatal("overflow mutated risk/audit")
		}
	}
	result, err := s.Reconcile(before.Cash+1, -1)
	if err != nil || result.ReconciliationDelta != 2 || !result.KillSwitch {
		t.Fatalf("valid signed-position difference lost: %+v %v", result, err)
	}
	result, err = s.Reconcile(math.MaxInt64, before.Cash)
	if err != nil || result.ReconciliationDelta != math.MaxInt64 {
		t.Fatalf("representable maximum delta rejected or rounded: %+v %v", result, err)
	}
}
