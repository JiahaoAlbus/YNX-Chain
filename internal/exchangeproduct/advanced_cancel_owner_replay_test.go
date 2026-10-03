package exchangeproduct

import "testing"

func TestAdvancedCancellationReplayRemainsOwnerBoundAfterRestart(t *testing.T) {
	for _, kind := range []string{"scale", "twap", "conditional"} {
		t.Run(kind, func(t *testing.T) {
			s, chain, _ := newTestService(t)
			cfg := s.cfg
			owner := accountSession(t, s, alice, "advanced-cancel-owner", "exchange:read", "exchange:trade")
			other := accountSession(t, s, bob, "advanced-cancel-other", "exchange:read", "exchange:trade")
			confirmDeposit(t, s, chain, owner, "acacacacacacacac", 10*AmountScale)
			var id string
			var err error
			var payload func(string, string, string) []byte
			var cancel func(*Service, WalletSession, string, string, string) (string, string, error)
			switch kind {
			case "scale":
				v, e := createScale(t, s, owner, "sell", 2*AmountScale, 4*AmountScale, 6*AmountScale, 3, true, "advanced-scale-create")
				id, err, payload = v.ID, e, ScaleCancelAuthorizationPayload
				cancel = func(s *Service, a WalletSession, id, key, sig string) (string, string, error) {
					v, e := s.CancelScale(a, id, key, sig)
					return v.ID, digest(v), e
				}
			case "twap":
				v, e := createTWAP(t, s, owner, "sell", 4*AmountScale, 2*AmountScale, 2, 60, "advanced-twap-create")
				id, err, payload = v.ID, e, TWAPCancelAuthorizationPayload
				cancel = func(s *Service, a WalletSession, id, key, sig string) (string, string, error) {
					v, e := s.CancelTWAP(a, id, key, sig)
					return v.ID, digest(v), e
				}
			case "conditional":
				v, e := createConditional(t, s, owner, "sell", "take_profit", 5*AmountScale, 5*AmountScale, AmountScale, "advanced-conditional-create")
				id, err, payload = v.ID, e, ConditionalCancelAuthorizationPayload
				cancel = func(s *Service, a WalletSession, id, key, sig string) (string, string, error) {
					v, e := s.CancelConditionalOrder(a, id, key, sig)
					return v.ID, digest(v), e
				}
			}
			if err != nil || id == "" {
				t.Fatal("fixture creation failed", err)
			}
			key := "advanced-" + kind + "-cancel"
			sig := signAction(owner.private, payload(owner.account, id, key))
			_, expected, err := cancel(s, owner.session, id, key, sig)
			if err != nil {
				t.Fatal(err)
			}
			for launch := 0; launch < 2; launch++ {
				before := digest(s.state)
				foreignID, _, err := cancel(s, other.session, id, key, signAction(other.private, payload(other.account, id, key)))
				if err != ErrForbidden || foreignID != "" {
					t.Fatalf("foreign %s replay returned id=%q error=%v", kind, foreignID, err)
				}
				for i := 0; i < 3; i++ {
					ownerID, got, err := cancel(s, owner.session, id, key, sig)
					if err != nil || ownerID != id || got != expected {
						t.Fatal("exact owner replay changed", err)
					}
				}
				if digest(s.state) != before {
					t.Fatal("replay changed state")
				}
				assertLedgerBalances(t, s.Snapshot(owner.account))
				assertLedgerBalances(t, s.Snapshot(other.account))
				native := s.state.Balances[balanceKey(owner.account, NativeAsset)]
				if native.AvailableMicro != 10*AmountScale || native.ReservedMicro != 0 {
					t.Fatal("cancellation did not release fixture reservation exactly once")
				}
				if launch == 0 {
					if err := s.Close(); err != nil {
						t.Fatal(err)
					}
					s, err = New(cfg)
					if err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() { s.Close() })
				}
			}
		})
	}
}
