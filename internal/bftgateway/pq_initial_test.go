package bftgateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

type gatewayInitialFixture struct {
	f      *pqGatewayFixture
	mock   *pqMockComet
	path   string
	raw    []byte
	pins   consensus.ConsensusBootstrapPins
	boot   *consensus.ConsensusBootstrap
	intent ynxauth.RegistrationIntent
}

func newGatewayInitialFixture(t *testing.T) *gatewayInitialFixture {
	t.Helper()
	// Independent synthetic Genesis assigns an unused canonical owner to a full
	// pair. No source account, classic migration, Root or public-chain claim is
	// manufactured; the only original allocation is to a distinct donor.
	f := &pqGatewayFixture{owner: "0x" + strings.Repeat("3", 40), recipient: "0x" + strings.Repeat("4", 40)}
	var err error
	f.d, err = chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.d.Faucet(f.recipient, 1000); err != nil {
		t.Fatal(err)
	}
	f.d.ProduceBlock()
	if err = f.d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	f.migration, err = f.d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, role := range f.migration.Validators {
		key := ed25519.GenPrivKeyFromSecret([]byte("synthetic-initial-validator-" + strconv.Itoa(i)))
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: role.Address, KeyType: chain.ConsensusPubKeyTypeEd25519,
			PublicKey: base64.StdEncoding.EncodeToString(key.PubKey().Bytes()), ConsensusAddress: strings.ToUpper(hex.EncodeToString(key.PubKey().Address()))})
	}
	f.migration, err = f.migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	f.network, err = hex.DecodeString(f.migration.OriginalGenesisHash)
	if err != nil {
		t.Fatal(err)
	}
	var public ynxbatch.PublicKey
	f.key, public, err = ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(f.key.Destroy)
	doc, err := consensus.BuildCometGenesis(f.migration, time.Date(2026, 10, 25, 1, 2, 3, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	plain, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	configuration := consensus.PQInitialAccountConfiguration{Version: consensus.PQInitialAccountsVersion, NetworkID: f.migration.OriginalGenesisHash,
		EnableAt: "2", BirthFee: "0", Accounts: []consensus.PQInitialAccountBinding{{Owner: f.owner, PKA: hex.EncodeToString(public.PKA), PKB: hex.EncodeToString(public.PKB)}}}
	result := &gatewayInitialFixture{f: f, path: filepath.Join(t.TempDir(), "initial-state.json")}
	result.raw, err = consensus.EncodePQInitialAccountGenesis(plain, f.migration, configuration)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(result.raw)
	result.pins = consensus.ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(digest[:]), OriginalGenesisHash: f.migration.OriginalGenesisHash, MigrationStateHash: f.migration.StateHash}
	result.boot, err = consensus.NewConsensusBootstrap(result.raw, result.pins, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	f.a, err = consensus.NewPersistentApplicationWithBootstrap(f.migration, result.path, result.boot)
	if err != nil {
		t.Fatal(err)
	}
	params := doc.ConsensusParams.ToProto()
	init := &abci.RequestInitChain{Time: doc.GenesisTime, ChainId: doc.ChainID, InitialHeight: doc.InitialHeight, ConsensusParams: &params, AppStateBytes: bytes.Clone(doc.AppState)}
	validators := make([]*cmttypes.Validator, len(doc.Validators))
	for i, validator := range doc.Validators {
		pub, err := cryptoenc.PubKeyToProto(validator.PubKey)
		if err != nil {
			t.Fatal(err)
		}
		init.Validators = append(init.Validators, abci.ValidatorUpdate{PubKey: pub, Power: validator.Power})
		validators[i] = cmttypes.NewValidator(validator.PubKey, validator.Power)
	}
	if _, err = f.a.InitChain(context.Background(), init); err != nil {
		t.Fatal(err)
	}
	result.intent = ynxauth.RegistrationIntent{ChainID: f.network, Owner: f.owner, PKA: public.PKA, PKB: public.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: 3}
	message, err := result.intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	f.wire = signGatewayMember(t, f.key, f.network, f.owner, ynxauth.TransactionPurpose, message)
	f.payload, err = consensus.EncodePQInitialRegistrationTransaction(f.wire)
	if err != nil {
		t.Fatal(err)
	}
	result.mock = newPQMock(t, f)
	result.mock.height = uint64(doc.InitialHeight)
	result.mock.nextValidatorsHash = cmttypes.NewValidatorSet(validators).Hash()
	return result
}

func initialApplicationBytes(t *testing.T, a *consensus.Application, path string) []byte {
	t.Helper()
	out, err := a.Query(context.Background(), &abci.RequestQuery{Path: path})
	if err != nil || out.Code != 0 {
		t.Fatal("actual initial query failed", path, out, err)
	}
	return bytes.Clone(out.Value)
}

func initialAuthorization(t *testing.T, a *consensus.Application, owner string) consensus.PQWalletAccountView {
	t.Helper()
	var view consensus.PQWalletAccountView
	if err := json.Unmarshal(initialApplicationBytes(t, a, consensus.PQWalletAuthorizationPath+owner), &view); err != nil {
		t.Fatal(err)
	}
	return view
}

func assertInitialMember(t *testing.T, f *gatewayInitialFixture, view PQMemberView) {
	t.Helper()
	if view.Type != consensus.PQInitialRegistrationType || view.Status != "committed" || !view.Committed || view.Source != "comet-rpc" ||
		view.NativeTransactionHash != consensus.SignedTransactionHash(f.f.wire) || view.ABCITransactionHash != consensus.SignedTransactionHash(f.f.payload) ||
		view.NativeTransactionHash == view.ABCITransactionHash || !bytes.Equal(view.Wire, f.f.wire) || view.ExecutionHeight != 2 ||
		view.CometIndex == nil || *view.CometIndex != 0 || view.Transaction == nil || view.From != f.f.owner || view.To != f.f.owner || view.Amount != 0 || view.Fee != 0 || view.Nonce != 1 {
		t.Fatalf("initial registration lost original identity or zero-balance effects: %+v", view)
	}
	tx := view.Transaction
	if tx.Type != consensus.PQInitialRegistrationType || tx.Hash != view.NativeTransactionHash || tx.BlockNum != 2 || tx.Amount != 0 || tx.Fee != 0 || tx.Nonce != 1 ||
		len(tx.LotFlows) != 0 || len(tx.Logs) != 0 || tx.Memo != "ynx-pq-account-initial-v1:"+hex.EncodeToString(f.f.wire) {
		t.Fatal("initial registration acquired unexecuted effects")
	}
}

func TestGatewayPQInitialRegistrationActualCommitAndColdOriginal(t *testing.T) {
	f := newGatewayInitialFixture(t)
	beforeSource, err := f.f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	donor := queryPQGatewayAccount(t, f.f.a, f.f.recipient)
	var fees []consensus.BFTFeeEvent
	if err := json.Unmarshal(initialApplicationBytes(t, f.f.a, "/economics/fees"), &fees); err != nil || len(fees) != 0 {
		t.Fatal("synthetic initial-account fixture already has fee events", fees, err)
	}
	missing, err := f.f.a.Query(context.Background(), &abci.RequestQuery{Path: "/accounts/" + f.f.owner})
	if err != nil || missing.Code == 0 {
		t.Fatal("allowlist alone created an account", missing, err)
	}
	policy := initialAuthorization(t, f.f.a, f.f.owner)
	if policy.Policy == nil || len(policy.Policy.Records) != 0 || policy.LedgerNonce != 0 || policy.PQSigningEnabled {
		t.Fatal("unregistered birth had signing authority")
	}
	server := gatewayPQServer(t, f.mock)
	code, view := pqMemberPOST(t, server.URL, "/accounts/"+f.f.owner+"/authorization/register", f.f.wire)
	if code != http.StatusOK {
		t.Fatalf("normal initial registration: HTTP %d %+v", code, view)
	}
	assertInitialMember(t, f, view)
	account := queryPQGatewayAccount(t, f.f.a, f.f.owner)
	if account.Balance != 0 || account.Staked != 0 || account.Nonce != 1 || len(account.Lots) != 0 || account.ResourceUsage != (chain.ResourceUsage{BandwidthUsed: 1}) {
		t.Fatal("birth changed its exact zero-value/resource effects", account)
	}
	if after := queryPQGatewayAccount(t, f.f.a, f.f.recipient); !reflect.DeepEqual(donor, after) {
		t.Fatal("birth changed another account", donor, after)
	}
	// The existing fee journal intentionally seals an empty initial [] as nil.
	// Check the actual event ledger, not that pre/post JSON spelling difference.
	if err := json.Unmarshal(initialApplicationBytes(t, f.f.a, "/economics/fees"), &fees); err != nil || len(fees) != 0 {
		t.Fatal("birth created an actual fee event", fees, err)
	}
	policy = initialAuthorization(t, f.f.a, f.f.owner)
	if policy.Policy == nil || len(policy.Policy.Records) != 1 || !policy.PQSigningEnabled || policy.CommittedPQSigningEnabled || policy.LedgerNonce != 1 || policy.ExecutionHeight != 3 || policy.CommittedHeight != 2 {
		t.Fatal("birth did not preserve exact current and next-height policy")
	}
	record := policy.Policy.Records[0]
	if record.Revision != 1 || record.RegisteredAt != 2 || record.ActiveFrom != 3 || record.LedgerNonce != 1 || !bytes.Equal(record.PKA, f.intent.PKA) || !bytes.Equal(record.PKB, f.intent.PKB) {
		t.Fatal("birth replaced the pinned complete pair or activation")
	}
	for _, route := range []string{view.ReadbackURL, "/txs/" + view.ABCITransactionHash} {
		code, read := pqMemberGET(t, server.URL+route)
		if code != http.StatusOK || !reflect.DeepEqual(read, view) {
			t.Fatal("initial original readback differs", code, read)
		}
	}
	disk, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(f.path)
	if err != nil {
		t.Fatal(err)
	}
	// Cold construction must recover from the same original checkpoint and
	// independently pinned Genesis. The checkpoint cannot qualify its own pair.
	freshBoot, err := consensus.NewConsensusBootstrap(f.raw, f.pins, f.f.migration)
	if err != nil {
		t.Fatal(err)
	}
	cold, err := consensus.NewPersistentApplicationWithBootstrap(f.f.migration, f.path, freshBoot)
	if err != nil {
		t.Fatal(err)
	}
	f.mock.mu.Lock()
	f.f.a = cold
	f.mock.mu.Unlock()
	code, read := pqMemberGET(t, server.URL+view.ReadbackURL)
	if code != http.StatusOK || !reflect.DeepEqual(read, view) || !reflect.DeepEqual(account, queryPQGatewayAccount(t, cold, f.f.owner)) {
		t.Fatal("cold initial-account original changed")
	}
	after, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	afterInfo, err := os.Stat(f.path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(disk, after) || !os.SameFile(info, afterInfo) || !info.ModTime().Equal(afterInfo.ModTime()) {
		t.Fatal("cold/read-only query rewrote the original checkpoint")
	}
	if _, err := consensus.NewPersistentApplication(f.f.migration, f.path); err == nil {
		t.Fatal("checkpoint pair replaced independent Genesis")
	}
	afterSource, err := f.f.migration.CanonicalJSON()
	if err != nil || !bytes.Equal(beforeSource, afterSource) {
		t.Fatal("new account rewrote source migration")
	}
	f.mock.mu.Lock()
	defer f.mock.mu.Unlock()
	if f.mock.posts != 1 {
		t.Fatal("read/cold restore resubmitted initial registration")
	}
}

func TestGatewayPQInitialRegistrationRejectsRouteANDAndOccupied(t *testing.T) {
	f := newGatewayInitialFixture(t)
	server := gatewayPQServer(t, f.mock)
	before := initialApplicationBytes(t, f.f.a, "/state")
	// Route/intent mismatch is rejected before any upstream write.
	code, rejected := pqMemberPOST(t, server.URL, "/accounts/"+f.f.recipient+"/authorization/register", f.f.wire)
	if code != http.StatusBadRequest || rejected.Committed || f.mock.posts != 0 {
		t.Fatal("wrong registration route reached the ledger")
	}
	for _, branch := range []string{"A", "B"} {
		member, err := ynxbatch.DecodeMember(f.f.wire)
		if err != nil {
			t.Fatal(err)
		}
		if branch == "A" {
			member.Certificate.SigmaA[0] ^= 1
		} else {
			member.Certificate.SigmaB[0] ^= 1
		}
		wire, err := ynxbatch.EncodeMember(member)
		if err != nil {
			t.Fatal(err)
		}
		setGatewayMemberOriginal(t, f.mock, consensus.PQInitialRegistrationType, wire, 2)
		code, rejected = pqMemberPOST(t, server.URL, "/accounts/"+f.f.owner+"/authorization/register", wire)
		if code != http.StatusUnprocessableEntity || rejected.Committed || rejected.Status != "rejected" || !bytes.Equal(before, initialApplicationBytes(t, f.f.a, "/state")) {
			t.Fatal("corrupt AND birth changed state", branch, code, rejected)
		}
	}
	message, err := f.intent.SigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	wire := signGatewayMember(t, f.f.key, f.f.network, f.f.owner, ynxauth.TransactionPurpose, message)
	setGatewayMemberOriginal(t, f.mock, consensus.PQInitialRegistrationType, wire, 2)
	code, view := pqMemberPOST(t, server.URL, "/accounts/"+f.f.owner+"/authorization/register", wire)
	if code != http.StatusOK {
		t.Fatal("valid initial registration refused after bad signatures", code, view)
	}
	assertInitialMember(t, f, view)
	disk, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	setGatewayMemberOriginal(t, f.mock, consensus.PQInitialRegistrationType, wire, 3)
	code, rejected = pqMemberPOST(t, server.URL, "/accounts/"+f.f.owner+"/authorization/register", wire)
	if code != http.StatusUnprocessableEntity || rejected.Committed || !strings.Contains(rejected.Error, "unoccupied") {
		t.Fatal("occupied account registration was not refused", code, rejected)
	}
	after, err := os.ReadFile(f.path)
	if err != nil || !bytes.Equal(disk, after) {
		t.Fatal("occupied registration rewrote original state")
	}
}

func TestGatewayPQInitialRegistrationUnknownOnlyReadsOriginal(t *testing.T) {
	f := newGatewayInitialFixture(t)
	f.mock.mode = "connection-loss"
	server := gatewayPQServer(t, f.mock)
	code, view := pqMemberPOST(t, server.URL, "/accounts/"+f.f.owner+"/authorization/register", f.f.wire)
	if code != http.StatusAccepted || view.Status != "unknown" || view.Committed || view.Transaction != nil || view.NativeTransactionHash != consensus.SignedTransactionHash(f.f.wire) || view.ABCITransactionHash != consensus.SignedTransactionHash(f.f.payload) {
		t.Fatal("lost birth response became success or lost identity", code, view)
	}
	// The original actually committed before the response was lost. Reconcile
	// only its retained native/ABCI identities; never POST or sign a replacement.
	for _, route := range []string{view.ReadbackURL, "/txs/" + view.ABCITransactionHash} {
		code, read := pqMemberGET(t, server.URL+route)
		if code != http.StatusOK {
			t.Fatal("lost-response original not found", code, read)
		}
		assertInitialMember(t, f, read)
	}
	f.mock.mu.Lock()
	defer f.mock.mu.Unlock()
	if f.mock.posts != 1 {
		t.Fatal("UNKNOWN initial registration was resubmitted")
	}
}
