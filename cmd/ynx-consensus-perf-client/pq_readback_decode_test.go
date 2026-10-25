package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// Real signed canonical bytes; readback views are UNIT observations. This
// fixture does not fund, execute, admit or finalize its 1024 transfer messages.
func pqWholeLargeReadbackFixture(t testing.TB) (pqWholeCase, []byte) {
	t.Helper()
	key, _, e := ynxbatch.KeyGen()
	if e != nil {
		t.Fatal(e)
	}
	defer key.Destroy()
	network := bytes.Repeat([]byte{0x31}, 32)
	owner := "0x" + strings.Repeat("12", 20)
	messages := make([][]byte, 1024)
	for i := range messages {
		messages[i], e = (ynxauth.Transfer{ChainID: network, NativeChainID: 6423, From: owner, To: "0x" + strings.Repeat("34", 20), Amount: 1, Fee: 1, Nonce: uint64(i + 1)}).SigningBytes()
		if e != nil {
			t.Fatal(e)
		}
	}
	batch, e := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: ynxauth.TransactionPurpose}, messages, ynxbatch.SignOptions{Optimized: true})
	if e != nil {
		t.Fatal(e)
	}
	defer batch.Discard()
	wire, e := batch.WholeWire()
	if e != nil {
		t.Fatal(e)
	}
	p, e := preparePQWholeCase(wire)
	if e != nil {
		t.Fatal(e)
	}
	view := pqWholeUnitView(p)
	index := uint32(17)
	view.CometIndex = &index
	raw, e := json.Marshal(view)
	if e != nil {
		t.Fatal(e)
	}
	return p, raw
}

func TestPQWholeCaseReadbackReturnsValidatedIndexWithoutSecondDecode(t *testing.T) {
	p, raw := pqWholeLargeReadbackFixture(t)
	admitted, rejected, height, index, e := p.committedResponse(raw)
	if e != nil || admitted != 1024 || rejected != 0 || height != 7 || index == nil || *index != 17 {
		t.Fatal("complete identity/results/index changed", admitted, rejected, height, index, e)
	}
	changed := bytes.Replace(raw, []byte(`"cometIndex":17`), []byte(`"cometIndex":null`), 1)
	if bytes.Equal(changed, raw) {
		t.Fatal("negative did not change original readback")
	}
	if _, _, _, _, e = p.committedResponse(changed); e == nil {
		t.Fatal("missing index bypassed original committed validation")
	}
	t.Logf("UNIT_READBACK_ONLY members=%d wireBytes=%d responseBytes=%d; no actual business execution/TPS", len(p.members), len(p.wire), len(raw))
}

func BenchmarkPQWholeCaseCommittedReadbackDecode(b *testing.B) {
	p, raw := pqWholeLargeReadbackFixture(b)
	b.Run("before-second-index-decode", func(b *testing.B) {
		b.ReportAllocs()
		b.SetBytes(int64(len(raw)))
		for i := 0; i < b.N; i++ {
			if _, _, _, _, e := p.committedResponse(raw); e != nil {
				b.Fatal(e)
			}
			var v struct {
				CometIndex *uint32 `json:"cometIndex"`
			}
			if e := json.Unmarshal(raw, &v); e != nil || v.CometIndex == nil || *v.CometIndex != 17 {
				b.Fatal("legacy index", e)
			}
		}
	})
	b.Run("after-reuse-validated-index", func(b *testing.B) {
		b.ReportAllocs()
		b.SetBytes(int64(len(raw)))
		for i := 0; i < b.N; i++ {
			if _, _, _, index, e := p.committedResponse(raw); e != nil || index == nil || *index != 17 {
				b.Fatal("validated index", e)
			}
		}
	})
}
