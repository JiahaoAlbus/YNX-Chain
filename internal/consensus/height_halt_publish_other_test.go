//go:build !linux

package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/cometbft/cometbft/node"
)

func TestHeightHaltPublicationUnsupportedPlatformPreservesOriginal(t *testing.T) {
	parent := t.TempDir()
	options := HeightHaltPublicationOptions{ApplicationStatePath: filepath.Join(parent, "original.application"), Control: node.HeightHaltControl{ChainID: "ynx_6423-1", GenesisSHA256: strings.Repeat("a", 64), OperatorPlanSHA256: strings.Repeat("b", 64), SessionID: strings.Repeat("c", 64)}}
	options.Control.Path = filepath.Join(parent, "operator-height-halt-"+options.Control.SessionID+".json")
	if err := os.WriteFile(options.ApplicationStatePath, []byte("retain original application bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(node.HeightHaltRequest{Version: "YNX-OPERATOR-HEIGHT-HALT/v1", TargetHeight: "17", ChainID: options.Control.ChainID, GenesisSHA256: options.Control.GenesisSHA256, OperatorPlanSHA256: options.Control.OperatorPlanSHA256, SessionID: options.Control.SessionID})
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	before := inspectionInventory(t, parent)
	result, err := PublishHeightHaltRequest(raw, hex.EncodeToString(digest[:]), options)
	if err == nil || !strings.Contains(err.Error(), "Linux renameat2 RENAME_NOREPLACE") || result.Published {
		t.Fatal("unsupported platform used a publication fallback", result, err)
	}
	if !reflect.DeepEqual(before, inspectionInventory(t, parent)) {
		t.Fatal("unsupported platform created files or changed original source")
	}
}
