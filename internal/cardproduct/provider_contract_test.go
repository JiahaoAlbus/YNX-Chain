package cardproduct

import (
	"bytes"
	"testing"
	"time"
)

type malformedSandboxProvider struct{ SandboxProvider }

func (p malformedSandboxProvider) Capabilities() ProviderCapabilities {
	capabilities := p.SandboxProvider.Capabilities()
	capabilities.SecureDisplay = "provider_hosted"
	return capabilities
}

func TestProviderCapabilityContracts(t *testing.T) {
	unavailable := UnavailableProvider{ProviderName: "issuer-not-configured"}
	if err := ValidateProviderCapabilities(unavailable); err != nil {
		t.Fatalf("unavailable provider contract rejected: %v", err)
	}
	unavailableCapabilities := unavailable.Capabilities()
	if unavailableCapabilities.Mode != "unavailable" || unavailableCapabilities.Network != "unavailable" || len(unavailableCapabilities.Lifecycle) != 0 || !unavailableCapabilities.ExternalCredentialNeed || unavailableCapabilities.CredentialBoundary != "provider_selection_and_secret_reference_required" {
		t.Fatalf("unavailable provider capability boundary is incomplete: %+v", unavailableCapabilities)
	}

	sandbox := NewSandboxProvider(nil)
	if err := ValidateProviderCapabilities(sandbox); err != nil {
		t.Fatalf("sandbox provider contract rejected: %v", err)
	}
	sandboxContract := sandbox.Capabilities()
	if sandboxContract.Mode != "sandbox" || sandboxContract.Network != Network || sandboxContract.SecureDisplay != "safe_metadata_only" || sandboxContract.SensitiveDataStorage != "forbidden" {
		t.Fatalf("sandbox provider contract is unsafe: %+v", sandboxContract)
	}
	if len(sandboxContract.Lifecycle) != 7 || len(sandboxContract.Controls) != 7 || len(sandboxContract.ProviderEvents) != 5 {
		t.Fatalf("sandbox provider contract is incomplete: %+v", sandboxContract)
	}

	// Capabilities are defensive copies so callers cannot mutate the provider's
	// future contract response.
	sandboxContract.Lifecycle[0] = "tampered"
	if sandbox.Capabilities().Lifecycle[0] != "application" {
		t.Fatal("provider capability contract leaked mutable global state")
	}
}

func TestServiceRejectsNonConformantProviderBeforeUse(t *testing.T) {
	_, err := New(Config{
		StorePath:        t.TempDir() + "/card-state.json",
		IntegrityKey:     bytes.Repeat([]byte{0x17}, 32),
		GatewayKey:       bytes.Repeat([]byte{0x32}, 32),
		ProviderEventKey: bytes.Repeat([]byte{0x61}, 32),
		Provider:         malformedSandboxProvider{SandboxProvider: NewSandboxProvider(nil)},
		Now:              func() time.Time { return time.Date(2026, 7, 27, 0, 0, 0, 0, time.UTC) },
	})
	if err == nil {
		t.Fatal("service accepted an issuer provider that violates the secure-display contract")
	}
}
