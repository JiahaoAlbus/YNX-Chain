package cardproduct

import (
	"errors"
	"fmt"
	"slices"
	"strings"
)

const ProviderCapabilitySchema = "ynx.card.provider.capabilities.v1"

var (
	canonicalProviderEvents = []string{"authorization", "reversal", "clearing", "decline", "refund"}
	canonicalControls       = []string{"spend_limit", "online", "international", "atm", "allowed_mcc", "blocked_mcc", "allowed_countries"}
	canonicalLifecycle      = []string{"application", "issue", "activate", "freeze", "unfreeze", "replace", "close"}
)

type ProviderCapabilities struct {
	SchemaVersion          string   `json:"schemaVersion"`
	ProviderName           string   `json:"providerName"`
	Mode                   string   `json:"mode"`
	Network                string   `json:"network"`
	Lifecycle              []string `json:"lifecycle"`
	Controls               []string `json:"controls"`
	ProviderEvents         []string `json:"providerEvents"`
	WebhookAuthentication  string   `json:"webhookAuthentication"`
	SecureDisplay          string   `json:"secureDisplay"`
	SensitiveDataStorage   string   `json:"sensitiveDataStorage"`
	CredentialBoundary     string   `json:"credentialBoundary"`
	ExternalCredentialNeed bool     `json:"externalCredentialNeed"`
}

func ValidateProviderCapabilities(provider IssuerProvider) error {
	if provider == nil {
		return errors.New("issuer provider is required")
	}
	capabilities := provider.Capabilities()
	if capabilities.SchemaVersion != ProviderCapabilitySchema {
		return fmt.Errorf("issuer provider capability schema must be %s", ProviderCapabilitySchema)
	}
	if strings.TrimSpace(capabilities.ProviderName) == "" || capabilities.ProviderName != provider.Name() {
		return errors.New("issuer provider capability name mismatch")
	}
	if capabilities.SensitiveDataStorage != "forbidden" {
		return errors.New("issuer provider must forbid sensitive card data storage in YNX")
	}
	if err := requireUnique("lifecycle", capabilities.Lifecycle); err != nil {
		return err
	}
	if err := requireUnique("controls", capabilities.Controls); err != nil {
		return err
	}
	if err := requireUnique("provider events", capabilities.ProviderEvents); err != nil {
		return err
	}

	switch capabilities.Mode {
	case "unavailable":
		if capabilities.Network != "unavailable" || len(capabilities.Lifecycle) != 0 || len(capabilities.Controls) != 0 || len(capabilities.ProviderEvents) != 0 {
			return errors.New("unavailable issuer provider must expose zero operational capabilities")
		}
		if capabilities.WebhookAuthentication != "unavailable" || capabilities.SecureDisplay != "unavailable" || capabilities.CredentialBoundary != "provider_selection_and_secret_reference_required" || !capabilities.ExternalCredentialNeed {
			return errors.New("unavailable issuer provider capability boundary is inconsistent")
		}
	case "sandbox":
		if capabilities.Network != Network {
			return errors.New("sandbox issuer provider must use the YNX Testnet Sandbox network")
		}
		if !slices.Equal(capabilities.Lifecycle, canonicalLifecycle) || !slices.Equal(capabilities.Controls, canonicalControls) || !slices.Equal(capabilities.ProviderEvents, canonicalProviderEvents) {
			return errors.New("sandbox issuer provider capabilities do not match the canonical contract")
		}
		if capabilities.WebhookAuthentication != "hmac_sha256_v1" || capabilities.SecureDisplay != "safe_metadata_only" || capabilities.CredentialBoundary != "none" || capabilities.ExternalCredentialNeed {
			return errors.New("sandbox issuer provider capability boundary is inconsistent")
		}
	case "production":
		if strings.TrimSpace(capabilities.Network) == "" || capabilities.Network == Network || capabilities.Network == "unavailable" {
			return errors.New("production issuer provider must declare its real provider network")
		}
		if !slices.Equal(capabilities.Lifecycle, canonicalLifecycle) || !slices.Equal(capabilities.Controls, canonicalControls) || !slices.Equal(capabilities.ProviderEvents, canonicalProviderEvents) {
			return errors.New("production issuer provider must satisfy the complete canonical capability contract")
		}
		if capabilities.WebhookAuthentication != "provider_signature_v1" || capabilities.SecureDisplay != "provider_hosted" || capabilities.CredentialBoundary != "secret_reference_only" || !capabilities.ExternalCredentialNeed {
			return errors.New("production issuer provider must use provider-hosted display and secret-reference credentials")
		}
	default:
		return errors.New("issuer provider mode is unsupported")
	}
	return nil
}

func requireUnique(label string, values []string) error {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("issuer provider %s contains an empty capability", label)
		}
		if _, exists := seen[value]; exists {
			return fmt.Errorf("issuer provider %s contains duplicate capability %q", label, value)
		}
		seen[value] = struct{}{}
	}
	return nil
}

func unavailableCapabilities(name string) ProviderCapabilities {
	return ProviderCapabilities{
		SchemaVersion:          ProviderCapabilitySchema,
		ProviderName:           name,
		Mode:                   "unavailable",
		Network:                "unavailable",
		Lifecycle:              []string{},
		Controls:               []string{},
		ProviderEvents:         []string{},
		WebhookAuthentication:  "unavailable",
		SecureDisplay:          "unavailable",
		SensitiveDataStorage:   "forbidden",
		CredentialBoundary:     "provider_selection_and_secret_reference_required",
		ExternalCredentialNeed: true,
	}
}

func sandboxCapabilities(name string) ProviderCapabilities {
	return ProviderCapabilities{
		SchemaVersion:          ProviderCapabilitySchema,
		ProviderName:           name,
		Mode:                   "sandbox",
		Network:                Network,
		Lifecycle:              append([]string(nil), canonicalLifecycle...),
		Controls:               append([]string(nil), canonicalControls...),
		ProviderEvents:         append([]string(nil), canonicalProviderEvents...),
		WebhookAuthentication:  "hmac_sha256_v1",
		SecureDisplay:          "safe_metadata_only",
		SensitiveDataStorage:   "forbidden",
		CredentialBoundary:     "none",
		ExternalCredentialNeed: false,
	}
}
