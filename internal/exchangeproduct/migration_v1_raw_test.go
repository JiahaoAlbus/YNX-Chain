package exchangeproduct

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSchemaV1RawIntegritySurvivesHistoricalNestedShape(t *testing.T) {
	compact := `{"schemaVersion":1,"sequence":0,"custodyAddress":"","challenges":{},"sessions":{},"balances":{},"ledger":[],"depositIntents":{},"deposits":{},"withdrawals":{},"orders":{"historical":{"historicalOnly":"field"}},"trades":[],"fees":[],"security":{},"support":{},"ai":{},"idempotency":{},"audit":[],"integrityHash":""}`
	hash := sha256.Sum256([]byte(compact))
	stored := hex.EncodeToString(hash[:])
	compact = strings.Replace(compact, `"integrityHash":""`, `"integrityHash":"`+stored+`"`, 1)
	var indented bytes.Buffer
	if err := json.Indent(&indented, []byte(compact), "", "  "); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "historical-v1.json")
	if err := os.WriteFile(path, indented.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	state, exists, err := loadState(path)
	if err != nil || !exists || state.SchemaVersion != 1 {
		t.Fatalf("historical v1 compatibility: exists=%v schema=%d err=%v", exists, state.SchemaVersion, err)
	}
	if _, ok := state.Orders["historical"]; !ok {
		t.Fatal("historical order identity was not retained")
	}
}
