package exchangeproduct

import (
	"testing"
	"time"
)

type advancedRecoveryCase struct {
	name    string
	create  func(*Service, testAccount, string, int64) (any, error)
	current func(*Service) any
}

func advancedRecoveryCases(t *testing.T) []advancedRecoveryCase {
	return []advancedRecoveryCase{
		{"conditional", func(s *Service, a testAccount, key string, amount int64) (any, error) {
			return createConditional(t, s, a, "sell", "stop", AmountScale, 2*AmountScale, amount, key)
		}, func(s *Service) any {
			for _, v := range s.state.ConditionalOrders {
				return v
			}
			return nil
		}},
		{"oco", func(s *Service, a testAccount, key string, amount int64) (any, error) {
			return createOCO(t, s, a, "sell", AmountScale, AmountScale, 3*AmountScale, 3*AmountScale, amount, key)
		}, func(s *Service) any {
			for _, v := range s.state.OCOGroups {
				return v
			}
			return nil
		}},
		{"twap", func(s *Service, a testAccount, key string, amount int64) (any, error) {
			return createTWAP(t, s, a, "sell", 2*AmountScale, amount, 2, 10, key)
		}, func(s *Service) any {
			for _, v := range s.state.TWAPOrders {
				return v
			}
			return nil
		}},
		{"scale", func(s *Service, a testAccount, key string, amount int64) (any, error) {
			return createScale(t, s, a, "sell", 2*AmountScale, 3*AmountScale, amount, 2, false, key)
		}, func(s *Service) any {
			for _, v := range s.state.ScaleOrders {
				return v
			}
			return nil
		}},
		{"iceberg", func(s *Service, a testAccount, key string, amount int64) (any, error) {
			return createIceberg(t, s, a, "sell", 2*AmountScale, amount, AmountScale/2, false, key)
		}, func(s *Service) any {
			for _, v := range s.state.Orders {
				return v
			}
			return nil
		}},
	}
}

func expiredAdvancedRecoveryFixture(t *testing.T, tt advancedRecoveryCase) (*Service, testAccount, testAccount, string, any) {
	t.Helper()
	s, chain, _ := newTestService(t)
	owner := accountSession(t, s, alice, "advanced-recovery-owner", "exchange:read", "exchange:trade")
	other := accountSession(t, s, bob, "advanced-recovery-other", "exchange:read", "exchange:trade")
	confirmDeposit(t, s, chain, owner, "fafafafafafafafa", 2*AmountScale)
	key := "advanced-recovery-" + tt.name
	if _, err := tt.create(s, owner, key, AmountScale); err != nil {
		t.Fatal(err)
	}
	arm := DeadManRequest{Action: "arm", TimeoutSeconds: 5, NonceDomain: "deadman:advanced-recovery", IdempotencyKey: "advanced-recovery-arm"}
	arm.WalletSignature = signAction(owner.private, DeadManAuthorizationPayload(owner.account, arm))
	armed, err := s.ConfigureDeadMan(owner.session, arm)
	if err != nil {
		t.Fatal(err)
	}
	s.cfg.Now = func() time.Time { return armed.ExpiresAt }
	if count, err := s.SweepDeadMan(); err != nil || count != 1 {
		t.Fatal("expiry did not cancel one parent", count, err)
	}
	terminal := tt.current(s)
	if terminal == nil {
		t.Fatal("terminal missing")
	}
	return s, owner, other, key, terminal
}

func TestExistingAdvancedCreationReplayAfterExpiryOnlyReadsTerminalEffect(t *testing.T) {
	for _, tt := range advancedRecoveryCases(t) {
		t.Run(tt.name, func(t *testing.T) {
			s, owner, other, key, terminal := expiredAdvancedRecoveryFixture(t, tt)
			before := digest(s.state)
			check := func(service *Service) {
				t.Helper()
				for i := 0; i < 3; i++ {
					got, err := tt.create(service, owner, key, AmountScale)
					if err != nil || digest(got) != digest(terminal) {
						t.Fatal("exact replay lost settled effect", err)
					}
				}
				if _, err := tt.create(service, owner, key, AmountScale+1); err != ErrConflict {
					t.Fatal("changed intent not fenced", err)
				}
				if _, err := tt.create(service, other, key, AmountScale); err != ErrConflict {
					t.Fatal("foreign own signature not fenced", err)
				}
				if _, err := tt.create(service, owner, key+"-fresh", AmountScale); err != ErrForbidden {
					t.Fatal("fresh creation bypassed expired risk", err)
				}
				if digest(service.state) != before {
					t.Fatal("recovery changed orders/reserve/fees/audit")
				}
				if b := service.state.Balances[balanceKey(owner.account, NativeAsset)]; b.AvailableMicro != 2*AmountScale || b.ReservedMicro != 0 {
					t.Fatal("replay reopened reserve")
				}
				assertLedgerBalances(t, service.Snapshot(owner.account))
				assertLedgerBalances(t, service.Snapshot(other.account))
			}
			check(s)
			cfg := s.cfg
			if err := s.Close(); err != nil {
				t.Fatal(err)
			}
			restarted, err := New(cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer restarted.Close()
			check(restarted)
		})
	}
}

func TestExistingAdvancedReplayRejectsMissingOrForeignCachedEffect(t *testing.T) {
	for _, tt := range advancedRecoveryCases(t) {
		for _, corruption := range []string{"missing", "foreign"} {
			t.Run(tt.name+"/"+corruption, func(t *testing.T) {
				s, owner, other, key, _ := expiredAdvancedRecoveryFixture(t, tt)
				prior := s.state.Idempotency[key]
				if corruption == "missing" {
					prior.ObjectID = "missing-original-effect"
					s.state.Idempotency[key] = prior
				} else {
					switch tt.name {
					case "conditional":
						effect := s.state.ConditionalOrders[prior.ObjectID]
						effect.Account = other.account
						s.state.ConditionalOrders[prior.ObjectID] = effect
					case "oco":
						effect := s.state.OCOGroups[prior.ObjectID]
						effect.Account = other.account
						s.state.OCOGroups[prior.ObjectID] = effect
					case "twap":
						effect := s.state.TWAPOrders[prior.ObjectID]
						effect.Account = other.account
						s.state.TWAPOrders[prior.ObjectID] = effect
					case "scale":
						effect := s.state.ScaleOrders[prior.ObjectID]
						effect.Account = other.account
						s.state.ScaleOrders[prior.ObjectID] = effect
					case "iceberg":
						effect := s.state.Orders[prior.ObjectID]
						effect.Account = other.account
						s.state.Orders[prior.ObjectID] = effect
					}
				}
				before := digest(s.state)
				got, err := tt.create(s, owner, key, AmountScale)
				if err != ErrForbidden {
					t.Fatal("invalid cached effect was accepted", err, got)
				}
				if digest(s.state) != before {
					t.Fatal("invalid cached effect was rewritten or recreated")
				}
			})
		}
	}
}
