package quantlab

import (
	"errors"
	"math"
	"path/filepath"
	"strings"
	"testing"
)

func TestPaperSettlementRejectsUnrepresentableLegacyStateWithoutMutation(t *testing.T) {
	for _, tc := range []struct {
		name, side                            string
		cash, position, price, amount, volume int64
	}{
		{"cash_overflow", "sell", math.MaxInt64, -1_000_000, 1_000_000, 1_000_000, 10_000_000},
		{"cash_underflow", "buy", math.MinInt64, 1_000_000, 1_000_000, 1_000_000, 10_000_000},
		{"minimum_position", "buy", 0, math.MinInt64, 1, 1, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := Config{StatePath: filepath.Join(t.TempDir(), "state.json")}
			s, err := New(cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			// Controlled legacy-state fixture; never a public balance or live order.
			s.state.Paper.Cash, s.state.Paper.Position = tc.cash, tc.position
			if err := s.save(); err != nil {
				t.Fatal(err)
			}
			before := hash(s.state)
			if _, err := s.ApplyPaperSignal(strings.Repeat("a", 64), tc.side, tc.price, tc.amount, tc.volume); !errors.Is(err, ErrInvalid) && !errors.Is(err, ErrForbidden) {
				t.Fatalf("unsafe settlement accepted: %v", err)
			}
			if hash(s.state) != before {
				t.Fatal("rejected settlement mutated memory")
			}
			reopened, err := New(cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			if hash(reopened.state) != before {
				t.Fatal("rejected settlement mutated durable state")
			}
		})
	}
}
