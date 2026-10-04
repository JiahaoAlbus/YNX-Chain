package quantlab

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTestnetExactReceiptRecoveryAtCapacityAcrossRestart(t *testing.T) {
	now := time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC)
	broker := &positionBoundBroker{}
	cfg := Config{StatePath: filepath.Join(t.TempDir(), "state.json"), Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: broker}
	s, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	m := validMandate(now, strings.Repeat("a", 64))
	m.MaxPosition, m.MaxOrdersPerMinute = 1_000_000, 1
	m, err = s.RegisterMandate(m)
	if err != nil {
		t.Fatal(err)
	}
	submit := func(service *Service, side, key, signature string, risk TestnetRiskObservation) (TestnetOrder, error) {
		return service.SubmitTestnetWithSession(context.Background(), m.Digest, side, 1_000_000, 1_000_000, key, signature, "controlled-session", risk)
	}
	first, err := submit(s, "buy", "capacity-exact-key", "controlled-signature", validRisk(now))
	if err != nil {
		t.Fatal(err)
	}
	before := hash(s.state)
	reopened, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	for _, service := range []*Service{s, reopened} {
		again, err := submit(service, "buy", "capacity-exact-key", "controlled-signature", validRisk(now))
		if err != nil || hash(again) != hash(first) {
			t.Fatalf("exact replay differs: %v", err)
		}
		for _, attempt := range []struct {
			side, key, signature string
			want                 error
		}{
			{"buy", "new-capacity-key", "controlled-signature", ErrForbidden},
			{"sell", "capacity-exact-key", "controlled-signature", ErrConflict},
			{"buy", "capacity-exact-key", "changed-signature", ErrConflict},
		} {
			if _, err := submit(service, attempt.side, attempt.key, attempt.signature, validRisk(now)); err != attempt.want {
				t.Fatalf("want %v got %v", attempt.want, err)
			}
		}
		stale := validRisk(now)
		stale.OracleAsOf = now.Add(-time.Minute)
		if _, err := submit(service, "buy", "capacity-exact-key", "controlled-signature", stale); err != ErrForbidden {
			t.Fatalf("stale replay risk admitted: %v", err)
		}
		if hash(service.state) != before {
			t.Fatal("receipt replay changed state/audit")
		}
	}
	if broker.calls != 1 {
		t.Fatalf("replay resubmitted to venue: %d", broker.calls)
	}
	for _, corruption := range []struct {
		name string
		edit func(map[string]TestnetOrder)
		want error
	}{
		{"pending", func(orders map[string]TestnetOrder) {
			order := orders[first.ID]
			order.Status = "reserved_outcome_unknown"
			orders[first.ID] = order
		}, ErrUnavailable},
		{"missing", func(orders map[string]TestnetOrder) { delete(orders, first.ID) }, ErrUnavailable},
		{"duplicate", func(orders map[string]TestnetOrder) { copy := first; copy.ID = "duplicate"; orders[copy.ID] = copy }, ErrConflict},
		{"changed_record", func(orders map[string]TestnetOrder) {
			order := orders[first.ID]
			order.Amount++
			orders[first.ID] = order
		}, ErrConflict},
	} {
		t.Run(corruption.name, func(t *testing.T) {
			s.state.TestnetOrders = map[string]TestnetOrder{first.ID: first}
			corruption.edit(s.state.TestnetOrders)
			if err := s.save(); err != nil {
				t.Fatal(err)
			}
			expected := hash(s.state)
			if _, err := submit(reopened, "buy", "capacity-exact-key", "controlled-signature", validRisk(now)); err != corruption.want {
				t.Fatalf("want %v got %v", corruption.want, err)
			}
			if broker.calls != 1 || hash(reopened.state) != expected {
				t.Fatal("inconsistent reservation replay caused execution or mutation")
			}
		})
	}
	s.state.TestnetOrders = map[string]TestnetOrder{first.ID: first}
	if err := s.save(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Kill("recovery-test"); err != nil {
		t.Fatal(err)
	}
	if _, err := submit(reopened, "buy", "capacity-exact-key", "controlled-signature", validRisk(now)); err != ErrForbidden {
		t.Fatalf("kill gate bypassed: %v", err)
	}
}
