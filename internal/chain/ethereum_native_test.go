package chain

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
)

func ethereumFixture(t *testing.T, name string) ([]byte, ethnative.Transfer) {
	t.Helper()
	data, err := os.ReadFile("../../testdata/ethereum-native/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct{ Vectors []struct{ Name, Raw string } }
	if err = json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, v := range fixture.Vectors {
		if v.Name == name {
			raw, _ := hex.DecodeString(strings.TrimPrefix(v.Raw, "0x"))
			eth, err := ethnative.Verify(raw, 6423)
			if err != nil {
				t.Fatal(err)
			}
			return raw, eth
		}
	}
	t.Fatal("fixture absent")
	return nil, ethnative.Transfer{}
}
func ethereumInput(raw []byte, eth ethnative.Transfer) SignedTransferInput {
	return SignedTransferInput{Hash: eth.Hash, From: eth.From, To: eth.To, Amount: eth.Amount, Fee: 1, Nonce: eth.Nonce + 1, EthereumRaw: raw}
}

func TestEthereumAdmissionVerifiesFieldsAndExactLedgerCharge(t *testing.T) {
	raw, eth := ethereumFixture(t, "valid")
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet(eth.From, 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	input := ethereumInput(raw, eth)
	if _, _, err := d.SubmitSignedTransfer(input); err == nil {
		t.Fatal("disabled adapter accepted a transaction")
	}
	if err := d.SetEthereumNativeTransfers(true); err != nil {
		t.Fatal(err)
	}
	before, _ := d.ReplicationSnapshotJSON()
	for _, field := range []string{"hash", "from", "to", "amount", "fee", "nonce", "raw"} {
		bad := input
		switch field {
		case "hash":
			bad.Hash = "0x" + strings.Repeat("1", 64)
		case "from":
			bad.From = eth.To
		case "to":
			bad.To = eth.From
		case "amount":
			bad.Amount++
		case "fee":
			bad.Fee++
		case "nonce":
			bad.Nonce++
		case "raw":
			bad.EthereumRaw = []byte{0xc0}
		}
		if _, _, err := d.SubmitSignedTransfer(bad); err == nil {
			t.Fatalf("tampered %s accepted", field)
		}
	}
	// SavedAt changes per serialization; compare the actual authoritative state.
	var old, newer devnetSnapshot
	_ = json.Unmarshal(before, &old)
	after, _ := d.ReplicationSnapshotJSON()
	_ = json.Unmarshal(after, &newer)
	if newer.Accounts[eth.From].Balance != old.Accounts[eth.From].Balance || len(newer.Pending) != len(old.Pending) {
		t.Fatal("rejected input mutated ledger")
	}
	supply := int64(0)
	for _, a := range d.accounts {
		supply += a.Balance
	}
	tx, replayed, err := d.SubmitSignedTransfer(input)
	if err != nil || replayed {
		t.Fatalf("submit: %v %v", err, replayed)
	}
	sender, _ := d.Account(eth.From)
	receiver, _ := d.Account(eth.To)
	if sender.Balance != 97 || receiver.Balance != 2 || sender.Nonce != 1 || tx.Fee != 1 {
		t.Fatalf("inexact fee/value application: sender=%+v recipient=%+v tx=%+v", sender, receiver, tx)
	}
	afterSupply := int64(0)
	for _, a := range d.accounts {
		afterSupply += a.Balance
	}
	if supply != afterSupply {
		t.Fatal("transfer changed supply")
	}
	if _, replayed, err := d.SubmitSignedTransfer(input); err != nil || !replayed {
		t.Fatalf("same raw replay: %v %v", replayed, err)
	}
	sender, _ = d.Account(eth.From)
	if sender.Balance != 97 || sender.Nonce != 1 {
		t.Fatal("replay charged twice")
	}
	if err := NewDevnet(DefaultNetworkConfig("mainnet")).SetEthereumNativeTransfers(true); err == nil {
		t.Fatal("mainnet adapter enabled")
	}
}

func TestEthereumPersistenceReplicationAndDisabledRollback(t *testing.T) {
	raw, eth := ethereumFixture(t, "valid")
	cfg := DefaultNetworkConfig("testnet")
	dir := t.TempDir()
	d, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	_ = d.SetEthereumNativeTransfers(true)
	_, _ = d.Faucet(eth.From, 100)
	d.ProduceBlock()
	_, _, err = d.SubmitSignedTransfer(ethereumInput(raw, eth))
	if err != nil {
		t.Fatal(err)
	}
	// Pending envelope survives restart before inclusion, and verifies with the
	// feature gate off, so rollback never needs to restore an old balance image.
	restarted, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.EthereumNativeTransfersEnabled() {
		t.Fatal("feature gate persisted unexpectedly")
	}
	if tx, ok := restarted.Transaction(eth.Hash); !ok || tx.Nonce != 1 || tx.Memo != ethnative.MemoPrefix+hex.EncodeToString(raw) {
		t.Fatal("pending raw lost at restart")
	}
	restarted.ProduceBlock()
	snapshot, err := restarted.ReplicationSnapshotJSON()
	if err != nil {
		t.Fatal(err)
	}
	follower, err := NewPersistentDevnet(cfg, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = follower.ApplyReplicationSnapshotJSON(snapshot, true); err != nil {
		t.Fatal(err)
	}
	if tx, ok := follower.Transaction(eth.Hash); !ok || tx.BlockNum == 0 || tx.Amount != 2 {
		t.Fatal("replication lost Ethereum transaction")
	}
	var tampered devnetSnapshot
	_ = json.Unmarshal(snapshot, &tampered)
	for i := range tampered.Blocks {
		for j := range tampered.Blocks[i].Transactions {
			if tampered.Blocks[i].Transactions[j].Hash == eth.Hash {
				tampered.Blocks[i].Transactions[j].Amount++
			}
		}
	}
	tampered, err = sealDevnetSnapshot(tampered)
	if err != nil {
		t.Fatal(err)
	}
	tamperedBytes, _ := json.Marshal(tampered)
	if _, err = follower.ApplyReplicationSnapshotJSON(tamperedBytes, true); err == nil {
		t.Fatal("resealed normalized transaction tampering bypassed original Ethereum signature")
	}
	// Continue native traffic after disabling Ethereum admission: no nonce reset.
	_, _, err = follower.SubmitSignedTransfer(SignedTransferInput{Hash: "0x" + strings.Repeat("a", 64), From: eth.From, To: eth.To, Amount: 1, Fee: 1, Nonce: 2})
	if err != nil {
		t.Fatal("native continuation after rollback failed:", err)
	}
}

func TestEthereumGasBudgetAndContractRejection(t *testing.T) {
	raw, eth := ethereumFixture(t, "padded_gas")
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	_ = d.SetEthereumNativeTransfers(true)
	_, _ = d.Faucet(eth.From, 3)
	d.ProduceBlock()
	if _, _, err := d.SubmitSignedTransfer(ethereumInput(raw, eth)); err == nil {
		t.Fatal("gasLimit budget above balance accepted")
	}
	_, _ = d.Faucet(eth.From, 10)
	d.contracts[eth.To] = ContractArtifact{Address: eth.To}
	if _, _, err := d.SubmitSignedTransfer(ethereumInput(raw, eth)); err == nil {
		t.Fatal("contract transfer accepted")
	}
}
