package quantlab

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"testing"
)

func TestPublishedStrategyTemplateHasNoExecutionOrPrivilegedCapability(t *testing.T) {
	data, err := os.ReadFile("../../apps/quant-lab/examples/strategy-template.json")
	if err != nil {
		t.Fatal(err)
	}
	var template struct {
		SchemaVersion        int            `json:"schemaVersion"`
		TemplateID           string         `json:"templateId"`
		Name                 string         `json:"name"`
		Family               string         `json:"family"`
		Runtime              string         `json:"runtime"`
		ExecutionEligibility bool           `json:"executionEligibility"`
		ProfitClaim          bool           `json:"profitClaim"`
		Parameters           map[string]any `json:"parameters"`
		RequiredEvidence     []string       `json:"requiredEvidence"`
		Limitations          []string       `json:"limitations"`
		Permissions          struct {
			HostFilesystem, ArbitraryNetwork, WalletKey, ProviderSecret bool
			Withdrawal, OwnerChange, RiskChange                         bool
		} `json:"permissions"`
		PackageRequirements struct {
			SignatureRequired, DependencyAllowlistRequired         bool
			SecretScanRequired, MalwareScanRequired                bool
			DeterministicClockRequired, CheckpointRecoveryRequired bool
		} `json:"packageRequirements"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&template); err != nil {
		t.Fatal(err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		t.Fatal("strategy template must contain exactly one JSON value")
	}
	permissions, requirements := template.Permissions, template.PackageRequirements
	if template.SchemaVersion != 1 || template.ExecutionEligibility || template.ProfitClaim || permissions.HostFilesystem || permissions.ArbitraryNetwork || permissions.WalletKey || permissions.ProviderSecret || permissions.Withdrawal || permissions.OwnerChange || permissions.RiskChange || !requirements.SignatureRequired || !requirements.DependencyAllowlistRequired || !requirements.SecretScanRequired || !requirements.MalwareScanRequired || !requirements.DeterministicClockRequired || !requirements.CheckpointRecoveryRequired {
		t.Fatalf("unsafe template: %+v", template)
	}
}

func TestPublishedShadowIntentConformsToVenueNeutralContract(t *testing.T) {
	data, err := os.ReadFile("../../apps/quant-lab/examples/execution-intent.shadow.json")
	if err != nil {
		t.Fatal(err)
	}
	var intent OrderIntent
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&intent); err != nil {
		t.Fatal(err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		t.Fatal("execution example must contain exactly one JSON value")
	}
	if err := validateIntent(intent); err != nil {
		t.Fatal(err)
	}
}
