package exchangeproduct

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"
)

func TestAccountAndEventObservationsCannotMutateRetainedState(t *testing.T) {
	for _, lane := range []string{"twap", "scale", "ai", "stream-user", "stream-market", "events-user", "events-market"} {
		t.Run(lane, func(t *testing.T) {
			s, _, path := newTestService(t)
			defer s.Close()
			original := cloneState(s.state)
			s.state.TWAPOrders["retained"] = TWAPOrder{ID: "retained", Account: alice, ChildOrderIDs: []string{"original-child"}}
			s.state.ScaleOrders["retained"] = ScaleOrder{ID: "retained", Account: alice, ChildOrderIDs: []string{"original-child"}}
			s.state.AI["retained"] = AIRecord{ID: "retained", Account: alice, ContextClasses: []string{"owned-orders"}}
			for _, stream := range []string{"user", "market"} {
				s.emitExecutionLocked(stream, "controlled", alice, "fixture", "retained", json.RawMessage(`{"z":1,"a":9007199254740993}`))
			}
			if err := s.saveOrRollbackLocked(original); err != nil {
				t.Fatal(err)
			}
			before := digest(s.state)
			disk, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if lane == "twap" || lane == "scale" || lane == "ai" {
				view := s.Snapshot(alice)
				if other := s.Snapshot(bob); len(other.TWAPOrders)+len(other.ScaleOrders)+len(other.AI) != 0 {
					t.Fatal("foreign account observed owned records")
				}
				switch lane {
				case "twap":
					view.TWAPOrders[0].ChildOrderIDs[0] = "changed"
				case "scale":
					view.ScaleOrders[0].ChildOrderIDs[0] = "changed"
				case "ai":
					view.AI[0].ContextClasses[0] = "changed"
				}
			} else {
				stream := "user"
				if lane == "stream-market" || lane == "events-market" {
					stream = "market"
				}
				var events []ExecutionEvent
				if lane == "stream-user" || lane == "stream-market" {
					view, err := s.StreamSnapshot(stream, alice)
					if err != nil {
						t.Fatal(err)
					}
					events = view.Events
				} else {
					var err error
					events, _, err = s.ExecutionEvents(0, stream, alice, 100)
					if err != nil {
						t.Fatal(err)
					}
				}
				if len(events) != 1 || string(events[0].Payload) != `{"z":1,"a":9007199254740993}` {
					t.Fatal("event byte identity/order/int64 changed")
				}
				events[0].Payload[2] = 'x'
			}
			if digest(s.state) != before {
				t.Fatal("returned observation mutated retained Exchange state")
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(disk, after) {
				t.Fatalf("observation changed durable bytes: %v", err)
			}
		})
	}
}

func TestAdvancedAndAIReceiptsCannotMutateRetainedState(t *testing.T) {
	for _, lane := range []string{"scale-create", "scale-replay", "scale-cancel", "scale-cancel-replay", "twap-replay", "twap-cancel", "twap-cancel-replay", "mass-cancel", "mass-replay", "ai-create", "ai-review"} {
		t.Run(lane, func(t *testing.T) {
			s, chain, path := newTestService(t)
			defer s.Close()
			owner := accountSession(t, s, alice, "observation-owner", "exchange:read", "exchange:trade", "exchange:ai")
			confirmDeposit(t, s, chain, owner, "edededededededed", 10*AmountScale)
			var mutate func()
			var err error
			if lane == "ai-create" || lane == "ai-review" {
				var value AIRecord
				value, err = s.DraftAI(owner.session, "owned_trade_summary", "controlled local records", []string{"owned_orders"}, true)
				if err == nil && lane == "ai-review" {
					value, err = s.ReviewAI(owner.session, value.ID, "retry")
				}
				mutate = func() { value.ContextClasses[0] = "changed" }
			} else if lane == "twap-replay" || lane == "twap-cancel" || lane == "twap-cancel-replay" {
				var value TWAPOrder
				value, err = createTWAP(t, s, owner, "sell", 4*AmountScale, 2*AmountScale, 2, 60, "observation-twap-create")
				if err == nil {
					_, err = s.TickTWAP()
				}
				if err == nil && lane == "twap-replay" {
					value, err = createTWAP(t, s, owner, "sell", 4*AmountScale, 2*AmountScale, 2, 60, "observation-twap-create")
				}
				if err == nil && lane != "twap-replay" {
					key := "observation-twap-cancel"
					signature := signAction(owner.private, TWAPCancelAuthorizationPayload(owner.account, value.ID, key))
					value, err = s.CancelTWAP(owner.session, value.ID, key, signature)
					if err == nil && lane == "twap-cancel-replay" {
						value, err = s.CancelTWAP(owner.session, value.ID, key, signature)
					}
				}
				if err == nil && len(value.ChildOrderIDs) == 0 {
					t.Fatal("fixture must have actual child orders")
				}
				mutate = func() { value.ChildOrderIDs[0] = "changed" }
			} else {
				var value ScaleOrder
				value, err = createScale(t, s, owner, "sell", 2*AmountScale, 4*AmountScale, 6*AmountScale, 3, true, "observation-scale-create")
				if err == nil && lane == "scale-replay" {
					value, err = createScale(t, s, owner, "sell", 2*AmountScale, 4*AmountScale, 6*AmountScale, 3, true, "observation-scale-create")
				}
				if err == nil && (lane == "scale-cancel" || lane == "scale-cancel-replay") {
					key := "observation-scale-cancel"
					signature := signAction(owner.private, ScaleCancelAuthorizationPayload(owner.account, value.ID, key))
					value, err = s.CancelScale(owner.session, value.ID, key, signature)
					if err == nil && lane == "scale-cancel-replay" {
						value, err = s.CancelScale(owner.session, value.ID, key, signature)
					}
				}
				mutate = func() { value.ChildOrderIDs[0] = "changed" }
				if err == nil && (lane == "mass-cancel" || lane == "mass-replay") {
					key := "observation-mass-cancel"
					signature := signAction(owner.private, MassCancelAuthorizationPayload(owner.account, DefaultMarket, key))
					var receipt CancelResult
					receipt, err = s.MassCancel(owner.session, DefaultMarket, key, signature)
					if err == nil && lane == "mass-replay" {
						receipt, err = s.MassCancel(owner.session, DefaultMarket, key, signature)
					}
					if err == nil && len(receipt.ScaleOrders) != 1 {
						t.Fatal("fixture must have one retained parent")
					}
					mutate = func() { receipt.ScaleOrders[0].ChildOrderIDs[0] = "changed" }
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			before := digest(s.state)
			disk, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			mutate()
			if digest(s.state) != before {
				t.Fatal("command receipt changed retained Exchange state")
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(disk, after) {
				t.Fatalf("receipt mutation changed durable bytes: %v", err)
			}
		})
	}
}

func TestRetainedStreamEncodingIsIndependentOfLockedPayloadUpdates(t *testing.T) {
	s, _, _ := newTestService(t)
	defer s.Close()
	s.emitExecutionLocked("user", "controlled", alice, "fixture", "retained", json.RawMessage(`{"z":1,"a":9007199254740993}`))
	view, err := s.StreamSnapshot("user", alice)
	if err != nil {
		t.Fatal(err)
	}
	before, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 100; i++ {
			s.mu.Lock()
			s.state.ExecutionEvents[0].Payload[2] = byte('a' + i%26)
			s.mu.Unlock()
		}
	}()
	for i := 0; i < 100; i++ {
		encoded, err := json.Marshal(view)
		if err != nil || !bytes.Equal(encoded, before) {
			t.Errorf("retained stream changed during locked update: %v", err)
			break
		}
	}
	<-done
}
