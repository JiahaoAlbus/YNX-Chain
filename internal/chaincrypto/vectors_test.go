package chaincrypto

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

type publicVector struct {
	Kind               string `json:"kind"`
	Message            string `json:"messageHex"`
	ClassicalKey       string `json:"classicalPublicKeyHex"`
	PQKey              string `json:"pqPublicKeyHex"`
	ClassicalSignature string `json:"classicalSignatureHex"`
	PQSignature        string `json:"pqSignatureHex"`
}

func TestPublicVectors(t *testing.T) {
	const path = "fixtures/public-vectors.json"
	if os.Getenv("YNX_GENERATE_ISOLATED_PUBLIC_VECTORS") == "1" {
		// Generates only ephemeral experiment signatures. Private keys are never
		// serialized, printed, or persisted. O_EXCL preserves previous vectors.
		f := newFixture(t)
		tx := testTx()
		a, _ := tx.CanonicalBytes()
		c, _ := (ConsensusMessage{testNetwork(), [20]byte{1}, 1, 100, 2, Precommit, []byte("synthetic original vote/block-id/timestamp")}).CanonicalBytes()
		var vectors []publicVector
		for i, raw := range [][]byte{a, c} {
			keys := f.account
			kind := "account"
			if i == 1 {
				keys = f.validator
				kind = "consensus"
			}
			s := f.sign(t, raw, i == 1)
			vectors = append(vectors, publicVector{kind, hex.EncodeToString(raw), hex.EncodeToString(keys.Classical), hex.EncodeToString(keys.PostQuantum), hex.EncodeToString(s.Classical), hex.EncodeToString(s.PostQuantum)})
		}
		data, e := json.MarshalIndent(vectors, "", "  ")
		if e != nil {
			t.Fatal(e)
		}
		if e = os.MkdirAll("fixtures", 0755); e != nil {
			t.Fatal(e)
		}
		out, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = out.Write(append(data, '\n')); e != nil {
			out.Close()
			t.Fatal(e)
		}
		if e = out.Sync(); e != nil {
			out.Close()
			t.Fatal(e)
		}
		if e = out.Close(); e != nil {
			t.Fatal(e)
		}
	}
	data, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	var vectors []publicVector
	if e = json.Unmarshal(data, &vectors); e != nil || len(vectors) != 2 {
		t.Fatal("invalid public vector document")
	}
	decode := func(s string) []byte {
		v, e := hex.DecodeString(s)
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	for _, v := range vectors {
		raw := decode(v.Message)
		keys := PublicKeys{decode(v.ClassicalKey), decode(v.PQKey)}
		s := Signatures{decode(v.ClassicalSignature), decode(v.PQSignature)}
		var err error
		switch v.Kind {
		case "account":
			err = (CIRCLProvider{}).VerifyAccount(keys, raw, s)
			m, e := DecodeTxMessage(raw)
			if e != nil {
				t.Fatal(e)
			}
			round, _ := m.CanonicalBytes()
			if !bytes.Equal(round, raw) {
				t.Fatal("tx roundtrip")
			}
		case "consensus":
			err = (CIRCLProvider{}).VerifyConsensus(keys, raw, s)
			m, e := DecodeConsensusMessage(raw)
			if e != nil {
				t.Fatal(e)
			}
			round, _ := m.CanonicalBytes()
			if !bytes.Equal(round, raw) {
				t.Fatal("consensus roundtrip")
			}
		default:
			t.Fatal("unknown vector")
		}
		if err != nil {
			t.Fatal(err)
		}
	}
}
func TestDecodersRejectMalformedCanonicalBytes(t *testing.T) {
	tx, _ := testTx().CanonicalBytes()
	co, _ := (ConsensusMessage{testNetwork(), [20]byte{1}, 1, 100, 2, Precommit, []byte("full vote")}).CanonicalBytes()
	for _, raw := range [][]byte{tx, co} {
		for i := 0; i < len(raw); i++ {
			if _, e := DecodeTxMessage(raw[:i]); e == nil {
				t.Fatal("truncated tx accepted")
			}
			if _, e := DecodeConsensusMessage(raw[:i]); e == nil {
				t.Fatal("truncated consensus accepted")
			}
		}
		for _, bad := range [][]byte{append(append([]byte(nil), raw...), 0), bytes.Repeat([]byte{255}, 32), make([]byte, MaxAuthMessage+1)} {
			if _, e := DecodeTxMessage(bad); e == nil {
				t.Fatal("malformed tx accepted")
			}
			if _, e := DecodeConsensusMessage(bad); e == nil {
				t.Fatal("malformed consensus accepted")
			}
		}
	}
	if _, e := DecodeTxMessage(co); e == nil {
		t.Fatal("consensus alias as tx")
	}
	if _, e := DecodeConsensusMessage(tx); e == nil {
		t.Fatal("tx alias as consensus")
	}
}
