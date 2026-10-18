package consensus

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"

	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/merkle"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

// These are original Comet proof builders, not replacement JSON fixtures or
// trusted consensus data. The existing signed-header tests verify that layer.
func TestPQTransactionProofSingleLeafCometCodec(t *testing.T) {
	txs := cmttypes.Txs{cmttypes.Tx("original single transaction")}
	txRaw, err := cmtjson.Marshal(txs.Proof(0))
	if err != nil {
		t.Fatal(err)
	}
	results := []*abci.ExecTxResult{{Code: 0, Data: []byte("original deterministic execution"), GasWanted: 3, GasUsed: 2}}
	resultRaw, resultProof, err := EncodePQTransactionExecutionProof(results, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		raw    []byte
		decode func([]byte) error
	}{
		{"transaction", txRaw, func(raw []byte) error {
			var proof cmttypes.TxProof
			if err := pqTransactionComet(raw, &proof, MaxPQTransactionTxProofBytes); err != nil {
				return err
			}
			return proof.Validate(txs.Hash())
		}},
		{"execution", resultProof, func(raw []byte) error {
			var proof merkle.Proof
			if err := pqTransactionComet(raw, &proof, MaxPQTransactionExecutionProofBytes); err != nil {
				return err
			}
			return proof.Verify(cmttypes.NewResults(results).Hash(), resultRaw)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if !bytes.Contains(tc.raw, []byte(`"aunts":[]`)) {
				t.Fatal("original Comet single-leaf encoder did not expose the actual empty path")
			}
			if err := tc.decode(tc.raw); err != nil {
				t.Fatal("original single-leaf Comet proof was rejected", err)
			}
			if err := tc.decode(bytes.Replace(tc.raw, []byte(`"aunts":[]`), []byte("\"aunts\":[ \n ]"), 1)); err != nil {
				t.Fatal("ordinary JSON whitespace changed the proof", err)
			}
			for _, change := range []struct{ name, before, after string }{
				{"unknown", `"total":"1"`, `"unknown":true,"total":"1"`},
				{"missing-total", `"total":"1",`, ``},
				{"missing-index", `"index":"0",`, ``},
				{"duplicate", `"index":"0"`, `"index":"0","index":"0"`},
				{"numeric-total", `"total":"1"`, `"total":1`},
				{"noncanonical-total", `"total":"1"`, `"total":"01"`},
				{"wrong-total", `"total":"1"`, `"total":"2"`},
				{"zero-total", `"total":"1"`, `"total":"0"`},
				{"wrong-index", `"index":"0"`, `"index":"1"`},
				{"negative-index", `"index":"0"`, `"index":"-1"`},
				{"null-aunts", `"aunts":[]`, `"aunts":null`},
				{"object-aunts", `"aunts":[]`, `"aunts":{}`},
				{"bad-base64", `"aunts":[]`, `"aunts":["!"]`},
				{"empty-aunt", `"aunts":[]`, `"aunts":[""]`},
				{"extra-aunt", `"aunts":[]`, `"aunts":["` + base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32)) + `"]`},
			} {
				t.Run(change.name, func(t *testing.T) {
					if bytes.Count(tc.raw, []byte(change.before)) != 1 {
						t.Fatal("negative fixture did not match the original Comet field")
					}
					bad := bytes.Replace(tc.raw, []byte(change.before), []byte(change.after), 1)
					if err := tc.decode(bad); err == nil {
						t.Fatal("malformed or false single-leaf proof accepted")
					}
				})
			}
			if err := tc.decode(append(bytes.Clone(tc.raw), []byte(`{}`)...)); err == nil {
				t.Fatal("trailing proof JSON accepted")
			}
		})
	}
}

func TestPQTransactionProofCometCodecPreservesNonemptyPaths(t *testing.T) {
	txs := cmttypes.Txs{cmttypes.Tx("first"), cmttypes.Tx("second")}
	for index := range txs {
		original := txs.Proof(index)
		raw, err := cmtjson.Marshal(original)
		var proof cmttypes.TxProof
		if err != nil || pqTransactionComet(raw, &proof, MaxPQTransactionTxProofBytes) != nil || proof.Validate(txs.Hash()) != nil || len(proof.Proof.Aunts) != 1 || !bytes.Equal(proof.Proof.Aunts[0], original.Proof.Aunts[0]) {
			t.Fatal("valid multi-leaf path was changed", err)
		}
	}
	// A nil omitempty field remains the original legal codec form. Only an
	// explicitly encoded empty array needs restoration; null is not equivalent.
	single := cmttypes.Txs{cmttypes.Tx("single")}
	proof := single.Proof(0)
	proof.Proof.Aunts = nil
	raw, err := cmtjson.Marshal(proof)
	var decoded cmttypes.TxProof
	if err != nil || strings.Contains(string(raw), `"aunts"`) || pqTransactionComet(raw, &decoded, MaxPQTransactionTxProofBytes) != nil || decoded.Proof.Aunts != nil || decoded.Validate(single.Hash()) != nil {
		t.Fatal("original omitted nil path semantics changed", err)
	}
}
