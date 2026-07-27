package cardproduct

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrProviderUnavailable = errors.New("card issuer provider unavailable")

type IssueRequest struct{ ApplicationID, Account, EligibilityReference string }
type ProviderCard struct {
	ProviderCardID, Network, Last4 string
	ExpiryMonth, ExpiryYear        int
	Status                         string
}

type IssuerProvider interface {
	Name() string
	Capabilities() ProviderCapabilities
	Health(context.Context) error
	CheckEligibility(context.Context, string, string) (Eligibility, error)
	SubmitApplication(context.Context, IssueRequest) (string, string, error)
	IssueSandbox(context.Context, IssueRequest) (ProviderCard, error)
	UpdateStatus(context.Context, string, string) error
	Replace(context.Context, string) (ProviderCard, error)
	UpdateControls(context.Context, string, Controls) error
}

type UnavailableProvider struct{ ProviderName string }

func (p UnavailableProvider) Name() string {
	if strings.TrimSpace(p.ProviderName) == "" {
		return "unconfigured-issuer"
	}
	return p.ProviderName
}
func (p UnavailableProvider) Capabilities() ProviderCapabilities {
	return unavailableCapabilities(p.Name())
}
func (p UnavailableProvider) Health(context.Context) error { return ErrProviderUnavailable }
func (p UnavailableProvider) CheckEligibility(context.Context, string, string) (Eligibility, error) {
	return Eligibility{}, ErrProviderUnavailable
}
func (p UnavailableProvider) SubmitApplication(context.Context, IssueRequest) (string, string, error) {
	return "", "provider_unavailable", ErrProviderUnavailable
}
func (p UnavailableProvider) IssueSandbox(context.Context, IssueRequest) (ProviderCard, error) {
	return ProviderCard{}, ErrProviderUnavailable
}
func (p UnavailableProvider) UpdateStatus(context.Context, string, string) error {
	return ErrProviderUnavailable
}
func (p UnavailableProvider) Replace(context.Context, string) (ProviderCard, error) {
	return ProviderCard{}, ErrProviderUnavailable
}
func (p UnavailableProvider) UpdateControls(context.Context, string, Controls) error {
	return ErrProviderUnavailable
}

type SandboxProvider struct{ now func() time.Time }

func NewSandboxProvider(now func() time.Time) SandboxProvider {
	if now == nil {
		now = time.Now
	}
	return SandboxProvider{now: now}
}
func (SandboxProvider) Name() string { return "YNX Card Testnet Sandbox" }
func (p SandboxProvider) Capabilities() ProviderCapabilities {
	return sandboxCapabilities(p.Name())
}
func (SandboxProvider) Health(context.Context) error { return nil }
func (p SandboxProvider) CheckEligibility(_ context.Context, account, reference string) (Eligibility, error) {
	if strings.HasPrefix(reference, "kyc_rejected_") {
		return Eligibility{Reference: reference, Status: "rejected", Provider: p.Name(), UpdatedAt: p.now().UTC()}, nil
	}
	if !strings.HasPrefix(reference, "kyc_sandbox_") {
		return Eligibility{Reference: reference, Status: "pending_review", Provider: p.Name(), UpdatedAt: p.now().UTC()}, nil
	}
	return Eligibility{Reference: reference, Status: "eligible_sandbox", Provider: p.Name(), UpdatedAt: p.now().UTC()}, nil
}
func (p SandboxProvider) SubmitApplication(_ context.Context, req IssueRequest) (string, string, error) {
	if !strings.HasPrefix(req.EligibilityReference, "kyc_sandbox_") {
		return "", "pending_review", nil
	}
	return "provapp_" + shortHash(req.ApplicationID, req.Account), "issued_sandbox", nil
}
func (p SandboxProvider) IssueSandbox(_ context.Context, req IssueRequest) (ProviderCard, error) {
	hash := shortHash(req.ApplicationID, req.Account, "card")
	return ProviderCard{ProviderCardID: "pcard_" + hash, Network: Network, Last4: sandboxLast4(hash), ExpiryMonth: 12, ExpiryYear: p.now().UTC().Year() + 3, Status: "issued_sandbox"}, nil
}
func (SandboxProvider) UpdateStatus(_ context.Context, _ string, status string) error {
	if !contains([]string{"active", "frozen", "closed"}, status) {
		return fmt.Errorf("sandbox provider rejects status")
	}
	return nil
}
func (p SandboxProvider) Replace(_ context.Context, providerCardID string) (ProviderCard, error) {
	hash := shortHash(providerCardID, p.now().UTC().Format(time.RFC3339Nano))
	return ProviderCard{ProviderCardID: "pcard_" + hash, Network: Network, Last4: sandboxLast4(hash), ExpiryMonth: 12, ExpiryYear: p.now().UTC().Year() + 3, Status: "issued_sandbox"}, nil
}
func (SandboxProvider) UpdateControls(context.Context, string, Controls) error { return nil }

func sandboxLast4(seed string) string {
	sum := sha256.Sum256([]byte(seed))
	return fmt.Sprintf("%d%d%d%d", sum[0]%10, sum[1]%10, sum[2]%10, sum[3]%10)
}

type AIProvider interface {
	Complete(context.Context, string, string) (provider, model, result string, units int64, err error)
}
