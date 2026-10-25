package bftgateway

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

func TestGatewayPQInitialPreparedFundingRegisterTransferAndCold(t *testing.T) {
	// Normal source Faucet -> actual builder/pinned Genesis -> actual App.
	// Only Comet HTTP transport is mocked. This supplies no public Faucet URL,
	// Root, real Wallet approval, network deployment or BFT finality claim.
	f := newGatewayInitialFixturePrepared(t, true)
	originalSource, err := f.f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	sourceSender := queryPQGatewayAccount(t, f.f.a, f.f.owner)
	sourceRecipient := queryPQGatewayAccount(t, f.f.a, f.f.recipient)
	if sourceSender.Balance != 100 || sourceSender.Nonce != 0 || sourceSender.ResourceUsage != (chain.ResourceUsage{}) || len(sourceSender.Lots) != 1 {
		t.Fatal("normal source funding is not a fresh Faucet recipient", sourceSender)
	}
	policy := initialAuthorization(t, f.f.a, f.f.owner)
	if policy.PQSigningEnabled || policy.LedgerNonce != 0 || policy.Policy == nil || len(policy.Policy.Records) != 0 {
		t.Fatal("funding created signing authorization before explicit birth")
	}
	server := gatewayPQServer(t, f.mock)
	code, registered := pqMemberPOST(t, server.URL, "/accounts/"+f.f.owner+"/authorization/register", f.f.wire)
	if code != http.StatusOK {
		t.Fatal("prepared initial registration failed", code, registered)
	}
	assertInitialMember(t, f, registered)
	afterRegistration := queryPQGatewayAccount(t, f.f.a, f.f.owner)
	if afterRegistration.Balance != 100 || afterRegistration.Nonce != 1 || afterRegistration.Staked != 0 ||
		afterRegistration.ResourceUsage != (chain.ResourceUsage{BandwidthUsed: 1}) || !reflect.DeepEqual(afterRegistration.Lots, sourceSender.Lots) ||
		!reflect.DeepEqual(sourceRecipient, queryPQGatewayAccount(t, f.f.a, f.f.recipient)) {
		t.Fatal("birth changed source funding, lots or another account", afterRegistration)
	}
	var fees []consensus.BFTFeeEvent
	if err := json.Unmarshal(initialApplicationBytes(t, f.f.a, "/economics/fees"), &fees); err != nil || len(fees) != 0 {
		t.Fatal("birth charged fees instead of preserving prepared funds", fees, err)
	}
	for _, route := range []string{registered.ReadbackURL, "/txs/" + registered.ABCITransactionHash} {
		code, read := pqMemberGET(t, server.URL+route)
		if code != http.StatusOK || !reflect.DeepEqual(read, registered) {
			t.Fatal("registration original differs", code, read)
		}
	}
	// At the next actual execution height the original complete pair becomes
	// active. Use the normal transfer message, fee and consecutive account nonce.
	policy = initialAuthorization(t, f.f.a, f.f.owner)
	if !policy.PQSigningEnabled || policy.ExecutionHeight != 3 || policy.LedgerNonce != 1 || policy.Policy == nil || len(policy.Policy.Records) != 1 {
		t.Fatal("prepared account did not acquire its exact normal next-height policy")
	}
	transferWire := signGatewayMember(t, f.f.key, f.f.network, f.f.owner, ynxauth.TransactionPurpose, f.f.message(t, 2, 7))
	setGatewayMemberOriginal(t, f.mock, consensus.PQTransferType, transferWire, 3)
	code, transfer := pqMemberPOST(t, server.URL, "/transactions/pq/broadcast", transferWire)
	if code != http.StatusOK {
		t.Fatal("funded ordinary PQ transfer failed", code, transfer)
	}
	assertGatewayMemberCommit(t, transfer, transferWire, f.f.payload, 3, f.f.owner, f.f.recipient, 7, 2)
	afterTransfer := queryPQGatewayAccount(t, f.f.a, f.f.owner)
	afterRecipient := queryPQGatewayAccount(t, f.f.a, f.f.recipient)
	if afterTransfer.Balance != 92 || afterTransfer.Nonce != 2 || afterTransfer.ResourceUsage != (chain.ResourceUsage{BandwidthUsed: 2}) ||
		afterRecipient.Balance != sourceRecipient.Balance+7 || afterRecipient.Nonce != sourceRecipient.Nonce {
		t.Fatal("ordinary fee/amount/nonce differs from actual execution", afterTransfer, afterRecipient)
	}
	var moved int64
	for id, amount := range sourceSender.Lots {
		delta := amount - afterTransfer.Lots[id]
		if delta < 0 || afterRecipient.Lots[id]-sourceRecipient.Lots[id] != delta {
			t.Fatal("normal transfer lost original lot lineage")
		}
		moved += delta
	}
	if moved != 7 {
		t.Fatal("normal transfer changed the original principal-lot semantics", moved)
	}
	if err := json.Unmarshal(initialApplicationBytes(t, f.f.a, "/economics/fees"), &fees); err != nil || len(fees) != 1 ||
		fees[0].TxHash != transfer.ABCITransactionHash || fees[0].GrossFeeYNXT != 1 || fees[0].Payer != f.f.owner || fees[0].BlockHeight != 3 {
		t.Fatal("ordinary transfer did not retain its actual one-unit fee event", fees, err)
	}
	for _, route := range []string{transfer.ReadbackURL, "/txs/" + transfer.ABCITransactionHash} {
		code, read := pqMemberGET(t, server.URL+route)
		if code != http.StatusOK || !reflect.DeepEqual(read, transfer) {
			t.Fatal("funded transfer original differs", code, read)
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
	for _, tc := range []struct {
		route    string
		original PQMemberView
	}{
		{registered.ReadbackURL, registered}, {"/txs/" + registered.ABCITransactionHash, registered},
		{transfer.ReadbackURL, transfer}, {"/txs/" + transfer.ABCITransactionHash, transfer},
	} {
		code, read := pqMemberGET(t, server.URL+tc.route)
		if code != http.StatusOK || !reflect.DeepEqual(read, tc.original) {
			t.Fatal("cold original readback changed", code, read)
		}
	}
	if got := queryPQGatewayAccount(t, cold, f.f.owner); !reflect.DeepEqual(got, afterTransfer) || got.Balance != 92 || got.Nonce != 2 {
		t.Fatal("cold restart lost funded ordinary transaction effects", got)
	}
	if got := queryPQGatewayAccount(t, cold, f.f.recipient); !reflect.DeepEqual(got, afterRecipient) {
		t.Fatal("cold restart lost recipient state", got)
	}
	afterDisk, err := os.ReadFile(f.path)
	if err != nil {
		t.Fatal(err)
	}
	afterInfo, err := os.Stat(f.path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(disk, afterDisk) || !os.SameFile(info, afterInfo) || !info.ModTime().Equal(afterInfo.ModTime()) {
		t.Fatal("cold queries rewrote the original checkpoint")
	}
	afterSource, err := f.f.migration.CanonicalJSON()
	if err != nil || !bytes.Equal(originalSource, afterSource) {
		t.Fatal("birth/transfer rewrote the source migration")
	}
	f.mock.mu.Lock()
	defer f.mock.mu.Unlock()
	if f.mock.posts != 2 {
		t.Fatal("readback or cold restart resent a signed original", f.mock.posts)
	}
}
