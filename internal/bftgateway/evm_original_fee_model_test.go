package bftgateway

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
)

func TestOriginalFeeModelConfiguredABCIObservation(t *testing.T) {
	f := newPQIdentityFixture(t, func(d *chain.Devnet) {
		if err := d.EnableAccountPQ(2); err != nil {
			t.Fatal(err)
		}
	})
	_, server := identityGateway(t, f)
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"ynx_getFeeModel","params":[]}`)
	response, err := http.Post(server.URL+"/evm", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || len(raw) > 8192 {
		t.Fatalf("unexpected HTTP or response size %d %d", response.StatusCode, len(raw))
	}
	var envelope struct {
		Result struct {
			Version     string                                `json:"version"`
			Enabled     bool                                  `json:"enabled"`
			ChainID     string                                `json:"chainId"`
			Fee         string                                `json:"feeWei"`
			Gas         string                                `json:"gas"`
			Price       string                                `json:"gasPrice"`
			Quantum     string                                `json:"amountQuantumWei"`
			Durability  json.RawMessage                       `json:"durability"`
			Observation consensus.EthereumOriginalObservation `json:"ynxBFTObservation"`
		} `json:"result"`
		Error any `json:"error"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	v := envelope.Result
	if envelope.Error != nil || v.Version != "ynx-ethereum-native-v1" || !v.Enabled || v.ChainID != "0x1917" || v.Fee != "0xde0b6b3a7640000" || v.Gas != "0x61a8" || v.Price != "0x246139ca8000" || v.Quantum != v.Fee || len(v.Durability) != 0 {
		t.Fatalf("wrong old adapter model: %s", raw)
	}
	if err := consensus.ValidateEthereumOriginalObservation(v.Observation, f.stateHeight); err != nil || v.Observation.CommittedAppHash != f.stateHash || v.Observation.NativeGenesisHash != f.pins.OriginalGenesisHash || v.Observation.CometGenesisSHA256 != f.pins.CometGenesisSHA256 || v.Observation.MigrationStateHash != f.pins.MigrationStateHash {
		t.Fatalf("wrong configured-node identity: %s (%v)", raw, err)
	}
	for name, mutate := range map[string]func(*consensus.EthereumOriginalObservation){
		"wrong version":               func(o *consensus.EthereumOriginalObservation) { o.Version = "old" },
		"wrong source":                func(o *consensus.EthereumOriginalObservation) { o.Source = "independent" },
		"wrong height":                func(o *consensus.EthereumOriginalObservation) { o.CommittedHeight++ },
		"wrong chain":                 func(o *consensus.EthereumOriginalObservation) { o.CometChainID = "other" },
		"bad root":                    func(o *consensus.EthereumOriginalObservation) { o.CommittedAppHash = "00" },
		"no policy":                   func(o *consensus.EthereumOriginalObservation) { o.PolicyEnableAt = 0 },
		"claims authorization":        func(o *consensus.EthereumOriginalObservation) { o.AccountAuthorizationRequired = false },
		"claims independent finality": func(o *consensus.EthereumOriginalObservation) { o.IndependentFinality = true },
	} {
		t.Run(name, func(t *testing.T) {
			invalid := v.Observation
			mutate(&invalid)
			if consensus.ValidateEthereumOriginalObservation(invalid, f.stateHeight) == nil {
				t.Fatal("invalid observation accepted")
			}
		})
	}
	for _, params := range []string{`null`, `{}`, `[1]`} {
		assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":1,"method":"ynx_getFeeModel","params":`+params+`}`, -32602)
	}
	for _, req := range []*abci.RequestQuery{{Path: consensus.EthereumOriginalCapabilityPath, Prove: true}, {Path: consensus.EthereumOriginalCapabilityPath, Height: f.stateHeight + 1}, {Path: consensus.EthereumOriginalCapabilityPath, Data: []byte("x")}} {
		result, err := f.app.Query(context.Background(), req)
		if err != nil || result.Code == 0 || len(result.Value) != 0 {
			t.Fatalf("unsupported query accepted: %+v %v", result, err)
		}
	}
}

func TestOriginalFeeModelMissingPolicyFailsClosed(t *testing.T) {
	f := newPQIdentityFixture(t)
	_, server := identityGateway(t, f)
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":1,"method":"ynx_getFeeModel","params":[]}`, -32004)
	f.mode = "no-bootstrap"
	assertRPCError(t, server.URL+"/evm", `{"jsonrpc":"2.0","id":1,"method":"ynx_getFeeModel","params":[]}`, -32004)
}
