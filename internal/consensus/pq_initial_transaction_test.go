package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
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

type pqInitialFixture struct {
	f             *validatorRegistryFixture
	configuration PQInitialAccountConfiguration
	registration  []byte
	transfer      []byte
	owner, donor  string
}

func newPQInitialFixture(t *testing.T) *pqInitialFixture {
	t.Helper()
	donor := mustNativeAddress(t, deterministicPrivateKey(218))
	// The operator assigns this canonical address; the unrelated QA classic key
	// is retained only to prove that even a valid classic signature is refused.
	owner := mustNativeAddress(t, deterministicPrivateKey(219))
	d := chain.NewDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), []chain.Validator{
		{Address: "ynx_validator_primary", Moniker: "primary", VotingPower: 1, Active: true},
		{Address: "ynx_validator_seoul", Moniker: "seoul", VotingPower: 1, Active: true},
		{Address: "ynx_validator_singapore", Moniker: "singapore", VotingPower: 1, Active: true},
		{Address: "ynx_validator_virginia", Moniker: "virginia", VotingPower: 1, Active: true},
	})
	if _, err := d.Faucet(donor, 1000); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	if err := d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	var validators []chain.ConsensusValidatorKeyBinding
	legacy := make(map[string]ed25519.PrivateKey)
	for i, role := range migration.Validators {
		key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(111 + i)}, ed25519.SeedSize))
		public := key.Public().(ed25519.PublicKey)
		address := sha256.Sum256(public)
		legacy[string(address[:20])] = key
		validators = append(validators, chain.ConsensusValidatorKeyBinding{ValidatorAddress: role.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(address[:20]))})
	}
	migration, err = migration.BindConsensusValidatorKeys(validators)
	if err != nil {
		t.Fatal(err)
	}
	key, public, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(key.Destroy)
	configuration := PQInitialAccountConfiguration{Version: PQInitialAccountsVersion, NetworkID: migration.OriginalGenesisHash, EnableAt: "2", BirthFee: "0", Accounts: []PQInitialAccountBinding{{Owner: owner, PKA: hex.EncodeToString(public.PKA), PKB: hex.EncodeToString(public.PKB)}}}
	f := &validatorRegistryFixture{migration: migration, legacy: legacy}
	t.Cleanup(func() {
		for _, key := range legacy {
			clear(key)
		}
	})
	f.doc, err = BuildCometGenesis(migration, time.Date(2026, 10, 25, 1, 2, 3, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	plain, err := cmtjson.Marshal(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	f.raw, err = EncodePQInitialAccountGenesis(plain, migration, configuration)
	if err != nil {
		t.Fatal(err)
	}
	genesis := sha256.Sum256(f.raw)
	f.pins = ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(genesis[:]), OriginalGenesisHash: migration.OriginalGenesisHash, MigrationStateHash: migration.StateHash}
	f.bootstrap, err = NewConsensusBootstrap(f.raw, f.pins, migration)
	if err != nil {
		t.Fatal(err)
	}
	network, _ := hex.DecodeString(migration.OriginalGenesisHash)
	intent := ynxauth.RegistrationIntent{ChainID: network, Owner: owner, PKA: public.PKA, PKB: public.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: 3}
	registerMessage, err := intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	transferMessage, err := (ynxauth.Transfer{ChainID: network, NativeChainID: uint64(migration.Network.ChainID), From: owner, To: donor, Amount: 7, Fee: 1, Nonce: 2}).SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	// One real N4 certificate covers distinct registration and normal transfer
	// members. No secp migration or second signing ceremony is used for birth.
	batch, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: ynxauth.TransactionPurpose}, [][]byte{[]byte("unrelated"), registerMessage, transferMessage, []byte("unused")}, ynxbatch.SignOptions{Optimized: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(batch.Discard)
	result := &pqInitialFixture{f: f, configuration: configuration, owner: owner, donor: donor}
	for index, target := range map[uint32]*[]byte{1: &result.registration, 2: &result.transfer} {
		member, err := ynxbatch.Extract(batch, index)
		if err != nil {
			t.Fatal(err)
		}
		*target, err = ynxbatch.EncodeMember(member)
		if err != nil {
			t.Fatal(err)
		}
	}
	return result
}

func TestABCIPQInitialRegistrationCommitFundingTransferAndCold(t *testing.T) {
	f := newPQInitialFixture(t)
	ctx := context.Background()
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
	if kind, wire, err := pqTransactionWire(payload); err != nil || kind != PQInitialRegistrationType || !bytes.Equal(wire, f.registration) {
		t.Fatal("normal finality parser did not retain the original initial Member", err)
	}
	before, _ := json.Marshal(app.committed)
	check, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: payload})
	after, _ := json.Marshal(app.committed)
	if err != nil || check.Code != 0 || !bytes.Equal(before, after) {
		t.Fatal("normal CheckTx rejected bound birth or mutated committed state", check, err)
	}
	classic, err := NewSignedTransfer(deterministicPrivateKey(219), f.f.migration.Network.ChainID, f.donor, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	classicRaw, err := EncodeSignedTransaction(classic)
	if err != nil {
		t.Fatal(err)
	}
	classicCheck, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: classicRaw})
	if err != nil || classicCheck.Code == 0 || !strings.Contains(classicCheck.Log, "post-quantum") {
		t.Fatal("Genesis reserved owner accepted classic authorization before activation", classicCheck, err)
	}
	prematureFund, err := NewSignedTransfer(deterministicPrivateKey(218), f.f.migration.Network.ChainID, f.owner, 20, 1)
	if err != nil {
		t.Fatal(err)
	}
	prematureRaw, err := EncodeSignedTransaction(prematureFund)
	if err != nil {
		t.Fatal(err)
	}
	premature, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: prematureRaw})
	if err != nil || premature.Code == 0 || !strings.Contains(premature.Log, "before funding") {
		t.Fatal("unsolicited prefunding could occupy a reserved new owner", premature, err)
	}
	commit := func(height int64, transactions ...[]byte) {
		t.Helper()
		result, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: f.f.doc.GenesisTime.Add(time.Duration(height) * time.Second), NextValidatorsHash: bytes.Clone(f.f.bootstrap.validatorSetHash), Txs: transactions})
		if err != nil || len(result.TxResults) != len(transactions) {
			t.Fatal("normal FinalizeBlock failed", result, err)
		}
		for _, tx := range result.TxResults {
			if tx.Code != 0 {
				t.Fatal("normal transaction failed", tx)
			}
		}
		if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	commit(2, payload)
	index, exists := accountIndex(app.committed.Accounts, f.owner)
	if !exists || app.committed.Accounts[index].Balance != 0 || app.committed.Accounts[index].Staked != 0 || app.committed.Accounts[index].Nonce != 1 || len(app.committed.Accounts[index].Lots) != 0 || app.committed.Accounts[index].ResourceUsage != (chain.ResourceUsage{BandwidthUsed: 1}) || len(app.committed.FeeEvents) != 0 {
		t.Fatal("birth granted value, resources, a fee waiver for another operation, or a wrong nonce")
	}
	if len(app.committed.AccountPolicy.Records) != 1 || app.committed.AccountPolicy.Records[0].ActiveFrom != 3 {
		t.Fatal("birth did not preserve its future activation")
	}
	view, err := pqWalletHistoryView(app.committed, f.f.migration, SignedTransactionHash(f.registration))
	if err != nil || view.Transaction.Type != PQInitialRegistrationType || view.Transaction.Fee != 0 || view.ABCITransactionHash != SignedTransactionHash(payload) {
		t.Fatal("normal originals view rejected the committed birth", err)
	}
	cold, err := NewPersistentApplicationWithBootstrap(f.f.migration, path, f.f.bootstrap)
	if err != nil || !reflect.DeepEqual(cold.committed.AccountPolicy, app.committed.AccountPolicy) {
		t.Fatal("normal cold constructor rejected or changed genuine birth evidence", err)
	}
	app = cold
	diskBefore, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	check, err = app.CheckTx(ctx, &abci.RequestCheckTx{Tx: payload})
	diskAfter, readErr := os.ReadFile(path)
	if err != nil || readErr != nil || check.Code == 0 || !bytes.Equal(diskBefore, diskAfter) {
		t.Fatal("registration replay changed the existing checkpoint", check, err, readErr)
	}
	if _, err := NewPersistentApplication(f.f.migration, path); err == nil {
		t.Fatal("a checkpoint's own copied pair replaced independent Genesis authority")
	}
	fund, err := NewSignedTransfer(deterministicPrivateKey(218), f.f.migration.Network.ChainID, f.owner, 20, 1)
	if err != nil {
		t.Fatal(err)
	}
	fundRaw, err := EncodeSignedTransaction(fund)
	if err != nil {
		t.Fatal(err)
	}
	commit(3, fundRaw)
	transferRaw, err := EncodePQTransaction(PQTransferType, f.transfer)
	if err != nil {
		t.Fatal(err)
	}
	commit(4, transferRaw)
	index, _ = accountIndex(app.committed.Accounts, f.owner)
	if app.committed.Accounts[index].Balance != 12 || app.committed.Accounts[index].Nonce != 2 || len(app.committed.FeeEvents) != 2 || app.committed.FeeEvents[1].GrossFeeYNXT != 1 {
		t.Fatal("funded new PQ account bypassed ordinary nonce or fee semantics")
	}
	if _, err := NewPersistentApplicationWithBootstrap(f.f.migration, path, f.f.bootstrap); err != nil {
		t.Fatal("normal cold restore lost birth or later fee-paying transfer", err)
	}
	for name, mutate := range map[string]func(*CommittedState){
		"lost birth original": func(s *CommittedState) { s.PQHistory = s.PQHistory[1:] },
		"birth fee forged":    func(s *CommittedState) { s.PQHistory[0].Transaction.Fee = 1 },
		"nonce rewritten":     func(s *CommittedState) { s.PQHistory[0].Transaction.Nonce = 2 },
		"record pair swapped": func(s *CommittedState) { s.AccountPolicy.Records[0].PKB[0] ^= 1 },
		"ABCI hash swapped":   func(s *CommittedState) { s.PQHistory[0].ABCITransactionHash = "0x" + strings.Repeat("1", 64) },
	} {
		t.Run(name, func(t *testing.T) {
			bad := app.committed
			bad.AccountPolicy = cloneConsensusAccountPolicy(bad.AccountPolicy)
			bad.PQHistory = clonePQHistory(bad.PQHistory)
			mutate(&bad)
			if err := validateConsensusPQState(bad, f.f.migration); err == nil {
				t.Fatal("forged persisted birth evidence was accepted")
			}
		})
	}
}
