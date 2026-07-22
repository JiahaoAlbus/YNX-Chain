package governance

import (
	"encoding/json"
	"os"
	"testing"
)

func TestPublishedBFTExecutionReceiptVector(t *testing.T) {
	data, err := os.ReadFile("../../release/integration/governance-bft-test-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		ReceiptVectors []struct {
			Input    *ExecutionReceipt `json:"input"`
			Expected string            `json:"expected"`
		} `json:"receiptVectors"`
	}
	if err = json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	if len(vectors.ReceiptVectors) == 0 || vectors.ReceiptVectors[0].Input == nil || vectors.ReceiptVectors[0].Expected != "accepted" {
		t.Fatal("accepted receipt vector missing")
	}
	receipt := *vectors.ReceiptVectors[0].Input
	if err = validateExecutionReceipt(receipt, receipt.ManifestHash); err != nil {
		t.Fatalf("published receipt vector invalid: %v", err)
	}
}
