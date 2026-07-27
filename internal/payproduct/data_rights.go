package payproduct

import (
	"errors"
	"sort"
	"strings"
	"time"
)

const (
	merchantDataExportSchemaVersion = 1
	merchantRetentionPolicyVersion  = "merchant-data-retention-v1"
	merchantDeletionCoolingOffHours = 168
)

type MerchantDataRetentionPolicy struct {
	Version                  string `json:"version"`
	DeletionCoolingOffHours  int    `json:"deletionCoolingOffHours"`
	AutomaticDeletionEnabled bool   `json:"automaticDeletionEnabled"`
	ExecutionAuthority       string `json:"executionAuthority"`
	FinancialEvidenceRule    string `json:"financialEvidenceRule"`
	OpenCaseRule             string `json:"openCaseRule"`
	AuditRule                string `json:"auditRule"`
	ProviderDataRule         string `json:"providerDataRule"`
	PublicChainDataRule      string `json:"publicChainDataRule"`
	SensitiveMaterialRule    string `json:"sensitiveMaterialRule"`
	Source                   string `json:"source"`
}

type MerchantDataRightsOverview struct {
	SchemaVersion int                         `json:"schemaVersion"`
	MerchantID    string                      `json:"merchantId"`
	Policy        MerchantDataRetentionPolicy `json:"policy"`
	Requests      []MerchantDataRequest       `json:"requests"`
	AsOf          time.Time                   `json:"asOf"`
	Source        string                      `json:"source"`
}

type MerchantDataExport struct {
	SchemaVersion int                         `json:"schemaVersion"`
	Merchant      Merchant                    `json:"merchant"`
	Members       []MerchantMember            `json:"members"`
	Catalog       []CatalogItem               `json:"catalog"`
	Invoices      []Invoice                   `json:"invoices"`
	Refunds       []RefundRequest             `json:"refunds"`
	Disputes      []Dispute                   `json:"disputes"`
	Deliveries    []WebhookDelivery           `json:"deliveries"`
	AIRuns        []AIRun                     `json:"aiRuns"`
	Providers     []ProviderConnection        `json:"providers"`
	DataRequests  []MerchantDataRequest       `json:"dataRequests"`
	Audit         []AuditEntry                `json:"audit"`
	Policy        MerchantDataRetentionPolicy `json:"policy"`
	Redactions    []string                    `json:"redactions"`
	GeneratedAt   time.Time                   `json:"generatedAt"`
	Source        string                      `json:"source"`
}

type MerchantDeletionRequestInput struct {
	ConfirmMerchantID string `json:"confirmMerchantId"`
	Reason            string `json:"reason"`
	IdempotencyKey    string `json:"idempotencyKey"`
}

func merchantDataRetentionPolicy() MerchantDataRetentionPolicy {
	return MerchantDataRetentionPolicy{
		Version:                  merchantRetentionPolicyVersion,
		DeletionCoolingOffHours:  merchantDeletionCoolingOffHours,
		AutomaticDeletionEnabled: false,
		ExecutionAuthority:       "accepted retention policy and explicit operator approval required",
		FinancialEvidenceRule:    "retain authoritative settlement, refund, dispute and reconciliation evidence until obligations are resolved and an accepted policy authorizes disposition",
		OpenCaseRule:             "open refund, dispute and delivery obligations block deletion execution",
		AuditRule:                "audit disposition requires an accepted policy; records are never silently erased",
		ProviderDataRule:         "third-party provider data requires provider-specific export or deletion evidence; this service never claims provider-held data was deleted",
		PublicChainDataRule:      "confirmed public-chain records are immutable references and are never represented as deleted by this service",
		SensitiveMaterialRule:    "sensitive runtime authorization material is excluded from exports and handled only through approved rotation or shutdown",
		Source:                   "merchant-console-policy-v1",
	}
}

func (s *Service) MerchantDataRights(actor MerchantPrincipal) (MerchantDataRightsOverview, error) {
	if actor.Role != "owner" {
		return MerchantDataRightsOverview{}, errors.New("owner role required for merchant data rights")
	}
	out := MerchantDataRightsOverview{SchemaVersion: merchantDataExportSchemaVersion, MerchantID: actor.Merchant.ID, Policy: merchantDataRetentionPolicy(), Requests: []MerchantDataRequest{}, AsOf: s.now().UTC(), Source: "integrity-protected-merchant-store"}
	err := s.store.View(func(data Snapshot) error {
		if _, ok := data.Merchants[actor.Merchant.ID]; !ok {
			return errors.New("merchant not found")
		}
		for _, request := range data.DataRequests {
			if request.MerchantID == actor.Merchant.ID {
				out.Requests = append(out.Requests, request)
			}
		}
		sort.Slice(out.Requests, func(i, j int) bool {
			if out.Requests[i].CreatedAt.Equal(out.Requests[j].CreatedAt) {
				return out.Requests[i].ID < out.Requests[j].ID
			}
			return out.Requests[i].CreatedAt.Before(out.Requests[j].CreatedAt)
		})
		return nil
	})
	return out, err
}

func (s *Service) ExportMerchantData(actor MerchantPrincipal) (MerchantDataExport, error) {
	if actor.Role != "owner" {
		return MerchantDataExport{}, errors.New("owner role required for merchant data export")
	}
	now := s.now().UTC()
	out := MerchantDataExport{
		SchemaVersion: merchantDataExportSchemaVersion,
		Members:       []MerchantMember{},
		Catalog:       []CatalogItem{},
		Invoices:      []Invoice{},
		Refunds:       []RefundRequest{},
		Disputes:      []Dispute{},
		Deliveries:    []WebhookDelivery{},
		AIRuns:        []AIRun{},
		Providers:     []ProviderConnection{},
		DataRequests:  []MerchantDataRequest{},
		Audit:         []AuditEntry{},
		Policy:        merchantDataRetentionPolicy(),
		Redactions: []string{
			"authorization internals",
			"runtime session material",
			"replay and idempotency internals",
			"provider access material",
			"delivery authentication values",
		},
		GeneratedAt: now,
		Source:      "integrity-protected-merchant-store",
	}
	err := s.store.View(func(data Snapshot) error {
		merchant, ok := data.Merchants[actor.Merchant.ID]
		if !ok {
			return errors.New("merchant not found")
		}
		out.Merchant = publicMerchant(merchant)
		for _, member := range data.MerchantMembers {
			if member.MerchantID == actor.Merchant.ID {
				out.Members = append(out.Members, member)
			}
		}
		for _, item := range data.Catalog {
			if item.MerchantID == actor.Merchant.ID {
				out.Catalog = append(out.Catalog, item)
			}
		}
		for _, invoice := range data.Invoices {
			if invoice.MerchantID == actor.Merchant.ID {
				out.Invoices = append(out.Invoices, invoice)
			}
		}
		for _, refund := range data.Refunds {
			if refund.MerchantID == actor.Merchant.ID {
				out.Refunds = append(out.Refunds, refund)
			}
		}
		for _, dispute := range data.Disputes {
			if dispute.MerchantID == actor.Merchant.ID {
				out.Disputes = append(out.Disputes, dispute)
			}
		}
		for _, delivery := range data.Deliveries {
			if delivery.MerchantID == actor.Merchant.ID {
				delivery.Signature = ""
				out.Deliveries = append(out.Deliveries, delivery)
			}
		}
		for _, run := range data.AIRuns {
			if run.MerchantID == actor.Merchant.ID {
				out.AIRuns = append(out.AIRuns, run)
			}
		}
		for _, provider := range data.Providers {
			if provider.MerchantID == actor.Merchant.ID {
				provider = publicProviderConnection(provider)
				provider.CredentialReference = ""
				out.Providers = append(out.Providers, provider)
			}
		}
		for _, request := range data.DataRequests {
			if request.MerchantID == actor.Merchant.ID {
				out.DataRequests = append(out.DataRequests, request)
			}
		}
		for _, entry := range data.Audit {
			if entry.MerchantID == actor.Merchant.ID {
				out.Audit = append(out.Audit, entry)
			}
		}
		return nil
	})
	if err != nil {
		return MerchantDataExport{}, err
	}
	sortMerchantDataExport(&out)
	return out, nil
}

func (s *Service) RequestMerchantDeletion(actor MerchantPrincipal, input MerchantDeletionRequestInput) (MerchantDataRequest, error) {
	if actor.Role != "owner" {
		return MerchantDataRequest{}, errors.New("owner role required for merchant deletion request")
	}
	if strings.TrimSpace(input.ConfirmMerchantID) != actor.Merchant.ID {
		return MerchantDataRequest{}, errors.New("exact merchant ID confirmation required")
	}
	reason := strings.TrimSpace(input.Reason)
	if len(reason) < 8 || len(reason) > 500 {
		return MerchantDataRequest{}, errors.New("deletion reason must contain 8 to 500 characters")
	}
	key, err := validKey(input.IdempotencyKey)
	if err != nil {
		return MerchantDataRequest{}, err
	}
	input.ConfirmMerchantID = actor.Merchant.ID
	input.Reason = reason
	input.IdempotencyKey = key
	now := s.now().UTC()
	requestHash := hashJSON(input)
	requestID := "mdr_" + hashString(actor.Merchant.ID, key)[:20]
	eligibleAt := now.Add(merchantDeletionCoolingOffHours * time.Hour)
	err = s.idempotentUpdate("merchant-data-deletion", actor.Merchant.ID, key, requestHash, requestID, func(data *Snapshot) error {
		if _, ok := data.Merchants[actor.Merchant.ID]; !ok {
			return errors.New("merchant not found")
		}
		for _, existing := range data.DataRequests {
			if existing.MerchantID == actor.Merchant.ID && existing.Type == "deletion" && existing.ID != requestID && existing.Status != "canceled" && existing.Status != "rejected" && existing.Status != "completed" {
				return errors.New("merchant already has an active deletion request")
			}
		}
		blockers := merchantDeletionBlockers(*data, actor.Merchant.ID)
		status := "cooling_off"
		if len(blockers) > 0 {
			status = "retention_blocked"
		}
		data.DataRequests[requestID] = MerchantDataRequest{ID: requestID, MerchantID: actor.Merchant.ID, Type: "deletion", Status: status, RequestedBy: actor.Account, Reason: reason, PolicyVersion: merchantRetentionPolicyVersion, Blockers: blockers, EligibleAt: &eligibleAt, CreatedAt: now, UpdatedAt: now}
		appendAudit(data, actor.Merchant.ID, actor.Account, "merchant.data.deletion.request", requestID, "committed", "status="+status+"; automatic deletion disabled", now)
		return nil
	})
	if err != nil {
		return MerchantDataRequest{}, err
	}
	var out MerchantDataRequest
	err = s.store.View(func(data Snapshot) error {
		var ok bool
		out, ok = data.DataRequests[requestID]
		if !ok {
			return errors.New("merchant deletion request not found")
		}
		return nil
	})
	return out, err
}

func (s *Service) CancelMerchantDeletion(actor MerchantPrincipal, requestID string) (MerchantDataRequest, error) {
	if actor.Role != "owner" {
		return MerchantDataRequest{}, errors.New("owner role required for merchant deletion cancellation")
	}
	requestID = strings.TrimSpace(requestID)
	if !identifierRE.MatchString(requestID) || !strings.HasPrefix(requestID, "mdr_") {
		return MerchantDataRequest{}, errors.New("valid merchant deletion request ID required")
	}
	now := s.now().UTC()
	var out MerchantDataRequest
	err := s.store.Update(func(data *Snapshot) error {
		request, ok := data.DataRequests[requestID]
		if !ok || request.MerchantID != actor.Merchant.ID || request.Type != "deletion" {
			return errors.New("merchant deletion request not found")
		}
		if request.Status == "completed" || request.Status == "rejected" {
			return errors.New("merchant deletion request can no longer be canceled")
		}
		if request.Status == "canceled" {
			out = request
			return nil
		}
		request.Status = "canceled"
		request.CanceledAt = &now
		request.UpdatedAt = now
		data.DataRequests[requestID] = request
		appendAudit(data, actor.Merchant.ID, actor.Account, "merchant.data.deletion.cancel", requestID, "committed", "deletion request canceled before execution", now)
		out = request
		return nil
	})
	return out, err
}

func merchantDeletionBlockers(data Snapshot, merchantID string) []string {
	seen := map[string]bool{}
	for _, invoice := range data.Invoices {
		if invoice.MerchantID != merchantID {
			continue
		}
		if invoice.Status == "pending" {
			seen["open-invoice"] = true
		}
		if invoice.Status == "committed" || invoice.Settlement != nil {
			seen["financial-record-retention-policy-unaccepted"] = true
		}
	}
	for _, provider := range data.Providers {
		if provider.MerchantID == merchantID && provider.Status != "disabled" {
			seen["provider-data-disposition-unverified"] = true
		}
	}
	for _, refund := range data.Refunds {
		if refund.MerchantID == merchantID && refund.Status != "resolved" && refund.Status != "rejected" && refund.Status != "canceled" {
			seen["open-refund-request"] = true
		}
	}
	for _, dispute := range data.Disputes {
		if dispute.MerchantID == merchantID && dispute.Status != "resolved" && dispute.Status != "rejected" && dispute.Status != "closed" {
			seen["open-dispute"] = true
		}
	}
	for _, delivery := range data.Deliveries {
		if delivery.MerchantID == merchantID && (delivery.Status == "queued" || delivery.Status == "retrying" || delivery.Status == "pending") {
			seen["pending-webhook-delivery"] = true
		}
	}
	out := make([]string, 0, len(seen))
	for blocker := range seen {
		out = append(out, blocker)
	}
	sort.Strings(out)
	return out
}

func sortMerchantDataExport(out *MerchantDataExport) {
	sort.Slice(out.Members, func(i, j int) bool { return out.Members[i].Account < out.Members[j].Account })
	sort.Slice(out.Catalog, func(i, j int) bool { return out.Catalog[i].ID < out.Catalog[j].ID })
	sort.Slice(out.Invoices, func(i, j int) bool { return out.Invoices[i].ID < out.Invoices[j].ID })
	sort.Slice(out.Refunds, func(i, j int) bool { return out.Refunds[i].ID < out.Refunds[j].ID })
	sort.Slice(out.Disputes, func(i, j int) bool { return out.Disputes[i].ID < out.Disputes[j].ID })
	sort.Slice(out.Deliveries, func(i, j int) bool { return out.Deliveries[i].ID < out.Deliveries[j].ID })
	sort.Slice(out.AIRuns, func(i, j int) bool { return out.AIRuns[i].ID < out.AIRuns[j].ID })
	sort.Slice(out.Providers, func(i, j int) bool { return out.Providers[i].ID < out.Providers[j].ID })
	sort.Slice(out.DataRequests, func(i, j int) bool { return out.DataRequests[i].ID < out.DataRequests[j].ID })
	sort.Slice(out.Audit, func(i, j int) bool {
		if out.Audit[i].At.Equal(out.Audit[j].At) {
			return out.Audit[i].ID < out.Audit[j].ID
		}
		return out.Audit[i].At.Before(out.Audit[j].At)
	})
}
