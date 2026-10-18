package main

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abciclient "github.com/cometbft/cometbft/abci/client"
	abciserver "github.com/cometbft/cometbft/abci/server"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

// Real wire calls, concurrent admission and exact persistent results. This is
// transport correctness coverage, not a throughput or latency benchmark.
func TestABCITransportConcurrentAdmissionAndDurability(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes([]byte{31})
	sender, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	recipientKey := secp256k1.PrivKeyFromBytes([]byte{32})
	recipient, err := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(sender, 10000); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	tx, err := consensus.NewSignedTransfer(key, 6423, recipient, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := consensus.EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	var canonical []byte
	for _, transport := range []string{"socket", "grpc"} {
		t.Run(transport, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			root, err := os.MkdirTemp("", "ynx-wire-")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = os.RemoveAll(root) })
			file := filepath.Join(root, "state.json")
			app, err := consensus.NewBlockJournaledApplication(migration, file)
			if err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			timed := withPhaseTiming(app, &output)
			reservation, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			address := "tcp://" + reservation.Addr().String()
			if err := reservation.Close(); err != nil {
				t.Fatal(err)
			}
			server, err := abciserver.NewServer(address, transport, timed)
			if err != nil {
				t.Fatal(err)
			}
			if err := server.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = server.Stop() })
			clientAddress := address
			if transport == "grpc" {
				// A gRPC target is numeric host:port; tcp:// is the server's
				// listening URI and grpc.NewClient treats it as a DNS target.
				clientAddress = strings.TrimPrefix(address, "tcp://")
			}
			client, err := abciclient.NewClient(clientAddress, transport, true)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = client.Stop() })
			started := make(chan error, 1)
			go func() { started <- client.Start() }()
			select {
			case err := <-started:
				if err != nil {
					t.Fatal(err)
				}
			case <-ctx.Done():
				t.Fatal("ABCI client startup exceeded bounded context", ctx.Err())
			}
			before, err := client.Info(ctx, &abci.RequestInfo{})
			if err != nil {
				t.Fatal(err)
			}
			failures := make(chan error, 16)
			var workers sync.WaitGroup
			for i := 0; i < 16; i++ {
				workers.Add(1)
				go func(i int) {
					defer workers.Done()
					payload := raw
					if i%2 == 1 {
						payload = []byte("invalid signed transaction")
					}
					response, err := client.CheckTx(ctx, &abci.RequestCheckTx{Tx: payload})
					if err != nil || response == nil || (response.Code == 0) != (i%2 == 0) {
						failures <- fmt.Errorf("admission %d: response=%v error=%v", i, response, err)
					}
				}(i)
			}
			workers.Wait()
			close(failures)
			for err := range failures {
				t.Error(err)
			}
			if t.Failed() {
				return
			}
			after, err := client.Info(ctx, &abci.RequestInfo{})
			if err != nil || before.LastBlockHeight != after.LastBlockHeight || !bytes.Equal(before.LastBlockAppHash, after.LastBlockAppHash) {
				t.Fatal("concurrent admission mutated committed state", err)
			}
			height := int64(migration.Height) + 1
			finalized, err := client.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000+height, 0), Txs: [][]byte{raw}})
			if err != nil || finalized == nil || len(finalized.TxResults) != 1 || finalized.TxResults[0].Code != 0 {
				t.Fatal("real signed execution failed", err, finalized)
			}
			if _, err := client.Commit(ctx, &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			replayed, err := client.CheckTx(ctx, &abci.RequestCheckTx{Tx: raw})
			if err != nil || replayed == nil || replayed.Code == 0 {
				t.Fatal("committed nonce replay admitted", err, replayed)
			}
			reopened, err := consensus.NewBlockJournaledApplication(migration, file)
			if err != nil {
				t.Fatal(err)
			}
			stored, err := reopened.Info(ctx, &abci.RequestInfo{})
			if err != nil || stored.LastBlockHeight != height || !bytes.Equal(stored.LastBlockAppHash, finalized.AppHash) {
				t.Fatal("durable recovery differs", err)
			}
			actual, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			if transport == "socket" {
				canonical = actual
			} else if !bytes.Equal(canonical, actual) {
				t.Fatal("transport changed exact durable journal bytes")
			}
			timed.recorder.emit("shutdown", nil)
			rows := phaseReports(t, output.String())
			last := rows[len(rows)-1]
			if last.InFlight != 0 {
				t.Fatal("unfinished concurrent timing calls")
			}
		})
	}
}
