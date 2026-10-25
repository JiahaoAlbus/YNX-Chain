package main

import (
	"encoding/json"
	"os"
	"reflect"
	"strconv"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func TestPQWholeCaseVerifiedBusinessCountsOriginalPartialAndRejectedEffects(t *testing.T) {
	path := os.Getenv("YNX_PERF_PQ_PROOF_FIXTURE")
	if path == "" {
		t.Skip("requires original signed consensus fixture; no proof qualification from skip")
	}
	raw, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Version       string `json:"version"`
		SyntheticOnly bool   `json:"syntheticOnly"`
		Cases         []struct {
			Expected json.RawMessage      `json:"expectedTransaction"`
			Response pqCaseVerifierOutput `json:"expectedResponse"`
		} `json:"cases"`
	}
	if e = json.Unmarshal(raw, &f); e != nil || f.Version != "YNX-PQ-CONSENSUS-TRANSACTION-PROOF-PUBLIC-FIXTURE/v1" || !f.SyntheticOnly || len(f.Cases) != 3 {
		t.Fatal("original public fixture required", e)
	}
	for i, c := range f.Cases {
		t.Run([]string{"succeeded-single", "terminal-rejected-duplicate", "partial-whole"}[i], func(t *testing.T) {
			var expected struct {
				Type  string `json:"transactionType"`
				Wire  []byte `json:"nativeWire"`
				Index string `json:"index"`
				Block struct {
					Height string `json:"headerHeight"`
				} `json:"block"`
			}
			if e = json.Unmarshal(c.Expected, &expected); e != nil {
				t.Fatal(e)
			}
			var p pqWholeCase
			if expected.Type == consensus.PQWholeType {
				p, e = preparePQWholeCase(expected.Wire)
			} else {
				p, e = preparePQMemberCase(expected.Wire)
			}
			if e != nil {
				t.Fatal(e)
			}
			h, e := strconv.ParseUint(expected.Block.Height, 10, 64)
			if e != nil {
				t.Fatal(e)
			}
			n, e := strconv.ParseUint(expected.Index, 10, 32)
			if e != nil {
				t.Fatal(e)
			}
			index := uint32(n)
			report := pqWholeCaseReport{ExecutionHeight: h, CometIndex: &index}
			if p.kind == consensus.PQWholeType {
				report.EffectiveBusinessIncludedObserved = 3
				report.RejectedMembers = len(p.members) - 3
			}
			effects, e := p.verifiedBusinessIdentities(c.Response, &report)
			want := []int{1, 0, 3}[i]
			if e != nil || len(effects) != want {
				t.Fatal("proof effects became envelope/failed transaction count", effects, e)
			}
			if p.kind == consensus.PQWholeType {
				wrong := report
				wrong.EffectiveBusinessIncludedObserved++
				wrong.RejectedMembers--
				if _, err := p.verifiedBusinessIdentities(c.Response, &wrong); err == nil {
					t.Fatal("independent proof disagrees with observed member counts")
				}
			}
			again, e := p.verifiedBusinessIdentities(c.Response, &report)
			if e != nil || !reflect.DeepEqual(again, effects) {
				t.Fatal("repeat readback minted different business identity", again, e)
			}
			seen := map[string]bool{}
			for _, hash := range append(effects, again...) {
				seen[hash] = true
			}
			if len(seen) != want {
				t.Fatal("original effect hashes cannot deduplicate repeated proof")
			}
			if i == 2 {
				for name, mutate := range map[string]func(*consensus.PQTransactionProofResult){
					"row-order":           func(r *consensus.PQTransactionProofResult) { r.BatchResults[0].Index = 1 },
					"rejected-effect":     func(r *consensus.PQTransactionProofResult) { r.BatchResults[1].TransactionHash = p.members[1] },
					"admitted-effect":     func(r *consensus.PQTransactionProofResult) { r.BatchResults[0].TransactionHash = "other" },
					"missing-result":      func(r *consensus.PQTransactionProofResult) { r.BatchResults = r.BatchResults[:3] },
					"partial-as-complete": func(r *consensus.PQTransactionProofResult) { r.ExecutionSuccessful = true },
				} {
					t.Run(name, func(t *testing.T) {
						v := c.Response
						copyResult := *v.Result
						copyResult.BatchResults = append([]consensus.PQTransactionBatchResult(nil), copyResult.BatchResults...)
						v.Result = &copyResult
						mutate(v.Result)
						if _, err := p.verifiedBusinessIdentities(v, &report); err == nil {
							t.Fatal("unbound batch result counted")
						}
					})
				}
			}
		})
	}
	t.Log("SYNTHETIC_ORIGINAL_CORE_RESULT_ACCOUNTING_ONLY: transfer=1 rejected-duplicate=0 partial-whole=3; no node/TPS/finality grant from this classifier test")
}
