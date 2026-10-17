package ynxbatch

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/cloudflare/circl/sign/slhdsa"
)

func TestNISTACVPPublishedVectors(t *testing.T) {
	var vectors struct {
		SourceRevision string
		SigVer         []struct {
			ParameterSet                    string
			TcID                            int
			PK, Message, Context, Signature string
			TestPassed                      bool
		}
		KeyGen []struct {
			ParameterSet                        string
			TcID                                int
			Seed, SkSeed, SkPrf, PkSeed, PK, SK string
		}
	}
	data, e := os.ReadFile("testdata/nist-acvp.json")
	requireNoError(t, e)
	requireNoError(t, json.Unmarshal(data, &vectors))
	if vectors.SourceRevision != "975de31eb83d87039ec88934fdc47d8c312b892d" {
		t.Fatal("unrecognized NIST vector source")
	}
	passed, failed := map[string]int{}, map[string]int{}
	for _, v := range vectors.SigVer {
		pk, msg, ctx, sig := hx(t, v.PK), hx(t, v.Message), hx(t, v.Context), hx(t, v.Signature)
		ok := false
		switch v.ParameterSet {
		case "ML-DSA-87":
			var p mldsa87.PublicKey
			if p.UnmarshalBinary(pk) == nil {
				ok = mldsa87.Verify(&p, msg, ctx, sig)
			}
		case "SLH-DSA-SHA2-256f":
			p := slhdsa.PublicKey{ID: slhdsa.SHA2_256f}
			if p.UnmarshalBinary(pk) == nil {
				ok = slhdsa.Verify(&p, slhdsa.NewMessage(msg), sig, ctx)
			}
		default:
			t.Fatalf("unrecognized parameter set %s", v.ParameterSet)
		}
		if ok != v.TestPassed {
			t.Fatalf("%s tcId=%d: got %v want %v", v.ParameterSet, v.TcID, ok, v.TestPassed)
		}
		if ok {
			passed[v.ParameterSet]++
		} else {
			failed[v.ParameterSet]++
		}
	}
	for _, name := range []string{"ML-DSA-87", "SLH-DSA-SHA2-256f"} {
		if passed[name] == 0 || failed[name] == 0 {
			t.Fatal("missing positive or negative vectors", name)
		}
	}
	for _, v := range vectors.KeyGen {
		switch v.ParameterSet {
		case "ML-DSA-87":
			seed := hx(t, v.Seed)
			if len(seed) != mldsa87.SeedSize {
				t.Fatal("NIST seed size")
			}
			var s [mldsa87.SeedSize]byte
			copy(s[:], seed)
			p, k := mldsa87.NewKeyFromSeed(&s)
			same(t, p.Bytes(), hx(t, v.PK))
			same(t, k.Bytes(), hx(t, v.SK))
		case "SLH-DSA-SHA2-256f":
			seed := append(append(hx(t, v.SkSeed), hx(t, v.SkPrf)...), hx(t, v.PkSeed)...)
			if len(seed) != 96 {
				t.Fatal("NIST seed size")
			}
			p, k, e := slhdsa.GenerateKey(bytes.NewReader(seed), slhdsa.SHA2_256f)
			requireNoError(t, e)
			pb, e := p.MarshalBinary()
			requireNoError(t, e)
			kb, e := k.MarshalBinary()
			requireNoError(t, e)
			same(t, pb, hx(t, v.PK))
			same(t, kb, hx(t, v.SK))
		default:
			t.Fatalf("unrecognized parameter set %s", v.ParameterSet)
		}
	}
}
