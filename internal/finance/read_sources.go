package finance

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
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

type ReadSourceAction struct {
	Label                 string `json:"label"`
	URL                   string `json:"url,omitempty"`
	Configured            bool   `json:"configured"`
	Owner                 string `json:"owner"`
	OpensOwnerProduct     bool   `json:"opensOwnerProduct"`
	RequiresOwnerApproval bool   `json:"requiresOwnerApproval"`
}

type ReadSourceDescriptor struct {
	ID                      string           `json:"id"`
	Name                    string           `json:"name"`
	Owner                   string           `json:"owner"`
	Capability              string           `json:"capability"`
	ConsumerEnvelopeVersion string           `json:"consumerEnvelopeVersion"`
	OwnerContractAccepted   bool             `json:"ownerContractAccepted"`
	ReadOnly                bool             `json:"readOnly"`
	Status                  SourceStatus     `json:"status"`
	Action                  ReadSourceAction `json:"action"`
	ForbiddenCapabilities   []string         `json:"forbiddenCapabilities"`
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
		result[definition.ID] = ReadSourceDescriptor{
			ID:                      definition.ID,
			Name:                    definition.Name,
			Owner:                   definition.Owner,
			Capability:              definition.Capability,
			ConsumerEnvelopeVersion: ReadSourceEnvelopeVersion,
			OwnerContractAccepted:   false,
			ReadOnly:                true,
			Status: SourceStatus{
				Available:  false,
				Source:     definition.Owner,
				Version:    ReadSourceEnvelopeVersion,
				AsOf:       &statusAt,
				AsOfKind:   "finance-contract-evaluated-at",
				Coverage:   definition.Capability,
				SyncStatus: "owner-contract-pending",
				Error:      "No owner-frozen read-only contract has been accepted by Finance",
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
