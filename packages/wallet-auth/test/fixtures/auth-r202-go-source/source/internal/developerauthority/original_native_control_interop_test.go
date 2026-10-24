package developerauthority

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestOriginalNativeControlCABIActualGoOriginals(t *testing.T) {
	raw, e := os.ReadFile(filepath.Join("..", "..", "packages", "wallet-auth", "test", "fixtures", "native-control-public-interop.json"))
	if e != nil {
		t.Fatal(e)
	}
	if len(raw) != 86706 || hash(raw) != "32d90211e6f019b1d073fe7a5692384a7821c9f1cd0708506fa1c679bb5e1aba" {
		t.Fatal("fixture identity")
	}
	var f struct {
		Principal string `json:"principalOriginalBase64"`
		Command   string `json:"commandOriginalBase64"`
		Observed  int64  `json:"observedAtMs,string"`
	}
	if json.Unmarshal(raw, &f) != nil {
		t.Fatal("fixture schema")
	}
	pRaw, e := base64.StdEncoding.DecodeString(f.Principal)
	if e != nil {
		t.Fatal(e)
	}
	cRaw, e := base64.StdEncoding.DecodeString(f.Command)
	if e != nil {
		t.Fatal(e)
	}
	var p Principal
	var c Command
	if json.Unmarshal(pRaw, &p) != nil || json.Unmarshal(cRaw, &c) != nil {
		t.Fatal("original schema")
	}
	p2, _ := json.Marshal(p)
	c2, _ := json.Marshal(c)
	if !bytes.Equal(pRaw, p2) || !bytes.Equal(cRaw, c2) || p.AccountGeneration != 9007199254740993 || p.SessionGeneration != 18446744073709551615 || c.ExpectedRevision != 9007199254740993 {
		t.Fatal("actual Go original/numeric mismatch")
	}
	if !c.valid(f.Observed) || !principalValid(p, f.Observed) {
		t.Fatal("historical original invalid")
	}
	if c.valid(1792810800000) || principalValid(p, 1792810800000) {
		t.Fatal("historical fixture became current")
	}
}
