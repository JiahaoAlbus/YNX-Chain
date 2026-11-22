package bftgateway

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

// The fixture uses only fresh synthetic accounts; it exercises one original
// PQ contract operation and never retries or substitutes a prior operation.
func TestEVMMigratedContractPQUpdateReadAndRestart(t *testing.T) {
	classic := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 72))
	owner, err := consensus.NativeAddress(classic.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	source, bytecode := gatewayBoundedFixture(t)
	var address string
	var signer *ynxbatch.PrivateKey
	var network []byte
	f := newPQIdentityFixture(t, func(d *chain.Devnet) {
		if _, e := d.Faucet(owner, 1000); e != nil {
			t.Fatal(e)
		}
		d.ProduceBlock()
		contract, _, e := d.DeployContractWithArgs(owner, "SampleEVMWriteCounter", source, []string{"7"})
		if e != nil {
			t.Fatal(e)
		}
		address = contract.Address
		d.ProduceBlock()
		if e = d.EnableAccountPQ(d.LatestHeight() + 1); e != nil {
			t.Fatal(e)
		}
		migration, e := d.ExportConsensusMigrationState()
		if e != nil {
			t.Fatal(e)
		}
		network, e = hex.DecodeString(migration.OriginalGenesisHash)
		if e != nil {
			t.Fatal(e)
		}
		var public ynxbatch.PublicKey
		signer, public, e = ynxbatch.KeyGen()
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(signer.Destroy)
		account, ok := d.Account(owner)
		if !ok {
			t.Fatal("synthetic owner unavailable")
		}
		intent := ynxauth.RegistrationIntent{ChainID: network, Owner: owner, PKA: public.PKA, PKB: public.PKB, NewRevision: 1, LedgerNonce: account.Nonce + 1, ActivateAt: d.LatestHeight() + 2}
		message, e := intent.SigningBytes()
		if e != nil {
			t.Fatal(e)
		}
		digest := sha256.Sum256(message)
		registration, e := (ynxauth.Migration{Intent: intent, ClassicPublicKey: classic.PubKey().SerializeCompressed(), ClassicSignature: ecdsa.Sign(classic, digest[:]).Serialize(), NewKeyProof: signGatewayWhole(t, signer, network, owner, ynxauth.MigrationPurpose, [][]byte{message})}).Encode()
		if e != nil {
			t.Fatal(e)
		}
		if _, _, e = d.SubmitAccountMigration(registration); e != nil {
			t.Fatal(e)
		}
		d.ProduceBlock()
	})
	artifact, err := f.app.PQContractArtifact(address)
	if err != nil {
		t.Fatal(err)
	}
	commitment, err := chain.ContractExecutionStateCommitment(artifact)
	if err != nil {
		t.Fatal(err)
	}
	fixture := &pqGatewayFixture{a: f.app, migration: f.migration, key: signer, network: network, owner: owner}
	account := queryPQGatewayAccount(t, f.app, owner)
	input := ynxauth.ContractExecutePayload{Name: artifact.Name, Target: address, SourceHash: artifact.SourceHash, DeployedBytecodeHash: artifact.DeployedBytecodeHash, CompilerConfigHash: artifact.CompilerConfigHash, ExpectedStorageCommitment: commitment, Calldata: "0x7cf5dab0" + fmt.Sprintf("%064x", 2)}
	wire := gatewayActionWire(t, fixture, ynxauth.ActionContractExecute, input, account.Nonce+1, ynxauth.ContractExecuteFee, 1)
	raw, err := consensus.EncodePQContractTransaction(wire, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	check, err := f.app.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: raw})
	if err != nil || check.Code != 0 {
		t.Fatal("PQ CheckTx", check, err)
	}
	height := f.stateHeight + 1
	at := artifact.DeployedAt.Add(time.Second)
	if !at.After(f.commit.Header.Time) {
		at = f.commit.Header.Time.Add(time.Second)
	}
	result, err := f.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Time: at, NextValidatorsHash: f.set.Hash(), Txs: [][]byte{raw}})
	if err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code != 0 {
		t.Fatal("PQ execution", result, err)
	}
	if _, err = f.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	live := newABCICometFixture(t, f.app, height)
	upstream := httptest.NewServer(live)
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL, MigrationHeight: f.migration.Height, MigrationBlockHash: f.migration.LastBlockHash})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()
	read := func() {
		t.Helper()
		assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":1,"method":"eth_getCode","params":["`+address+`","latest"]}`, bytecode)
		assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":2,"method":"eth_getStorageAt","params":["`+address+`","0x0","latest"]}`, "0x"+strings.Repeat("0", 63)+"9")
		assertRPCResult(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":3,"method":"eth_call","params":[{"to":"`+address+`","data":"0x06661abd"},"latest"]}`, "0x"+strings.Repeat("0", 63)+"9")
	}
	read()
	cold, err := consensus.NewPersistentApplicationWithBootstrap(f.migration, f.statePath, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	live.app = cold
	read()
}
