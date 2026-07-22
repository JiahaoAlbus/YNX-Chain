package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const CommittedStateVersion = 9

// CommittedState is the durable ABCI application state. Height is persisted
// for restart recovery but excluded from AppHash because empty blocks do not
// change application state.
type CommittedState struct {
	Version                    int                             `json:"version"`
	ChainID                    int64                           `json:"chainId"`
	MigrationStateHash         string                          `json:"migrationStateHash"`
	Initialized                bool                            `json:"initialized"`
	Height                     int64                           `json:"height"`
	Accounts                   []chain.ConsensusAccount        `json:"accounts"`
	FeeEvents                  []BFTFeeEvent                   `json:"feeEvents"`
	StakeDelegations           []BFTStakeDelegation            `json:"stakeDelegations"`
	Unbondings                 []BFTUnbondingEntry             `json:"unbondings"`
	AIPermissions              []BFTAIPermission               `json:"aiPermissions"`
	AIActions                  []BFTAIAction                   `json:"aiActions"`
	AIAuditEvents              []BFTAIAuditEvent               `json:"aiAuditEvents"`
	PayIntents                 []BFTPayIntent                  `json:"payIntents"`
	PayInvoices                []BFTPayInvoice                 `json:"payInvoices"`
	PayRefunds                 []BFTPayRefund                  `json:"payRefunds"`
	PayWebhooks                []BFTPayWebhook                 `json:"payWebhooks"`
	PayEvents                  []BFTPayEvent                   `json:"payEvents"`
	PayIdempotency             []BFTPayIdempotency             `json:"payIdempotency"`
	ResourceQuotes             []BFTResourceQuote              `json:"resourceQuotes"`
	ResourceDelegations        []BFTResourceDelegation         `json:"resourceDelegations"`
	ResourceRentals            []BFTResourceRental             `json:"resourceRentals"`
	ResourceIncome             []BFTResourceIncome             `json:"resourceIncome"`
	ResourceEvents             []BFTResourceEvent              `json:"resourceEvents"`
	ResourceIdempotency        []BFTResourceIdempotency        `json:"resourceIdempotency"`
	ResourcePools              []BFTResourcePool               `json:"resourcePools,omitempty"`
	ResourceSponsorships       []BFTResourceSponsorship        `json:"resourceSponsorships,omitempty"`
	ResourceSponsorIdempotency []BFTResourceSponsorIdempotency `json:"resourceSponsorIdempotency,omitempty"`
	ResourceSponsorActionRefs  []BFTResourceSponsorActionRef   `json:"resourceSponsorActionRefs,omitempty"`
	ResourceSponsorAudit       []BFTResourceSponsorAudit       `json:"resourceSponsorAudit,omitempty"`
	GovernanceRequests         []BFTGovernanceRequest          `json:"governanceRequests"`
	TrustAppeals               []BFTTrustAppeal                `json:"trustAppeals"`
	TrustCorrections           []BFTTrustCorrection            `json:"trustCorrections"`
	TrustLabels                []BFTTrustLabel                 `json:"trustLabels"`
	TrustEvidence              []BFTTrustEvidence              `json:"trustEvidence"`
	TrackingReviews            []BFTTrackingReview             `json:"trackingReviews"`
	Transparency               []BFTTransparencyEntry          `json:"transparencyEntries"`
	Contracts                  []BFTContract                   `json:"contracts"`
	EVMReceipts                []BFTEVMReceipt                 `json:"evmReceipts"`
	EVMLogs                    []BFTEVMLog                     `json:"evmLogs"`
	IDEIdempotency             []BFTIDEIdempotency             `json:"ideIdempotency"`
	AppHash                    string                          `json:"appHash"`
}

type committedStateHashDocument struct {
	Domain                     string                          `json:"domain"`
	Version                    int                             `json:"version"`
	ChainID                    int64                           `json:"chainId"`
	MigrationStateHash         string                          `json:"migrationStateHash"`
	Accounts                   []chain.ConsensusAccount        `json:"accounts"`
	FeeEvents                  []BFTFeeEvent                   `json:"feeEvents,omitempty"`
	StakeDelegations           []BFTStakeDelegation            `json:"stakeDelegations,omitempty"`
	Unbondings                 []BFTUnbondingEntry             `json:"unbondings,omitempty"`
	AIPermissions              []BFTAIPermission               `json:"aiPermissions"`
	AIActions                  []BFTAIAction                   `json:"aiActions"`
	AIAuditEvents              []BFTAIAuditEvent               `json:"aiAuditEvents"`
	PayIntents                 []BFTPayIntent                  `json:"payIntents"`
	PayInvoices                []BFTPayInvoice                 `json:"payInvoices"`
	PayRefunds                 []BFTPayRefund                  `json:"payRefunds"`
	PayWebhooks                []BFTPayWebhook                 `json:"payWebhooks"`
	PayEvents                  []BFTPayEvent                   `json:"payEvents"`
	PayIdempotency             []BFTPayIdempotency             `json:"payIdempotency"`
	ResourceQuotes             []BFTResourceQuote              `json:"resourceQuotes"`
	ResourceDelegations        []BFTResourceDelegation         `json:"resourceDelegations"`
	ResourceRentals            []BFTResourceRental             `json:"resourceRentals"`
	ResourceIncome             []BFTResourceIncome             `json:"resourceIncome"`
	ResourceEvents             []BFTResourceEvent              `json:"resourceEvents"`
	ResourceIdempotency        []BFTResourceIdempotency        `json:"resourceIdempotency"`
	ResourcePools              []BFTResourcePool               `json:"resourcePools,omitempty"`
	ResourceSponsorships       []BFTResourceSponsorship        `json:"resourceSponsorships,omitempty"`
	ResourceSponsorIdempotency []BFTResourceSponsorIdempotency `json:"resourceSponsorIdempotency,omitempty"`
	ResourceSponsorActionRefs  []BFTResourceSponsorActionRef   `json:"resourceSponsorActionRefs,omitempty"`
	ResourceSponsorAudit       []BFTResourceSponsorAudit       `json:"resourceSponsorAudit,omitempty"`
	GovernanceRequests         []BFTGovernanceRequest          `json:"governanceRequests"`
	TrustAppeals               []BFTTrustAppeal                `json:"trustAppeals"`
	TrustCorrections           []BFTTrustCorrection            `json:"trustCorrections"`
	TrustLabels                []BFTTrustLabel                 `json:"trustLabels"`
	TrustEvidence              []BFTTrustEvidence              `json:"trustEvidence"`
	TrackingReviews            []BFTTrackingReview             `json:"trackingReviews"`
	Transparency               []BFTTransparencyEntry          `json:"transparencyEntries"`
	Contracts                  []BFTContract                   `json:"contracts"`
	EVMReceipts                []BFTEVMReceipt                 `json:"evmReceipts"`
	EVMLogs                    []BFTEVMLog                     `json:"evmLogs"`
	IDEIdempotency             []BFTIDEIdempotency             `json:"ideIdempotency"`
}

func initialCommittedState(migration chain.ConsensusMigrationState) CommittedState {
	return CommittedState{
		Version:                    CommittedStateVersion,
		ChainID:                    migration.Network.ChainID,
		MigrationStateHash:         migration.StateHash,
		Initialized:                false,
		Height:                     int64(migration.Height),
		Accounts:                   cloneAccounts(migration.Accounts),
		FeeEvents:                  []BFTFeeEvent{},
		StakeDelegations:           []BFTStakeDelegation{},
		Unbondings:                 []BFTUnbondingEntry{},
		AIPermissions:              []BFTAIPermission{},
		AIActions:                  []BFTAIAction{},
		AIAuditEvents:              []BFTAIAuditEvent{},
		PayIntents:                 []BFTPayIntent{},
		PayInvoices:                []BFTPayInvoice{},
		PayRefunds:                 []BFTPayRefund{},
		PayWebhooks:                []BFTPayWebhook{},
		PayEvents:                  []BFTPayEvent{},
		PayIdempotency:             []BFTPayIdempotency{},
		ResourceQuotes:             []BFTResourceQuote{},
		ResourceDelegations:        []BFTResourceDelegation{},
		ResourceRentals:            []BFTResourceRental{},
		ResourceIncome:             []BFTResourceIncome{},
		ResourceEvents:             []BFTResourceEvent{},
		ResourceIdempotency:        []BFTResourceIdempotency{},
		ResourcePools:              []BFTResourcePool{},
		ResourceSponsorships:       []BFTResourceSponsorship{},
		ResourceSponsorIdempotency: []BFTResourceSponsorIdempotency{},
		ResourceSponsorActionRefs:  []BFTResourceSponsorActionRef{},
		ResourceSponsorAudit:       []BFTResourceSponsorAudit{},
		GovernanceRequests:         []BFTGovernanceRequest{},
		TrustAppeals:               []BFTTrustAppeal{},
		TrustCorrections:           []BFTTrustCorrection{},
		TrustLabels:                []BFTTrustLabel{},
		TrustEvidence:              []BFTTrustEvidence{},
		TrackingReviews:            []BFTTrackingReview{},
		Transparency:               []BFTTransparencyEntry{},
		Contracts:                  []BFTContract{},
		EVMReceipts:                []BFTEVMReceipt{},
		EVMLogs:                    []BFTEVMLog{},
		IDEIdempotency:             []BFTIDEIdempotency{},
		AppHash:                    migration.StateHash,
	}
}

func sealCommittedState(migration chain.ConsensusMigrationState, height int64, execution executionState) (CommittedState, error) {
	state := CommittedState{
		Version:                    CommittedStateVersion,
		ChainID:                    migration.Network.ChainID,
		MigrationStateHash:         migration.StateHash,
		Initialized:                true,
		Height:                     height,
		Accounts:                   cloneAccounts(execution.accounts),
		FeeEvents:                  append([]BFTFeeEvent(nil), execution.feeEvents...),
		StakeDelegations:           append([]BFTStakeDelegation(nil), execution.stakeDelegations...),
		Unbondings:                 cloneUnbondings(execution.unbondings),
		AIPermissions:              cloneAIPermissions(execution.permissions),
		AIActions:                  cloneAIActions(execution.actions),
		AIAuditEvents:              append([]BFTAIAuditEvent(nil), execution.auditEvents...),
		PayIntents:                 append([]BFTPayIntent(nil), execution.payIntents...),
		PayInvoices:                append([]BFTPayInvoice(nil), execution.payInvoices...),
		PayRefunds:                 append([]BFTPayRefund(nil), execution.payRefunds...),
		PayWebhooks:                append([]BFTPayWebhook(nil), execution.payWebhooks...),
		PayEvents:                  append([]BFTPayEvent(nil), execution.payEvents...),
		PayIdempotency:             append([]BFTPayIdempotency(nil), execution.payIdempotency...),
		ResourceQuotes:             append([]BFTResourceQuote(nil), execution.resourceQuotes...),
		ResourceDelegations:        append([]BFTResourceDelegation(nil), execution.resourceDelegations...),
		ResourceRentals:            append([]BFTResourceRental(nil), execution.resourceRentals...),
		ResourceIncome:             append([]BFTResourceIncome(nil), execution.resourceIncome...),
		ResourceEvents:             append([]BFTResourceEvent(nil), execution.resourceEvents...),
		ResourceIdempotency:        append([]BFTResourceIdempotency(nil), execution.resourceIdempotency...),
		ResourcePools:              cloneBFTResourcePools(execution.resourcePools),
		ResourceSponsorships:       append([]BFTResourceSponsorship(nil), execution.resourceSponsorships...),
		ResourceSponsorIdempotency: cloneBFTResourceSponsorIdempotency(execution.resourceSponsorIdempotency),
		ResourceSponsorActionRefs:  append([]BFTResourceSponsorActionRef(nil), execution.resourceSponsorActionRefs...),
		ResourceSponsorAudit:       append([]BFTResourceSponsorAudit(nil), execution.resourceSponsorAudit...),
		GovernanceRequests:         cloneGovernanceRequests(execution.governanceRequests),
		TrustAppeals:               cloneTrustAppeals(execution.trustAppeals),
		TrustCorrections:           append([]BFTTrustCorrection(nil), execution.trustCorrections...),
		TrustLabels:                cloneTrustLabels(execution.trustLabels),
		TrustEvidence:              cloneTrustEvidence(execution.trustEvidence),
		TrackingReviews:            cloneTrackingReviews(execution.trackingReviews),
		Transparency:               cloneTransparencyEntries(execution.transparency),
		Contracts:                  cloneBFTContracts(execution.contracts),
		EVMReceipts:                cloneBFTEVMReceipts(execution.evmReceipts),
		EVMLogs:                    cloneBFTEVMLogs(execution.evmLogs),
		IDEIdempotency:             append([]BFTIDEIdempotency(nil), execution.ideIdempotency...),
	}
	if accountsEqual(state.Accounts, migration.Accounts) && !state.hasApplicationRecords() {
		state.AppHash = migration.StateHash
	} else {
		hash, err := state.calculateHash()
		if err != nil {
			return CommittedState{}, err
		}
		state.AppHash = hash
	}
	if err := state.Validate(migration); err != nil {
		return CommittedState{}, err
	}
	return state, nil
}

func (s CommittedState) Validate(migration chain.ConsensusMigrationState) error {
	if err := migration.Validate(); err != nil {
		return fmt.Errorf("invalid migration anchor: %w", err)
	}
	if s.Version != CommittedStateVersion {
		return fmt.Errorf("unsupported committed state version %d", s.Version)
	}
	if s.ChainID != migration.Network.ChainID || s.MigrationStateHash != migration.StateHash {
		return errors.New("committed state does not match its YNX migration anchor")
	}
	if s.Height < int64(migration.Height) {
		return fmt.Errorf("committed height %d precedes migrated height %d", s.Height, migration.Height)
	}
	if !s.Initialized && (s.Height != int64(migration.Height) || !accountsEqual(s.Accounts, migration.Accounts) || s.hasApplicationRecords() || !strings.EqualFold(s.AppHash, migration.StateHash)) {
		return errors.New("uninitialized committed state must exactly match the migration anchor")
	}
	if len(s.Accounts) == 0 {
		return errors.New("committed state requires accounts")
	}
	var liquid, staked int64
	previous := ""
	for _, account := range s.Accounts {
		if strings.TrimSpace(account.Address) == "" || (previous != "" && account.Address <= previous) {
			return errors.New("committed accounts must have unique sorted addresses")
		}
		if account.Balance < 0 || account.Staked < 0 {
			return fmt.Errorf("committed account %s has negative YNXT", account.Address)
		}
		if account.ResourceUsage.BandwidthUsed < 0 || account.ResourceUsage.ComputeUsed < 0 || account.ResourceUsage.AICreditsUsed < 0 || account.ResourceUsage.TrustUsed < 0 || account.ResourceUsage.PayCreditsUsed < 0 {
			return fmt.Errorf("committed account %s has negative resource usage", account.Address)
		}
		if account.Balance > math.MaxInt64-liquid || account.Staked > math.MaxInt64-staked {
			return errors.New("committed YNXT totals overflow int64")
		}
		for lotID, amount := range account.Lots {
			if strings.TrimSpace(lotID) == "" || amount < 0 {
				return fmt.Errorf("committed account %s has invalid lot state", account.Address)
			}
		}
		liquid += account.Balance
		staked += account.Staked
		previous = account.Address
	}
	previous = ""
	for _, permission := range s.AIPermissions {
		if permission.ID == "" || (previous != "" && permission.ID <= previous) || !IsNativeAddress(permission.Signer) || permission.SessionID == "" || permission.Requester == "" || permission.Scope == "" || permission.Purpose == "" || permission.Status != "active" || permission.CreatedAt.IsZero() || !permission.ExpiresAt.After(permission.CreatedAt) || permission.BlockHeight <= 0 || permission.TxHash == "" || permission.AuditHash == "" {
			return errors.New("committed AI permissions must be complete and sorted by unique ID")
		}
		previous = permission.ID
	}
	previous = ""
	for _, action := range s.AIActions {
		if action.ID == "" || (previous != "" && action.ID <= previous) || !IsNativeAddress(action.Signer) || action.SessionID == "" || action.Requester == "" || action.Scope == "" || action.ActionType == "" || action.Description == "" || action.Status == "" || action.CreatedAt.IsZero() || !action.ExpiresAt.After(action.CreatedAt) || action.BlockHeight <= 0 || action.TxHash == "" || action.AuditHash == "" {
			return errors.New("committed AI actions must be complete and sorted by unique ID")
		}
		previous = action.ID
	}
	seenAudit := make(map[string]struct{}, len(s.AIAuditEvents))
	for _, event := range s.AIAuditEvents {
		if event.ID == "" || event.RecordID == "" || event.Type == "" || !IsNativeAddress(event.Signer) || event.BlockHeight <= 0 || event.CreatedAt.IsZero() || event.TxHash == "" || event.AuditHash == "" {
			return errors.New("committed AI audit event is incomplete")
		}
		if _, exists := seenAudit[event.ID]; exists {
			return errors.New("committed AI audit event IDs must be unique")
		}
		seenAudit[event.ID] = struct{}{}
	}
	if err := validatePayCommittedState(s); err != nil {
		return err
	}
	if err := validateResourceCommittedState(s, migration); err != nil {
		return err
	}
	if err := validateResourceSponsorCommittedState(s); err != nil {
		return err
	}
	if err := validateTrustCommittedState(s); err != nil {
		return err
	}
	if err := validateIDECommittedState(s); err != nil {
		return err
	}
	if err := validateFeeEvents(s.FeeEvents); err != nil {
		return err
	}
	if err := validateStakingState(s, migration); err != nil {
		return err
	}
	if liquid > math.MaxInt64-staked || migration.LiquidSupplyYNXT > math.MaxInt64-migration.StakedSupplyYNXT {
		return errors.New("committed or migration total YNXT supply overflows int64")
	}
	unbonding, err := pendingUnbondingSupply(s.Unbondings)
	if err != nil {
		return err
	}
	if liquid > math.MaxInt64-staked || liquid+staked > math.MaxInt64-unbonding || liquid+staked+unbonding != migration.LiquidSupplyYNXT+migration.StakedSupplyYNXT {
		return errors.New("committed state changed total liquid plus staked YNXT supply")
	}
	expected := migration.StateHash
	if !accountsEqual(s.Accounts, migration.Accounts) || s.hasApplicationRecords() {
		var err error
		expected, err = s.calculateHash()
		if err != nil {
			return err
		}
	}
	if !strings.EqualFold(s.AppHash, expected) {
		return fmt.Errorf("committed app hash mismatch: expected %s", expected)
	}
	return nil
}

func (s CommittedState) calculateHash() (string, error) {
	return s.calculateHashFor("YNX_ABCI_STATE_V9", CommittedStateVersion)
}

func (s CommittedState) calculateHashFor(domain string, version int) (string, error) {
	doc := committedStateHashDocument{
		Domain:                     domain,
		Version:                    version,
		ChainID:                    s.ChainID,
		MigrationStateHash:         s.MigrationStateHash,
		Accounts:                   s.Accounts,
		FeeEvents:                  s.FeeEvents,
		StakeDelegations:           s.StakeDelegations,
		Unbondings:                 s.Unbondings,
		AIPermissions:              s.AIPermissions,
		AIActions:                  s.AIActions,
		AIAuditEvents:              s.AIAuditEvents,
		PayIntents:                 s.PayIntents,
		PayInvoices:                s.PayInvoices,
		PayRefunds:                 s.PayRefunds,
		PayWebhooks:                s.PayWebhooks,
		PayEvents:                  s.PayEvents,
		PayIdempotency:             s.PayIdempotency,
		ResourceQuotes:             s.ResourceQuotes,
		ResourceDelegations:        s.ResourceDelegations,
		ResourceRentals:            s.ResourceRentals,
		ResourceIncome:             s.ResourceIncome,
		ResourceEvents:             s.ResourceEvents,
		ResourceIdempotency:        s.ResourceIdempotency,
		ResourcePools:              s.ResourcePools,
		ResourceSponsorships:       s.ResourceSponsorships,
		ResourceSponsorIdempotency: s.ResourceSponsorIdempotency,
		ResourceSponsorActionRefs:  s.ResourceSponsorActionRefs,
		ResourceSponsorAudit:       s.ResourceSponsorAudit,
		GovernanceRequests:         s.GovernanceRequests,
		TrustAppeals:               s.TrustAppeals,
		TrustCorrections:           s.TrustCorrections,
		TrustLabels:                s.TrustLabels,
		TrustEvidence:              s.TrustEvidence,
		TrackingReviews:            s.TrackingReviews,
		Transparency:               s.Transparency,
		Contracts:                  s.Contracts,
		EVMReceipts:                s.EVMReceipts,
		EVMLogs:                    s.EVMLogs,
		IDEIdempotency:             s.IDEIdempotency,
	}
	payload, err := json.Marshal(doc)
	if err != nil {
		return "", fmt.Errorf("encode committed state hash document: %w", err)
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func (s CommittedState) hasApplicationRecords() bool {
	return len(s.FeeEvents)+len(s.StakeDelegations)+len(s.Unbondings)+len(s.AIPermissions)+len(s.AIActions)+len(s.AIAuditEvents)+len(s.PayIntents)+len(s.PayInvoices)+len(s.PayRefunds)+len(s.PayWebhooks)+len(s.PayEvents)+len(s.PayIdempotency)+len(s.ResourceQuotes)+len(s.ResourceDelegations)+len(s.ResourceRentals)+len(s.ResourceIncome)+len(s.ResourceEvents)+len(s.ResourceIdempotency)+len(s.ResourcePools)+len(s.ResourceSponsorships)+len(s.ResourceSponsorIdempotency)+len(s.ResourceSponsorActionRefs)+len(s.ResourceSponsorAudit)+len(s.GovernanceRequests)+len(s.TrustAppeals)+len(s.TrustCorrections)+len(s.TrustLabels)+len(s.TrustEvidence)+len(s.TrackingReviews)+len(s.Transparency)+len(s.Contracts)+len(s.EVMReceipts)+len(s.EVMLogs)+len(s.IDEIdempotency) != 0
}

func validateFeeEvents(events []BFTFeeEvent) error {
	seen := make(map[string]struct{}, len(events))
	for _, event := range events {
		if event.ID == "" || event.PolicyVersion != FeePolicyVersion || event.TxHash == "" || event.TransactionType == "" || !IsNativeAddress(event.Payer) || strings.TrimSpace(event.Recipient) == "" || event.GrossFeeYNXT <= 0 || event.BurnYNXT < 0 || event.ValidatorYNXT < 0 || event.ProviderYNXT < 0 || event.ProtocolYNXT < 0 || event.TreasuryYNXT < 0 || event.Source != "ynx-consensus-fixed-fee-v1" || event.BlockHeight <= 0 || event.RecordedAt.IsZero() || event.AuditHash != feeEventAuditHash(event) {
			return errors.New("committed fee events must be complete and audit-bound")
		}
		if event.BurnYNXT+event.ValidatorYNXT+event.ProviderYNXT+event.ProtocolYNXT+event.TreasuryYNXT != event.GrossFeeYNXT {
			return errors.New("committed fee event allocation must reconcile to gross fee")
		}
		if _, exists := seen[event.ID]; exists {
			return errors.New("committed fee event IDs must be unique")
		}
		seen[event.ID] = struct{}{}
	}
	return nil
}

func validatePayCommittedState(s CommittedState) error {
	previous := ""
	for _, value := range s.PayIntents {
		if !payIDPattern.MatchString(value.ID) || (previous != "" && value.ID <= previous) || !IsNativeAddress(value.Signer) || value.Merchant == "" || value.Amount <= 0 || value.Currency != "YNXT" || value.Status != "created" || value.CreatedAt.IsZero() || value.IdempotencyKey == "" || !payHashPattern.MatchString(value.RequestHash) || value.BlockHeight <= 0 || value.TxHash == "" || value.AuditHash == "" {
			return errors.New("committed Pay intents must be complete and sorted")
		}
		previous = value.ID
	}
	previous = ""
	for _, value := range s.PayInvoices {
		if !payIDPattern.MatchString(value.ID) || (previous != "" && value.ID <= previous) || !payIDPattern.MatchString(value.IntentID) || !IsNativeAddress(value.Signer) || value.Merchant == "" || value.Amount <= 0 || value.Currency != "YNXT" || value.Status != "issued" || value.CreatedAt.IsZero() || !value.DueAt.After(value.CreatedAt) || value.IdempotencyKey == "" || !payHashPattern.MatchString(value.RequestHash) || value.BlockHeight <= 0 || value.TxHash == "" || value.AuditHash == "" {
			return errors.New("committed Pay invoices must be complete and sorted")
		}
		previous = value.ID
	}
	previous = ""
	for _, value := range s.PayRefunds {
		if !payIDPattern.MatchString(value.ID) || (previous != "" && value.ID <= previous) || !payIDPattern.MatchString(value.IntentID) || !IsNativeAddress(value.Signer) || value.Merchant == "" || value.Amount <= 0 || value.Currency != "YNXT" || value.Status != "recorded" || value.CreatedAt.IsZero() || value.IdempotencyKey == "" || !payHashPattern.MatchString(value.RequestHash) || value.BlockHeight <= 0 || value.TxHash == "" || value.AuditHash == "" {
			return errors.New("committed Pay refunds must be complete and sorted")
		}
		previous = value.ID
	}
	previous = ""
	for _, value := range s.PayWebhooks {
		if !payIDPattern.MatchString(value.EventID) || (previous != "" && value.EventID <= previous) || !payIDPattern.MatchString(value.IntentID) || !IsNativeAddress(value.Signer) || value.Merchant == "" || value.EventType == "" || !payHashPattern.MatchString(value.Signature) || !payHashPattern.MatchString(value.PayloadHash) || value.SignedAt.IsZero() || value.Algorithm != "hmac-sha256" || value.IdempotencyKey == "" || !value.ReplaySafe || !payHashPattern.MatchString(value.RequestHash) || value.BlockHeight <= 0 || value.TxHash == "" || value.AuditHash == "" {
			return errors.New("committed Pay webhooks must be complete and sorted")
		}
		previous = value.EventID
	}
	seenEvents := make(map[string]struct{}, len(s.PayEvents))
	for _, value := range s.PayEvents {
		if !payIDPattern.MatchString(value.ID) || !payIDPattern.MatchString(value.IntentID) || value.ObjectID == "" || !IsNativeAddress(value.Signer) || value.Merchant == "" || value.Currency != "YNXT" || value.IdempotencyKey == "" || value.BlockHeight <= 0 || value.TxHash == "" || value.AuditHash == "" || value.CreatedAt.IsZero() {
			return errors.New("committed Pay event is incomplete")
		}
		if _, exists := seenEvents[value.ID]; exists {
			return errors.New("committed Pay event IDs must be unique")
		}
		seenEvents[value.ID] = struct{}{}
	}
	previous = ""
	for _, value := range s.PayIdempotency {
		if !payIDPattern.MatchString(value.ID) || (previous != "" && value.ID <= previous) || !IsNativeAddress(value.Signer) || value.Merchant == "" || value.IdempotencyKey == "" || !isPayAction(value.Action) || !payHashPattern.MatchString(value.RequestHash) || value.ObjectType == "" || value.ObjectID == "" || value.TxHash == "" {
			return errors.New("committed Pay idempotency records must be complete and sorted")
		}
		previous = value.ID
	}
	return nil
}

func loadCommittedState(path string, migration chain.ConsensusMigrationState) (CommittedState, error) {
	if strings.TrimSpace(path) == "" {
		return initialCommittedState(migration), nil
	}
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return initialCommittedState(migration), nil
	}
	if err != nil {
		return CommittedState{}, fmt.Errorf("stat committed state: %w", err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		return CommittedState{}, fmt.Errorf("committed state permissions must not allow group or other access: %o", info.Mode().Perm())
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		return CommittedState{}, fmt.Errorf("read committed state: %w", err)
	}
	var state CommittedState
	if err := json.Unmarshal(payload, &state); err != nil {
		return CommittedState{}, fmt.Errorf("decode committed state: %w", err)
	}
	if state.Version == 7 {
		expected := migration.StateHash
		if !accountsEqual(state.Accounts, migration.Accounts) || state.hasApplicationRecords() {
			expected, err = state.calculateHashFor("YNX_ABCI_STATE_V7", 7)
			if err != nil {
				return CommittedState{}, fmt.Errorf("calculate legacy committed state hash: %w", err)
			}
		}
		if !strings.EqualFold(state.AppHash, expected) {
			return CommittedState{}, errors.New("legacy committed state app hash is invalid")
		}
		state.Version = CommittedStateVersion
		state.FeeEvents = []BFTFeeEvent{}
		if !accountsEqual(state.Accounts, migration.Accounts) || state.hasApplicationRecords() {
			state.AppHash, err = state.calculateHash()
			if err != nil {
				return CommittedState{}, fmt.Errorf("migrate committed state hash: %w", err)
			}
		}
	}
	if state.Version == 8 {
		expected := migration.StateHash
		if !accountsEqual(state.Accounts, migration.Accounts) || state.hasApplicationRecords() {
			expected, err = state.calculateHashFor("YNX_ABCI_STATE_V8", 8)
			if err != nil {
				return CommittedState{}, fmt.Errorf("calculate version 8 committed state hash: %w", err)
			}
		}
		if !strings.EqualFold(state.AppHash, expected) {
			return CommittedState{}, errors.New("version 8 committed state app hash is invalid")
		}
		state.Version = CommittedStateVersion
		state.StakeDelegations = []BFTStakeDelegation{}
		state.Unbondings = []BFTUnbondingEntry{}
		if !accountsEqual(state.Accounts, migration.Accounts) || state.hasApplicationRecords() {
			state.AppHash, err = state.calculateHash()
			if err != nil {
				return CommittedState{}, fmt.Errorf("migrate version 8 committed state hash: %w", err)
			}
		}
	}
	if err := state.Validate(migration); err != nil {
		return CommittedState{}, fmt.Errorf("validate committed state: %w", err)
	}
	return state, nil
}

func saveCommittedState(path string, state CommittedState, migration chain.ConsensusMigrationState) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	if err := state.Validate(migration); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode committed state: %w", err)
	}
	payload = append(payload, '\n')
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create committed state directory: %w", err)
	}
	temp, err := os.CreateTemp(dir, ".ynx-abci-state-*")
	if err != nil {
		return fmt.Errorf("create committed state temp file: %w", err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return fmt.Errorf("secure committed state temp file: %w", err)
	}
	if _, err := temp.Write(payload); err != nil {
		_ = temp.Close()
		return fmt.Errorf("write committed state temp file: %w", err)
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return fmt.Errorf("sync committed state temp file: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close committed state temp file: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("replace committed state: %w", err)
	}
	directory, err := os.Open(dir)
	if err == nil {
		err = directory.Sync()
		_ = directory.Close()
	}
	if err != nil {
		return fmt.Errorf("sync committed state directory: %w", err)
	}
	return nil
}

func cloneAccounts(accounts []chain.ConsensusAccount) []chain.ConsensusAccount {
	out := make([]chain.ConsensusAccount, len(accounts))
	for i, account := range accounts {
		out[i] = account
		out[i].Lots = make(map[string]int64, len(account.Lots))
		for lotID, amount := range account.Lots {
			out[i].Lots[lotID] = amount
		}
	}
	return out
}

func cloneAIPermissions(permissions []BFTAIPermission) []BFTAIPermission {
	return append([]BFTAIPermission(nil), permissions...)
}

func cloneUnbondings(values []BFTUnbondingEntry) []BFTUnbondingEntry {
	out := append([]BFTUnbondingEntry(nil), values...)
	for i := range out {
		if out[i].WithdrawnAt != nil {
			value := *out[i].WithdrawnAt
			out[i].WithdrawnAt = &value
		}
	}
	return out
}

func cloneAIActions(actions []BFTAIAction) []BFTAIAction {
	out := make([]BFTAIAction, len(actions))
	for i, action := range actions {
		out[i] = action
		out[i].Reasons = append([]string(nil), action.Reasons...)
		if action.ApprovedAt != nil {
			approvedAt := *action.ApprovedAt
			out[i].ApprovedAt = &approvedAt
		}
		if action.RejectedAt != nil {
			rejectedAt := *action.RejectedAt
			out[i].RejectedAt = &rejectedAt
		}
	}
	return out
}

func accountsEqual(left, right []chain.ConsensusAccount) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && string(leftJSON) == string(rightJSON)
}

func accountIndex(accounts []chain.ConsensusAccount, address string) (int, bool) {
	index := sort.Search(len(accounts), func(i int) bool { return accounts[i].Address >= address })
	return index, index < len(accounts) && accounts[index].Address == address
}

func ensureAccount(accounts []chain.ConsensusAccount, address string) ([]chain.ConsensusAccount, int) {
	index, ok := accountIndex(accounts, address)
	if ok {
		return accounts, index
	}
	accounts = append(accounts, chain.ConsensusAccount{})
	copy(accounts[index+1:], accounts[index:])
	accounts[index] = chain.ConsensusAccount{Address: address, Lots: map[string]int64{}}
	return accounts, index
}
