package resourceproduct

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"testing"
)

type resourceIntegrationContract struct {
	ContractVersion string `json:"contractVersion"`
	Product         struct {
		Owner        string `json:"owner"`
		SourceCommit string `json:"sourceCommit"`
	} `json:"product"`
	ErrorCodes  map[string]string `json:"errorCodes"`
	TestVectors struct {
		RequiredIDs []string `json:"requiredIds"`
	} `json:"testVectors"`
	ReleaseStatus map[string]bool `json:"releaseStatus"`
}

type resourceCrossProductVectors struct {
	ContractVersion string `json:"contractVersion"`
	Vectors         []struct {
		ID           string `json:"id"`
		ExpectedCode string `json:"expectedCode"`
	} `json:"vectors"`
}

func readJSONFixture(t *testing.T, path string, out any) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.NewDecoder(bytes.NewReader(raw)).Decode(out); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
}

func TestResourceIntegrationContractAndVectorsStayAligned(t *testing.T) {
	var contract resourceIntegrationContract
	readJSONFixture(t, "../../release/integration/resource-market-contract.json", &contract)
	if contract.ContractVersion != "resource-market-integration-v1" {
		t.Fatalf("contractVersion=%q", contract.ContractVersion)
	}
	if contract.Product.Owner != "16-resource-market" || len(contract.Product.SourceCommit) != 40 {
		t.Fatalf("product identity=%+v", contract.Product)
	}
	for _, code := range []string{
		"RESOURCE_REQUEST_REJECTED",
		"RESOURCE_ROLE_REQUIRED",
		"RESOURCE_ACTION_REJECTED",
		"RESOURCE_CAPACITY_UNAVAILABLE",
		"RESOURCE_STATE_TRANSITION_INVALID",
		"RESOURCE_PROOF_REJECTED",
		"RESOURCE_SETTLEMENT_STATE_INVALID",
		"RESOURCE_SETTLEMENT_EVIDENCE_REQUIRED",
		"RESOURCE_SETTLEMENT_RECONCILIATION",
		"RESOURCE_SETTLEMENT_REPLAY",
	} {
		if contract.ErrorCodes[code] == "" {
			t.Fatalf("missing contract error code %s", code)
		}
	}
	for _, key := range []string{"integratedCentral", "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"} {
		if contract.ReleaseStatus[key] {
			t.Fatalf("unproven release status %s was true", key)
		}
	}

	var vectors resourceCrossProductVectors
	readJSONFixture(t, "../../docs/integration/CROSS_PRODUCT_TEST_VECTORS.json", &vectors)
	if vectors.ContractVersion != contract.ContractVersion {
		t.Fatalf("vector contract=%q contract=%q", vectors.ContractVersion, contract.ContractVersion)
	}
	byID := make(map[string]string, len(vectors.Vectors))
	for _, vector := range vectors.Vectors {
		if vector.ID == "" {
			t.Fatal("empty cross-product vector id")
		}
		if _, duplicate := byID[vector.ID]; duplicate {
			t.Fatalf("duplicate vector id %s", vector.ID)
		}
		byID[vector.ID] = vector.ExpectedCode
	}
	for _, id := range contract.TestVectors.RequiredIDs {
		if _, ok := byID[id]; !ok {
			t.Fatalf("required vector %s missing", id)
		}
	}
	engineReplay := errors.New("settlement transaction hash was already consumed by another receipt")
	if got := marketErrorCode("confirm_settlement", engineReplay); got != byID["RM-SETTLEMENT-REPLAY-001"] {
		t.Fatalf("runtime replay code=%s vector code=%s", got, byID["RM-SETTLEMENT-REPLAY-001"])
	}
	engineReconcile := errors.New("receipt amounts do not reconcile to signed metering")
	if got := marketErrorCode("confirm_settlement", engineReconcile); got != byID["RM-SETTLEMENT-RECONCILE-001"] {
		t.Fatalf("runtime reconciliation code=%s vector code=%s", got, byID["RM-SETTLEMENT-RECONCILE-001"])
	}
}
