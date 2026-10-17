package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	cometed25519 "github.com/cometbft/cometbft/crypto/ed25519"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmtversion "github.com/cometbft/cometbft/proto/tendermint/version"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/cometbft/cometbft/version"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestEndpointAndWorkloadBounds(t *testing.T) {
	for _, endpoint := range []string{"http://example.com:1", "http://localhost:1234", "https://127.0.0.1:1234", "http://127.0.0.1", "http://127.0.0.1:1234/path", "http://user@127.0.0.1:1234", "http://127.0.0.1:01234"} {
		if validateEndpoint(endpoint) == nil {
			t.Fatalf("unsafe endpoint accepted: %s", endpoint)
		}
	}
	if err := validateEndpoint("http://127.0.0.1:31757"); err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{`{"transactions":[]}`, `{"transactions":["YQ==","YQ=="]}`, `{"transactions":["YQ=="],"extra":true}`, `{"transactions":["YQ=="]} {}`} {
		if _, err := decodeTransactions([]byte(input)); err == nil {
			t.Fatalf("invalid workload accepted: %s", input)
		}
	}
	o := options{manifest: "manifest", transactions: "transactions", concurrency: 4, timeout: 10 * time.Second, poll: 100 * time.Millisecond}
	if err := validateOptions(o); err != nil {
		t.Fatal(err)
	}
	o.timeout = 31 * time.Second
	if validateOptions(o) == nil {
		t.Fatal("unbounded timeout accepted")
	}
	o.timeout = 10 * time.Second
	o.rounds = 2
	if validateOptions(o) == nil {
		t.Fatal("repeated driver without durable report destination accepted")
	}
	o.output = "new-result.json"
	if err := validateOptions(o); err != nil {
		t.Fatal(err)
	}
	o.rounds = 33
	if validateOptions(o) == nil {
		t.Fatal("unbounded round count accepted")
	}
}

func TestExpandedDecoderBoundIsFinite(t *testing.T) {
	// These are decoder-only byte fixtures, not signed/accepted transactions.
	input := transactionInput{Transactions: make([]string, maxTransactions)}
	for i := range input.Transactions {
		input.Transactions[i] = base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf("decoder-bound-fixture-%d", i)))
	}
	data, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	if txs, err := decodeTransactions(data); err != nil || len(txs) != maxTransactions {
		t.Fatal("new bounded decoder ceiling failed", err)
	}
	input.Transactions = append(input.Transactions, base64.StdEncoding.EncodeToString([]byte("one-too-many")))
	data, err = json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeTransactions(data); err == nil {
		t.Fatal("decoder accepted beyond hard ceiling")
	}
}

func confirmationFixture(t *testing.T, powers []int64, signers int) (consensus.EphemeralNetworkManifest, *cmttypes.ValidatorSet, *coretypes.ResultValidators, *coretypes.ResultCommit, *coretypes.ResultTx, cmttypes.Tx) {
	t.Helper()
	m := consensus.EphemeralNetworkManifest{Version: consensus.EphemeralNetworkVersion, Purpose: "local-ephemeral", ChainID: "ynx_6423-1", GenesisHash: strings.Repeat("ab", 32)}
	keys := map[string]cometed25519.PrivKey{}
	var vals []*cmttypes.Validator
	for i, power := range powers {
		key := cometed25519.GenPrivKeyFromSecret([]byte{byte(i + 1)})
		pub := key.PubKey()
		keys[string(pub.Address())] = key
		vals = append(vals, cmttypes.NewValidator(pub, power))
		m.Nodes = append(m.Nodes, consensus.EphemeralNetworkNode{Home: filepath.Join(t.TempDir(), "node"), RPCURL: fmt.Sprintf("http://127.0.0.1:%d", 31757+i), ConsensusAddress: fmt.Sprintf("%X", pub.Address()), ConsensusPubKey: base64.StdEncoding.EncodeToString(pub.Bytes()), ConsensusKeyType: chain.ConsensusPubKeyTypeEd25519})
	}
	set := cmttypes.NewValidatorSet(vals)
	raw := cmttypes.Tx("offline-test-transaction")
	txs := cmttypes.Txs{raw}
	header := &cmttypes.Header{Version: cmtversion.Consensus{Block: version.BlockProtocol, App: 13}, ChainID: m.ChainID, Height: 5, Time: time.Unix(1802736000, 0), ValidatorsHash: set.Hash(), NextValidatorsHash: set.Hash(), DataHash: txs.Hash(), ProposerAddress: set.Validators[0].Address}
	partHash := sha256.Sum256([]byte("offline-parts"))
	blockID := cmttypes.BlockID{Hash: header.Hash(), PartSetHeader: cmttypes.PartSetHeader{Total: 1, Hash: partHash[:]}}
	commit := &cmttypes.Commit{Height: 5, Round: 0, BlockID: blockID}
	for i, validator := range set.Validators {
		if i >= signers {
			commit.Signatures = append(commit.Signatures, cmttypes.NewCommitSigAbsent())
			continue
		}
		vote := &cmtproto.Vote{Type: cmtproto.PrecommitType, Height: 5, Round: 0, BlockID: blockID.ToProto(), Timestamp: header.Time, ValidatorAddress: validator.Address, ValidatorIndex: int32(i)}
		sig, err := keys[string(validator.Address)].Sign(cmttypes.VoteSignBytes(m.ChainID, vote))
		if err != nil {
			t.Fatal(err)
		}
		commit.Signatures = append(commit.Signatures, cmttypes.CommitSig{BlockIDFlag: cmttypes.BlockIDFlagCommit, ValidatorAddress: validator.Address, Timestamp: header.Time, Signature: sig})
	}
	validators := &coretypes.ResultValidators{BlockHeight: 5, Validators: set.Validators, Count: 4, Total: 4}
	result := &coretypes.ResultCommit{SignedHeader: cmttypes.SignedHeader{Header: header, Commit: commit}, CanonicalCommit: true}
	tx := &coretypes.ResultTx{Hash: raw.Hash(), Height: 5, Index: 0, Tx: raw, TxResult: abcitypes.ExecTxResult{Code: 0}, Proof: txs.Proof(0)}
	return m, set, validators, result, tx, raw
}

func TestConfirmationRequiresSignedWeightedQuorumAndInclusion(t *testing.T) {
	for _, tc := range []struct {
		name    string
		powers  []int64
		signers int
		valid   bool
	}{
		{"three equal signatures", []int64{1, 1, 1, 1}, 3, true},
		{"two equal signatures", []int64{1, 1, 1, 1}, 2, false},
		{"one weighted supermajority", []int64{70, 10, 10, 10}, 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, set, vals, commit, tx, raw := confirmationFixture(t, tc.powers, tc.signers)
			if err := verifyConfirmation(m, set, vals, commit, tx, raw); (err == nil) != tc.valid {
				t.Fatalf("quorum result: %v", err)
			}
		})
	}
	for _, mutation := range []string{"signature", "transaction", "height", "execution", "weights", "merkle"} {
		t.Run(mutation, func(t *testing.T) {
			m, set, vals, commit, tx, raw := confirmationFixture(t, []int64{1, 1, 1, 1}, 4)
			switch mutation {
			case "signature":
				commit.Commit.Signatures[0].Signature[0] ^= 1
			case "transaction":
				tx.Tx = []byte("different transaction")
			case "height":
				tx.Height++
			case "execution":
				tx.TxResult.Code = 2
			case "weights":
				copyVals := make([]*cmttypes.Validator, 4)
				for i, val := range vals.Validators {
					copy := *val
					copyVals[i] = &copy
				}
				copyVals[0].VotingPower++
				vals.Validators = copyVals
			case "merkle":
				tx.Proof.Proof.Total++
			}
			if err := verifyConfirmation(m, set, vals, commit, tx, raw); err == nil {
				t.Fatal("invalid confirmation accepted")
			}
		})
	}
}

func TestFinalSubmissionRequiresDurableEvidenceAndHonestCounts(t *testing.T) {
	zero := uint32(0)
	at := time.Now()
	latency := 5.0
	results := []transactionResult{
		{SubmittedAt: &at, CheckTxCode: &zero, CheckTxIdentityVerified: true, ExecutionCode: &zero, IncludedObservedAt: &at, InclusionMs: &latency, QuorumVerified: true, TransactionProofVerified: true, Status: "timeout"},
		{SubmittedAt: &at, CheckTxCode: &zero, CheckTxIdentityVerified: true, ExecutionCode: &zero, IncludedObservedAt: &at, ConfirmedObservedAt: &at, ConfirmationMs: &latency, QuorumVerified: true, TransactionProofVerified: true, DurableStateVerified: true},
		{SubmittedAt: &at, Status: "submission_unknown"},
		{Status: "not_submitted"},
	}
	s := summarize(results, 2)
	if s.Submitted != 3 || s.CheckTxAccepted != 2 || s.IncludedCodeZero != 2 || s.QuorumConfirmed != 2 || s.FinalSubmitted != 1 || s.TimedOut != 1 || s.SubmissionUnknown != 1 || s.NotSubmitted != 1 || s.FinalSubmissionRate != .5 || s.ConfirmationLatency.Samples != 1 {
		t.Fatalf("incorrect stage counts: %+v", s)
	}
}

func TestDurableReadbackRejectsMissingWrongAndTamperedState(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{7}, 32))
	recipientKey := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{8}, 32))
	sender, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	recipient, _ := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(sender, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "state.json")
	tx, _ := consensus.NewSignedTransfer(key, 6423, recipient, 3, 1)
	raw, _ := consensus.EncodeSignedTransaction(tx)
	height := int64(migration.Height) + 1
	if _, err := verifyDurableExecution(file, migration, raw, height); !errors.Is(err, errDurableNotReady) {
		t.Fatalf("missing state: %v", err)
	}
	app, err := consensus.NewPersistentApplication(migration, file)
	if err != nil {
		t.Fatal(err)
	}
	result, err := app.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000, 0), Txs: [][]byte{raw}})
	if err != nil || result.TxResults[0].Code != 0 {
		t.Fatalf("finalize: %+v %v", result, err)
	}
	if _, err := app.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	state, err := verifyDurableExecution(file, migration, raw, height)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifyDurableExecution(file, migration, raw, height+1); !errors.Is(err, errDurableNotReady) {
		t.Fatalf("future height: %v", err)
	}
	other, _ := consensus.NewSignedTransfer(key, 6423, recipient, 4, 1)
	otherRaw, _ := consensus.EncodeSignedTransaction(other)
	if _, err := verifyDurableExecution(file, migration, otherRaw, height); err == nil {
		t.Fatal("wrong transaction accepted")
	}
	state.Accounts[0].Balance++
	tampered, _ := json.Marshal(state)
	if err := os.WriteFile(file, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := verifyDurableExecution(file, migration, raw, height); err == nil {
		t.Fatal("tampered durable state accepted")
	}
}
