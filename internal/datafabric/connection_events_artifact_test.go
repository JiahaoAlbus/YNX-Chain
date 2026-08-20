package datafabric

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestAcceptedConnectionEventArtifactBindsIntegrationAcceptanceWithoutChangingCandidate(t *testing.T) {
	path := filepath.Join("..", "..", "schemas", "data-fabric", "wallet-connectivity-events-v1.accepted.schema.json")
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document struct {
		Status           string `json:"x-contract-status"`
		ContractVersion  string `json:"x-contract-version"`
		AcceptanceCommit string `json:"x-acceptance-commit"`
		RuntimeAdapter   string `json:"x-runtime-adapter"`
	}
	if err := json.Unmarshal(encoded, &document); err != nil {
		t.Fatal(err)
	}
	if document.Status != "ACCEPTED" || document.ContractVersion != ConnectionEventsContractVersion || document.AcceptanceCommit != "e13fca35d890427a25bff9d6122e7c7581247cdb" || document.RuntimeAdapter != "internal/datafabric.ConnectionEvent" {
		t.Fatalf("accepted connection artifact lost its authority binding: %+v", document)
	}
}
