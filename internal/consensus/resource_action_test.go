package consensus

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestApplicationPersistsResourceDelegationRentalAndSupply(t *testing.T) {
	ctx := context.Background()
	providerKey := deterministicPrivateKey(91)
	renterKey := deterministicPrivateKey(92)
	provider, renter := mustNativeAddress(t, providerKey), mustNativeAddress(t, renterKey)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(provider, 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet(renter, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "resource-state.json")
	app, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}

	delegationInput := ResourceDelegationPayload{Provider: provider, Beneficiary: provider, AmountYNXT: 100, PolicyHash: migration.ResourcePolicy.PolicyHash, IdempotencyKey: "delegate-1"}
	delegationInput.RequestHash = ResourceDelegationRequestHash(delegationInput.Provider, delegationInput.Beneficiary, delegationInput.AmountYNXT, delegationInput.PolicyHash, delegationInput.IdempotencyKey)
	delegationRaw := mustResourceAction(t, providerKey, ActionResourceDelegate, delegationInput, 1)
	delegationID := ApplicationActionRecordID("resource-delegation", ApplicationActionHash(delegationRaw))

	blockTime := time.Date(2026, 7, 12, 13, 0, 0, 0, time.UTC)
	expiresAt := blockTime.Add(5 * time.Minute)
	quote, err := chain.ResourceQuoteForPolicy(migration.ResourcePolicy, renter, 100, 10, 1, 1, expiresAt)
	if err != nil {
		t.Fatal(err)
	}
	rentalInput := ResourceRentalPayload{Address: renter, Provider: provider, Bandwidth: 100, Compute: 10, AICredits: 1, TrustCredits: 1, QuoteID: quote.ID, QuoteExpiresAt: expiresAt, PolicyHash: migration.ResourcePolicy.PolicyHash, MaxPriceYNXT: quote.PriceYNXT, IdempotencyKey: "rent-1"}
	rentalInput.RequestHash = ResourceRentalRequestHash(rentalInput.Address, rentalInput.Provider, rentalInput.Bandwidth, rentalInput.Compute, rentalInput.AICredits, rentalInput.TrustCredits, rentalInput.QuoteID, rentalInput.QuoteExpiresAt, rentalInput.PolicyHash, rentalInput.MaxPriceYNXT, rentalInput.IdempotencyKey)
	rentalRaw := mustResourceAction(t, renterKey, ActionResourceRent, rentalInput, 1)
	rentalID := ApplicationActionRecordID("resource-rental", ApplicationActionHash(rentalRaw))

	height := int64(migration.Height) + 1
	txs := [][]byte{delegationRaw, rentalRaw}
	proposal, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: height, Time: blockTime, Txs: txs})
	if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_ACCEPT {
		t.Fatalf("Resource proposal failed: %+v %v", proposal, err)
	}
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: txs})
	if err != nil || len(finalized.TxResults) != 2 {
		t.Fatalf("Resource finalize failed: %+v %v", finalized, err)
	}
	for _, result := range finalized.TxResults {
		if result.Code != 0 || len(result.Events) != 1 || result.Events[0].Type != "ynx.resource_action" {
			t.Fatalf("unexpected Resource result: %+v", result)
		}
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}

	var delegation BFTResourceDelegation
	queryJSON(t, app, "/resource/delegations/"+delegationID, &delegation)
	if delegation.AmountYNXT != 100 || delegation.Provider != provider || delegation.Beneficiary != provider {
		t.Fatalf("bad delegation: %+v", delegation)
	}
	var rental BFTResourceRental
	queryJSON(t, app, "/resource/rentals/"+rentalID, &rental)
	if rental.QuoteID != quote.ID || rental.PriceYNXT != quote.PriceYNXT || rental.ProviderIncomeYNXT+rental.ProtocolFeeYNXT != quote.PriceYNXT {
		t.Fatalf("bad rental: %+v", rental)
	}
	var committedQuote BFTResourceQuote
	queryJSON(t, app, "/resource/quotes/"+quote.ID, &committedQuote)
	if committedQuote.PolicyHash != migration.ResourcePolicy.PolicyHash || !committedQuote.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("bad quote: %+v", committedQuote)
	}
	var analytics chain.ResourceAnalytics
	queryJSON(t, app, "/resource/analytics", &analytics)
	if analytics.ActiveDelegationCount != 1 || analytics.ResourceRentalCount != 1 || analytics.DelegatedYNXT != 100 || analytics.RentalVolumeYNXT != quote.PriceYNXT {
		t.Fatalf("bad analytics: %+v", analytics)
	}

	var state CommittedState
	queryJSON(t, app, "/state", &state)
	liquid, staked := sumConsensusYNXT(state.Accounts)
	if liquid+staked != migration.LiquidSupplyYNXT+migration.StakedSupplyYNXT {
		t.Fatal("Resource actions changed total YNXT supply")
	}
	providerAccount := queryConsensusAccount(t, app, provider)
	renterAccount := queryConsensusAccount(t, app, renter)
	if providerAccount.Staked != accountByAddress(t, migration.Accounts, provider).Staked+100 || providerAccount.Nonce != 1 || renterAccount.Nonce != 1 {
		t.Fatalf("unexpected Resource accounts: provider=%+v renter=%+v", providerAccount, renterAccount)
	}
	if renterAccount.ResourceUsage.AICreditsUsed != 0 || renterAccount.ResourceUsage.TrustUsed != 0 || renterAccount.ResourceUsage.PayCreditsUsed != 0 {
		t.Fatalf("rental charged typed credits: %+v", renterAccount.ResourceUsage)
	}

	duplicate := delegationInput
	duplicate.AmountYNXT = 1
	duplicate.RequestHash = ResourceDelegationRequestHash(duplicate.Provider, duplicate.Beneficiary, duplicate.AmountYNXT, duplicate.PolicyHash, duplicate.IdempotencyKey)
	duplicateRaw := mustResourceAction(t, providerKey, ActionResourceDelegate, duplicate, 2)
	check, _ := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: duplicateRaw})
	if check.Code == 0 {
		t.Fatal("Resource idempotency key was reused")
	}

	restarted, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}
	var restored BFTResourceRental
	queryJSON(t, restarted, "/resource/rentals/"+rentalID, &restored)
	if string(mustJSON(t, restored)) != string(mustJSON(t, rental)) {
		t.Fatal("Resource state changed after restart")
	}
}

func TestResourceRentalRejectsMissingProviderStaleQuoteAndPolicy(t *testing.T) {
	ctx := context.Background()
	key := deterministicPrivateKey(93)
	provider := mustNativeAddress(t, deterministicPrivateKey(94))
	signer := mustNativeAddress(t, key)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	_, _ = devnet.Faucet(signer, 100)
	devnet.ProduceBlock()
	migration, _ := devnet.ExportConsensusMigrationState()
	app, _ := NewApplication(migration)
	blockTime := time.Date(2026, 7, 12, 14, 0, 0, 0, time.UTC)
	expiresAt := blockTime.Add(time.Minute)
	quote, _ := chain.ResourceQuoteForPolicy(migration.ResourcePolicy, signer, 100, 0, 0, 0, expiresAt)
	input := ResourceRentalPayload{Address: signer, Provider: provider, Bandwidth: 100, QuoteID: quote.ID, QuoteExpiresAt: expiresAt, PolicyHash: migration.ResourcePolicy.PolicyHash, MaxPriceYNXT: quote.PriceYNXT, IdempotencyKey: "missing-provider"}
	input.RequestHash = ResourceRentalRequestHash(input.Address, input.Provider, input.Bandwidth, 0, 0, 0, input.QuoteID, input.QuoteExpiresAt, input.PolicyHash, input.MaxPriceYNXT, input.IdempotencyKey)
	raw := mustResourceAction(t, key, ActionResourceRent, input, 1)
	check, _ := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: raw})
	if check.Code == 0 {
		t.Fatal("rental accepted provider without active delegation")
	}

	input.Provider = chain.ProtocolResourceProvider
	input.IdempotencyKey = "expired-quote"
	input.RequestHash = ResourceRentalRequestHash(input.Address, input.Provider, input.Bandwidth, 0, 0, 0, input.QuoteID, input.QuoteExpiresAt, input.PolicyHash, input.MaxPriceYNXT, input.IdempotencyKey)
	raw = mustResourceAction(t, key, ActionResourceRent, input, 1)
	proposal, _ := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Height: int64(migration.Height) + 1, Time: expiresAt.Add(time.Second), Txs: [][]byte{raw}})
	if proposal.Status != abcitypes.ResponseProcessProposal_REJECT {
		t.Fatal("expired Resource quote was accepted")
	}

	input.PolicyHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	input.IdempotencyKey = "stale-policy"
	input.RequestHash = ResourceRentalRequestHash(input.Address, input.Provider, input.Bandwidth, 0, 0, 0, input.QuoteID, input.QuoteExpiresAt, input.PolicyHash, input.MaxPriceYNXT, input.IdempotencyKey)
	raw = mustResourceAction(t, key, ActionResourceRent, input, 1)
	check, _ = app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: raw})
	if check.Code == 0 {
		t.Fatal("stale Resource policy was accepted")
	}
	account := queryConsensusAccount(t, app, signer)
	if account.Nonce != 0 || account.Balance != accountByAddress(t, migration.Accounts, signer).Balance {
		t.Fatal("rejected Resource actions consumed nonce or balance")
	}
}

func TestResourceActionEnvelopeUsesOnlySharedFeeAndBandwidth(t *testing.T) {
	key := deterministicPrivateKey(95)
	signer := mustNativeAddress(t, key)
	input := ResourceDelegationPayload{Provider: signer, Beneficiary: signer, AmountYNXT: 1, PolicyHash: chain.DefaultResourceMarketPolicy().PolicyHash, IdempotencyKey: "units-test"}
	input.RequestHash = ResourceDelegationRequestHash(input.Provider, input.Beneficiary, input.AmountYNXT, input.PolicyHash, input.IdempotencyKey)
	tx, err := NewSignedApplicationAction(key, 6423, ActionResourceDelegate, input, 1)
	if err != nil {
		t.Fatal(err)
	}
	if tx.AIUnits != 0 || tx.PayUnits != 0 || tx.TrustUnits != 0 || tx.Fee != 1 {
		t.Fatalf("bad Resource envelope charges: %+v", tx)
	}
}

func mustResourceAction(t *testing.T, key *secp256k1.PrivateKey, action string, input any, nonce uint64) []byte {
	t.Helper()
	tx, err := NewSignedApplicationAction(key, 6423, action, input, nonce)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := EncodeSignedApplicationAction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func queryConsensusAccount(t *testing.T, app *Application, address string) chain.ConsensusAccount {
	t.Helper()
	response, err := app.Query(context.Background(), &abcitypes.RequestQuery{Path: "/accounts/" + address})
	if err != nil || response.Code != 0 {
		t.Fatalf("query account %s: %+v %v", address, response, err)
	}
	var account chain.ConsensusAccount
	if err := json.Unmarshal(response.Value, &account); err != nil {
		t.Fatal(err)
	}
	return account
}

func sumConsensusYNXT(accounts []chain.ConsensusAccount) (int64, int64) {
	var liquid, staked int64
	for _, account := range accounts {
		liquid += account.Balance
		staked += account.Staked
	}
	return liquid, staked
}

func accountByAddress(t *testing.T, accounts []chain.ConsensusAccount, address string) chain.ConsensusAccount {
	t.Helper()
	for _, account := range accounts {
		if account.Address == address {
			return account
		}
	}
	t.Fatalf("account %s not found", address)
	return chain.ConsensusAccount{}
}
