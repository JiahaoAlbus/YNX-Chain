package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/receipt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func commandDigest(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

// This generates the original CORE owner's public signed QA fixture through its
// existing export entry. It never changes CORE source or treats QA roots as a
// deployed Host/Native grant. One function regression exercises the real normal
// executable, private pinned invocation and helper HTTP route together.
func TestP09OriginalCommandReceiptFlow(t *testing.T) {
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(dir, "original-core-verifier")
	build := exec.Command("go", "build", "-mod=readonly", "-p", "1", "-o", binary, "./cmd/ynx-consensus-proof-verify")
	build.Dir = root
	build.Env = append(os.Environ(), "GOMAXPROCS=2")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("original executable: %v %s", err, output)
	}
	fixturePath := filepath.Join(dir, "public-pq-fixture.json")
	generate := exec.Command("go", "test", "-mod=readonly", "-p", "1", "./internal/consensus", "-run", "^TestPQConsensusTransactionProofPublicFixture$", "-count=1")
	generate.Dir = root
	generate.Env = append(os.Environ(), "GOMAXPROCS=2", "YNX_PQ_TRANSACTION_PROOF_FIXTURE_OUT="+fixturePath)
	if output, err := generate.CombinedOutput(); err != nil {
		t.Fatalf("original signed QA export: %v %s", err, output)
	}
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		SyntheticOnly bool `json:"syntheticOnly"`
		Materials     []struct {
			Name   string `json:"name"`
			Bytes  []byte `json:"bytes"`
			SHA256 string `json:"sha256"`
		} `json:"materials"`
		Parameters map[string]string `json:"trustContextParameters"`
		Files      map[string]string `json:"trustContextFiles"`
		Cases      []struct {
			Name     string          `json:"name"`
			Expected json.RawMessage `json:"expectedTransaction"`
			Request  json.RawMessage `json:"request"`
			Response json.RawMessage `json:"expectedResponse"`
		} `json:"cases"`
	}
	if json.Unmarshal(raw, &f) != nil || !f.SyntheticOnly || len(f.Cases) != 3 {
		t.Fatal("not original signed isolated fixture")
	}
	for _, m := range f.Materials {
		if filepath.Base(m.Name) != m.Name || commandDigest(m.Bytes) != m.SHA256 {
			t.Fatal("material identity")
		}
		if err := os.WriteFile(filepath.Join(dir, m.Name), m.Bytes, 0600); err != nil {
			t.Fatal(err)
		}
	}
	for field, name := range f.Files {
		f.Parameters[field] = filepath.Join(dir, name)
	}
	code, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	for i, c := range f.Cases {
		t.Run(c.Name, func(t *testing.T) {
			contextBytes, _ := json.Marshal(map[string]any{"version": "YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1", "lightTrust": f.Parameters, "expectedTransaction": json.RawMessage(c.Expected)})
			path := filepath.Join(dir, "context-"+strconv.Itoa(i)+".json")
			if err := os.WriteFile(path, contextBytes, 0600); err != nil {
				t.Fatal(err)
			}
			v, err := receipt.OpenPQCommandVerifier(binary, commandDigest(code), path, commandDigest(contextBytes))
			if err != nil {
				t.Fatal(err)
			}
			defer v.Close()
			var req struct {
				Proof json.RawMessage `json:"proof"`
			}
			if err := json.Unmarshal(c.Request, &req); err != nil {
				t.Fatal(err)
			}
			var expected struct {
				TransactionHash string `json:"transactionHash"`
				NativeWireHash  string `json:"nativeWireHash"`
				Index           string `json:"index"`
				Block           struct {
					HeaderHeight string `json:"headerHeight"`
				} `json:"block"`
			}
			if err := json.Unmarshal(c.Expected, &expected); err != nil {
				t.Fatal(err)
			}
			index, err := strconv.ParseUint(expected.Index, 10, 32)
			if err != nil {
				t.Fatal(err)
			}
			collector := map[string]any{"version": receipt.PQCollectorVersion, "source": "original-core-controlled-QA", "status": "collected", "nativeTransactionHash": expected.NativeWireHash, "abciTransactionHash": expected.TransactionHash, "executionHeight": expected.Block.HeaderHeight, "cometIndex": index, "independentFinality": false, "proofVerification": "not-performed", "proof": req.Proof}
			body, _ := json.Marshal(collector)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/txs/0x"+expected.NativeWireHash+"/pq-finality-proof" {
					http.NotFound(w, r)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				w.Write(body)
			}))
			defer upstream.Close()
			h, s := fixture(t, upstream.URL)
			h.pqCommand = v
			ticket := pair(t, s)
			status, out := call(t, s, "/api/lookup-proof", s.URL, ticket, map[string]string{"txId": expected.TransactionHash})
			view, ok := out["view"].(map[string]any)
			if status != 200 || !ok || view["level"] != "INCLUSION_VERIFIED" || view["abciResultVerified"] != true || view["fundsVerified"] != false || view["nativeGrant"] != false {
				t.Fatalf("original functional flow: %d %+v", status, out)
			}
			want := []string{"succeeded", "rejected", "partial"}[i]
			if view["executionOutcome"] != want {
				t.Fatalf("lost terminal outcome: %+v", view)
			}
			if i == 2 {
				var original struct {
					Result consensus.PQTransactionProofResult `json:"result"`
				}
				if err := json.Unmarshal(c.Response, &original); err != nil {
					t.Fatal(err)
				}
				found := false
				for _, member := range original.Result.BatchResults {
					if member.Outcome != "admitted" {
						continue
					}
					found = true
					status, out := call(t, s, "/api/lookup-proof", s.URL, ticket, map[string]string{"txId": member.TransactionHash})
					v := out["view"].(map[string]any)
					if status != 200 || v["selectedMemberResultVerified"] != true || v["selectedMemberOutcome"] != "admitted" || v["fundsVerified"] != false {
						t.Fatalf("selected member lost true outcome: %d %+v", status, out)
					}
					break
				}
				if !found {
					t.Fatal("original partial fixture omitted admitted member")
				}
			}
			// Local configuration is captured; changing the selected context cannot
			// retarget the immutable invocation after startup.
			os.WriteFile(path, []byte(`{"untrusted":true}`), 0600)
			if result := v.Verify(context.Background(), strings.Repeat("f", 64), body); result.Level != receipt.RPCOnly {
				t.Fatal("peer selected target")
			}
			cancelled, cancel := context.WithCancel(context.Background())
			cancel()
			if result := v.Verify(cancelled, expected.TransactionHash, body); result.Level != receipt.RPCOnly {
				t.Fatal("cancelled proof published")
			}
			if i == 0 {
				changed := bytes.Replace(body, []byte(`"proofVerification":"not-performed"`), []byte(`"proofVerification":"verified"`), 1)
				// Collector assertions do not authenticate data. Remove the actual
				// proof while retaining peer success claims.
				collector["proof"] = json.RawMessage(`{}`)
				collector["independentFinality"] = true
				changed, _ = json.Marshal(collector)
				if result := v.Verify(context.Background(), expected.TransactionHash, changed); result.Level != receipt.RPCOnly {
					t.Fatal("collector minted trust")
				}
			}
			if err := v.Close(); err != nil {
				t.Fatal(err)
			}
			if result := v.Verify(context.Background(), expected.TransactionHash, body); result.Level != receipt.RPCOnly || result.Reason != "REVOKED" {
				t.Fatal("closed host reused")
			}
		})
	}
}
