package consensus

// Legacy hash documents are frozen from the two previously shipped source
// lineages. Field order and JSON tags are consensus data; do not consolidate.
import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"strings"
)

// Frozen source: 3a49306956eef0f5933714760f4cc34a7f93c584
type legacyFullHashDocument struct {
	Domain                     string                          `json:"domain"`
	Version                    int                             `json:"version"`
	ChainID                    int64                           `json:"chainId"`
	MigrationStateHash         string                          `json:"migrationStateHash"`
	Accounts                   []chain.ConsensusAccount        `json:"accounts"`
	FeeEvents                  []BFTFeeEvent                   `json:"feeEvents,omitempty"`
	StrategyMandates           []assetauth.StrategyMandate     `json:"strategyMandates,omitempty"`
	StrategyVaults             []assetauth.StrategyVault       `json:"strategyVaults,omitempty"`
	AssetAuditEvents           []BFTAssetAuditEvent            `json:"assetAuditEvents,omitempty"`
	SmartAccounts              []assetauth.SmartAccount        `json:"smartAccounts,omitempty"`
	Paymasters                 []BFTPaymaster                  `json:"paymasters,omitempty"`
	UserOperationEvents        []BFTUserOperationEvent         `json:"userOperationEvents,omitempty"`
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
	GovernanceExecutions       []BFTGovernanceExecution        `json:"governanceExecutions,omitempty"`
	GovernanceExecutionAudit   []BFTGovernanceExecutionAudit   `json:"governanceExecutionAudit,omitempty"`
	DexAssets                  []BFTDexAsset                   `json:"dexAssets,omitempty"`
	DexBalances                []BFTDexBalance                 `json:"dexBalances,omitempty"`
	DexPools                   []BFTDexPool                    `json:"dexPools,omitempty"`
	DexEvents                  []BFTDexEvent                   `json:"dexEvents,omitempty"`
}

func (s CommittedState) calculateLegacyFullHash(domain string, version int) (string, error) {
	doc := legacyFullHashDocument{
		Domain:                     domain,
		Version:                    version,
		ChainID:                    s.ChainID,
		MigrationStateHash:         s.MigrationStateHash,
		Accounts:                   s.Accounts,
		FeeEvents:                  s.FeeEvents,
		StrategyMandates:           s.StrategyMandates,
		StrategyVaults:             s.StrategyVaults,
		AssetAuditEvents:           s.AssetAuditEvents,
		SmartAccounts:              s.SmartAccounts,
		Paymasters:                 s.Paymasters,
		UserOperationEvents:        s.UserOperationEvents,
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
		GovernanceExecutions:       s.GovernanceExecutions,
		GovernanceExecutionAudit:   s.GovernanceExecutionAudit,
		DexAssets:                  s.DexAssets,
		DexBalances:                s.DexBalances,
		DexPools:                   s.DexPools,
		DexEvents:                  s.DexEvents,
	}
	payload, err := json.Marshal(doc)
	if err != nil {
		return "", fmt.Errorf("encode committed state hash document: %w", err)
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

// Frozen source: d4857f24735cccc23f2034c110f966ad99273e2f
type legacyNativeHashDocument struct {
	Domain                     string                          `json:"domain"`
	Version                    int                             `json:"version"`
	ChainID                    int64                           `json:"chainId"`
	MigrationStateHash         string                          `json:"migrationStateHash"`
	Accounts                   []chain.ConsensusAccount        `json:"accounts"`
	FeeEvents                  []BFTFeeEvent                   `json:"feeEvents,omitempty"`
	NativeTransfers            []BFTNativeTransfer             `json:"nativeTransfers,omitempty"`
	AIPermissions              []BFTAIPermission               `json:"aiPermissions"`
	AIActions                  []BFTAIAction                   `json:"aiActions"`
	AIAuditEvents              []BFTAIAuditEvent               `json:"aiAuditEvents"`
	PayIntents                 []BFTPayIntent                  `json:"payIntents"`
	PayInvoices                []BFTPayInvoice                 `json:"payInvoices"`
	PaySettlements             []BFTPaySettlement              `json:"paySettlements,omitempty"`
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
	GovernanceExecutions       []BFTGovernanceExecution        `json:"governanceExecutions"`
	GovernanceExecutionAudit   []BFTGovernanceExecutionAudit   `json:"governanceExecutionAudit"`
	DexAssets                  []BFTDexAsset                   `json:"dexAssets,omitempty"`
	DexBalances                []BFTDexBalance                 `json:"dexBalances,omitempty"`
	DexPools                   []BFTDexPool                    `json:"dexPools,omitempty"`
	DexEvents                  []BFTDexEvent                   `json:"dexEvents,omitempty"`
}

func (s CommittedState) calculateLegacyNativeHash(domain string, version int) (string, error) {
	doc := legacyNativeHashDocument{
		Domain:                     domain,
		Version:                    version,
		ChainID:                    s.ChainID,
		MigrationStateHash:         s.MigrationStateHash,
		Accounts:                   s.Accounts,
		FeeEvents:                  s.FeeEvents,
		NativeTransfers:            s.NativeTransfers,
		AIPermissions:              s.AIPermissions,
		AIActions:                  s.AIActions,
		AIAuditEvents:              s.AIAuditEvents,
		PayIntents:                 s.PayIntents,
		PayInvoices:                s.PayInvoices,
		PaySettlements:             s.PaySettlements,
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
		GovernanceExecutions:       s.GovernanceExecutions,
		GovernanceExecutionAudit:   s.GovernanceExecutionAudit,
		DexAssets:                  s.DexAssets,
		DexBalances:                s.DexBalances,
		DexPools:                   s.DexPools,
		DexEvents:                  s.DexEvents,
	}
	payload, err := json.Marshal(doc)
	if err != nil {
		return "", fmt.Errorf("encode committed state hash document: %w", err)
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func (s CommittedState) hasFullOnlyRecords() bool {
	return len(s.StrategyMandates)+len(s.StrategyVaults)+len(s.AssetAuditEvents)+len(s.SmartAccounts)+len(s.Paymasters)+len(s.UserOperationEvents)+len(s.StakeDelegations)+len(s.Unbondings) != 0
}
func (s CommittedState) hasNativeOnlyRecords() bool {
	return len(s.NativeTransfers)+len(s.PaySettlements) != 0
}

// Verification never drops a field that was excluded from a legacy hash.
// An overlapping version number is disambiguated by its exact archived digest.
func upgradeLegacyCommittedState(s CommittedState, migration chain.ConsensusMigrationState) (CommittedState, error) {
	if s.Version == CommittedStateVersion {
		return s, nil
	}
	if s.Version < 7 || s.Version > 14 {
		return CommittedState{}, fmt.Errorf("unsupported committed state version %d", s.Version)
	}
	domain := fmt.Sprintf("YNX_ABCI_STATE_V%d", s.Version)
	anchor := accountsEqual(s.Accounts, migration.Accounts) && !s.hasNonMigrationApplicationRecords() && committedDexMatchesMigration(s, migration) && s.Height >= int64(migration.Height)
	verified := anchor && strings.EqualFold(s.AppHash, migration.StateHash)
	if !verified && s.Version <= 13 && !s.hasNativeOnlyRecords() {
		digest, err := s.calculateLegacyFullHash(domain, s.Version)
		if err != nil {
			return CommittedState{}, err
		}
		verified = strings.EqualFold(s.AppHash, digest)
	}
	if !verified && (s.Version == 8 || s.Version == 13 || s.Version == 14) && !s.hasFullOnlyRecords() {
		digest, err := s.calculateLegacyNativeHash(domain, s.Version)
		if err != nil {
			return CommittedState{}, err
		}
		verified = strings.EqualFold(s.AppHash, digest)
	}
	if !verified {
		return CommittedState{}, errors.New("legacy committed state app hash does not match either preserved source lineage")
	}
	s.Version = CommittedStateVersion
	// Preserve every record, including fee history. Only the version/hash changes.
	if s.Initialized && (!accountsEqual(s.Accounts, migration.Accounts) || s.hasApplicationRecords()) {
		var err error
		s.AppHash, err = s.calculateHash()
		if err != nil {
			return CommittedState{}, err
		}
	} else {
		s.AppHash = migration.StateHash
	}
	return s, nil
}
