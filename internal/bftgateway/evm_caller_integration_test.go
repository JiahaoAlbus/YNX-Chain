package bftgateway

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

// A synthetic local app and the actual pinned compiler artifact exercise the
// gateway, ABCI and VM; this does not create a transaction on a real chain.
func TestGatewayPinnedERC20StaticCallerIsReadOnly(t *testing.T) {
	key := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 73))
	owner, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile("../../contracts/tokens/SampleYNXTCompatibleERC20.sol")
	if err != nil {
		t.Fatal(err)
	}
	rawArtifact, err := os.ReadFile("../../artifacts/contracts/tokens/SampleYNXTCompatibleERC20.sol/SampleYNXTCompatibleERC20.json")
	if err != nil {
		t.Fatal(err)
	}
	var artifact struct {
		DeployedBytecode string `json:"deployedBytecode"`
	}
	if err := json.Unmarshal(rawArtifact, &artifact); err != nil {
		t.Fatal(err)
	}
	if _, _, err := chain.ValidateBoundedPinnedContract("SampleYNXTCompatibleERC20", strings.TrimSpace(string(source)), artifact.DeployedBytecode); err != nil {
		t.Fatal(err)
	}
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet(owner, 100); err != nil {
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
	deploy := consensus.IDEContractDeployPayload{Name: "SampleYNXTCompatibleERC20", Source: strings.TrimSpace(string(source)), DeployedBytecode: artifact.DeployedBytecode, ConstructorArgs: []string{"7"}, IdempotencyKey: "caller-readonly-fixture"}
	deploy.RequestHash = consensus.IDEDeployRequestHash(deploy.Name, deploy.Source, deploy.DeployedBytecode, deploy.ConstructorArgs, deploy.IdempotencyKey)
	var deployed struct {
		Contract consensus.BFTContract `json:"contract"`
	}
	postSignedAction(t, server.URL+"/ide/deploy", signedIDEFixture(t, key, consensus.ActionIDEContractDeploy, deploy, 1), http.StatusCreated, &deployed)
	address := deployed.Contract.Address
	if address == "" {
		t.Fatal("missing synthetic contract")
	}
	balanceCall := `{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"` + address + `","data":"0x70a08231` + strings.Repeat("0", 24) + owner[2:] + `"},"latest"]}`
	want := "0x" + strings.Repeat("0", 63) + "7"
	assertRPCResult(t, server.URL+"/evm", balanceCall, want)
	call := func(from string) string {
		t.Helper()
		object := `{"to":"` + address + `","data":"0xa9059cbb` + strings.Repeat("0", 24) + strings.Repeat("1", 40) + strings.Repeat("0", 63) + `1"`
		if from != "" {
			object += `,"from":"` + from + `"`
		}
		request := `{"jsonrpc":"2.0","id":2,"method":"eth_call","params":[` + object + `},"latest"]}`
		response, err := http.Post(server.URL+"/evm", "application/json", bytes.NewBufferString(request))
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var result struct {
			Error *struct {
				Code    int    `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.NewDecoder(response.Body).Decode(&result); err != nil || result.Error == nil || result.Error.Code != -32000 {
			t.Fatalf("unexpected static result: %+v %v", result, err)
		}
		return result.Error.Message
	}
	if got := call(""); !strings.Contains(got, "static caller context unavailable") {
		t.Fatal("missing caller was silently invented", got)
	}
	if got := call(owner); !strings.Contains(got, "SSTORE is not allowed") {
		t.Fatal("supplied caller did not reach static write guard", got)
	}
	assertRPCResult(t, server.URL+"/evm", balanceCall, want)
}
