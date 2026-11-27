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
	observed, _, err := CallBoundedContractAs(code, "0x00000000", caller, nil)
	if err != nil || observed != "0x"+strings.Repeat("0", 24)+strings.Repeat("1", 40) {
		t.Fatalf("static supplied caller: %q %v", observed, err)
	}
	zero, _, err := CallBoundedContractAs(code, "0x00000000", "0x"+strings.Repeat("0", 40), nil)
	if err != nil || zero != "0x"+strings.Repeat("0", 64) {
		t.Fatalf("explicit zero caller: %q %v", zero, err)
	}
	for _, bad := range []string{"", "0xABC", "0x" + strings.Repeat("G", 40), "0x" + strings.Repeat("A", 40)} {
		if _, _, err := CallBoundedContractAs(code, "0x00000000", bad, nil); err == nil {
			t.Fatalf("invalid caller accepted: %q", bad)
		}
	}
	// Read-only calls cannot mutate storage even when a caller is supplied.
	if _, _, err := CallBoundedContractAs("0x600160005500", "0x00000000", caller, nil); err == nil {
		t.Fatal("static caller enabled a state write")
	}
	if _, _, err := CallBoundedContractAs("0x60006000a000", "0x00000000", caller, nil); err == nil || !strings.Contains(err.Error(), "LOG is not allowed") {
		t.Fatalf("static caller enabled a log: %v", err)
	}
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
	caller := "0x" + strings.Repeat("2", 40)
	storage := BoundedContractInitialStorage(string(source), caller, []string{"7"})
	if _, _, err := CallBoundedContractAs(artifact.DeployedBytecode, calldata, caller, storage); err == nil || !strings.Contains(err.Error(), "SSTORE is not allowed") {
		t.Fatalf("pinned ERC20 static call did not reach and reject storage write: %v", err)
	}
}
