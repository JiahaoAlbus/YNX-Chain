//go:build unix

package consensus

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/p2p"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
)

// Controlled HTTP is only a transport observation, never a synthetic node or
// signing authority. Complete checkpoint/DB/AND behavior is exercised separately.
func TestPQLabDistributedReadbackQuietRequiresOriginalCoordinates(t *testing.T) {
	state := CommittedState{Height: 8, AppHash: strings.Repeat("12", 32)}
	hash, _ := hex.DecodeString(state.AppHash)
	status := coretypes.ResultStatus{NodeInfo: p2p.DefaultNodeInfo{DefaultNodeID: "synthetic-observation", Network: "synthetic-chain"}, SyncInfo: coretypes.SyncInfo{LatestBlockHeight: 8}}
	info := coretypes.ResultABCIInfo{Response: abci.ResponseInfo{Data: ApplicationName, LastBlockHeight: 8, LastBlockAppHash: hash}}
	statusRaw, err := cmtjson.Marshal(&status)
	if err != nil {
		t.Fatal(err)
	}
	infoRaw, err := cmtjson.Marshal(&info)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"valid", "catching_up", "missing_catching_up", "wrong_height", "header_hash_instead_of_app_hash", "wrong_node", "rpc_error", "redirect"} {
		t.Run(name, func(t *testing.T) {
			var observedStatus map[string]any
			var observedInfo map[string]any
			if json.Unmarshal(statusRaw, &observedStatus) != nil || json.Unmarshal(infoRaw, &observedInfo) != nil {
				t.Fatal("observation setup")
			}
			sync := observedStatus["sync_info"].(map[string]any)
			switch name {
			case "catching_up":
				sync["catching_up"] = true
			case "missing_catching_up":
				delete(sync, "catching_up")
			case "wrong_height":
				sync["latest_block_height"] = "9"
			case "header_hash_instead_of_app_hash":
				observedInfo["response"].(map[string]any)["last_block_app_hash"] = strings.Repeat("00", 32)
			case "wrong_node":
				observedStatus["node_info"].(map[string]any)["id"] = "another-node"
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if name == "redirect" {
					w.Header().Set("Location", "/not-followed")
					w.WriteHeader(http.StatusFound)
					return
				}
				value := any(observedStatus)
				if r.URL.Path == "/abci_info" {
					value = observedInfo
				}
				body := map[string]any{"jsonrpc": "2.0", "id": -1, "result": value}
				if name == "rpc_error" {
					body["error"] = map[string]any{"code": -32603, "message": "original observation unavailable"}
				}
				_ = json.NewEncoder(w).Encode(body)
			}))
			defer server.Close()
			local := &PQLabDistributedLocal{plan: PQLabDistributedPlan{ChainID: "synthetic-chain"}, node: PQLabNetworkNode{NodeID: "synthetic-observation", RPCAddress: server.URL}}
			result, err := pqDistributedQuiet(context.Background(), local, state)
			if name == "valid" {
				if err != nil || result.Height != state.Height || result.AppHash != state.AppHash || result.CatchingUp {
					t.Fatal("complete same-coordinate observation", err)
				}
			} else if err == nil {
				t.Fatal("invalid observation accepted as quiet")
			}
		})
	}
}
