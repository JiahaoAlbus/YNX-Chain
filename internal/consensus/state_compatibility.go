package consensus

import (
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/assetauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// Historical hash projections are copied from the two fixed source parents.
// New fields cannot enter an old hash domain or vanish from a new state commitment.
type perfCommittedStateHashDocument struct {
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

type protocolCommittedStateHashDocument struct {
	ValidatorRegistry          *ValidatorRegistryState         `json:"validatorRegistry,omitempty"`
	PQEngineSchedule           *PQEngineSchedule               `json:"pqEngineSchedule,omitempty"`
	LegacyContracts            *LegacyContracts                `json:"legacyContracts,omitempty"`
	LegacyResourceMarket       *LegacyResourceMarket           `json:"legacyResourceMarket,omitempty"`
	LegacyResourceSponsor      *LegacyResourceSponsor          `json:"legacyResourceSponsor,omitempty"`
	TraceLots                  map[string]chain.TrustTraceLot  `json:"traceLots,omitempty"`
	AccountPolicy              *ynxauth.State                  `json:"accountPolicy,omitempty"`
	PQHistory                  []PQCommittedAuthorization      `json:"pqHistory,omitempty"`
	PQBatches                  map[string]PQCommittedBatch     `json:"pqBatches,omitempty"`
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

func (d committedStateHashDocument) wireValue() any {
	if d.Version <= 13 {
		return perfCommittedStateHashDocument{
			Domain:                     d.Domain,
			Version:                    d.Version,
			ChainID:                    d.ChainID,
			MigrationStateHash:         d.MigrationStateHash,
			Accounts:                   d.Accounts,
			FeeEvents:                  d.FeeEvents,
			StrategyMandates:           d.StrategyMandates,
			StrategyVaults:             d.StrategyVaults,
			AssetAuditEvents:           d.AssetAuditEvents,
			SmartAccounts:              d.SmartAccounts,
			Paymasters:                 d.Paymasters,
			UserOperationEvents:        d.UserOperationEvents,
			StakeDelegations:           d.StakeDelegations,
			Unbondings:                 d.Unbondings,
			AIPermissions:              d.AIPermissions,
			AIActions:                  d.AIActions,
			AIAuditEvents:              d.AIAuditEvents,
			PayIntents:                 d.PayIntents,
			PayInvoices:                d.PayInvoices,
			PayRefunds:                 d.PayRefunds,
			PayWebhooks:                d.PayWebhooks,
			PayEvents:                  d.PayEvents,
			PayIdempotency:             d.PayIdempotency,
			ResourceQuotes:             d.ResourceQuotes,
			ResourceDelegations:        d.ResourceDelegations,
			ResourceRentals:            d.ResourceRentals,
			ResourceIncome:             d.ResourceIncome,
			ResourceEvents:             d.ResourceEvents,
			ResourceIdempotency:        d.ResourceIdempotency,
			ResourcePools:              d.ResourcePools,
			ResourceSponsorships:       d.ResourceSponsorships,
			ResourceSponsorIdempotency: d.ResourceSponsorIdempotency,
			ResourceSponsorActionRefs:  d.ResourceSponsorActionRefs,
			ResourceSponsorAudit:       d.ResourceSponsorAudit,
			GovernanceRequests:         d.GovernanceRequests,
			TrustAppeals:               d.TrustAppeals,
			TrustCorrections:           d.TrustCorrections,
			TrustLabels:                d.TrustLabels,
			TrustEvidence:              d.TrustEvidence,
			TrackingReviews:            d.TrackingReviews,
			Transparency:               d.Transparency,
			Contracts:                  d.Contracts,
			EVMReceipts:                d.EVMReceipts,
			EVMLogs:                    d.EVMLogs,
			IDEIdempotency:             d.IDEIdempotency,
			GovernanceExecutions:       d.GovernanceExecutions,
			GovernanceExecutionAudit:   d.GovernanceExecutionAudit,
			DexAssets:                  d.DexAssets,
			DexBalances:                d.DexBalances,
			DexPools:                   d.DexPools,
			DexEvents:                  d.DexEvents,
		}
	}
	if d.Version <= 17 {
		return protocolCommittedStateHashDocument{
			ValidatorRegistry:          d.ValidatorRegistry,
			PQEngineSchedule:           d.PQEngineSchedule,
			LegacyContracts:            d.LegacyContracts,
			LegacyResourceMarket:       d.LegacyResourceMarket,
			LegacyResourceSponsor:      d.LegacyResourceSponsor,
			TraceLots:                  d.TraceLots,
			AccountPolicy:              d.AccountPolicy,
			PQHistory:                  d.PQHistory,
			PQBatches:                  d.PQBatches,
			Domain:                     d.Domain,
			Version:                    d.Version,
			ChainID:                    d.ChainID,
			MigrationStateHash:         d.MigrationStateHash,
			Accounts:                   d.Accounts,
			FeeEvents:                  d.FeeEvents,
			NativeTransfers:            d.NativeTransfers,
			AIPermissions:              d.AIPermissions,
			AIActions:                  d.AIActions,
			AIAuditEvents:              d.AIAuditEvents,
			PayIntents:                 d.PayIntents,
			PayInvoices:                d.PayInvoices,
			PaySettlements:             d.PaySettlements,
			PayRefunds:                 d.PayRefunds,
			PayWebhooks:                d.PayWebhooks,
			PayEvents:                  d.PayEvents,
			PayIdempotency:             d.PayIdempotency,
			ResourceQuotes:             d.ResourceQuotes,
			ResourceDelegations:        d.ResourceDelegations,
			ResourceRentals:            d.ResourceRentals,
			ResourceIncome:             d.ResourceIncome,
			ResourceEvents:             d.ResourceEvents,
			ResourceIdempotency:        d.ResourceIdempotency,
			ResourcePools:              d.ResourcePools,
			ResourceSponsorships:       d.ResourceSponsorships,
			ResourceSponsorIdempotency: d.ResourceSponsorIdempotency,
			ResourceSponsorActionRefs:  d.ResourceSponsorActionRefs,
			ResourceSponsorAudit:       d.ResourceSponsorAudit,
			GovernanceRequests:         d.GovernanceRequests,
			TrustAppeals:               d.TrustAppeals,
			TrustCorrections:           d.TrustCorrections,
			TrustLabels:                d.TrustLabels,
			TrustEvidence:              d.TrustEvidence,
			TrackingReviews:            d.TrackingReviews,
			Transparency:               d.Transparency,
			Contracts:                  d.Contracts,
			EVMReceipts:                d.EVMReceipts,
			EVMLogs:                    d.EVMLogs,
			IDEIdempotency:             d.IDEIdempotency,
			GovernanceExecutions:       d.GovernanceExecutions,
			GovernanceExecutionAudit:   d.GovernanceExecutionAudit,
			DexAssets:                  d.DexAssets,
			DexBalances:                d.DexBalances,
			DexPools:                   d.DexPools,
			DexEvents:                  d.DexEvents,
		}
	}
	type unionDocument committedStateHashDocument
	return unionDocument(d)
}

// MarshalJSON is also the exact reference used by canonical byte-equivalence tests.
func (d committedStateHashDocument) MarshalJSON() ([]byte, error) { return json.Marshal(d.wireValue()) }

func validateHistoricalStateFields(s CommittedState, migration chain.ConsensusMigrationState) error {
	if !supportedCommittedStateVersion(s.Version) {
		return errors.New("unsupported historical committed state version")
	}
	if s.Version <= 13 {
		if s.ValidatorRegistry != nil || s.PQEngineSchedule != nil || s.LegacyContracts != nil || s.LegacyResourceMarket != nil || s.LegacyResourceSponsor != nil || s.TraceLots != nil || s.AccountPolicy != nil || len(s.PQHistory)+len(s.PQBatches)+len(s.NativeTransfers)+len(s.PaySettlements) != 0 || migration.AccountPolicy != nil {
			return errors.New("legacy performance state cannot carry uncommitted protocol authorization or lineage fields")
		}
		if (s.Version < 8 && len(s.FeeEvents) != 0) || (s.Version < 9 && len(s.StrategyMandates)+len(s.StrategyVaults)+len(s.AssetAuditEvents) != 0) || (s.Version < 10 && len(s.StakeDelegations)+len(s.Unbondings) != 0) || (s.Version < 11 && len(s.SmartAccounts)+len(s.Paymasters)+len(s.UserOperationEvents) != 0) || (s.Version < 12 && len(s.GovernanceExecutions)+len(s.GovernanceExecutionAudit) != 0) || (s.Version < 13 && len(s.DexAssets)+len(s.DexBalances)+len(s.DexPools)+len(s.DexEvents) != 0) {
			return errors.New("historical state carries records outside its original version")
		}
	} else if s.Version <= 17 && len(s.StrategyMandates)+len(s.StrategyVaults)+len(s.AssetAuditEvents)+len(s.SmartAccounts)+len(s.Paymasters)+len(s.UserOperationEvents)+len(s.StakeDelegations)+len(s.Unbondings) != 0 {
		return errors.New("protocol source state cannot carry uncommitted performance runtime fields")
	}
	return nil
}
