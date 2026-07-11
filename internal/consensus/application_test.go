package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abciclient "github.com/cometbft/cometbft/abci/client"
	abciserver "github.com/cometbft/cometbft/abci/server"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func TestApplicationInitializesFromYNXMigrationAndCommitsEmptyBlock(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet("ynx_abci_owner", 1000); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	state, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewApplication(state)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := state.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	initResponse, err := app.InitChain(ctx, &abcitypes.RequestInitChain{ChainId: "ynx_6423-1", InitialHeight: int64(state.Height) + 1, AppStateBytes: payload})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(initResponse.AppHash, mustHash(t, state.StateHash)) {
		t.Fatal("ABCI InitChain did not return the migration state hash")
	}
	accountResponse, err := app.Query(ctx, &abcitypes.RequestQuery{Path: "/accounts/ynx_abci_owner"})
	if err != nil || accountResponse.Code != abcitypes.CodeTypeOK || !bytes.Contains(accountResponse.Value, []byte(`"balance":1000`)) {
		t.Fatalf("ABCI account query failed: response=%+v err=%v", accountResponse, err)
	}
	nextHeight := int64(state.Height) + 1
	finalizeResponse, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: nextHeight})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(finalizeResponse.AppHash, initResponse.AppHash) {
		t.Fatal("empty block changed the migrated YNXT application hash")
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	info, err := app.Info(ctx, &abcitypes.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	if info.Data != ApplicationName || info.LastBlockHeight != nextHeight || !bytes.Equal(info.LastBlockAppHash, initResponse.AppHash) {
		t.Fatalf("unexpected ABCI info after commit: %+v", info)
	}
}

func TestApplicationServesCometBFTSocketProtocol(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	senderKey := deterministicPrivateKey(31)
	sender := mustNativeAddress(t, senderKey)
	recipient := mustNativeAddress(t, deterministicPrivateKey(32))
	if _, err := devnet.Faucet("ynx_socket_owner", 777); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet(sender, 200); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	state, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewApplication(state)
	if err != nil {
		t.Fatal(err)
	}
	socketPath := fmt.Sprintf("/tmp/ynx-abci-%d.sock", os.Getpid())
	_ = os.Remove(socketPath)
	t.Cleanup(func() { _ = os.Remove(socketPath) })
	address := "unix://" + socketPath
	server, err := abciserver.NewServer(address, "socket", app)
	if err != nil {
		t.Fatal(err)
	}
	if err := server.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Stop() })
	client, err := abciclient.NewClient(address, "socket", true)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Stop() })
	ctx := context.Background()
	info, err := client.Info(ctx, &abcitypes.RequestInfo{})
	if err != nil || info.Data != ApplicationName || info.LastBlockHeight != int64(state.Height) {
		t.Fatalf("socket Info failed: response=%+v err=%v", info, err)
	}
	account, err := client.Query(ctx, &abcitypes.RequestQuery{Path: "/accounts/ynx_socket_owner"})
	if err != nil || account.Code != abcitypes.CodeTypeOK || !bytes.Contains(account.Value, []byte(`"balance":777`)) {
		t.Fatalf("socket Query failed: response=%+v err=%v", account, err)
	}
	tx, err := NewSignedTransfer(senderKey, state.Network.ChainID, recipient, 50, 1)
	if err != nil {
		t.Fatal(err)
	}
	txPayload, err := EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	check, err := client.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: txPayload})
	if err != nil || check.Code != abcitypes.CodeTypeOK {
		t.Fatalf("socket CheckTx failed: response=%+v err=%v", check, err)
	}
	height := int64(state.Height) + 1
	finalized, err := client.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Txs: [][]byte{txPayload}})
	if err != nil || len(finalized.TxResults) != 1 || finalized.TxResults[0].Code != abcitypes.CodeTypeOK {
		t.Fatalf("socket FinalizeBlock failed: response=%+v err=%v", finalized, err)
	}
	if _, err := client.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	recipientAccount, err := client.Query(ctx, &abcitypes.RequestQuery{Path: "/accounts/" + recipient})
	if err != nil || recipientAccount.Code != abcitypes.CodeTypeOK || !bytes.Contains(recipientAccount.Value, []byte(`"balance":50`)) {
		t.Fatalf("socket committed account query failed: response=%+v err=%v", recipientAccount, err)
	}
}

func TestApplicationRejectsUnsignedTransactionsAndMismatchedGenesis(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	devnet.ProduceBlock()
	state, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewApplication(state)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := app.InitChain(ctx, &abcitypes.RequestInitChain{ChainId: "wrong-chain"}); err == nil {
		t.Fatal("ABCI application accepted a mismatched chain ID")
	}
	check, err := app.CheckTx(ctx, &abcitypes.RequestCheckTx{Tx: []byte(`{"type":"transfer"}`)})
	if err != nil || check.Code != CodeUnsupportedTx {
		t.Fatalf("unsigned transaction was not rejected: response=%+v err=%v", check, err)
	}
	proposal, err := app.ProcessProposal(ctx, &abcitypes.RequestProcessProposal{Txs: [][]byte{[]byte("unsigned")}})
	if err != nil || proposal.Status != abcitypes.ResponseProcessProposal_REJECT {
		t.Fatalf("proposal with unsigned transaction was not rejected: response=%+v err=%v", proposal, err)
	}
}

func mustHash(t *testing.T, value string) []byte {
	t.Helper()
	decoded, err := hex.DecodeString(value)
	if err != nil {
		t.Fatal(err)
	}
	return decoded
}
