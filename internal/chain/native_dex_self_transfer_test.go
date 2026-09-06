package chain

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"testing"
)

func TestNativeDexSelfTransferConservesAssetBalance(t *testing.T) {
	for _, nearLimit := range []bool{false, true} {
		t.Run(fmt.Sprintf("nearLimit=%t", nearLimit), func(t *testing.T) {
			d, input := dexPersistenceFixture(t, NativeDexActionAssetTransfer)
			amount := int64(50)
			if nearLimit {
				// Total native DEX asset supply remains valid: the pool holds the
				// remainder. A fictitious self-credit would exceed MaxInt64 here.
				pool := d.dexPools["dex_test_pool"]
				d.setNativeDexBalance("test-coin", input.Signer, math.MaxInt64-pool.Reserve1)
				asset := d.dexAssets["test-coin"]
				asset.TotalSupply, asset.MaxSupply = math.MaxInt64, math.MaxInt64
				asset.AuditHash = nativeDexAssetAuditHash(asset)
				d.dexAssets[asset.ID] = asset
				amount = pool.Reserve1 + 1
			}
			input.Payload, _ = json.Marshal(NativeDexAssetTransferPayload{AssetID: "test-coin", Recipient: input.Signer, Amount: amount})
			assetBefore := d.dexAssets["test-coin"]
			balanceBefore := d.nativeDexBalance("test-coin", input.Signer)
			poolBefore := cloneNativeDexPool(d.dexPools["dex_test_pool"])
			senderBefore, _ := d.Account(input.Signer)
			validator := d.nextValidatorAddressLocked()
			validatorBefore, _ := d.Account(validator)
			tx, _, replayed, err := d.SubmitNativeDexAction(input)
			if err != nil || replayed {
				t.Fatalf("self-transfer rejected: %v", err)
			}
			if balanceAfter := d.nativeDexBalance("test-coin", input.Signer); balanceAfter != balanceBefore {
				t.Fatalf("DEX self-transfer minted tokens: asset balance %d -> %d while recorded total supply remains %d", balanceBefore, balanceAfter, d.dexAssets["test-coin"].TotalSupply)
			}
			if !reflect.DeepEqual(assetBefore, d.dexAssets["test-coin"]) || !reflect.DeepEqual(poolBefore, d.dexPools["dex_test_pool"]) {
				t.Fatal("self-transfer changed asset supply or pool reserves/lots")
			}
			senderAfter, _ := d.Account(input.Signer)
			validatorAfter, _ := d.Account(validator)
			if tx.Fee != 1 || tx.Nonce != input.Nonce || senderAfter.Balance != senderBefore.Balance-1 || senderAfter.Nonce != senderBefore.Nonce+1 || senderAfter.ResourceUsage.BandwidthUsed != senderBefore.ResourceUsage.BandwidthUsed+1 || validatorAfter.Balance != validatorBefore.Balance+1 {
				t.Fatal("self-transfer did not consume exactly one nonce, bandwidth unit and native fee")
			}
			if len(tx.LotFlows) != 1 || tx.LotFlows[0].Amount != 1 {
				t.Fatal("self-transfer has unexpected native fee lot flow")
			}
			lot := tx.LotFlows[0].LotID
			senderBefore.Lots[lot]--
			validatorBefore.Lots[lot]++
			if !reflect.DeepEqual(senderBefore.Lots, senderAfter.Lots) || !reflect.DeepEqual(validatorBefore.Lots, validatorAfter.Lots) {
				t.Fatal("self-transfer changed native lots beyond its one-unit fee")
			}
			beforeReplay := moduleBusinessState(t, d)
			if replayTx, _, replayed, err := d.SubmitNativeDexAction(input); err != nil || !replayed || replayTx.Hash != tx.Hash {
				t.Fatal("self-transfer replay failed")
			}
			assertModuleState(t, d, beforeReplay)
			restored, err := NewPersistentDevnet(d.cfg, d.dataDir)
			if err != nil {
				t.Fatal(err)
			}
			assertModuleState(t, restored, beforeReplay)
		})
	}
}

func TestNativeDexSelfTransferInvalidInputIsAtomic(t *testing.T) {
	for _, failure := range []string{"insufficient asset", "fee balance overflow", "fee lot overflow"} {
		t.Run(failure, func(t *testing.T) {
			d, input := dexPersistenceFixture(t, NativeDexActionAssetTransfer)
			amount := int64(50)
			switch failure {
			case "insufficient asset":
				amount = d.nativeDexBalance("test-coin", input.Signer) + 1
			case "fee balance overflow":
				d.account(d.nextValidatorAddressLocked()).Balance = math.MaxInt64
			case "fee lot overflow":
				for lot := range d.accounts[input.Signer].Lots {
					d.account(d.nextValidatorAddressLocked()).Lots[lot] = math.MaxInt64
				}
			}
			input.Payload, _ = json.Marshal(NativeDexAssetTransferPayload{AssetID: "test-coin", Recipient: input.Signer, Amount: amount})
			before := moduleBusinessState(t, d)
			if tx, _, replayed, err := d.SubmitNativeDexAction(input); err == nil || tx.Hash != "" || replayed {
				t.Fatal("invalid self-transfer was accepted")
			}
			assertModuleState(t, d, before)
		})
	}
}

func TestNativeDexSelfTransferPersistenceFailure(t *testing.T) {
	for _, post := range []bool{false, true} {
		t.Run(fmt.Sprintf("postRename=%t", post), func(t *testing.T) {
			d, input := dexPersistenceFixture(t, NativeDexActionAssetTransfer)
			input.Payload, _ = json.Marshal(NativeDexAssetTransferPayload{AssetID: "test-coin", Recipient: input.Signer, Amount: 50})
			before := d.nativeDexBalance("test-coin", input.Signer)
			submit := func(target *Devnet) (any, Transaction, error) {
				tx, m, _, err := target.SubmitNativeDexAction(input)
				return m.Event, tx, err
			}
			exerciseModulePersistence(t, d, submit, post)
			if d.nativeDexBalance("test-coin", input.Signer) != before {
				t.Fatal("failed/retried self-transfer minted tokens")
			}
		})
	}
}
