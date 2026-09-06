package chain

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func moduleBusinessState(t *testing.T, d *Devnet) []byte {
	t.Helper()
	d.mu.RLock()
	defer d.mu.RUnlock()
	snapshot := d.snapshotLocked()
	snapshot.SavedAt = time.Time{}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func assertModuleState(t *testing.T, d *Devnet, want []byte) {
	t.Helper()
	if !bytes.Equal(moduleBusinessState(t, d), want) {
		t.Fatal("module mutation changed unrelated or rolled-back snapshot state")
	}
}

func dexPersistenceFixture(t *testing.T, action string) (*Devnet, NativeDexSignedActionInput) {
	t.Helper()
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	signer := "0x" + strings.Repeat("1", 40)
	if _, err := d.Faucet(signer, 100000); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Hour).Unix()
	input := func(action string, payload any, nonce uint64) NativeDexSignedActionInput {
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		return NativeDexSignedActionInput{Hash: fmt.Sprintf("0x%064x", nonce), Signer: signer, Action: action, Nonce: nonce, Fee: 1, Payload: raw}
	}
	for _, setup := range []NativeDexSignedActionInput{
		input(NativeDexActionAssetCreate, NativeDexAssetCreatePayload{AssetID: "test-coin", Symbol: "TCO", Name: "Test coin", MaxSupply: 1000000, InitialSupply: 10000}, 1),
		input(NativeDexActionPoolCreate, NativeDexPoolCreatePayload{PoolID: "dex_test_pool", Asset0: NativeDexAssetID, Asset1: "test-coin", FeeBps: 30}, 2),
		input(NativeDexActionLiquidityAdd, NativeDexLiquidityPayload{PoolID: "dex_test_pool", Amount0: 1000, Amount1: 2000, MinShares: 1, DeadlineUnix: deadline}, 3),
	} {
		if _, _, _, err := d.SubmitNativeDexAction(setup); err != nil {
			t.Fatal(err)
		}
	}
	d.ProduceBlock()
	payloads := map[string]any{
		NativeDexActionAssetCreate:     NativeDexAssetCreatePayload{AssetID: "new-coin", Symbol: "NEW", Name: "New coin", MaxSupply: 1000, InitialSupply: 100},
		NativeDexActionAssetMint:       NativeDexAssetAmountPayload{AssetID: "test-coin", Amount: 100},
		NativeDexActionAssetTransfer:   NativeDexAssetTransferPayload{AssetID: "test-coin", Recipient: "0x" + strings.Repeat("2", 40), Amount: 50},
		NativeDexActionPoolCreate:      NativeDexPoolCreatePayload{PoolID: "dex_new_pool", Asset0: NativeDexAssetID, Asset1: "test-coin", FeeBps: 100},
		NativeDexActionLiquidityAdd:    NativeDexLiquidityPayload{PoolID: "dex_test_pool", Amount0: 10, Amount1: 20, MinShares: 1, DeadlineUnix: deadline},
		NativeDexActionLiquidityRemove: NativeDexLiquidityRemovePayload{PoolID: "dex_test_pool", Shares: 10, MinAmount0: 1, MinAmount1: 1, DeadlineUnix: deadline},
		NativeDexActionSwapExactInput:  NativeDexSwapExactInputPayload{PoolID: "dex_test_pool", AssetIn: "test-coin", AmountIn: 20, MinAmountOut: 1, DeadlineUnix: deadline},
		NativeDexActionSwapExactOutput: NativeDexSwapExactOutputPayload{PoolID: "dex_test_pool", AssetOut: NativeDexAssetID, AmountOut: 5, MaxAmountIn: 100, DeadlineUnix: deadline},
	}
	return d, input(action, payloads[action], 4)
}

type moduleSubmit func(*Devnet) (any, Transaction, error)

// Every action exercises both sides of rename, continued faults, exact replay,
// a successful retry, and a full constructor restart without touching live data.
func exerciseModulePersistence(t *testing.T, d *Devnet, submit moduleSubmit, postRename bool) {
	t.Helper()
	before := moduleBusinessState(t, d)
	path := d.snapshotPath() + ".tmp"
	if postRename {
		path = d.snapshotIntegrityMarkerPath() + ".tmp"
	}
	unblock := blockSnapshotWrite(t, path)
	value, tx, err := submit(d)
	if err == nil || errors.Is(err, ErrSnapshotDurabilityUncertain) != postRename || (tx.Hash != "") != postRename {
		t.Fatalf("wrong fault outcome: tx=%+v err=%v", tx, err)
	}
	visible := before
	if postRename {
		visible = moduleBusinessState(t, d)
	}
	assertModuleState(t, d, visible)
	assertModuleState(t, readTransferSnapshot(t, d), visible)
	for i := 0; i < 2; i++ {
		repeated, repeatedTx, retryErr := submit(d)
		if retryErr == nil || errors.Is(retryErr, ErrSnapshotDurabilityUncertain) != postRename || repeatedTx.Hash != tx.Hash {
			t.Fatalf("faulty replay claimed success or lost identity: %+v %v", repeatedTx, retryErr)
		}
		if postRename && !reflect.DeepEqual(value, repeated) {
			t.Fatal("uncertain retry changed original result")
		}
		assertModuleState(t, d, visible)
	}
	if postRename {
		unblockSnapshot := blockSnapshotWrite(t, d.snapshotPath()+".tmp")
		_, repeated, err := submit(d)
		if !errors.Is(err, ErrSnapshotDurabilityUncertain) || repeated.Hash != tx.Hash {
			t.Fatal("pre-rename retry erased an earlier uncertain outcome")
		}
		assertModuleState(t, d, visible)
		unblockSnapshot()
	}
	unblock()
	value, committed, err := submit(d)
	if err != nil || committed.Hash == "" || (postRename && committed.Hash != tx.Hash) {
		t.Fatalf("repair failed: %+v %v", committed, err)
	}
	after := moduleBusinessState(t, d)
	restored, err := NewPersistentDevnet(d.cfg, d.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	assertModuleState(t, restored, after)
	for _, target := range []*Devnet{d, restored} {
		repeated, replayed, err := submit(target)
		if err != nil || replayed.Hash != committed.Hash {
			t.Fatalf("durable replay failed: %+v %v", replayed, err)
		}
		if !reflect.DeepEqual(value, repeated) {
			t.Fatal("durable replay changed original result")
		}
		assertModuleState(t, target, after)
	}
}

func TestNativeDexPersistenceFailureMatrix(t *testing.T) {
	for _, action := range []string{NativeDexActionAssetCreate, NativeDexActionAssetMint, NativeDexActionAssetTransfer, NativeDexActionPoolCreate, NativeDexActionLiquidityAdd, NativeDexActionLiquidityRemove, NativeDexActionSwapExactInput, NativeDexActionSwapExactOutput} {
		for _, post := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/postRename=%t", action, post), func(t *testing.T) {
				d, input := dexPersistenceFixture(t, action)
				submit := func(target *Devnet) (any, Transaction, error) {
					tx, m, _, err := target.SubmitNativeDexAction(input)
					return m.Event, tx, err
				}
				exerciseModulePersistence(t, d, submit, post)
			})
		}
	}
}

func resourcePersistenceFixture(t *testing.T, action string) (*Devnet, moduleSubmit) {
	t.Helper()
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ownerKey, userKey := resourceTestKey(91), resourceTestKey(92)
	owner, user := resourceTestAddress(t, ownerKey), resourceTestAddress(t, userKey)
	if _, err := d.Faucet(owner, 100); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Faucet(user, 100); err != nil {
		t.Fatal(err)
	}
	create := resourcePoolCreateFixture(user, "merchant", "persistence", time.Now().UTC().Add(time.Hour), "base-pool")
	create.Authorization = mustResourceAuthorization(t, ownerKey, 6423, ResourcePoolCreateAction, create, 1)
	pool, _, err := d.CreateResourcePool(create)
	if err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	switch action {
	case ResourcePoolCreateAction:
		create.IdempotencyKey = "new-pool"
		create.Authorization = ResourceAuthorization{}
		create.Authorization = mustResourceAuthorization(t, ownerKey, 6423, action, create, 2)
		return d, func(target *Devnet) (any, Transaction, error) {
			p, tx, err := target.CreateResourcePool(create)
			return p, tx, err
		}
	case ResourcePoolFundAction:
		in := ResourcePoolFundInput{PoolID: pool.ID, Additional: ResourceUnits{Bandwidth: 5}, ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "fund-pool"}
		in.Authorization = mustResourceAuthorization(t, ownerKey, 6423, action, in, 2)
		return d, func(target *Devnet) (any, Transaction, error) {
			p, tx, err := target.FundResourcePool(in)
			return p, tx, err
		}
	case ResourcePoolPolicyAction:
		in := ResourcePoolPolicyInput{PoolID: pool.ID, AllowedBeneficiaries: []string{user}, AllowedScopes: []string{"dapp_action", "pay_api"}, AllowedResourceTypes: []string{"bandwidth", "compute"}, PerActionLimit: ResourceUnits{Bandwidth: 8, Compute: 2}, ExpiresAt: time.Now().UTC().Add(2 * time.Hour), ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "policy-pool"}
		in.Authorization = mustResourceAuthorization(t, ownerKey, 6423, action, in, 2)
		return d, func(target *Devnet) (any, Transaction, error) {
			p, tx, err := target.UpdateResourcePoolPolicy(in)
			return p, tx, err
		}
	case ResourcePoolStatusAction:
		in := ResourcePoolStatusInput{PoolID: pool.ID, Status: "revoked", ExpectedPolicyHash: pool.PolicyHash, IdempotencyKey: "revoke-pool"}
		in.Authorization = mustResourceAuthorization(t, ownerKey, 6423, action, in, 2)
		return d, func(target *Devnet) (any, Transaction, error) {
			p, tx, err := target.UpdateResourcePoolStatus(in)
			return p, tx, err
		}
	default:
		in := ResourceSponsorshipInput{PoolID: pool.ID, Beneficiary: user, Scope: "pay_api", ResourceType: "bandwidth", Amount: 5, ActionReference: "fault-action", IdempotencyKey: "sponsor-action"}
		in.Authorization = mustResourceAuthorization(t, userKey, 6423, action, in, 1)
		return d, func(target *Devnet) (any, Transaction, error) {
			p, tx, err := target.SponsorResource(in)
			return p, tx, err
		}
	}
}

func TestResourceSponsorPersistenceFailureMatrix(t *testing.T) {
	for _, action := range []string{ResourcePoolCreateAction, ResourcePoolFundAction, ResourcePoolPolicyAction, ResourcePoolStatusAction, ResourceSponsorAction} {
		for _, post := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/postRename=%t", action, post), func(t *testing.T) {
				d, submit := resourcePersistenceFixture(t, action)
				exerciseModulePersistence(t, d, submit, post)
			})
		}
	}
}

func TestNativeDexLateFailureRestoresActionAndFeeState(t *testing.T) {
	for _, failure := range []string{"fee lot overflow", "native pool lacks lots", "second asset credit overflow"} {
		t.Run(failure, func(t *testing.T) {
			action := NativeDexActionAssetCreate
			if failure != "fee lot overflow" {
				action = NativeDexActionLiquidityRemove
			}
			d, input := dexPersistenceFixture(t, action)
			if failure == "fee lot overflow" {
				for lot := range d.accounts[input.Signer].Lots {
					d.account(d.nextValidatorAddressLocked()).Lots[lot] = math.MaxInt64
				}
			} else if failure == "native pool lacks lots" {
				pool := d.dexPools["dex_test_pool"]
				for lot := range pool.NativeLots0 {
					pool.NativeLots0[lot] = 1
				}
				d.dexPools[pool.ID] = pool
			} else {
				d.setNativeDexBalance("test-coin", input.Signer, math.MaxInt64)
			}
			before := moduleBusinessState(t, d)
			if tx, _, _, err := d.SubmitNativeDexAction(input); err == nil || tx.Hash != "" {
				t.Fatalf("late failure accepted: %+v %v", tx, err)
			}
			assertModuleState(t, d, before)
		})
	}
}

func TestModuleConcurrentUncertainReplayChargesOnce(t *testing.T) {
	for _, module := range []string{"DEX", "Resource"} {
		t.Run(module, func(t *testing.T) {
			var d *Devnet
			var submit moduleSubmit
			if module == "DEX" {
				var in NativeDexSignedActionInput
				d, in = dexPersistenceFixture(t, NativeDexActionAssetCreate)
				submit = func(target *Devnet) (any, Transaction, error) {
					tx, m, _, err := target.SubmitNativeDexAction(in)
					return m.Event, tx, err
				}
			} else {
				d, submit = resourcePersistenceFixture(t, ResourceSponsorAction)
			}
			unblock := blockSnapshotWrite(t, d.snapshotIntegrityMarkerPath()+".tmp")
			_, tx, err := submit(d)
			if !errors.Is(err, ErrSnapshotDurabilityUncertain) {
				t.Fatal(err)
			}
			state := moduleBusinessState(t, d)
			for _, broken := range []bool{true, false} {
				if !broken {
					unblock()
				}
				var wg sync.WaitGroup
				for i := 0; i < 8; i++ {
					wg.Add(1)
					go func() {
						defer wg.Done()
						_, replay, err := submit(d)
						if replay.Hash != tx.Hash || (broken && !errors.Is(err, ErrSnapshotDurabilityUncertain)) || (!broken && err != nil) {
							t.Errorf("concurrent replay: %+v %v", replay, err)
						}
					}()
				}
				wg.Wait()
				assertModuleState(t, d, state)
			}
		})
	}
}
