package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestEthereumIndependentEthersLifecycle(t *testing.T) {
	if os.Getenv("YNX_ETHERS_MODULE") == "" {
		t.Skip("set YNX_ETHERS_MODULE to an existing ethers 6 install for independent client integration")
	}
	dir := t.TempDir()
	d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	_ = d.SetEthereumNativeTransfers(true)
	v := loadRPCVectors(t)[0]
	_, err = d.Faucet(v.Sender, 100)
	if err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	defer func() { cancel(); <-stopped }()
	go func() { defer close(stopped); d.Start(ctx, 50*time.Millisecond) }()
	server := httptest.NewServer(NewServer(d))
	defer server.Close()
	command := exec.CommandContext(ctx, "node", "../../testdata/ethereum-native/ethers-lifecycle.cjs", server.URL+"/evm")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("independent ethers lifecycle: %v\n%s", err, output)
	}
	t.Log(string(output))
	cancel()
	<-stopped
	if outputDir := os.Getenv("YNX_ETHEREUM_TEST_OUTPUT"); outputDir != "" {
		if err = os.MkdirAll(outputDir, 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(outputDir, "ethers-lifecycle.json"), output, 0600); err != nil {
			t.Fatal(err)
		}
		// Export an authenticated complete snapshot for old-binary rollback QA;
		// this contains only synthetic local accounts and no private material.
		snapshot, err := d.ReplicationSnapshotJSON()
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(outputDir, "local-synthetic-snapshot.json"), snapshot, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

// Use a real failed snapshot write, not a fabricated receipt, to reproduce the
// old ethers wait failure. Recovery reads this original hash without resending.
func TestEthereumIndependentEthersDurabilityWait(t *testing.T) {
	if os.Getenv("YNX_ETHERS_MODULE") == "" {
		t.Skip("set YNX_ETHERS_MODULE to an existing ethers 6 install for independent client integration")
	}
	dir := t.TempDir()
	d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if err = d.SetEthereumNativeTransfers(true); err != nil {
		t.Fatal(err)
	}
	v := loadRPCVectors(t)[0]
	if _, err = d.Faucet(v.Sender, 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	var sends atomic.Int32
	uncertainObserved := make(chan struct{}, 1)
	handler := NewServer(d)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, readErr := io.ReadAll(r.Body)
		if readErr != nil {
			http.Error(w, readErr.Error(), http.StatusBadRequest)
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(raw))
		var request struct {
			Method string `json:"method"`
		}
		_ = json.Unmarshal(raw, &request)
		if request.Method == "eth_sendRawTransaction" {
			sends.Add(1)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, r)
		for name, values := range response.Header() {
			for _, value := range values {
				w.Header().Add(name, value)
			}
		}
		w.WriteHeader(response.Code)
		_, _ = w.Write(response.Body.Bytes())
		if request.Method == "ynx_getTransactionDurability" {
			var body struct {
				Result struct {
					Status string `json:"status"`
					Hash   string `json:"transactionHash"`
				} `json:"result"`
			}
			if json.Unmarshal(response.Body.Bytes(), &body) == nil && body.Result.Status == "uncertain" && body.Result.Hash == v.Hash {
				select {
				case uncertainObserved <- struct{}{}:
				default:
				}
			}
		}
	}))
	defer server.Close()
	assertRPCResultValue(t, server.URL, "eth_sendRawTransaction", []any{v.Raw}, v.Hash)
	clear := obstructReceiptCheckpoint(t, filepath.Join(dir, "devnet-state.json.tmp"))
	d.ProduceBlock()
	s := newServerWithConfig(d, ServerConfig{})
	requireDurability(t, s, v.Hash, "uncertain")
	original, found := d.Transaction(v.Hash)
	if !found || original.BlockNum == 0 {
		t.Fatal("original transaction inclusion missing")
	}
	var uncertainReceipt map[string]any
	doRPC(t, server.URL, "eth_getTransactionReceipt", []any{v.Hash}, &uncertainReceipt)
	assertRPCErrorCode(t, uncertainReceipt, -32002)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	const client = `
const assert=require('node:assert/strict');
const ethers=require(process.env.YNX_ETHERS_MODULE);
const {waitForLocallyDurableReceipt}=require('../../testdata/ethereum-native/ethers-lifecycle.cjs');
const [url,hash,mode]=process.argv.slice(1);
const provider=new ethers.JsonRpcProvider(url,undefined,{pollingInterval:50,batchMaxCount:1,cacheTimeout:-1});
(async()=>{try {
 const tx=await provider.getTransaction(hash);
 assert.equal(tx.hash,hash);
 if(mode==='original') {
  await assert.rejects(()=>tx.wait(1,1000),e=>e.error?.code===-32002 && e.error?.data?.status==='transaction_durability_uncertain' && e.error?.data?.transactionHash===hash);
  console.log('ORIGINAL_UNCERTAIN_RECEIPT_REJECTED');
 } else {
  const receipt=await waitForLocallyDurableReceipt(provider,tx,10000);
  assert.equal(receipt.hash,hash);assert.equal(receipt.status,1);assert.equal(receipt.fee,ethers.parseEther('1'));
  console.log('ORIGINAL_HASH_LOCAL_DURABILITY_RECOVERED');
 }
}finally{provider.destroy()}})().catch(e=>{console.error(e);process.exitCode=1});`
	baseline := exec.CommandContext(ctx, "node", "-e", client, server.URL+"/evm", v.Hash, "original")
	output, err := baseline.CombinedOutput()
	if err != nil || !strings.Contains(string(output), "ORIGINAL_UNCERTAIN_RECEIPT_REJECTED") {
		t.Fatalf("old ethers wait did not reproduce original uncertainty: %v %s", err, output)
	}
	command := exec.CommandContext(ctx, "node", "-e", client, server.URL+"/evm", v.Hash, "recover")
	var captured bytes.Buffer
	command.Stdout, command.Stderr = &captured, &captured
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	var childErr error
	go func() { childErr = command.Wait(); close(done) }()
	defer func() { cancel(); <-done }()
	select {
	case <-uncertainObserved:
	case <-done:
		t.Fatalf("caller exited without observing original UNKNOWN: %v %s", childErr, captured.String())
	case <-ctx.Done():
		t.Fatal("caller did not read original uncertain durability", ctx.Err())
	}
	// An independent normal checkpoint completes. The child may only read;
	// neither the client nor this recovery sends the original transaction again.
	clear()
	d.ProduceBlock()
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("original-hash recovery did not finish", ctx.Err())
	}
	if childErr != nil || !strings.Contains(captured.String(), "ORIGINAL_HASH_LOCAL_DURABILITY_RECOVERED") {
		t.Fatalf("original-hash recovery: %v %s", childErr, captured.String())
	}
	if sends.Load() != 1 {
		t.Fatalf("uncertain outcome caused %d sends, want one original send", sends.Load())
	}
	recovered, state, found := d.TransactionWithDurability(v.Hash)
	if !found || state.Status != "durable" || !reflect.DeepEqual(recovered, original) {
		t.Fatal("original included transaction changed during reconciliation")
	}
	cold, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	coldTx, coldState, found := cold.TransactionWithDurability(v.Hash)
	account, accountFound := cold.Account(v.Sender)
	if !found || coldState.Status != "durable" || !reflect.DeepEqual(coldTx, original) || !accountFound || account.Balance != 97 || account.Nonce != 1 {
		t.Fatal("cold original receipt, balance or nonce changed")
	}
	t.Log("ORIGINAL_UNKNOWN_READBACK_ONLY_LOCAL_DURABILITY_PASS sends=1 newKeys=false NodeStart=false")
}

func TestEthereumIndependentEthersDurabilityRefusals(t *testing.T) {
	if os.Getenv("YNX_ETHERS_MODULE") == "" {
		t.Skip("set YNX_ETHERS_MODULE to an existing ethers 6 install for independent client integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	const controls = `
const assert=require('node:assert/strict');
const {waitForLocallyDurableReceipt}=require('../../testdata/ethereum-native/ethers-lifecycle.cjs');
const hash='0x'+'11'.repeat(32), blockHash='0x'+'22'.repeat(32);
const base={version:'ynx-local-durability-v1',scope:'local-snapshot',status:'durable',transactionHash:hash,blockNumber:'0x2',blockHash,checkpointBlockNumber:'0x2',checkpointBlockHash:blockHash,snapshotIntegrity:'0x'+'33'.repeat(32)};
(async()=>{
 for(const patch of [{version:'other'},{scope:'BFT-finality'},{transactionHash:'0x'+'44'.repeat(32)},{status:'memory_only'},{status:'not_found'},{status:'unknown'},{blockNumber:'0x02'},{checkpointBlockNumber:'0x1'},{checkpointBlockHash:'bad'},{snapshotIntegrity:'bad'}]) {
  let waits=0;
  const p={getNetwork:async()=>({chainId:6423n}),send:async(method,args)=>{assert.equal(method,'ynx_getTransactionDurability');assert.deepEqual(args,[hash]);return {...base,...patch}}};
  await assert.rejects(()=>waitForLocallyDurableReceipt(p,{hash,wait:async()=>{waits++;throw new Error('must not reach ethers receipt')}},100));assert.equal(waits,0);
 }
 let reads=0;
 await assert.rejects(()=>waitForLocallyDurableReceipt({getNetwork:async()=>({chainId:1n}),send:async()=>{reads++}},{hash},100),/network mismatch/);assert.equal(reads,0);
 const upstream=new Error('original read failed');
 await assert.rejects(()=>waitForLocallyDurableReceipt({getNetwork:async()=>({chainId:6423n}),send:async()=>{throw upstream}},{hash},100),e=>e===upstream);
 let waits=0;
 await assert.rejects(()=>waitForLocallyDurableReceipt({getNetwork:async()=>({chainId:6423n}),send:async()=>({...base,status:'pending_durable'})},{hash,wait:async()=>{waits++}},20),/deadline exceeded/);assert.equal(waits,0);
 await assert.rejects(()=>waitForLocallyDurableReceipt({getNetwork:async()=>new Promise(()=>{})},{hash},20),/deadline exceeded/);
 const receiptError=new Error('original ethers receipt still uncertain');
 await assert.rejects(()=>waitForLocallyDurableReceipt({getNetwork:async()=>({chainId:6423n}),send:async()=>base},{hash,wait:async()=>{throw receiptError}},100),e=>e===receiptError);
 console.log('ORIGINAL_DURABILITY_WAIT_REFUSALS_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});`
	output, err := exec.CommandContext(ctx, "node", "-e", controls).CombinedOutput()
	if err != nil || !strings.Contains(string(output), "ORIGINAL_DURABILITY_WAIT_REFUSALS_PASS") {
		t.Fatalf("durability wait refusal controls: %v %s", err, output)
	}
}
