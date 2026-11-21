package chain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/rand"
	"reflect"
	"runtime"
	"testing"
	"time"
	"unsafe"
)

func jsonOracleTransactions(t *testing.T, value []Transaction) []Transaction {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var result []Transaction
	if err = json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	return result
}
func TestConsensusMigrationDetachedTransactionsJSONEquivalencePUBLIC(t *testing.T) {
	if !transactionDetachSchema() {
		t.Fatal("original concrete schema not admitted")
	}
	t0 := time.Date(2026, 2, 3, 4, 5, 6, 123, time.UTC)
	base := Transaction{Hash: "h<&>", Type: "k", From: "f", To: "t", Amount: 4, Fee: 5, Nonce: 6, BlockHash: "b", BlockNum: 9, Timestamp: t0, LotFlows: []LotFlow{{LotID: "lot", Amount: 8, From: "from", To: "to"}}, Logs: []EVMLog{{Address: "a", Topics: []string{"", "topic"}, Data: "data", BlockHash: "bh", BlockNumber: 2, TransactionHash: "tx", TransactionIndex: 3, LogIndex: 4, Removed: true}}, Memo: "memo", Sponsor: "sp", SponsorPoolID: "pool", ResourceSource: "rs", ResourceType: "rt", ResourceConsumed: 7, ActionReference: "ar"}
	fixtures := [][]Transaction{nil, {}, {base}, {{Timestamp: t0, LotFlows: []LotFlow{}, Logs: []EVMLog{}}}, {{Timestamp: t0, Logs: []EVMLog{{Topics: []string{}}}}}}
	for i, in := range fixtures {
		got, ok := detachOrdinaryTransactions(in)
		if !ok {
			t.Fatalf("fixture %d refused", i)
		}
		want := jsonOracleTransactions(t, in)
		if !reflect.DeepEqual(want, got) {
			t.Fatalf("fixture %d differs", i)
		}
	}
	for _, bad := range []Transaction{{Timestamp: t0, Memo: string([]byte{0xff})}, {Timestamp: time.Now()}, {Timestamp: time.Date(2026, 1, 1, 0, 0, 0, 0, time.FixedZone("zone", 3600))}, {Timestamp: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}, {Timestamp: t0, Logs: []EVMLog{{Topics: []string{string([]byte{0xfe})}}}}} {
		if _, ok := detachOrdinaryTransactions([]Transaction{bad}); ok {
			t.Fatal("normalization-sensitive input did not fall back")
		}
	}
	// Ordinary valid strings can also originate in mutable caller-owned bytes.
	raw := []byte("mutable")
	v := base
	v.Memo = unsafe.String(unsafe.SliceData(raw), len(raw))
	got, ok := detachOrdinaryTransactions([]Transaction{v})
	if !ok {
		t.Fatal("unsafe fixture")
	}
	raw[0] = 'X'
	runtime.KeepAlive(raw)
	if got[0].Memo != "mutable" {
		t.Fatal("owner aliases caller bytes")
	}
}
func TestConsensusMigrationDetachedTransactionsRandomFieldsPUBLIC(t *testing.T) {
	rng := rand.New(rand.NewSource(8))
	ts := time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC)
	for i := 0; i < 1000; i++ {
		v := Transaction{Timestamp: ts, Memo: string(bytes.Repeat([]byte("X<&>"), rng.Intn(20))), Fee: rng.Int63(), LotFlows: []LotFlow{{Amount: rng.Int63(), LotID: "x"}}, Logs: []EVMLog{{Topics: []string{"", "x"}, Removed: i%2 == 0}}}
		if i%2 == 0 {
			v.LotFlows = []LotFlow{}
		}
		if i%3 == 0 {
			v.Logs[0].Topics = nil
		}
		got, ok := detachOrdinaryTransactions([]Transaction{v})
		if !ok || !reflect.DeepEqual(got, jsonOracleTransactions(t, []Transaction{v})) {
			t.Fatalf("sample %d", i)
		}
	}
}

func TestConsensusMigrationDetachedTransactionsFallbackAndDeepIsolationPUBLIC(t *testing.T) {
	when := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	cases := [][]Transaction{
		{{Timestamp: when, Memo: string([]byte{0xff, 0xfe})}},
		{{Timestamp: time.Now(), Logs: []EVMLog{{Topics: []string{"topic"}}}}},
		{{Timestamp: time.Date(2026, 1, 1, 0, 0, 0, 0, time.FixedZone("named", 3600))}},
		{{Timestamp: when, LotFlows: []LotFlow{}, Logs: []EVMLog{}}},
	}
	for i, transactions := range cases {
		source := devnetSnapshot{Blocks: []Block{{Transactions: transactions}}}
		detached, err := detachDevnetSnapshot(source)
		if err != nil {
			t.Fatalf("case %d: %v", i, err)
		}
		expected := jsonOracleTransactions(t, transactions)
		if !reflect.DeepEqual(detached.Blocks[0].Transactions, expected) {
			t.Fatalf("case %d differs from original", i)
		}
	}
	original := []Transaction{{Timestamp: when, Memo: "memo", LotFlows: []LotFlow{{LotID: "lot", From: "from", To: "to"}}, Logs: []EVMLog{{Address: "address", Topics: []string{"topic"}, Data: "data"}}}}
	detached, ok := detachOrdinaryTransactions(original)
	if !ok {
		t.Fatal("ordinary data rejected")
	}
	original[0].Memo = "mutated"
	original[0].LotFlows[0].LotID = "mutated"
	original[0].Logs[0].Address = "mutated"
	original[0].Logs[0].Topics[0] = "mutated"
	if detached[0].Memo != "memo" || detached[0].LotFlows[0].LotID != "lot" || detached[0].Logs[0].Address != "address" || detached[0].Logs[0].Topics[0] != "topic" {
		t.Fatal("source mutation reached detached owner")
	}
}

type detachSchemaGood struct {
	A string `json:"a"`
}
type detachSchemaTagChanged struct {
	A string `json:"a,omitempty"`
}
type detachSchemaTypeChanged struct {
	A []string `json:"a"`
}
type detachSchemaNameChanged struct {
	B string `json:"a"`
}
type detachSchemaCodecChanged struct {
	A string `json:"a"`
}

func (*detachSchemaCodecChanged) UnmarshalJSON([]byte) error { return nil }
func TestConsensusMigrationDetachedTransactionSchemaFailClosedPUBLIC(t *testing.T) {
	want := []transactionDetachField{{"A", "string", "a"}}
	if !transactionDetachMatches(reflect.TypeOf(detachSchemaGood{}), want) {
		t.Fatal("ordinary schema")
	}
	for _, v := range []any{detachSchemaTagChanged{}, detachSchemaTypeChanged{}, detachSchemaNameChanged{}, detachSchemaCodecChanged{}, struct {
		A string `json:"a"`
		B int    `json:"b"`
	}{}} {
		if transactionDetachMatches(reflect.TypeOf(v), want) {
			t.Fatalf("changed schema accepted: %T", v)
		}
	}
}
func TestConsensusMigrationDetachedTransactionNestedUnsafeAndFailureOrderingPUBLIC(t *testing.T) {
	backing := []byte("mutable")
	value := unsafe.String(unsafe.SliceData(backing), len(backing))
	x := []Transaction{{Timestamp: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), Hash: value, Type: value, From: value, To: value, BlockHash: value, Memo: value, Sponsor: value, SponsorPoolID: value, ResourceSource: value, ResourceType: value, ActionReference: value, LotFlows: []LotFlow{{LotID: value, From: value, To: value}}, Logs: []EVMLog{{Address: value, Topics: []string{value}, Data: value, BlockHash: value, TransactionHash: value}}}}
	result, ok := detachOrdinaryTransactions(x)
	if !ok {
		t.Fatal("valid input refused")
	}
	backing[0] = 'X'
	runtime.KeepAlive(backing)
	got := result[0]
	values := []string{got.Hash, got.Type, got.From, got.To, got.BlockHash, got.Memo, got.Sponsor, got.SponsorPoolID, got.ResourceSource, got.ResourceType, got.ActionReference, got.LotFlows[0].LotID, got.LotFlows[0].From, got.LotFlows[0].To, got.Logs[0].Address, got.Logs[0].Topics[0], got.Logs[0].Data, got.Logs[0].BlockHash, got.Logs[0].TransactionHash}
	for i, v := range values {
		if v != "mutable" {
			t.Fatalf("nested string alias %d", i)
		}
	}
	bad := []Transaction{{Timestamp: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC), Memo: string([]byte{0xff})}}
	_, oldErr := json.Marshal(bad)
	_, newErr := detachDevnetSnapshot(devnetSnapshot{Blocks: []Block{{Transactions: bad}}})
	if oldErr == nil || newErr == nil || newErr.Error() != fmt.Sprintf("detach checkpoint transactions: %v", oldErr) {
		t.Fatalf("first failure differs: %v / %v", oldErr, newErr)
	}
}
