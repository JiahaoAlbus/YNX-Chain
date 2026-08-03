package commerce

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	sellerDataExportSchemaVersion = 1
	minimumTransientRetention     = 30 * 24 * time.Hour
)

type SellerDataExport struct {
	SchemaVersion   int                      `json:"schemaVersion"`
	Source          string                   `json:"source"`
	AsOf            time.Time                `json:"asOf"`
	SnapshotVersion int                      `json:"snapshotVersion"`
	Store           StoreProfile             `json:"store"`
	Products        []Product                `json:"products"`
	Orders          []Order                  `json:"orders"`
	Roles           map[string]string        `json:"roles"`
	Revocations     []SellerRoleRevocation   `json:"revocations"`
	Invitations     []SellerInvitation       `json:"invitations"`
	Events          []SellerIntegrationEvent `json:"events"`
	Providers       []ProviderView           `json:"providers"`
	Audits          []AuditEvent             `json:"audits"`
	IncludedClasses []string                 `json:"includedClasses"`
	ExcludedClasses []string                 `json:"excludedClasses"`
}

type TransientRetentionPreview struct {
	Cutoff                time.Time `json:"cutoff"`
	MinimumRetentionHours int       `json:"minimumRetentionHours"`
	AIJobs                int       `json:"aiJobs"`
	RequestSamples        int       `json:"requestSamples"`
	ProtectedClasses      []string  `json:"protectedClasses"`
}

type TransientRetentionResult struct {
	TransientRetentionPreview
	CompletedAt time.Time `json:"completedAt"`
}

func (s *Store) ExportSellerData(actor, storeID, purpose string) (SellerDataExport, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	storeID = strings.TrimSpace(storeID)
	store, ok := s.s.Stores[storeID]
	if !ok {
		return SellerDataExport{}, ErrNotFound
	}
	if err := s.requireSellerLocked(storeID, actor, SellerRoleOwner); err != nil {
		return SellerDataExport{}, err
	}
	purpose = strings.TrimSpace(purpose)
	if len(purpose) > 256 {
		return SellerDataExport{}, errors.New("export purpose must not exceed 256 characters")
	}
	if purpose == "" {
		purpose = "owner-requested store data portability export"
	}

	auditLen := len(s.s.Audits)
	s.auditLocked(actor, SellerRoleOwner, "seller_data_exported", "store", storeID, "approved", purpose+"; transient runtime state excluded")
	if err := s.persistLocked(); err != nil {
		s.s.Audits = s.s.Audits[:auditLen]
		return SellerDataExport{}, err
	}

	objectIDs := map[string]struct{}{storeID: {}}
	products := make([]Product, 0)
	for _, product := range s.s.Products {
		if product.StoreID != storeID {
			continue
		}
		products = append(products, product)
		objectIDs[product.ID] = struct{}{}
	}
	sort.Slice(products, func(i, j int) bool { return products[i].ID < products[j].ID })

	orders := make([]Order, 0)
	for _, order := range s.s.Orders {
		if order.StoreID != storeID {
			continue
		}
		orders = append(orders, order)
		objectIDs[order.ID] = struct{}{}
	}
	sort.Slice(orders, func(i, j int) bool { return orders[i].ID < orders[j].ID })

	roles := make(map[string]string, len(s.s.SellerRoles[storeID]))
	for account, role := range s.s.SellerRoles[storeID] {
		roles[account] = role
	}

	revocations := make([]SellerRoleRevocation, 0)
	for _, revocation := range s.s.SellerRevocations {
		if revocation.StoreID != storeID {
			continue
		}
		revocations = append(revocations, revocation)
		objectIDs[revocation.ID] = struct{}{}
	}
	sort.Slice(revocations, func(i, j int) bool { return revocations[i].ID < revocations[j].ID })

	invitations := make([]SellerInvitation, 0)
	for _, invitation := range s.s.SellerInvitations {
		if invitation.StoreID != storeID {
			continue
		}
		invitations = append(invitations, invitation)
		objectIDs[invitation.ID] = struct{}{}
	}
	sort.Slice(invitations, func(i, j int) bool { return invitations[i].ID < invitations[j].ID })

	events := make([]SellerIntegrationEvent, 0)
	for _, event := range s.s.SellerEvents {
		if event.StoreID == storeID {
			events = append(events, event)
		}
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i].OccurredAt.Equal(events[j].OccurredAt) {
			return events[i].ID < events[j].ID
		}
		return events[i].OccurredAt.Before(events[j].OccurredAt)
	})

	providers := make([]ProviderView, 0)
	for key, config := range s.s.ProviderConfigs {
		if config.StoreID != storeID {
			continue
		}
		providers = append(providers, providerView(config))
		objectIDs[key] = struct{}{}
	}
	sort.Slice(providers, func(i, j int) bool { return providers[i].Kind < providers[j].Kind })

	audits := make([]AuditEvent, 0)
	for _, audit := range s.s.Audits {
		if _, include := objectIDs[audit.ObjectID]; include {
			audits = append(audits, audit)
		}
	}
	sort.Slice(audits, func(i, j int) bool {
		if audits[i].At.Equal(audits[j].At) {
			return audits[i].ID < audits[j].ID
		}
		return audits[i].At.Before(audits[j].At)
	})

	export := SellerDataExport{
		SchemaVersion:   sellerDataExportSchemaVersion,
		Source:          "ynx-seller-console-local-authority",
		AsOf:            s.now(),
		SnapshotVersion: s.s.Version,
		Store:           store,
		Products:        products,
		Orders:          orders,
		Roles:           roles,
		Revocations:     revocations,
		Invitations:     invitations,
		Events:          events,
		Providers:       providers,
		Audits:          audits,
		IncludedClasses: []string{"store_profile", "catalog", "inventory", "orders", "settlement_and_refund_evidence", "seller_roles", "seller_invitations", "seller_revocations", "seller_outbox", "provider_configuration_metadata", "store_scoped_audit"},
		ExcludedClasses: []string{"unrelated_stores", "buyer_profiles", "carts", "ai_jobs", "idempotency_records", "rate_limit_windows", "provider_access_references"},
	}
	encoded, err := json.Marshal(export)
	if err != nil {
		return SellerDataExport{}, err
	}
	var clone SellerDataExport
	if err := json.Unmarshal(encoded, &clone); err != nil {
		return SellerDataExport{}, err
	}
	return clone, nil
}

func retentionCutoff(now, cutoff time.Time) error {
	if cutoff.IsZero() {
		return errors.New("retention cutoff required")
	}
	if cutoff.After(now.Add(-minimumTransientRetention)) {
		return fmt.Errorf("retention cutoff must be at least %d hours old", int(minimumTransientRetention/time.Hour))
	}
	return nil
}

func terminalAIJob(job AIJob) bool {
	switch job.Status {
	case "applied_draft", "rejected", "cancelled":
		return true
	default:
		return false
	}
}

func (s *Store) transientRetentionPreviewLocked(cutoff time.Time) TransientRetentionPreview {
	preview := TransientRetentionPreview{
		Cutoff:                cutoff,
		MinimumRetentionHours: int(minimumTransientRetention / time.Hour),
		ProtectedClasses:      []string{"stores", "products", "orders", "settlement_and_refund_evidence", "seller_roles", "seller_invitations", "seller_revocations", "seller_outbox", "audits", "idempotency_records", "buyer_profiles", "carts"},
	}
	for _, job := range s.s.AIJobs {
		if terminalAIJob(job) && !job.UpdatedAt.After(cutoff) {
			preview.AIJobs++
		}
	}
	for _, samples := range s.s.RequestWindow {
		for _, at := range samples {
			if !at.After(cutoff) {
				preview.RequestSamples++
			}
		}
	}
	return preview
}

func (s *Store) PreviewTransientDataPrune(cutoff time.Time) (TransientRetentionPreview, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := retentionCutoff(s.now(), cutoff); err != nil {
		return TransientRetentionPreview{}, err
	}
	return s.transientRetentionPreviewLocked(cutoff), nil
}

func (s *Store) PruneTransientData(cutoff time.Time) (TransientRetentionResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	if err := retentionCutoff(now, cutoff); err != nil {
		return TransientRetentionResult{}, err
	}
	preview := s.transientRetentionPreviewLocked(cutoff)

	originalAIJobs := make(map[string]AIJob, len(s.s.AIJobs))
	for id, job := range s.s.AIJobs {
		originalAIJobs[id] = job
	}
	originalRequestWindow := make(map[string][]time.Time, len(s.s.RequestWindow))
	for key, samples := range s.s.RequestWindow {
		originalRequestWindow[key] = append([]time.Time(nil), samples...)
	}
	auditLen := len(s.s.Audits)

	for id, job := range s.s.AIJobs {
		if terminalAIJob(job) && !job.UpdatedAt.After(cutoff) {
			delete(s.s.AIJobs, id)
		}
	}
	for key, samples := range s.s.RequestWindow {
		kept := samples[:0]
		for _, at := range samples {
			if at.After(cutoff) {
				kept = append(kept, at)
			}
		}
		if len(kept) == 0 {
			delete(s.s.RequestWindow, key)
			continue
		}
		s.s.RequestWindow[key] = kept
	}
	s.auditLocked("operator-retention", "system", "transient_retention_pruned", "commerce_state", "snapshot", "approved", fmt.Sprintf("cutoff=%s ai_jobs=%d request_samples=%d; authority and financial evidence retained", cutoff.UTC().Format(time.RFC3339), preview.AIJobs, preview.RequestSamples))
	if err := s.persistLocked(); err != nil {
		s.s.AIJobs = originalAIJobs
		s.s.RequestWindow = originalRequestWindow
		s.s.Audits = s.s.Audits[:auditLen]
		return TransientRetentionResult{}, err
	}
	return TransientRetentionResult{TransientRetentionPreview: preview, CompletedAt: now}, nil
}
