package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

func TestABCIPQInitialPreparedFundingCommitTransferAndCold(t *testing.T) {
	f := newPQInitialFixtureWithFunding(t, true)
	ctx := context.Background()
	sourceIndex, exists := accountIndex(f.f.migration.Accounts, f.owner)
	if !exists {
		t.Fatal("real prepared Faucet account missing from source")
	}
	source := cloneAccounts(f.f.migration.Accounts[sourceIndex : sourceIndex+1])[0]
	if source.Balance != 100 || len(source.Lots) != 1 {
		t.Fatal("fixture did not retain its real Faucet funding")
	}
	migrationBefore := pqInitialFundingJSON(t, f.f.migration)
	parent := filepath.Join(t.TempDir(), "private")
	if err := os.Mkdir(parent, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(parent, "state.json")
	app, err := NewPersistentApplicationWithBootstrap(f.f.migration, path, f.f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.InitChain(ctx, f.f.initRequest(t)); err != nil {
		t.Fatal(err)
	}
	payload, err := EncodePQInitialRegistrationTransaction(f.registration)
	if err != nil {
		t.Fatal(err)
	}
	before := pqInitialFundingJSON(t, app.committed)
	diskBefore, diskBeforeErr := os.ReadFile(path)
	if diskBeforeErr != nil && !os.IsNotExist(diskBeforeErr) {
		t.Fatal(diskBeforeErr)
	}
	check, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: payload})
	if err != nil || check.Code != 0 || !bytes.Equal(before, pqInitialFundingJSON(t, app.committed)) {
		t.Fatal("normal CheckTx rejected prepared birth or mutated committed state", check, err)
	}
	for name, mutate := range map[string]func(*chain.ConsensusAccount){
		"balance": func(a *chain.ConsensusAccount) { a.Balance++ },
		"lot amount": func(a *chain.ConsensusAccount) {
			for id := range a.Lots {
				a.Lots[id]++
			}
		},
		"extra lot": func(a *chain.ConsensusAccount) { a.Lots["unissued"] = 1 },
		"nonce":     func(a *chain.ConsensusAccount) { a.Nonce++ },
		"stake":     func(a *chain.ConsensusAccount) { a.Staked++ },
		"resource":  func(a *chain.ConsensusAccount) { a.ResourceUsage.ComputeUsed++ },
	} {
		t.Run("current account/"+name, func(t *testing.T) {
			state := app.cloneExecutionState()
			index, found := accountIndex(state.accounts, f.owner)
			if !found {
				t.Fatal("prepared account missing before registration")
			}
			mutate(&state.accounts[index])
			if _, _, err := app.applyPQInitialRegistration(state, payload, 2, f.f.doc.GenesisTime.Add(2*time.Second)); err == nil {
				t.Fatal("birth consumed a changed prepared source account")
			}
			if !bytes.Equal(before, pqInitialFundingJSON(t, app.committed)) {
				t.Fatal("rejected isolated execution changed committed state")
			}
		})
	}
	for name, mutate := range map[string]func(*nativeAccountValue){
		"delta balance":     func(a *nativeAccountValue) { a.account.Balance++ },
		"zero lot presence": func(a *nativeAccountValue) { a.setLot("unissued", 0) },
	} {
		t.Run("current account/"+name, func(t *testing.T) {
			state := app.cloneExecutionState()
			account, found := nativeAccountAt(state, f.owner)
			if !found {
				t.Fatal("prepared native account missing")
			}
			mutate(&account)
			state.nativeAccounts = deltaPut(state.nativeAccounts, f.owner, account)
			if _, _, err := app.applyPQInitialRegistration(state, payload, 2, f.f.doc.GenesisTime.Add(2*time.Second)); err == nil {
				t.Fatal("prepared account comparison ignored changed native delta or zero-map presence")
			}
			if !bytes.Equal(before, pqInitialFundingJSON(t, app.committed)) {
				t.Fatal("rejected native delta changed committed state")
			}
		})
	}
	diskAfter, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) || os.IsNotExist(err) != os.IsNotExist(diskBeforeErr) || !bytes.Equal(diskBefore, diskAfter) {
		t.Fatal("CheckTx or rejected execution changed the checkpoint", err)
	}
	commit := func(height int64, transaction []byte) {
		t.Helper()
		result, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: f.f.doc.GenesisTime.Add(time.Duration(height) * time.Second), NextValidatorsHash: bytes.Clone(f.f.bootstrap.validatorSetHash), Txs: [][]byte{transaction}})
		if err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code != 0 {
			t.Fatal("normal prepared-account transaction failed", result, err)
		}
		if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	commit(2, payload)
	want := cloneAccounts([]chain.ConsensusAccount{source})[0]
	want.Nonce = 1
	want.ResourceUsage.BandwidthUsed = 1
	index, exists := accountIndex(app.committed.Accounts, f.owner)
	if !exists || !reflect.DeepEqual(app.committed.Accounts[index], want) || !reflect.DeepEqual(app.committed.TraceLots, f.f.migration.Runtime.Lots) || len(app.committed.FeeEvents) != 0 {
		t.Fatal("birth changed original funding/lineage or granted an unrelated fee waiver")
	}
	if len(app.committed.AccountPolicy.Records) != 1 || app.committed.AccountPolicy.Records[0].ActiveFrom != 3 || len(app.committed.PQHistory) != 1 {
		t.Fatal("birth lost its first registration or activation history")
	}
	view, err := pqWalletHistoryView(app.committed, f.f.migration, SignedTransactionHash(f.registration))
	if err != nil || view.Transaction.Type != PQInitialRegistrationType || view.Transaction.Amount != 0 || view.Transaction.Fee != 0 || len(view.Transaction.LotFlows) != 0 || view.ABCITransactionHash != SignedTransactionHash(payload) {
		t.Fatal("normal birth originals view rewrote funding as registration effects", err)
	}
	cold, err := NewPersistentApplicationWithBootstrap(f.f.migration, path, f.f.bootstrap)
	if err != nil || !bytes.Equal(pqInitialFundingJSON(t, cold.committed), pqInitialFundingJSON(t, app.committed)) {
		t.Fatal("normal cold restore changed prepared birth evidence", err)
	}
	app = cold
	transfer, err := EncodePQTransaction(PQTransferType, f.transfer)
	if err != nil {
		t.Fatal(err)
	}
	check, err = app.CheckTx(ctx, &abci.RequestCheckTx{Tx: transfer})
	if err != nil || check.Code != 0 {
		t.Fatal("active first PQ key could not spend its preserved source funding", check, err)
	}
	commit(3, transfer)
	index, _ = accountIndex(app.committed.Accounts, f.owner)
	if app.committed.Accounts[index].Balance != source.Balance-7-1 || app.committed.Accounts[index].Balance != 92 || app.committed.Accounts[index].Nonce != 2 || len(app.committed.FeeEvents) != 1 || app.committed.FeeEvents[0].GrossFeeYNXT != 1 || len(app.committed.PQHistory) != 2 {
		t.Fatal("prepared funding did not follow ordinary PQ transfer/nonce/fee rules")
	}
	if !bytes.Equal(migrationBefore, pqInitialFundingJSON(t, f.f.migration)) {
		t.Fatal("registration or transfer rewrote the immutable original source")
	}
	cold, err = NewPersistentApplicationWithBootstrap(f.f.migration, path, f.f.bootstrap)
	if err != nil || !bytes.Equal(pqInitialFundingJSON(t, cold.committed), pqInitialFundingJSON(t, app.committed)) {
		t.Fatal("normal cold restore changed spent account, policy, history or trace catalog", err)
	}
	if _, err := NewPersistentApplication(f.f.migration, path); err == nil {
		t.Fatal("prepared checkpoint's copied pair replaced independent Genesis authority")
	}
	for name, mutate := range map[string]func(*CommittedState){
		"lost birth": func(s *CommittedState) { s.PQHistory = s.PQHistory[1:] },
		"funding relabeled as birth": func(s *CommittedState) {
			s.PQHistory[0].Transaction.Amount = source.Balance
		},
	} {
		t.Run(name, func(t *testing.T) {
			bad := app.committed
			bad.PQHistory = clonePQHistory(bad.PQHistory)
			if err := validateConsensusPQState(bad, f.f.migration); err != nil {
				t.Fatal("valid prepared history failed before mutation", err)
			}
			mutate(&bad)
			if err := validateConsensusPQState(bad, f.f.migration); err == nil {
				t.Fatal("prepared funding weakened original birth history validation")
			}
		})
	}
}

func TestPQInitialPreparedFundingRequiresPinnedSource(t *testing.T) {
	f := newPQInitialFixtureWithFunding(t, true)
	binding := f.configuration.Accounts[0]
	pkA, err := hex.DecodeString(binding.PKA)
	if err != nil {
		t.Fatal(err)
	}
	pkB, err := hex.DecodeString(binding.PKB)
	if err != nil {
		t.Fatal(err)
	}
	faucet := pqInitialFundingFaucet(t, f.f.migration, f.owner)
	prepared, err := PreparePQInitialPreparedFundingBinding(f.f.migration, f.owner, pkA, pkB, faucet.Hash)
	if err != nil || !reflect.DeepEqual(prepared, binding) {
		t.Fatal("producer did not bind the actual full source account and Faucet", err)
	}
	plain, err := cmtjson.Marshal(f.f.doc)
	if err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*PQInitialAccountBinding){
		"missing explicit funding": func(b *PQInitialAccountBinding) { b.PreparedFunding = nil },
		"different source pin": func(b *PQInitialAccountBinding) {
			b.PreparedFunding.SourceStateHash = strings.Repeat("1", 64)
		},
		"different Faucet": func(b *PQInitialAccountBinding) {
			b.PreparedFunding.FaucetHash = "0x" + strings.Repeat("2", 64)
		},
	} {
		t.Run(name, func(t *testing.T) {
			var configuration PQInitialAccountConfiguration
			if err := json.Unmarshal(pqInitialFundingJSON(t, f.configuration), &configuration); err != nil {
				t.Fatal(err)
			}
			mutate(&configuration.Accounts[0])
			if _, err := EncodePQInitialAccountGenesis(plain, f.f.migration, configuration); err == nil {
				t.Fatal("candidate encoder accepted unbound prepared funding")
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(plain, &fields); err != nil {
				t.Fatal(err)
			}
			fields[PQInitialAccountsGenesisField] = pqInitialFundingJSON(t, configuration)
			raw := pqInitialFundingJSON(t, fields)
			pins := f.f.pins
			digest := sha256.Sum256(raw)
			pins.CometGenesisSHA256 = hex.EncodeToString(digest[:])
			if _, err := NewConsensusBootstrap(raw, pins, f.f.migration); err == nil {
				t.Fatal("normal repinned Genesis consumer accepted unbound prepared funding")
			}
		})
	}
	wrongPins := f.f.pins
	wrongPins.MigrationStateHash = strings.Repeat("1", 64)
	if _, err := NewConsensusBootstrap(f.f.raw, wrongPins, f.f.migration); err == nil {
		t.Fatal("prepared funding bypassed the independent migration pin")
	}
	for name, hash := range map[string]string{
		"absent Faucet": "0x" + strings.Repeat("2", 64),
		"hash alias":    strings.ToUpper(faucet.Hash),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := PreparePQInitialPreparedFundingBinding(f.f.migration, f.owner, pkA, pkB, hash); err == nil {
				t.Fatal("producer accepted a missing or noncanonical original Faucet")
			}
		})
	}
	intent, _, err := ynxauth.DecodePQInitialRegistrationMember(f.registration)
	if err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*chain.ConsensusMigrationState){
		"changed original lot catalog": func(m *chain.ConsensusMigrationState) {
			id := faucet.LotFlows[0].LotID
			lot := m.Runtime.Lots[id]
			lot.Origin = "invented mint"
			m.Runtime.Lots[id] = lot
		},
		"existing policy owner": func(m *chain.ConsensusMigrationState) {
			m.AccountPolicy.Records = []ynxauth.Record{{AlgorithmVersion: ynxbatch.Version, Owner: f.owner, PKA: pkA, PKB: pkB, Revision: 1, RegisteredAt: 2, ActiveFrom: intent.ActivateAt, LedgerNonce: 1}}
			m.Runtime.AccountPolicy = cloneConsensusAccountPolicy(m.AccountPolicy)
		},
		"existing revocation": func(m *chain.ConsensusMigrationState) {
			m.AccountPolicy.Version = ynxauth.PolicyRevocationVersion
			m.AccountPolicy.Revocations = []ynxauth.RevocationRecord{{Owner: f.owner, AuthorizingRevision: 1, ThroughRevision: 1, RegisteredAt: 2, RevokedFrom: 3, LedgerNonce: 2}}
			m.Runtime.AccountPolicy = cloneConsensusAccountPolicy(m.AccountPolicy)
		},
	} {
		t.Run(name, func(t *testing.T) {
			var changed chain.ConsensusMigrationState
			if err := json.Unmarshal(pqInitialFundingJSON(t, f.f.migration), &changed); err != nil {
				t.Fatal(err)
			}
			mutate(&changed)
			// Keep the real independent source pin. A modified catalog or copied
			// policy must not replace the original complete source authority.
			if changed.StateHash != f.f.pins.MigrationStateHash {
				t.Fatal("mutation changed the independent source pin")
			}
			if _, err := PreparePQInitialPreparedFundingBinding(changed, f.owner, pkA, pkB, faucet.Hash); err == nil {
				t.Fatal("producer accepted a changed or already occupied source owner")
			}
		})
	}
	for name, alter := range map[string]func(*chain.Devnet) string{
		"Faucet not in last block": func(d *chain.Devnet) string {
			d.ProduceBlock()
			return faucet.Hash
		},
		"second funding with earlier owner history": func(d *chain.Devnet) string {
			receipt, err := d.Faucet(f.owner, 1)
			if err != nil {
				t.Fatal(err)
			}
			d.ProduceBlock()
			return receipt.Hash
		},
	} {
		t.Run(name, func(t *testing.T) {
			d, err := f.f.migration.RestoreSourceRuntime()
			if err != nil {
				t.Fatal(err)
			}
			originalHash := alter(d)
			migration, err := d.ExportConsensusMigrationState()
			if err != nil {
				t.Fatal("real source mutation did not produce a valid migration", err)
			}
			if _, err := PreparePQInitialPreparedFundingBinding(migration, f.owner, pkA, pkB, originalHash); err == nil {
				t.Fatal("producer treated old or repeated funding as a new prepared owner")
			}
		})
	}
	mainnet := chain.NewDevnet(chain.DefaultNetworkConfig("mainnet"))
	mainnetFaucet, err := mainnet.Faucet(f.owner, faucet.Amount)
	if err != nil {
		t.Fatal(err)
	}
	mainnet.ProduceBlock()
	if err := mainnet.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	mainnetMigration, err := mainnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := PreparePQInitialPreparedFundingBinding(mainnetMigration, f.owner, pkA, pkB, mainnetFaucet.Hash); err == nil {
		t.Fatal("testnet preparation enabled funding authority for mainnet")
	}
}

func pqInitialFundingJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func pqInitialFundingFaucet(t *testing.T, migration chain.ConsensusMigrationState, owner string) chain.Transaction {
	t.Helper()
	var result chain.Transaction
	count := 0
	for _, block := range migration.Runtime.Blocks {
		for _, tx := range block.Transactions {
			if tx.Type == "faucet" && tx.To == owner {
				result = tx
				count++
			}
		}
	}
	if count != 1 {
		t.Fatal("fixture lacks exactly one real prepared Faucet")
	}
	return result
}
