package bftgateway

import (
	"bytes"
	"encoding/base64"
	"testing"

	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

func TestPQFinalityRPCSingleLeafOriginalCometCodec(t *testing.T) {
	txs := cmttypes.Txs{cmttypes.Tx("original single transaction")}
	original := coretypes.ResultTx{Hash: txs[0].Hash(), Height: 9, Index: 0, Tx: txs[0], TxResult: abci.ExecTxResult{Code: 0, Data: []byte("original result"), GasWanted: 3, GasUsed: 2}, Proof: txs.Proof(0)}
	raw, err := cmtjson.Marshal(&original)
	if err != nil || !bytes.Contains(raw, []byte(`"aunts":[]`)) {
		t.Fatal("actual Comet single-leaf RPC encoding unavailable", err)
	}
	decode := func(raw []byte) error {
		var result coretypes.ResultTx
		if err := pqFinalityDecode(raw, &result); err != nil {
			return err
		}
		if !bytes.Equal(result.Hash, original.Hash) || !bytes.Equal(result.Tx, original.Tx) || result.Height != original.Height || result.Index != 0 || !bytes.Equal(result.TxResult.Data, original.TxResult.Data) {
			t.Fatal("proof codec changed actual RPC identity or deterministic result")
		}
		return result.Proof.Validate(txs.Hash())
	}
	if err := decode(raw); err != nil {
		t.Fatal("actual single-leaf ResultTx was rejected", err)
	}
	for _, change := range []struct{ name, before, after string }{
		{"unknown", `"total":"1"`, `"extra":true,"total":"1"`},
		{"missing-index", `"index":"0",`, ``},
		{"missing-height", `"height":"9",`, ``},
		{"duplicate", `"index":"0"`, `"index":"0","index":"0"`},
		{"numeric-total", `"total":"1"`, `"total":1`},
		{"wrong-total", `"total":"1"`, `"total":"2"`},
		{"wrong-index", `"index":"0"`, `"index":"1"`},
		{"null", `"aunts":[]`, `"aunts":null`},
		{"bad-base64", `"aunts":[]`, `"aunts":["!"]`},
		{"nonempty", `"aunts":[]`, `"aunts":["` + base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32)) + `"]`},
	} {
		t.Run(change.name, func(t *testing.T) {
			if bytes.Count(raw, []byte(change.before)) != 1 {
				t.Fatal("negative did not match the real Comet RPC bytes")
			}
			if err := decode(bytes.Replace(raw, []byte(change.before), []byte(change.after), 1)); err == nil {
				t.Fatal("invalid RPC proof accepted")
			}
		})
	}
}

func TestPQFinalityRPCEmptyAuntsCompatibilityIsProofOnly(t *testing.T) {
	var unrelated struct {
		Values []string `json:"values,omitempty"`
	}
	if err := pqFinalityDecode([]byte(`{"values":[]}`), &unrelated); err == nil {
		t.Fatal("single-leaf compatibility generalized to unrelated empty arrays")
	}
	// The real two-leaf path remains byte exact and passes the same root check.
	txs := cmttypes.Txs{cmttypes.Tx("first"), cmttypes.Tx("second")}
	original := coretypes.ResultTx{Hash: txs[1].Hash(), Height: 9, Index: 1, Tx: txs[1], Proof: txs.Proof(1)}
	raw, err := cmtjson.Marshal(&original)
	var decoded coretypes.ResultTx
	if err != nil || pqFinalityDecode(raw, &decoded) != nil || decoded.Proof.Validate(txs.Hash()) != nil || len(decoded.Proof.Proof.Aunts) != 1 || !bytes.Equal(decoded.Proof.Proof.Aunts[0], original.Proof.Proof.Aunts[0]) {
		t.Fatal("existing nonempty RPC Merkle path changed", err)
	}
}
