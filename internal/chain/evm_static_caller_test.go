package chain

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestStaticEVMCallerRequiresOriginalContext(t *testing.T) {
	// CALLER; PUSH1 0; MSTORE; PUSH1 32; PUSH1 0; RETURN.
	code := "0x3360005260206000f3"
	got, _, err := CallBoundedContract(code, "0x00000000", nil)
	if err == nil || !strings.Contains(err.Error(), "static caller context unavailable") || got != "" {
		t.Fatalf("static CALLER without trusted context: %q %v", got, err)
	}
	caller := "0x" + strings.Repeat("1", 40)
	stateful, err := runStatefulEVMSubset(code, "0x00000000", caller, nil)
	if err != nil || stateful.EncodedResult != "0x"+strings.Repeat("0", 24)+strings.Repeat("1", 40) {
		t.Fatalf("stateful CALLER changed: %+v %v", stateful, err)
	}
}

func TestStaticPinnedERC20CallerFailsClosed(t *testing.T) {
	source, err := os.ReadFile("../../contracts/tokens/SampleYNXTCompatibleERC20.sol")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../artifacts/contracts/tokens/SampleYNXTCompatibleERC20.sol/SampleYNXTCompatibleERC20.json")
	if err != nil {
		t.Fatal(err)
	}
	var artifact struct {
		DeployedBytecode string `json:"deployedBytecode"`
	}
	if err := json.Unmarshal(raw, &artifact); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ValidateBoundedPinnedContract("SampleYNXTCompatibleERC20", strings.TrimSpace(string(source)), artifact.DeployedBytecode); err != nil {
		t.Fatal(err)
	}
	calldata := "0xa9059cbb" + strings.Repeat("0", 24) + strings.Repeat("1", 40) + strings.Repeat("0", 63) + "1"
	if _, _, err := CallBoundedContract(artifact.DeployedBytecode, calldata, nil); err == nil || !strings.Contains(err.Error(), "static caller context unavailable") {
		t.Fatalf("pinned ERC20 static CALLER did not fail closed: %v", err)
	}
}
