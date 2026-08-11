package finance

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/readintegration"
)

const (
	ReadSourceEnvelopeVersion  = "finance-source-read-envelope-v1"
	maxReadSourceEnvelopeBytes = 2 << 20
)

type ReadSourceActionConfig struct {
	ExchangeURL  string
	DEXURL       string
	QuantURL     string
	EconomicsURL string
}

type ReadSourceIntegrationConfig struct {
	ExchangeURL string
	ExchangeKey string
	DEXURL      string
	DEXKey      string
	QuantURL    string
	QuantKey    string
}

type readSourceIntegration struct {
	URL string
	Key string
}

type ReadSourceAction struct {
	Label                 string `json:"label"`
	URL                   string `json:"url,omitempty"`
	Configured            bool   `json:"configured"`
	Owner                 string `json:"owner"`
	OpensOwnerProduct     bool   `json:"opensOwnerProduct"`
	RequiresOwnerApproval bool   `json:"requiresOwnerApproval"`
}

type ReadSourceDescriptor struct {
	ID                      string              `json:"id"`
	Name                    string              `json:"name"`
	Owner                   string              `json:"owner"`
	Capability              string              `json:"capability"`
	ConsumerEnvelopeVersion string              `json:"consumerEnvelopeVersion"`
	OwnerContractAccepted   bool                `json:"ownerContractAccepted"`
	ReadOnly                bool                `json:"readOnly"`
	Status                  SourceStatus        `json:"status"`
	Action                  ReadSourceAction    `json:"action"`
	ForbiddenCapabilities   []string            `json:"forbiddenCapabilities"`
	Envelope                *ReadSourceEnvelope `json:"envelope,omitempty"`
}

type ReadSourceEnvelope struct {
	EnvelopeVersion      string          `json:"envelopeVersion"`
	SourceID             string          `json:"sourceId"`
	Owner                string          `json:"owner"`
	Network              string          `json:"network"`
	NativeAsset          string          `json:"nativeAsset"`
	AuthorizedAccount    string          `json:"authorizedAccount"`
	OwnerContractVersion string          `json:"ownerContractVersion"`
	PayloadSchema        string          `json:"payloadSchema"`
	AsOf                 time.Time       `json:"asOf"`
	AsOfKind             string          `json:"asOfKind"`
	Coverage             string          `json:"coverage"`
	SyncStatus           string          `json:"syncStatus"`
	ReadOnly             bool            `json:"readOnly"`
	Capabilities         []string        `json:"capabilities"`
	Payload              json.RawMessage `json:"payload"`
}

type AcceptedReadSourceContract struct {
	Accepted             bool
	SourceID             string
	Owner                string
	OwnerContractVersion string
	PayloadSchema        string
	AllowedCapabilities  []string
}

type readSourceDefinition struct {
	ID         string
	Name       string
	Owner      string
	Capability string
	Action     string
}

var readSourceDefinitions = []readSourceDefinition{
	{ID: "exchange", Name: "YNX Exchange", Owner: "07-exchange", Capability: "Authorized subaccounts, positions, fills, fees, funding and PnL evidence", Action: "Open YNX Exchange"},
	{ID: "dex", Name: "YNX DEX", Owner: "27-dex", Capability: "Authorized vault, LP, swap, fee, redemption and emergency-exit evidence", Action: "Open YNX DEX"},
	{ID: "quant", Name: "YNX Quant Lab", Owner: "08-quant-lab", Capability: "Authorized strategy, mandate, capital, PnL, fee, drawdown, risk and exit evidence", Action: "Open YNX Quant Lab"},
	{ID: "economics", Name: "YNXT Economics", Owner: "17-tokenomics", Capability: "Versioned issuance, burn, staking-source, treasury, service-fee and reserve evidence", Action: "Open YNXT Economics"},
}

var forbiddenReadSourceCapabilities = []string{
	"transaction.sign",
	"order.place",
	"swap.execute",
	"withdrawal.execute",
	"transfer.execute",
	"owner.change",
	"address.manage",
	"leverage.change",
	"risk-limit.change",
	"mandate.write",
	"treasury.write",
	"strategy.pause",
	"session.revoke",
}

var acceptedReadSourceContracts = map[string]AcceptedReadSourceContract{
	"exchange": {
		Accepted:             true,
		SourceID:             "exchange",
		Owner:                "07-exchange",
		OwnerContractVersion: "exchange-finance-read-v1",
		PayloadSchema:        "ynx-exchange-finance-account-v1",
		AllowedCapabilities: []string{
			"exchange.subaccount.read",
			"exchange.orders.read",
			"exchange.fills.read",
			"exchange.fees.read",
			"exchange.margin.read",
			"exchange.funding.read",
			"exchange.risk.read",
		},
	},
	"quant": {
		Accepted:             true,
		SourceID:             "quant",
		Owner:                "08-quant-lab",
		OwnerContractVersion: "quant-finance-read-v1",
		PayloadSchema:        "ynx-quant-finance-account-v1",
		AllowedCapabilities: []string{
			"quant.strategies.read",
			"quant.mandates.read",
			"quant.executions.read",
			"quant.pnl.read",
			"quant.risk.read",
			"quant.lifecycle.read",
		},
	},
	"dex": {
		Accepted:             true,
		SourceID:             "dex",
		Owner:                "27-dex",
		OwnerContractVersion: "dex-finance-read-v1",
		PayloadSchema:        "ynx-dex-finance-account-v1",
		AllowedCapabilities: []string{
			"dex.positions.read",
			"dex.swaps.read",
			"dex.liquidity.read",
			"dex.fees.read",
		},
	},
}

func (u *Upstreams) ConfigureReadSourceIntegrations(config ReadSourceIntegrationConfig) error {
	candidates := []struct{ id, label, endpoint, key string }{
		{id: "exchange", label: "Exchange", endpoint: config.ExchangeURL, key: config.ExchangeKey},
		{id: "dex", label: "DEX", endpoint: config.DEXURL, key: config.DEXKey},
		{id: "quant", label: "Quant", endpoint: config.QuantURL, key: config.QuantKey},
	}
	integrations := map[string]readSourceIntegration{}
	for _, candidate := range candidates {
		endpoint, key := strings.TrimSpace(candidate.endpoint), strings.TrimSpace(candidate.key)
		if (endpoint == "") != (key == "") {
			return fmt.Errorf("%s read URL and key must be configured together", candidate.label)
		}
		if endpoint == "" {
			continue
		}
		parsed, err := requireHTTPURL(endpoint)
		if err != nil {
			return fmt.Errorf("%s read URL: %w", candidate.label, err)
		}
		if len(key) < 32 {
			return fmt.Errorf("%s read key must contain at least 32 characters", candidate.label)
		}
		integrations[candidate.id] = readSourceIntegration{URL: strings.TrimRight(parsed.String(), "/"), Key: key}
	}
	if len(integrations) == 0 {
		u.readIntegrations = nil
		return nil
	}
	u.readIntegrations = integrations
	return nil
}

func (u *Upstreams) ConfigureReadSourceActions(config ReadSourceActionConfig) error {
	values := map[string]string{
		"exchange":  config.ExchangeURL,
		"dex":       config.DEXURL,
		"quant":     config.QuantURL,
		"economics": config.EconomicsURL,
	}
	actions := make(map[string]string, len(values))
	for id, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		parsed, err := requireReviewedActionURL(value)
		if err != nil {
			return fmt.Errorf("%s action URL: %w", id, err)
		}
		actions[id] = parsed.String()
	}
	u.readSourceActions = actions
	return nil
}

func (u *Upstreams) ReadSources(observedAt time.Time) map[string]ReadSourceDescriptor {
	if observedAt.IsZero() {
		observedAt = time.Now().UTC()
	} else {
		observedAt = observedAt.UTC()
	}
	result := make(map[string]ReadSourceDescriptor, len(readSourceDefinitions))
	for _, definition := range readSourceDefinitions {
		actionURL := ""
		if u != nil && u.readSourceActions != nil {
			actionURL = u.readSourceActions[definition.ID]
		}
		statusAt := observedAt
		contract, accepted := acceptedReadSourceContracts[definition.ID]
		syncStatus := "owner-contract-pending"
		errorMessage := "No owner-frozen read-only contract has been accepted by Finance"
		if accepted && contract.Accepted {
			syncStatus = "integration-unconfigured"
			errorMessage = "Accepted owner contract is not configured with an integration endpoint"
		}
		result[definition.ID] = ReadSourceDescriptor{
			ID:                      definition.ID,
			Name:                    definition.Name,
			Owner:                   definition.Owner,
			Capability:              definition.Capability,
			ConsumerEnvelopeVersion: ReadSourceEnvelopeVersion,
			OwnerContractAccepted:   accepted && contract.Accepted,
			ReadOnly:                true,
			Status: SourceStatus{
				Available:  false,
				Source:     definition.Owner,
				Version:    ReadSourceEnvelopeVersion,
				AsOf:       &statusAt,
				AsOfKind:   "finance-contract-evaluated-at",
				Coverage:   definition.Capability,
				SyncStatus: syncStatus,
				Error:      errorMessage,
			},
			Action: ReadSourceAction{
				Label:                 definition.Action,
				URL:                   actionURL,
				Configured:            actionURL != "",
				Owner:                 definition.Owner,
				OpensOwnerProduct:     true,
				RequiresOwnerApproval: true,
			},
			ForbiddenCapabilities: append([]string(nil), forbiddenReadSourceCapabilities...),
		}
	}
	return result
}

func (u *Upstreams) ReadSourcesForAccount(ctx context.Context, account string, observedAt time.Time) map[string]ReadSourceDescriptor {
	result := u.ReadSources(observedAt)
	if u == nil || u.readIntegrations == nil {
		return result
	}
	for id, integration := range u.readIntegrations {
		descriptor, ok := result[id]
		if !ok {
			continue
		}
		contract, accepted := acceptedReadSourceContracts[id]
		if !accepted || !contract.Accepted {
			continue
		}
		result[id] = u.readSourceForAccount(ctx, account, observedAt, id, integration, descriptor, contract)
	}
	return result
}

func (u *Upstreams) readSourceForAccount(ctx context.Context, account string, observedAt time.Time, id string, integration readSourceIntegration, descriptor ReadSourceDescriptor, contract AcceptedReadSourceContract) ReadSourceDescriptor {
	endpoint := integration.URL + "/v1/integrations/finance/account"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err == nil {
		err = readintegration.Sign(request, integration.Key, "finance", id, account, observedAt)
	}
	if err != nil {
		descriptor.Status.Source = endpoint
		descriptor.Status.SyncStatus = "credential-generation-failed"
		descriptor.Status.Error = err.Error()
		return descriptor
	}
	client := u.client
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		descriptor.Status.Source = endpoint
		descriptor.Status.SyncStatus = "owner-endpoint-unavailable"
		descriptor.Status.Error = err.Error()
		return descriptor
	}
	defer response.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(response.Body, maxReadSourceEnvelopeBytes+1))
	if readErr != nil || len(body) > maxReadSourceEnvelopeBytes || response.StatusCode != http.StatusOK {
		descriptor.Status.Source = endpoint
		descriptor.Status.SyncStatus = "owner-response-rejected"
		if readErr != nil {
			descriptor.Status.Error = readErr.Error()
		} else if len(body) > maxReadSourceEnvelopeBytes {
			descriptor.Status.Error = "owner response exceeds the Finance evidence limit"
		} else {
			descriptor.Status.Error = fmt.Sprintf("owner endpoint returned HTTP %d", response.StatusCode)
		}
		return descriptor
	}
	envelope, err := ValidateReadSourceEnvelope(body, account, contract, observedAt)
	if err != nil {
		descriptor.Status.Source = endpoint
		descriptor.Status.SyncStatus = "owner-evidence-rejected"
		descriptor.Status.Error = err.Error()
		return descriptor
	}
	descriptor.Status = SourceStatus{
		Available:  true,
		Source:     endpoint,
		Version:    envelope.OwnerContractVersion,
		AsOf:       &envelope.AsOf,
		AsOfKind:   envelope.AsOfKind,
		Coverage:   envelope.Coverage,
		SyncStatus: envelope.SyncStatus,
	}
	descriptor.Envelope = &envelope
	return descriptor
}

func ValidateReadSourceEnvelope(raw []byte, expectedAccount string, contract AcceptedReadSourceContract, now time.Time) (ReadSourceEnvelope, error) {
	if !contract.Accepted {
		return ReadSourceEnvelope{}, errors.New("owner contract is not accepted")
	}
	definition, ok := readSourceDefinitionByID(contract.SourceID)
	if !ok || contract.Owner != definition.Owner {
		return ReadSourceEnvelope{}, errors.New("accepted contract source owner is invalid")
	}
	if strings.TrimSpace(contract.OwnerContractVersion) == "" || strings.TrimSpace(contract.PayloadSchema) == "" {
		return ReadSourceEnvelope{}, errors.New("accepted contract version and payload schema are required")
	}
	allowed := make(map[string]struct{}, len(contract.AllowedCapabilities))
	for _, capability := range contract.AllowedCapabilities {
		if err := validateReadCapability(capability); err != nil {
			return ReadSourceEnvelope{}, fmt.Errorf("accepted capability %q: %w", capability, err)
		}
		allowed[capability] = struct{}{}
	}
	if len(allowed) == 0 {
		return ReadSourceEnvelope{}, errors.New("accepted contract must declare read capabilities")
	}
	if len(raw) == 0 || len(raw) > maxReadSourceEnvelopeBytes {
		return ReadSourceEnvelope{}, errors.New("read-source envelope size is invalid")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var envelope ReadSourceEnvelope
	if err := decoder.Decode(&envelope); err != nil {
		return ReadSourceEnvelope{}, fmt.Errorf("decode read-source envelope: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return ReadSourceEnvelope{}, errors.New("read-source envelope must contain one JSON object")
	}
	if envelope.EnvelopeVersion != ReadSourceEnvelopeVersion || envelope.SourceID != contract.SourceID || envelope.Owner != contract.Owner {
		return ReadSourceEnvelope{}, errors.New("read-source envelope identity is invalid")
	}
	if envelope.Network != ChainID || envelope.NativeAsset != "YNXT" {
		return ReadSourceEnvelope{}, errors.New("read-source network or native asset is invalid")
	}
	if !sameNormalizedAccount(envelope.AuthorizedAccount, expectedAccount) {
		return ReadSourceEnvelope{}, errors.New("read-source authorized account is invalid")
	}
	if envelope.OwnerContractVersion != contract.OwnerContractVersion || envelope.PayloadSchema != contract.PayloadSchema {
		return ReadSourceEnvelope{}, errors.New("read-source owner contract version or payload schema is invalid")
	}
	if !envelope.ReadOnly {
		return ReadSourceEnvelope{}, errors.New("read-source envelope is not read-only")
	}
	seenCapabilities := map[string]struct{}{}
	if len(envelope.Capabilities) == 0 {
		return ReadSourceEnvelope{}, errors.New("read-source capabilities are required")
	}
	for _, capability := range envelope.Capabilities {
		if err := validateReadCapability(capability); err != nil {
			return ReadSourceEnvelope{}, err
		}
		if _, ok := allowed[capability]; !ok {
			return ReadSourceEnvelope{}, fmt.Errorf("read-source capability %q is not accepted", capability)
		}
		if _, duplicate := seenCapabilities[capability]; duplicate {
			return ReadSourceEnvelope{}, fmt.Errorf("read-source capability %q is duplicated", capability)
		}
		seenCapabilities[capability] = struct{}{}
	}
	if envelope.AsOf.IsZero() || strings.TrimSpace(envelope.AsOfKind) == "" || strings.TrimSpace(envelope.Coverage) == "" || strings.TrimSpace(envelope.SyncStatus) == "" {
		return ReadSourceEnvelope{}, errors.New("read-source provenance is incomplete")
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if envelope.AsOf.After(now.UTC().Add(5 * time.Minute)) {
		return ReadSourceEnvelope{}, errors.New("read-source as-of time is in the future")
	}
	payload := bytes.TrimSpace(envelope.Payload)
	if len(payload) == 0 || bytes.Equal(payload, []byte("null")) {
		return ReadSourceEnvelope{}, errors.New("read-source payload is required")
	}
	return envelope, nil
}

func readSourceDefinitionByID(id string) (readSourceDefinition, bool) {
	for _, definition := range readSourceDefinitions {
		if definition.ID == id {
			return definition, true
		}
	}
	return readSourceDefinition{}, false
}

func validateReadCapability(capability string) error {
	value := strings.TrimSpace(capability)
	if value == "" || value != capability {
		return errors.New("read-source capability is invalid")
	}
	tokens := strings.FieldsFunc(strings.ToLower(value), func(r rune) bool {
		return r == '.' || r == ':' || r == '/' || r == '_' || r == '-'
	})
	if len(tokens) < 2 || tokens[len(tokens)-1] != "read" {
		return errors.New("read-source capability must end in read")
	}
	for _, token := range tokens {
		switch token {
		case "write", "sign", "execute", "mutate", "change", "management", "manage", "control", "pause", "resume", "revoke", "approve", "submit", "place", "cancel", "delete", "create", "update", "settle", "rotate":
			return errors.New("mutation capability is forbidden")
		}
	}
	return nil
}

func sameNormalizedAccount(left, right string) bool {
	leftNormalized, err := accountaddress.Normalize(left)
	if err != nil {
		return false
	}
	rightNormalized, err := accountaddress.Normalize(right)
	return err == nil && leftNormalized == rightNormalized
}

func requireReviewedActionURL(value string) (*url.URL, error) {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return nil, errors.New("absolute HTTPS URL without embedded credentials required")
	}
	return parsed, nil
}
