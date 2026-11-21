package bftgateway

import (
	"net/http/httptest"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestOriginalNativeEthereumEstimateWei(t *testing.T) {
	from, err := consensus.NativeAddress(secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 71)).PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	to := "0x3535353535353535353535353535353535353535"
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet(from, 4); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := consensus.NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(newABCICometFixture(t, app, int64(migration.Height)))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()
	call := func(fields string) string {
		return `{"jsonrpc":"2.0","id":1,"method":"eth_estimateGas","params":[{"from":"` + from + `","to":"` + to + `",` + fields + `}]}`
	}
	assertRPCResult(t, server.URL+"/evm", call(`"value":"0x1bc16d674ec80000"`), "0x61a8")
	assertRPCResult(t, server.URL+"/evm", call(`"value":"0x1bc16d674ec80000","gas":"0x7530","gasPrice":"0x246139ca8000"`), "0x61a8")
	assertRPCError(t, server.URL+"/evm", call(`"value":"0x1"`), -32000)
	assertRPCError(t, server.URL+"/evm", call(`"value":"0x1bc16d674ec80000","gas":"0x5208"`), -32004)
	assertRPCError(t, server.URL+"/evm", call(`"value":"0x29a2241af62c0000","gas":"0x7530"`), -32000)
	assertRPCError(t, server.URL+"/evm", call(`"value":"0x1bc16d674ec80000","maxFeePerGas":"0x2"`), -32004)
}
