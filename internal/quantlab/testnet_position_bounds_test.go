package quantlab

import (
	"context"
	"math"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type positionBoundBroker struct{ calls int }

func (b *positionBoundBroker) SubmitTestnet(ctx context.Context, m Mandate, o TestnetOrder, session string) (TestnetExecutionReceipt, error) {
	b.calls++
	return (testBroker{}).SubmitTestnet(ctx, m, o, session)
}

func TestTestnetPositionBoundsAreExactAcrossPersistedHistory(t *testing.T) {
	for _, tc := range []struct {
		name, side string
		amount     int64
		history    []TestnetOrder
		want       error
	}{
		{"positive_wrap_to_zero", "buy", 2, []TestnetOrder{{Side: "buy", Amount: math.MaxInt64}, {Side: "buy", Amount: math.MaxInt64}}, ErrForbidden},
		{"minimum_signed_projection", "sell", 1, []TestnetOrder{{Side: "sell", Amount: math.MaxInt64}}, ErrForbidden},
		{"positive_projection_wrap", "buy", 1, []TestnetOrder{{Side: "buy", Amount: math.MaxInt64}}, ErrForbidden},
		{"invalid_history_side", "buy", 1, []TestnetOrder{{Side: "unknown", Amount: 1}}, ErrInvalid},
		{"invalid_history_zero", "buy", 1, []TestnetOrder{{Side: "buy", Amount: 0}}, ErrInvalid},
		{"invalid_history_negative", "buy", 1, []TestnetOrder{{Side: "sell", Amount: -1}}, ErrInvalid},
		{"offsetting_history_map_order_independent", "buy", 1, []TestnetOrder{{Side: "buy", Amount: math.MaxInt64}, {Side: "buy", Amount: math.MaxInt64}, {Side: "sell", Amount: math.MaxInt64}, {Side: "sell", Amount: math.MaxInt64}}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			now := time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC)
			broker := &positionBoundBroker{}
			cfg := Config{StatePath: filepath.Join(t.TempDir(), "state.json"), Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: broker}
			s, err := New(cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			m, err := s.RegisterMandate(validMandate(now, strings.Repeat("a", 64)))
			if err != nil {
				t.Fatal(err)
			}
			// Controlled legacy-state records, not claims of live venue execution.
			for i, order := range tc.history {
				order.ID = strings.Repeat("h", i+1)
				order.MandateDigest, order.Status = m.Digest, "submitted_testnet"
				order.CreatedAt = now.Add(-time.Hour)
				s.state.TestnetOrders[order.ID] = order
			}
			if err := s.save(); err != nil {
				t.Fatal(err)
			}
			before := hash(s.state)
			_, err = s.SubmitTestnet(m.Digest, tc.side, 1_000_000, tc.amount, "exact-position-bound", validRisk(now))
			if err != tc.want {
				t.Fatalf("want %v, got %v", tc.want, err)
			}
			if tc.want == nil {
				if broker.calls != 1 {
					t.Fatalf("admitted request calls=%d", broker.calls)
				}
				return
			}
			if broker.calls != 0 || hash(s.state) != before {
				t.Fatal("rejection called broker or mutated state")
			}
			reopened, err := New(cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			if hash(reopened.state) != before {
				t.Fatal("rejection mutated durable state")
			}
		})
	}
}
