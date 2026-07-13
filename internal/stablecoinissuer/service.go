package stablecoinissuer

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

type Service struct {
	mu    sync.Mutex
	cfg   Config
	state persistentState
}

type Health struct {
	OK                             bool           `json:"ok"`
	Service                        string         `json:"service"`
	NativeSymbol                   string         `json:"nativeSymbol"`
	Persistence                    string         `json:"persistence"`
	StateIntegrity                 string         `json:"stateIntegrity"`
	IssuerCount                    int            `json:"issuerCount"`
	ApprovedIssuerCount            int            `json:"approvedIssuerCount"`
	RevokedIssuerCount             int            `json:"revokedIssuerCount"`
	AssetCount                     int            `json:"assetCount"`
	ApprovedAssetCount             int            `json:"approvedAssetCount"`
	RevokedAssetCount              int            `json:"revokedAssetCount"`
	IntentCount                    int            `json:"intentCount"`
	AuditEventCount                int            `json:"auditEventCount"`
	IssuerSupportEstablished       bool           `json:"issuerSupportEstablished"`
	ExternalExecutionEnabled       bool           `json:"externalExecutionEnabled"`
	NativeYNXTIssuerActionsAllowed bool           `json:"nativeYnxtIssuerActionsAllowed"`
	TruthfulStatus                 string         `json:"truthfulStatus"`
	Build                          buildinfo.Info `json:"build"`
}

type Transparency struct {
	IssuerApplications       int  `json:"issuerApplications"`
	IssuerApprovals          int  `json:"issuerApprovals"`
	IssuerRejections         int  `json:"issuerRejections"`
	IssuerRevocations        int  `json:"issuerRevocations"`
	AssetApplications        int  `json:"assetApplications"`
	AssetApprovals           int  `json:"assetApprovals"`
	AssetRejections          int  `json:"assetRejections"`
	AssetRevocations         int  `json:"assetRevocations"`
	MintIntents              int  `json:"mintIntents"`
	BurnIntents              int  `json:"burnIntents"`
	ExecutedMintBurnActions  int  `json:"executedMintBurnActions"`
	NativeProtocolActions    int  `json:"nativeProtocolActions"`
	ExternalExecutionEnabled bool `json:"externalExecutionEnabled"`
	IssuerSupportEstablished bool `json:"issuerSupportEstablished"`
}

func ValidateConfig(cfg Config) error {
	_, err := cfg.normalized()
	return err
}

func New(cfg Config) (*Service, error) {
	normalized, err := cfg.normalized()
	if err != nil {
		return nil, err
	}
	_, statErr := os.Stat(normalized.StatePath)
	stateExists := statErr == nil
	if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return nil, fmt.Errorf("stat stablecoin state: %w", statErr)
	}
	state, err := loadState(normalized.StatePath)
	if err != nil {
		return nil, err
	}
	service := &Service{cfg: normalized, state: state}
	if err := service.validateStateLocked(); err != nil {
		return nil, err
	}
	if !stateExists {
		if err := saveState(normalized.StatePath, &service.state); err != nil {
			return nil, err
		}
	}
	return service, nil
}

func (s *Service) Authorized(value string) bool {
	value = strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	if value == "" || len(value) != len(s.cfg.APIKey) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(value), []byte(s.cfg.APIKey)) == 1
}

func (s *Service) SubmitIssuer(request SubmitIssuerRequest) (MutationResult[Issuer], error) {
	normalized, digest, err := normalizeIssuerRequest(request)
	if err != nil {
		return MutationResult[Issuer]{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.state.Idempotency[normalized.IdempotencyKey]; ok {
		if existing.Action != "issuer_submit" || existing.Digest != digest {
			return MutationResult[Issuer]{}, idempotencyConflict()
		}
		return MutationResult[Issuer]{Record: cloneIssuer(s.state.Issuers[existing.ObjectID]), Replayed: true}, nil
	}
	registryKey := strings.ToLower(normalized.Jurisdiction + "|" + normalized.RegistryReference)
	if existingID, exists := s.state.IssuerRegistry[registryKey]; exists {
		return MutationResult[Issuer]{}, fmt.Errorf("%w: issuer registry reference already belongs to %s", ErrConflict, existingID)
	}
	now := s.now()
	id := "iss_" + digestSuffix(digest)
	issuer := Issuer{ID: id, LegalName: normalized.LegalName, Jurisdiction: normalized.Jurisdiction, RegistryReference: normalized.RegistryReference, ContactDomain: normalized.ContactDomain, EvidenceHashes: normalized.EvidenceHashes, Status: "pending_review", SupportStatus: "candidate_not_supported", CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.Issuers[id] = issuer
	s.state.IssuerRegistry[registryKey] = id
	s.state.Idempotency[normalized.IdempotencyKey] = idempotencyRecord{Action: "issuer_submit", Digest: digest, ObjectID: id}
	appendAudit(&s.state, now, "issuer_submitted", "issuer", id, digest)
	if err := s.saveOrRollback(before); err != nil {
		return MutationResult[Issuer]{}, err
	}
	return MutationResult[Issuer]{Record: cloneIssuer(issuer)}, nil
}

func (s *Service) ReviewIssuer(id string, request ReviewRequest) (MutationResult[Issuer], error) {
	id = strings.TrimSpace(id)
	normalized, decision, digest, err := normalizeReviewRequest(request)
	if err != nil {
		return MutationResult[Issuer]{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.state.Idempotency[normalized.IdempotencyKey]; ok {
		if existing.Action != "issuer_review" || existing.Digest != digest || existing.ObjectID != id {
			return MutationResult[Issuer]{}, idempotencyConflict()
		}
		return MutationResult[Issuer]{Record: cloneIssuer(s.state.Issuers[id]), Replayed: true}, nil
	}
	issuer, ok := s.state.Issuers[id]
	if !ok {
		return MutationResult[Issuer]{}, ErrNotFound
	}
	if issuer.Status != "pending_review" {
		return MutationResult[Issuer]{}, fmt.Errorf("%w: issuer review is already final", ErrConflict)
	}
	now := s.now()
	decision.DecidedAt = now
	issuer.Decision = &decision
	issuer.Status = "rejected"
	if decision.Decision == "approve" {
		issuer.Status = "approved"
	}
	issuer.UpdatedAt = now
	before := cloneState(s.state)
	s.state.Issuers[id] = issuer
	s.state.Idempotency[normalized.IdempotencyKey] = idempotencyRecord{Action: "issuer_review", Digest: digest, ObjectID: id}
	appendAudit(&s.state, now, "issuer_"+issuer.Status, "issuer", id, digest)
	if err := s.saveOrRollback(before); err != nil {
		return MutationResult[Issuer]{}, err
	}
	return MutationResult[Issuer]{Record: cloneIssuer(issuer)}, nil
}

func (s *Service) RevokeIssuer(id string, request RevokeRequest) (MutationResult[Issuer], error) {
	id = strings.TrimSpace(id)
	normalized, decision, digest, err := normalizeRevokeRequest(request)
	if err != nil {
		return MutationResult[Issuer]{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.state.Idempotency[normalized.IdempotencyKey]; ok {
		if existing.Action != "issuer_revoke" || existing.Digest != digest || existing.ObjectID != id {
			return MutationResult[Issuer]{}, idempotencyConflict()
		}
		return MutationResult[Issuer]{Record: cloneIssuer(s.state.Issuers[id]), Replayed: true}, nil
	}
	issuer, ok := s.state.Issuers[id]
	if !ok {
		return MutationResult[Issuer]{}, ErrNotFound
	}
	if issuer.Status != "approved" {
		return MutationResult[Issuer]{}, fmt.Errorf("%w: only an approved issuer can be revoked", ErrConflict)
	}
	now := s.now()
	decision.DecidedAt = now
	issuer.Status = "revoked"
	issuer.Revocation = &decision
	issuer.UpdatedAt = now
	before := cloneState(s.state)
	s.state.Issuers[id] = issuer
	s.state.Idempotency[normalized.IdempotencyKey] = idempotencyRecord{Action: "issuer_revoke", Digest: digest, ObjectID: id}
	appendAudit(&s.state, now, "issuer_revoked", "issuer", id, digest)
	if err := s.saveOrRollback(before); err != nil {
		return MutationResult[Issuer]{}, err
	}
	return MutationResult[Issuer]{Record: cloneIssuer(issuer)}, nil
}

func (s *Service) SubmitAsset(request SubmitAssetRequest) (MutationResult[Asset], error) {
	normalized, ceiling, supply, digest, registryKey, err := normalizeAssetRequest(request)
	if err != nil {
		return MutationResult[Asset]{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.state.Idempotency[normalized.IdempotencyKey]; ok {
		if existing.Action != "asset_submit" || existing.Digest != digest {
			return MutationResult[Asset]{}, idempotencyConflict()
		}
		return MutationResult[Asset]{Record: cloneAsset(s.state.Assets[existing.ObjectID]), Replayed: true}, nil
	}
	issuer, ok := s.state.Issuers[normalized.IssuerID]
	if !ok || issuer.Status != "approved" {
		return MutationResult[Asset]{}, ErrNotApproved
	}
	if existingID, exists := s.state.AssetRegistry[registryKey]; exists {
		return MutationResult[Asset]{}, fmt.Errorf("%w: asset reference already belongs to %s", ErrConflict, existingID)
	}
	if supply > ceiling {
		return MutationResult[Asset]{}, fmt.Errorf("%w: reported supply exceeds supply ceiling", ErrInvalid)
	}
	now := s.now()
	id := "sca_" + digestSuffix(digest)
	asset := Asset{ID: id, IssuerID: normalized.IssuerID, Symbol: normalized.Symbol, Name: normalized.Name, AssetClass: normalized.AssetClass, Canonicality: normalized.Canonicality, OriginChain: normalized.OriginChain, ContractReference: normalized.ContractReference, Decimals: normalized.Decimals, SupplyCeiling: normalized.SupplyCeiling, ReportedSupply: normalized.ReportedSupply, ReservedMintIntentAmount: "0", ReservedBurnIntentAmount: "0", MintPolicy: normalized.MintPolicy, BurnPolicy: normalized.BurnPolicy, LegalReviewStatus: normalized.LegalReviewStatus, EvidenceHashes: normalized.EvidenceHashes, Status: "pending_review", ExecutionEnabled: false, NativeYNXT: false, CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.Assets[id] = asset
	s.state.AssetRegistry[registryKey] = id
	s.state.Idempotency[normalized.IdempotencyKey] = idempotencyRecord{Action: "asset_submit", Digest: digest, ObjectID: id}
	appendAudit(&s.state, now, "asset_submitted", "asset", id, digest)
	if err := s.saveOrRollback(before); err != nil {
		return MutationResult[Asset]{}, err
	}
	return MutationResult[Asset]{Record: cloneAsset(asset)}, nil
}

func (s *Service) ReviewAsset(id string, request ReviewRequest) (MutationResult[Asset], error) {
	id = strings.TrimSpace(id)
	normalized, decision, digest, err := normalizeReviewRequest(request)
	if err != nil {
		return MutationResult[Asset]{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.state.Idempotency[normalized.IdempotencyKey]; ok {
		if existing.Action != "asset_review" || existing.Digest != digest || existing.ObjectID != id {
			return MutationResult[Asset]{}, idempotencyConflict()
		}
		return MutationResult[Asset]{Record: cloneAsset(s.state.Assets[id]), Replayed: true}, nil
	}
	asset, ok := s.state.Assets[id]
	if !ok {
		return MutationResult[Asset]{}, ErrNotFound
	}
	issuer := s.state.Issuers[asset.IssuerID]
	if issuer.Status != "approved" {
		return MutationResult[Asset]{}, ErrNotApproved
	}
	if asset.Status != "pending_review" {
		return MutationResult[Asset]{}, fmt.Errorf("%w: asset review is already final", ErrConflict)
	}
	now := s.now()
	decision.DecidedAt = now
	asset.Decision = &decision
	asset.Status = "rejected"
	if decision.Decision == "approve" {
		asset.Status = "approved"
	}
	asset.UpdatedAt = now
	before := cloneState(s.state)
	s.state.Assets[id] = asset
	s.state.Idempotency[normalized.IdempotencyKey] = idempotencyRecord{Action: "asset_review", Digest: digest, ObjectID: id}
	appendAudit(&s.state, now, "asset_"+asset.Status, "asset", id, digest)
	if err := s.saveOrRollback(before); err != nil {
		return MutationResult[Asset]{}, err
	}
	return MutationResult[Asset]{Record: cloneAsset(asset)}, nil
}

func (s *Service) RevokeAsset(id string, request RevokeRequest) (MutationResult[Asset], error) {
	id = strings.TrimSpace(id)
	normalized, decision, digest, err := normalizeRevokeRequest(request)
	if err != nil {
		return MutationResult[Asset]{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.state.Idempotency[normalized.IdempotencyKey]; ok {
		if existing.Action != "asset_revoke" || existing.Digest != digest || existing.ObjectID != id {
			return MutationResult[Asset]{}, idempotencyConflict()
		}
		return MutationResult[Asset]{Record: cloneAsset(s.state.Assets[id]), Replayed: true}, nil
	}
	asset, ok := s.state.Assets[id]
	if !ok {
		return MutationResult[Asset]{}, ErrNotFound
	}
	if asset.Status != "approved" {
		return MutationResult[Asset]{}, fmt.Errorf("%w: only an approved asset can be revoked", ErrConflict)
	}
	now := s.now()
	decision.DecidedAt = now
	asset.Status = "revoked"
	asset.Revocation = &decision
	asset.UpdatedAt = now
	before := cloneState(s.state)
	s.state.Assets[id] = asset
	s.state.Idempotency[normalized.IdempotencyKey] = idempotencyRecord{Action: "asset_revoke", Digest: digest, ObjectID: id}
	appendAudit(&s.state, now, "asset_revoked", "asset", id, digest)
	if err := s.saveOrRollback(before); err != nil {
		return MutationResult[Asset]{}, err
	}
	return MutationResult[Asset]{Record: cloneAsset(asset)}, nil
}

func (s *Service) CreateIntent(assetID string, request CreateIntentRequest) (MutationResult[Intent], error) {
	assetID = strings.TrimSpace(assetID)
	normalized, amount, digest, err := normalizeIntentRequest(request)
	if err != nil {
		return MutationResult[Intent]{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.state.Idempotency[normalized.IdempotencyKey]; ok {
		if existing.Action != "intent_create" || existing.Digest != digest {
			return MutationResult[Intent]{}, idempotencyConflict()
		}
		intent := s.state.Intents[existing.ObjectID]
		if intent.AssetID != assetID {
			return MutationResult[Intent]{}, idempotencyConflict()
		}
		return MutationResult[Intent]{Record: intent, Replayed: true}, nil
	}
	asset, ok := s.state.Assets[assetID]
	if !ok {
		return MutationResult[Intent]{}, ErrNotFound
	}
	issuer, issuerOK := s.state.Issuers[asset.IssuerID]
	if !issuerOK || issuer.Status != "approved" || asset.Status != "approved" || asset.ExecutionEnabled || asset.NativeYNXT {
		return MutationResult[Intent]{}, ErrNotApproved
	}
	if normalized.IssuerID != asset.IssuerID {
		return MutationResult[Intent]{}, fmt.Errorf("%w: intent issuer does not own asset", ErrInvalid)
	}
	ceiling, _ := strconv.ParseUint(asset.SupplyCeiling, 10, 64)
	supply, _ := strconv.ParseUint(asset.ReportedSupply, 10, 64)
	reservedMint, _ := strconv.ParseUint(asset.ReservedMintIntentAmount, 10, 64)
	reservedBurn, _ := strconv.ParseUint(asset.ReservedBurnIntentAmount, 10, 64)
	if normalized.Operation == "mint" {
		if reservedMint > ceiling-supply || amount > ceiling-supply-reservedMint {
			return MutationResult[Intent]{}, fmt.Errorf("%w: mint intent exceeds remaining supply ceiling", ErrInvalid)
		}
		reservedMint += amount
		asset.ReservedMintIntentAmount = strconv.FormatUint(reservedMint, 10)
	} else {
		if reservedBurn > supply || amount > supply-reservedBurn {
			return MutationResult[Intent]{}, fmt.Errorf("%w: burn intent exceeds reported supply", ErrInvalid)
		}
		reservedBurn += amount
		asset.ReservedBurnIntentAmount = strconv.FormatUint(reservedBurn, 10)
	}
	now := s.now()
	id := "sci_" + digestSuffix(digestJSON(struct {
		AssetID string              `json:"assetId"`
		Request CreateIntentRequest `json:"request"`
	}{assetID, normalized}))
	intent := Intent{ID: id, AssetID: assetID, IssuerID: normalized.IssuerID, Operation: normalized.Operation, Amount: normalized.Amount, Account: normalized.Account, ExternalReference: normalized.ExternalReference, EvidenceHash: normalized.EvidenceHash, Status: "recorded_not_executed", ExecutionEnabled: false, CreatedAt: now}
	asset.UpdatedAt = now
	before := cloneState(s.state)
	s.state.Intents[id] = intent
	s.state.Assets[assetID] = asset
	s.state.Idempotency[normalized.IdempotencyKey] = idempotencyRecord{Action: "intent_create", Digest: digest, ObjectID: id}
	appendAudit(&s.state, now, normalized.Operation+"_intent_recorded_not_executed", "intent", id, digest)
	if err := s.saveOrRollback(before); err != nil {
		return MutationResult[Intent]{}, err
	}
	return MutationResult[Intent]{Record: intent}, nil
}

func (s *Service) GetIssuer(id string) (Issuer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	issuer, ok := s.state.Issuers[strings.TrimSpace(id)]
	if !ok {
		return Issuer{}, ErrNotFound
	}
	return cloneIssuer(issuer), nil
}

func (s *Service) GetAsset(id string) (Asset, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	asset, ok := s.state.Assets[strings.TrimSpace(id)]
	if !ok {
		return Asset{}, ErrNotFound
	}
	return cloneAsset(asset), nil
}

func (s *Service) GetIntent(id string) (Intent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	intent, ok := s.state.Intents[strings.TrimSpace(id)]
	if !ok {
		return Intent{}, ErrNotFound
	}
	return intent, nil
}

func (s *Service) ListIssuers(after string, limit int) []Issuer {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := make([]Issuer, 0, len(s.state.Issuers))
	for _, item := range s.state.Issuers {
		if after == "" || item.ID > after {
			items = append(items, cloneIssuer(item))
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return truncate(items, limit)
}

func (s *Service) ListAssets(after string, limit int) []Asset {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := make([]Asset, 0, len(s.state.Assets))
	for _, item := range s.state.Assets {
		if after == "" || item.ID > after {
			items = append(items, cloneAsset(item))
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return truncate(items, limit)
}

func (s *Service) ListIntents(after string, limit int) []Intent {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := make([]Intent, 0, len(s.state.Intents))
	for _, item := range s.state.Intents {
		if after == "" || item.ID > after {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return truncate(items, limit)
}

func (s *Service) Audit(after uint64, limit int) []AuditEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	limit = normalizeLimit(limit)
	items := make([]AuditEvent, 0, limit)
	for _, event := range s.state.Audit {
		if event.Sequence > after {
			items = append(items, event)
			if len(items) == limit {
				break
			}
		}
	}
	return items
}

func (s *Service) Health(build buildinfo.Info) Health {
	s.mu.Lock()
	defer s.mu.Unlock()
	health := Health{OK: true, Service: "ynx-stablecoind", NativeSymbol: "YNXT", Persistence: "atomic-json-file", StateIntegrity: s.state.Integrity, IssuerCount: len(s.state.Issuers), AssetCount: len(s.state.Assets), IntentCount: len(s.state.Intents), AuditEventCount: len(s.state.Audit), IssuerSupportEstablished: false, ExternalExecutionEnabled: false, NativeYNXTIssuerActionsAllowed: false, TruthfulStatus: "local-control-plane-only-no-issuer-support-no-execution", Build: buildinfo.Normalize(build)}
	for _, issuer := range s.state.Issuers {
		switch issuer.Status {
		case "approved":
			health.ApprovedIssuerCount++
		case "revoked":
			health.RevokedIssuerCount++
		}
	}
	for _, asset := range s.state.Assets {
		switch asset.Status {
		case "approved":
			health.ApprovedAssetCount++
		case "revoked":
			health.RevokedAssetCount++
		}
	}
	return health
}

func (s *Service) Transparency() Transparency {
	s.mu.Lock()
	defer s.mu.Unlock()
	report := Transparency{IssuerApplications: len(s.state.Issuers), AssetApplications: len(s.state.Assets), ExternalExecutionEnabled: false, IssuerSupportEstablished: false}
	for _, issuer := range s.state.Issuers {
		switch issuer.Status {
		case "approved":
			report.IssuerApprovals++
		case "rejected":
			report.IssuerRejections++
		case "revoked":
			report.IssuerApprovals++
			report.IssuerRevocations++
		}
	}
	for _, asset := range s.state.Assets {
		switch asset.Status {
		case "approved":
			report.AssetApprovals++
		case "rejected":
			report.AssetRejections++
		case "revoked":
			report.AssetApprovals++
			report.AssetRevocations++
		}
	}
	for _, intent := range s.state.Intents {
		if intent.Operation == "mint" {
			report.MintIntents++
		} else if intent.Operation == "burn" {
			report.BurnIntents++
		}
	}
	return report
}

func normalizeIssuerRequest(request SubmitIssuerRequest) (SubmitIssuerRequest, string, error) {
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	request.LegalName = strings.TrimSpace(request.LegalName)
	request.Jurisdiction = strings.ToLower(strings.TrimSpace(request.Jurisdiction))
	request.RegistryReference = strings.ToLower(strings.TrimSpace(request.RegistryReference))
	request.ContactDomain = strings.ToLower(strings.TrimSpace(request.ContactDomain))
	if !idempotencyPattern.MatchString(request.IdempotencyKey) || len(request.LegalName) < 3 || len(request.LegalName) > 160 || !identifierPattern.MatchString(request.Jurisdiction) || !identifierPattern.MatchString(request.RegistryReference) || !identifierPattern.MatchString(request.ContactDomain) {
		return SubmitIssuerRequest{}, "", fmt.Errorf("%w: issuer identity is invalid", ErrInvalid)
	}
	evidence, err := normalizeEvidenceList(request.EvidenceHashes)
	if err != nil {
		return SubmitIssuerRequest{}, "", err
	}
	request.EvidenceHashes = evidence
	return request, digestJSON(request), nil
}

func normalizeReviewRequest(request ReviewRequest) (ReviewRequest, GovernanceDecision, string, error) {
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	request.Decision = strings.ToLower(strings.TrimSpace(request.Decision))
	request.Reviewer = strings.TrimSpace(request.Reviewer)
	request.GovernanceRequestID = strings.TrimSpace(request.GovernanceRequestID)
	request.Reason = strings.TrimSpace(request.Reason)
	evidence, err := normalizeEvidence(request.DecisionEvidenceHash)
	if err != nil {
		return ReviewRequest{}, GovernanceDecision{}, "", err
	}
	request.DecisionEvidenceHash = evidence
	if !idempotencyPattern.MatchString(request.IdempotencyKey) || (request.Decision != "approve" && request.Decision != "reject") || !identifierPattern.MatchString(request.Reviewer) || !identifierPattern.MatchString(request.GovernanceRequestID) || len(request.Reason) < 8 || len(request.Reason) > 512 {
		return ReviewRequest{}, GovernanceDecision{}, "", fmt.Errorf("%w: explicit governance decision fields are required", ErrInvalid)
	}
	decision := GovernanceDecision{Decision: request.Decision, Reviewer: request.Reviewer, GovernanceRequestID: request.GovernanceRequestID, DecisionEvidenceHash: evidence, Reason: request.Reason}
	return request, decision, digestJSON(request), nil
}

func normalizeRevokeRequest(request RevokeRequest) (RevokeRequest, GovernanceDecision, string, error) {
	review := ReviewRequest{IdempotencyKey: request.IdempotencyKey, Decision: "revoke", Reviewer: request.Reviewer, GovernanceRequestID: request.GovernanceRequestID, DecisionEvidenceHash: request.DecisionEvidenceHash, Reason: request.Reason}
	review.IdempotencyKey = strings.TrimSpace(review.IdempotencyKey)
	review.Reviewer = strings.TrimSpace(review.Reviewer)
	review.GovernanceRequestID = strings.TrimSpace(review.GovernanceRequestID)
	review.Reason = strings.TrimSpace(review.Reason)
	evidence, err := normalizeEvidence(review.DecisionEvidenceHash)
	if err != nil {
		return RevokeRequest{}, GovernanceDecision{}, "", err
	}
	if !idempotencyPattern.MatchString(review.IdempotencyKey) || !identifierPattern.MatchString(review.Reviewer) || !identifierPattern.MatchString(review.GovernanceRequestID) || len(review.Reason) < 8 || len(review.Reason) > 512 {
		return RevokeRequest{}, GovernanceDecision{}, "", fmt.Errorf("%w: explicit governance revocation fields are required", ErrInvalid)
	}
	normalized := RevokeRequest{IdempotencyKey: review.IdempotencyKey, Reviewer: review.Reviewer, GovernanceRequestID: review.GovernanceRequestID, DecisionEvidenceHash: evidence, Reason: review.Reason}
	decision := GovernanceDecision{Decision: "revoke", Reviewer: review.Reviewer, GovernanceRequestID: review.GovernanceRequestID, DecisionEvidenceHash: evidence, Reason: review.Reason}
	return normalized, decision, digestJSON(normalized), nil
}

func normalizeAssetRequest(request SubmitAssetRequest) (SubmitAssetRequest, uint64, uint64, string, string, error) {
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	request.IssuerID = strings.TrimSpace(request.IssuerID)
	request.Symbol = strings.ToUpper(strings.TrimSpace(request.Symbol))
	request.Name = strings.TrimSpace(request.Name)
	request.AssetClass = strings.ToLower(strings.TrimSpace(request.AssetClass))
	request.Canonicality = strings.ToLower(strings.TrimSpace(request.Canonicality))
	request.OriginChain = strings.ToLower(strings.TrimSpace(request.OriginChain))
	request.ContractReference = strings.ToLower(strings.TrimSpace(request.ContractReference))
	request.MintPolicy = strings.TrimSpace(request.MintPolicy)
	request.BurnPolicy = strings.TrimSpace(request.BurnPolicy)
	request.LegalReviewStatus = strings.ToLower(strings.TrimSpace(request.LegalReviewStatus))
	if !idempotencyPattern.MatchString(request.IdempotencyKey) || !identifierPattern.MatchString(request.IssuerID) || !identifierPattern.MatchString(request.Symbol) || len(request.Name) < 3 || len(request.Name) > 160 || !identifierPattern.MatchString(request.AssetClass) || (request.Canonicality != "canonical" && request.Canonicality != "represented") || !identifierPattern.MatchString(request.OriginChain) || !identifierPattern.MatchString(request.ContractReference) || request.Decimals < 0 || request.Decimals > 18 || len(request.MintPolicy) < 8 || len(request.MintPolicy) > 512 || len(request.BurnPolicy) < 8 || len(request.BurnPolicy) > 512 || !validLegalReviewStatus(request.LegalReviewStatus) {
		return SubmitAssetRequest{}, 0, 0, "", "", fmt.Errorf("%w: asset profile is invalid", ErrInvalid)
	}
	if isNativeYNXT(request) {
		return SubmitAssetRequest{}, 0, 0, "", "", fmt.Errorf("%w: native YNXT and protocol assets are outside issuer control", ErrInvalid)
	}
	ceiling, normalizedCeiling, err := parsePositiveAmount(request.SupplyCeiling)
	if err != nil {
		return SubmitAssetRequest{}, 0, 0, "", "", err
	}
	supply, err := strconv.ParseUint(strings.TrimSpace(request.ReportedSupply), 10, 64)
	if err != nil {
		return SubmitAssetRequest{}, 0, 0, "", "", fmt.Errorf("%w: reported supply must be a uint64 decimal string", ErrInvalid)
	}
	request.SupplyCeiling = normalizedCeiling
	request.ReportedSupply = strconv.FormatUint(supply, 10)
	evidence, err := normalizeEvidenceList(request.EvidenceHashes)
	if err != nil {
		return SubmitAssetRequest{}, 0, 0, "", "", err
	}
	request.EvidenceHashes = evidence
	digest := digestJSON(request)
	return request, ceiling, supply, digest, request.OriginChain + "|" + request.ContractReference, nil
}

func normalizeIntentRequest(request CreateIntentRequest) (CreateIntentRequest, uint64, string, error) {
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	request.IssuerID = strings.TrimSpace(request.IssuerID)
	request.Operation = strings.ToLower(strings.TrimSpace(request.Operation))
	request.Account = strings.TrimSpace(request.Account)
	request.ExternalReference = strings.TrimSpace(request.ExternalReference)
	if !idempotencyPattern.MatchString(request.IdempotencyKey) || !identifierPattern.MatchString(request.IssuerID) || (request.Operation != "mint" && request.Operation != "burn") || !identifierPattern.MatchString(request.Account) || !identifierPattern.MatchString(request.ExternalReference) {
		return CreateIntentRequest{}, 0, "", fmt.Errorf("%w: intent identity or operation is invalid", ErrInvalid)
	}
	amount, normalizedAmount, err := parsePositiveAmount(request.Amount)
	if err != nil {
		return CreateIntentRequest{}, 0, "", err
	}
	evidence, err := normalizeEvidence(request.EvidenceHash)
	if err != nil {
		return CreateIntentRequest{}, 0, "", err
	}
	request.Amount = normalizedAmount
	request.EvidenceHash = evidence
	return request, amount, digestJSON(request), nil
}

func (s *Service) validateStateLocked() error {
	for registryKey, id := range s.state.IssuerRegistry {
		issuer, ok := s.state.Issuers[id]
		if !ok || registryKey != strings.ToLower(issuer.Jurisdiction+"|"+issuer.RegistryReference) {
			return errors.New("stablecoin issuer registry is inconsistent")
		}
	}
	for id, issuer := range s.state.Issuers {
		validLifecycle := issuer.Status == "pending_review" && issuer.Decision == nil && issuer.Revocation == nil ||
			issuer.Status == "approved" && validDecision(issuer.Decision, "approve") && issuer.Revocation == nil ||
			issuer.Status == "rejected" && validDecision(issuer.Decision, "reject") && issuer.Revocation == nil ||
			issuer.Status == "revoked" && validDecision(issuer.Decision, "approve") && validDecision(issuer.Revocation, "revoke")
		if issuer.ID != id || issuer.SupportStatus != "candidate_not_supported" || !validLifecycle {
			return errors.New("stablecoin issuer record violates safety policy")
		}
	}
	computedMint := map[string]uint64{}
	computedBurn := map[string]uint64{}
	for id, intent := range s.state.Intents {
		asset, ok := s.state.Assets[intent.AssetID]
		amount, err := strconv.ParseUint(intent.Amount, 10, 64)
		if !ok || err != nil || amount == 0 || id != intent.ID || intent.IssuerID != asset.IssuerID || intent.Status != "recorded_not_executed" || intent.ExecutionEnabled || (intent.Operation != "mint" && intent.Operation != "burn") {
			return errors.New("stablecoin intent record violates safety policy")
		}
		if intent.Operation == "mint" {
			if ^uint64(0)-computedMint[intent.AssetID] < amount {
				return errors.New("stablecoin mint intent reservation overflows")
			}
			computedMint[intent.AssetID] += amount
		} else {
			if ^uint64(0)-computedBurn[intent.AssetID] < amount {
				return errors.New("stablecoin burn intent reservation overflows")
			}
			computedBurn[intent.AssetID] += amount
		}
	}
	for registryKey, id := range s.state.AssetRegistry {
		asset, ok := s.state.Assets[id]
		if !ok || registryKey != strings.ToLower(asset.OriginChain+"|"+asset.ContractReference) {
			return errors.New("stablecoin asset registry is inconsistent")
		}
	}
	for id, asset := range s.state.Assets {
		ceiling, errCeiling := strconv.ParseUint(asset.SupplyCeiling, 10, 64)
		supply, errSupply := strconv.ParseUint(asset.ReportedSupply, 10, 64)
		mint, errMint := strconv.ParseUint(asset.ReservedMintIntentAmount, 10, 64)
		burn, errBurn := strconv.ParseUint(asset.ReservedBurnIntentAmount, 10, 64)
		_, issuerOK := s.state.Issuers[asset.IssuerID]
		validLifecycle := asset.Status == "pending_review" && asset.Decision == nil && asset.Revocation == nil ||
			asset.Status == "approved" && validDecision(asset.Decision, "approve") && asset.Revocation == nil ||
			asset.Status == "rejected" && validDecision(asset.Decision, "reject") && asset.Revocation == nil ||
			asset.Status == "revoked" && validDecision(asset.Decision, "approve") && validDecision(asset.Revocation, "revoke")
		if id != asset.ID || !issuerOK || !validLifecycle || !validLegalReviewStatus(asset.LegalReviewStatus) || asset.ExecutionEnabled || asset.NativeYNXT || errCeiling != nil || errSupply != nil || errMint != nil || errBurn != nil || supply > ceiling || mint != computedMint[id] || burn != computedBurn[id] || mint > ceiling-supply || burn > supply {
			return errors.New("stablecoin asset record violates safety policy")
		}
	}
	for _, record := range s.state.Idempotency {
		if record.Action == "issuer_submit" || record.Action == "issuer_review" || record.Action == "issuer_revoke" {
			if _, ok := s.state.Issuers[record.ObjectID]; !ok {
				return errors.New("stablecoin issuer idempotency record is inconsistent")
			}
		} else if record.Action == "asset_submit" || record.Action == "asset_review" || record.Action == "asset_revoke" {
			if _, ok := s.state.Assets[record.ObjectID]; !ok {
				return errors.New("stablecoin asset idempotency record is inconsistent")
			}
		} else if record.Action == "intent_create" {
			if _, ok := s.state.Intents[record.ObjectID]; !ok {
				return errors.New("stablecoin intent idempotency record is inconsistent")
			}
		} else {
			return errors.New("stablecoin idempotency action is invalid")
		}
	}
	return nil
}

func validDecision(decision *GovernanceDecision, expected string) bool {
	if decision == nil || decision.Decision != expected || decision.DecidedAt == "" || !identifierPattern.MatchString(decision.Reviewer) || !identifierPattern.MatchString(decision.GovernanceRequestID) || len(decision.Reason) < 8 || len(decision.Reason) > 512 {
		return false
	}
	_, err := normalizeEvidence(decision.DecisionEvidenceHash)
	return err == nil
}

func (s *Service) now() string { return s.cfg.Now().UTC().Format(timeFormat) }

func (s *Service) saveOrRollback(before persistentState) error {
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return err
	}
	return nil
}

func idempotencyConflict() error {
	return fmt.Errorf("%w: idempotency key reused with changed input or action", ErrConflict)
}

func digestJSON(value any) string {
	raw, _ := json.Marshal(value)
	return "sha256:" + hashBytes(raw)
}

func digestSuffix(digest string) string {
	digest = strings.TrimPrefix(digest, "sha256:")
	return digest[:24]
}

func cloneIssuer(value Issuer) Issuer {
	raw, _ := json.Marshal(value)
	var clone Issuer
	_ = json.Unmarshal(raw, &clone)
	return clone
}

func cloneAsset(value Asset) Asset {
	raw, _ := json.Marshal(value)
	var clone Asset
	_ = json.Unmarshal(raw, &clone)
	return clone
}

func normalizeLimit(limit int) int {
	if limit <= 0 || limit > MaxListLimit {
		return 50
	}
	return limit
}

func truncate[T any](items []T, limit int) []T {
	limit = normalizeLimit(limit)
	if len(items) > limit {
		return items[:limit]
	}
	return items
}
