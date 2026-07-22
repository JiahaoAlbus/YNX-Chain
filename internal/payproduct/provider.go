package payproduct

import (
	"context"
	"errors"
	"regexp"
	"sort"
	"strings"
)

type ProviderProbe interface {
	Probe(context.Context, ProviderDefinition, ProviderConnection) (ProviderProbeResult, error)
}

type ProviderProbeResult struct {
	Health      string
	Source      string
	Version     string
	Coverage    string
	FailureCode string
}

type ProviderConnectionInput struct {
	ProviderID          string `json:"providerId"`
	Environment         string `json:"environment"`
	CredentialReference string `json:"credentialReference"`
	CredentialVersion   string `json:"credentialVersion"`
}

var credentialReferenceRE = regexp.MustCompile(`^credref_[A-Za-z0-9._:-]{3,120}$`)

var officialProviderDefinitions = map[string]ProviderDefinition{
	"quickbooks-online": {
		ID: "quickbooks-online", Category: "accounting", DisplayName: "QuickBooks Online", Environments: []string{"sandbox", "production"}, Capabilities: []string{"accounting-export", "invoice-sync"}, Authentication: "OAuth 2.0 server-side credential reference", RateLimitPolicy: "official provider account and API policy", DataRetention: "provider account and merchant contract dependent", Jurisdiction: "provider service region and merchant contract dependent", DataRights: "merchant-controlled export/deletion subject to provider terms", TermsURL: "https://www.intuit.com/legal/terms/", DocumentationURL: "https://developer.intuit.com/app/developer/qbo/docs/get-started", Version: "qbo-v3", Source: "official-provider-documentation",
	},
	"easypost": {
		ID: "easypost", Category: "shipping", DisplayName: "EasyPost", Environments: []string{"sandbox", "production"}, Capabilities: []string{"address-verification", "rates", "labels", "tracking"}, Authentication: "server-side API key credential reference", RateLimitPolicy: "official provider account and API policy", DataRetention: "provider account and merchant contract dependent", Jurisdiction: "provider service region and merchant contract dependent", DataRights: "merchant-controlled subject to provider terms", TermsURL: "https://www.easypost.com/terms", DocumentationURL: "https://docs.easypost.com/docs", Version: "v2", Source: "official-provider-documentation",
	},
	"avalara-avatax": {
		ID: "avalara-avatax", Category: "tax", DisplayName: "Avalara AvaTax", Environments: []string{"sandbox", "production"}, Capabilities: []string{"tax-estimate", "tax-commit", "tax-export"}, Authentication: "server-side OAuth or account credential reference", RateLimitPolicy: "official provider account and API policy", DataRetention: "provider account and merchant contract dependent", Jurisdiction: "tax nexus, provider region and merchant contract dependent", DataRights: "merchant and statutory retention controls apply", TermsURL: "https://www.avalara.com/us/en/legal/terms.html", DocumentationURL: "https://developer.avalara.com/api-reference/avatax/rest/v2/", Version: "rest-v2", Source: "official-provider-documentation",
	},
	"twilio-sendgrid": {
		ID: "twilio-sendgrid", Category: "email", DisplayName: "Twilio SendGrid", Environments: []string{"sandbox", "production"}, Capabilities: []string{"transactional-email", "delivery-events"}, Authentication: "server-side scoped API key credential reference", RateLimitPolicy: "official provider account and endpoint policy", DataRetention: "provider account and merchant contract dependent", Jurisdiction: "provider service region and merchant contract dependent", DataRights: "merchant-controlled subject to provider terms", TermsURL: "https://www.twilio.com/legal/tos", DocumentationURL: "https://www.twilio.com/docs/sendgrid/api-reference", Version: "v3", Source: "official-provider-documentation",
	},
	"aws-s3": {
		ID: "aws-s3", Category: "object-storage", DisplayName: "Amazon S3", Environments: []string{"sandbox", "production"}, Capabilities: []string{"receipt-archive", "export-storage", "object-retention"}, Authentication: "server-side IAM role or scoped credential reference", RateLimitPolicy: "official service quota and account policy", DataRetention: "merchant bucket lifecycle and legal policy", Jurisdiction: "merchant-selected AWS region", DataRights: "merchant-controlled bucket policy, export and deletion", TermsURL: "https://aws.amazon.com/service-terms/", DocumentationURL: "https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html", Version: "s3-api", Source: "official-provider-documentation",
	},
	"circle-stablecoins": {
		ID: "circle-stablecoins", Category: "stablecoin", DisplayName: "Circle Stablecoins", Environments: []string{"sandbox", "production"}, Capabilities: []string{"stablecoin-settlement", "transfer-status"}, Authentication: "server-side scoped API credential reference", RateLimitPolicy: "official provider account and endpoint policy", DataRetention: "provider account, compliance and merchant contract dependent", Jurisdiction: "provider eligibility and merchant jurisdiction dependent", DataRights: "provider compliance and merchant contract dependent", TermsURL: "https://www.circle.com/legal", DocumentationURL: "https://developers.circle.com/stablecoins/docs", Version: "official-current", Source: "official-provider-documentation",
	},
	"circle-cctp": {
		ID: "circle-cctp", Category: "bridge", DisplayName: "Circle CCTP", Environments: []string{"sandbox", "production"}, Capabilities: []string{"cross-chain-attestation", "burn-mint-evidence"}, Authentication: "official contracts and attestation API; signer remains outside Merchant Console", RateLimitPolicy: "official API and chain policy", DataRetention: "public chain plus provider API policy", Jurisdiction: "chain and provider eligibility dependent", DataRights: "public chain records are not erasable", TermsURL: "https://www.circle.com/legal", DocumentationURL: "https://developers.circle.com/cctp", Version: "official-current", Source: "official-provider-documentation",
	},
	"stripe": {
		ID: "stripe", Category: "pay", DisplayName: "Stripe", Environments: []string{"sandbox", "production"}, Capabilities: []string{"payment-reference", "refund-reference", "dispute-reference"}, Authentication: "server-side restricted key or OAuth credential reference", RateLimitPolicy: "official provider account and endpoint policy", DataRetention: "provider account, compliance and merchant contract dependent", Jurisdiction: "provider account country and service eligibility dependent", DataRights: "provider compliance and merchant contract dependent", TermsURL: "https://stripe.com/legal/ssa", DocumentationURL: "https://docs.stripe.com/api", Version: "official-current", Source: "official-provider-documentation",
	},
	"ynx-trust": {
		ID: "ynx-trust", Category: "trust", DisplayName: "YNX Trust", Environments: []string{"testnet"}, Capabilities: []string{"case-reference", "evidence-verification", "decision-reference"}, Authentication: "canonical Gateway service assertion", RateLimitPolicy: "central YNX Trust SLO policy", DataRetention: "versioned YNX Trust policy required before integration", Jurisdiction: "operator legal policy required before integration", DataRights: "authoritative Trust export/delete policy required", Version: "integration-pending", Source: "ynx-authoritative-service",
	},
}

func ProviderCatalog() []ProviderDefinition {
	out := make([]ProviderDefinition, 0, len(officialProviderDefinitions))
	for _, definition := range officialProviderDefinitions {
		definition.Environments = append([]string(nil), definition.Environments...)
		definition.Capabilities = append([]string(nil), definition.Capabilities...)
		out = append(out, definition)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Category < out[j].Category })
	return out
}

func (s *Service) ConfigureProvider(actor MerchantPrincipal, input ProviderConnectionInput) (ProviderConnection, error) {
	definition, ok := officialProviderDefinitions[strings.TrimSpace(input.ProviderID)]
	if !ok || !providerContains(definition.Environments, input.Environment) {
		return ProviderConnection{}, errors.New("official provider and supported environment required")
	}
	if !credentialReferenceRE.MatchString(input.CredentialReference) || !identifierRE.MatchString(input.CredentialVersion) {
		return ProviderConnection{}, errors.New("opaque credential reference and version required; secrets are not accepted")
	}
	now := s.now().UTC()
	id := "prv_" + hashString(actor.Merchant.ID, definition.ID, input.Environment)[:20]
	connection := ProviderConnection{ID: id, MerchantID: actor.Merchant.ID, ProviderID: definition.ID, Category: definition.Category, Environment: input.Environment, Capabilities: append([]string(nil), definition.Capabilities...), Status: "configured", Health: "unverified", HealthSource: "none", HealthVersion: definition.Version, HealthCoverage: "none", CredentialReference: input.CredentialReference, CredentialVersion: input.CredentialVersion, CreatedAt: now, UpdatedAt: now}
	err := s.store.Update(func(data *Snapshot) error {
		if current, exists := data.Providers[id]; exists {
			connection.CreatedAt = current.CreatedAt
		}
		data.Providers[id] = connection
		appendAudit(data, actor.Merchant.ID, actor.Account, "provider.configure", id, "committed", "provider="+definition.ID+" environment="+input.Environment+" credentialVersion="+input.CredentialVersion, now)
		return nil
	})
	return publicProviderConnection(connection), err
}

func (s *Service) TestProvider(ctx context.Context, actor MerchantPrincipal, id string) (ProviderConnection, error) {
	connection, definition, err := s.providerForMerchant(actor.Merchant.ID, id)
	if err != nil {
		return ProviderConnection{}, err
	}
	if connection.Status == "disabled" {
		return publicProviderConnection(connection), errors.New("provider connection is disabled")
	}
	now := s.now().UTC()
	connection.LastCheckedAt = &now
	connection.UpdatedAt = now
	var probeErr error
	result := ProviderProbeResult{Health: "unavailable", Source: "none", Version: definition.Version, Coverage: "none", FailureCode: "adapter_not_configured"}
	if s.providerProbe == nil {
		probeErr = errors.New("official provider adapter is not configured")
	} else {
		result, probeErr = s.providerProbe.Probe(ctx, definition, connection)
		if !validProbeResult(result, probeErr) {
			result = ProviderProbeResult{Health: "unavailable", Source: "none", Version: definition.Version, Coverage: "none", FailureCode: "invalid_probe_evidence"}
			probeErr = errors.New("official provider probe returned invalid evidence")
		}
	}
	connection.Health, connection.HealthSource, connection.HealthVersion, connection.HealthCoverage, connection.LastFailureCode = result.Health, result.Source, result.Version, result.Coverage, result.FailureCode
	if probeErr == nil && result.Health == "healthy" {
		connection.Status = "active"
		connection.LastSuccessAt = &now
	} else {
		connection.Status = "unavailable"
	}
	persistErr := s.store.Update(func(data *Snapshot) error {
		data.Providers[id] = connection
		outcome := "failed"
		if probeErr == nil {
			outcome = "verified"
		}
		appendAudit(data, actor.Merchant.ID, actor.Account, "provider.test", id, outcome, "health="+connection.Health+" source="+connection.HealthSource+" failure="+connection.LastFailureCode, now)
		return nil
	})
	if persistErr != nil {
		return ProviderConnection{}, persistErr
	}
	if probeErr != nil {
		return publicProviderConnection(connection), errors.New("provider connection unavailable; inspect the audited failure code")
	}
	return publicProviderConnection(connection), nil
}

func (s *Service) DisableProvider(actor MerchantPrincipal, id string) (ProviderConnection, error) {
	connection, _, err := s.providerForMerchant(actor.Merchant.ID, id)
	if err != nil {
		return ProviderConnection{}, err
	}
	now := s.now().UTC()
	connection.Status, connection.Health, connection.UpdatedAt = "disabled", "disabled", now
	err = s.store.Update(func(data *Snapshot) error {
		data.Providers[id] = connection
		appendAudit(data, actor.Merchant.ID, actor.Account, "provider.disable", id, "committed", "provider="+connection.ProviderID, now)
		return nil
	})
	return publicProviderConnection(connection), err
}

func (s *Service) providerForMerchant(merchantID, id string) (ProviderConnection, ProviderDefinition, error) {
	var connection ProviderConnection
	err := s.store.View(func(data Snapshot) error {
		var ok bool
		connection, ok = data.Providers[id]
		if !ok || connection.MerchantID != merchantID {
			return errors.New("provider connection not found")
		}
		return nil
	})
	definition, ok := officialProviderDefinitions[connection.ProviderID]
	if err != nil || !ok {
		if err == nil {
			err = errors.New("official provider definition not found")
		}
		return ProviderConnection{}, ProviderDefinition{}, err
	}
	return connection, definition, nil
}

func validProbeResult(result ProviderProbeResult, probeErr error) bool {
	if result.Version == "" || result.Coverage == "" {
		return false
	}
	if probeErr != nil {
		return result.Health == "unavailable" && result.FailureCode != ""
	}
	return (result.Health == "healthy" || result.Health == "degraded") && (result.Source == "official-provider-api" || result.Source == "ynx-authoritative-service") && result.FailureCode == ""
}

func publicProviderConnection(connection ProviderConnection) ProviderConnection {
	connection.Capabilities = append([]string(nil), connection.Capabilities...)
	return connection
}

func providerContains(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}
