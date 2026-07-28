package governance

import (
	"encoding/json"
	"fmt"
	"strconv"
)

const (
	registrySourceCommit = "c4f98fb0c8c08b35d4a8f33d8321a05e21c41736"
	registryRelease      = "governance-registry-v1-unreleased"
	registryEffectiveAt  = "2026-07-25T00:00:00Z"
)

type governanceObjectSpec struct {
	id        string
	name      string
	scope     Scope
	role      GovernanceRole
	threshold uint64
	quorum    uint64
	timelock  string
	emergency bool
}

type parameterSpec struct {
	id, objectID, path string
	scope              Scope
	current            int64
	minimum            int64
	maximum            int64
	perProposal        int64
	perWindow          int64
	window             string
	cooldown           string
	role               GovernanceRole
	threshold          uint64
	quorum             uint64
	timelock           string
	unit               string
}

var governanceObjectSpecs = []governanceObjectSpec{
	{"protocol-upgrade", "Protocol Upgrade", ScopeProtocolUpgrade, RoleTechnicalCouncil, 7500, 6000, "168h", false},
	{"consensus-upgrade", "Consensus Upgrade", ScopeConsensusUpgrade, RoleTechnicalCouncil, 8000, 6700, "336h", false},
	{"streambft-candidate", "StreamBFT Candidate", ScopeConsensusUpgrade, RoleTechnicalCouncil, 8000, 6700, "336h", false},
	{"genesis-parameters", "Genesis Parameters", ScopeGenesis, RoleTechnicalCouncil, 8000, 6700, "336h", false},
	{"validator-parameters", "Validator Parameters", ScopeGenesis, RoleTechnicalCouncil, 7500, 6000, "168h", false},
	{"fee-parameters", "Fee Parameters", ScopeEconomics, RoleTechnicalCouncil, 6667, 5000, "72h", false},
	{"burn-parameters", "Burn Parameters", ScopeEconomics, RoleTechnicalCouncil, 7500, 6000, "168h", false},
	{"issuance-parameters", "Issuance Parameters", ScopeEconomics, RoleTechnicalCouncil, 8000, 6700, "336h", false},
	{"treasury-spend", "Treasury Spend", ScopeTreasury, RoleTreasuryCouncil, 7500, 6000, "168h", false},
	{"treasury-allocation", "Treasury Allocation", ScopeTreasury, RoleTreasuryCouncil, 7500, 6000, "168h", false},
	{"stablecoin-provider", "Stablecoin Provider", ScopeStablecoin, RoleTechnicalCouncil, 7500, 6000, "168h", false},
	{"reserve-provider", "Reserve Provider", ScopeStablecoin, RoleTreasuryCouncil, 8000, 6700, "336h", false},
	{"redemption-parameters", "Redemption Parameters", ScopeStablecoin, RoleTechnicalCouncil, 7500, 6000, "168h", false},
	{"oracle-provider", "Oracle Provider", ScopeOracle, RoleTechnicalCouncil, 7500, 6000, "168h", true},
	{"oracle-threshold", "Oracle Threshold", ScopeOracle, RoleTechnicalCouncil, 7500, 6000, "168h", false},
	{"oracle-aggregation-parameters", "Oracle Aggregation Parameters", ScopeOracle, RoleTechnicalCouncil, 7500, 6000, "168h", false},
	{"bridge-provider", "Bridge Provider", ScopeBridge, RoleTechnicalCouncil, 8000, 6700, "336h", false},
	{"bridge-limits", "Bridge Limits", ScopeBridge, RoleTechnicalCouncil, 7500, 6000, "168h", false},
	{"bridge-pause", "Bridge Pause", ScopeBridge, RoleEmergencyCouncil, 7500, 6000, "24h", true},
	{"exchange-market-listing", "Exchange Market Listing", ScopeExchange, RoleTechnicalCouncil, 7500, 6000, "168h", false},
	{"exchange-market-delisting", "Exchange Market Delisting", ScopeExchange, RoleTechnicalCouncil, 7500, 6000, "72h", true},
	{"exchange-risk-bounds", "Exchange Risk Bounds", ScopeExchange, RoleTechnicalCouncil, 7500, 6000, "168h", false},
	{"dex-fee", "DEX Fee", ScopeDEX, RoleTechnicalCouncil, 6667, 5000, "72h", false},
	{"dex-pool-policy", "DEX Pool Policy", ScopeDEX, RoleTechnicalCouncil, 7500, 6000, "168h", true},
	{"quant-vault-bounds", "Quant / Vault Bounds", ScopeVault, RoleTechnicalCouncil, 7500, 6000, "168h", true},
	{"safety-module", "Safety Module", ScopeSafety, RoleSecurityCouncil, 8000, 6700, "336h", false},
	{"service-security-pool", "Service Security Pool", ScopeServiceSecurity, RoleSecurityCouncil, 8000, 6700, "336h", false},
	{"resource-provider-rules", "Resource Provider Rules", ScopeResource, RoleTechnicalCouncil, 7500, 6000, "168h", false},
	{"product-registry", "Product Registry", ScopeProductRegistry, RoleTechnicalCouncil, 6667, 5000, "72h", false},
	{"public-grants", "Public Grants", ScopeGrants, RoleTreasuryCouncil, 7500, 6000, "168h", false},
	{"incentives", "Incentives", ScopeGrants, RoleTreasuryCouncil, 7500, 6000, "168h", false},
	{"retention-policy", "Retention Policy", ScopeRetentionPolicy, RoleTechnicalCouncil, 7500, 6000, "168h", false},
	{"security-policy", "Security Policy", ScopeSecurityPolicy, RoleSecurityCouncil, 8000, 6700, "168h", false},
	{"release-policy", "Release Policy", ScopeReleasePolicy, RoleTechnicalCouncil, 7500, 6000, "168h", true},
}

var parameterSpecs = []parameterSpec{
	{"minimum-quorum", "release-policy", "/governance/minimumQuorumBps", ScopeReleasePolicy, 4000, 1000, 9000, 500, 1000, "720h", "168h", RoleTechnicalCouncil, 6667, 5000, "168h", "bps"},
	{"approval-threshold", "release-policy", "/governance/approvalThresholdBps", ScopeReleasePolicy, 6667, 5001, 9500, 500, 1000, "720h", "168h", RoleTechnicalCouncil, 7500, 6000, "168h", "bps"},
	{"veto-threshold", "security-policy", "/governance/vetoThresholdBps", ScopeSecurityPolicy, 3334, 1000, 5000, 500, 1000, "720h", "168h", RoleSecurityCouncil, 8000, 6700, "168h", "bps"},
	{"council-threshold", "security-policy", "/governance/councilThresholdBps", ScopeSecurityPolicy, 6667, 5001, 10000, 500, 1000, "720h", "168h", RoleSecurityCouncil, 8000, 6700, "168h", "bps"},
	{"emergency-threshold", "security-policy", "/governance/emergencyThresholdBps", ScopeSecurityPolicy, 7500, 6667, 10000, 500, 1000, "720h", "168h", RoleEmergencyCouncil, 8000, 6700, "168h", "bps"},
	{"treasury-threshold", "treasury-spend", "/governance/treasuryThresholdBps", ScopeTreasury, 7500, 6667, 10000, 500, 1000, "720h", "168h", RoleTreasuryCouncil, 8000, 6700, "168h", "bps"},
	{"upgrade-threshold", "protocol-upgrade", "/governance/upgradeThresholdBps", ScopeProtocolUpgrade, 8000, 6667, 10000, 500, 1000, "720h", "336h", RoleTechnicalCouncil, 8000, 6700, "336h", "bps"},
	{"provider-change-threshold", "oracle-provider", "/governance/providerChangeThresholdBps", ScopeOracle, 7500, 6667, 10000, 500, 1000, "720h", "168h", RoleTechnicalCouncil, 8000, 6700, "168h", "bps"},
	{"issuance-floor", "issuance-parameters", "/economics/issuanceFloor", ScopeEconomics, 0, 0, 1_000_000_000, 10_000_000, 20_000_000, "720h", "336h", RoleTechnicalCouncil, 8000, 6700, "336h", "microYNXT"},
	{"issuance-ceiling", "issuance-parameters", "/economics/issuanceCeiling", ScopeEconomics, 100_000_000, 1_000_000, 1_000_000_000, 25_000_000, 50_000_000, "720h", "336h", RoleTechnicalCouncil, 8000, 6700, "336h", "microYNXT"},
	{"burn-rate", "burn-parameters", "/economics/burnRateBps", ScopeEconomics, 500, 0, 5000, 250, 500, "720h", "168h", RoleTechnicalCouncil, 7500, 6000, "168h", "bps"},
	{"fee-split", "fee-parameters", "/economics/treasuryFeeShareBps", ScopeEconomics, 2500, 0, 10000, 500, 1000, "720h", "72h", RoleTechnicalCouncil, 6667, 5000, "72h", "bps"},
	{"treasury-allocation", "treasury-allocation", "/treasury/allocationBps", ScopeTreasury, 2000, 0, 5000, 500, 1000, "720h", "168h", RoleTreasuryCouncil, 7500, 6000, "168h", "bps"},
	{"validator-commission-min", "validator-parameters", "/validators/commissionMinBps", ScopeGenesis, 0, 0, 2000, 250, 500, "720h", "168h", RoleTechnicalCouncil, 7500, 6000, "168h", "bps"},
	{"validator-commission-max", "validator-parameters", "/validators/commissionMaxBps", ScopeGenesis, 2000, 500, 5000, 250, 500, "720h", "168h", RoleTechnicalCouncil, 7500, 6000, "168h", "bps"},
	{"slashing-bounds", "validator-parameters", "/validators/slashingMaxBps", ScopeGenesis, 500, 0, 5000, 250, 500, "720h", "168h", RoleSecurityCouncil, 8000, 6700, "168h", "bps"},
	{"staking-unbonding", "validator-parameters", "/validators/unbondingHours", ScopeGenesis, 504, 24, 2160, 168, 336, "720h", "168h", RoleTechnicalCouncil, 7500, 6000, "168h", "hours"},
	{"stablecoin-limit", "redemption-parameters", "/stablecoin/exposureLimit", ScopeStablecoin, 100_000_000, 0, 1_000_000_000, 10_000_000, 20_000_000, "720h", "168h", RoleTechnicalCouncil, 7500, 6000, "168h", "microUSD"},
	{"reserve-requirement", "reserve-provider", "/stablecoin/reserveRequirementBps", ScopeStablecoin, 10000, 10000, 20000, 500, 1000, "720h", "336h", RoleTreasuryCouncil, 8000, 6700, "336h", "bps"},
	{"redemption-limit", "redemption-parameters", "/stablecoin/redemptionDailyLimit", ScopeStablecoin, 10_000_000, 0, 1_000_000_000, 1_000_000, 2_000_000, "168h", "72h", RoleTechnicalCouncil, 7500, 6000, "168h", "microUSD"},
	{"oracle-threshold", "oracle-threshold", "/oracle/minimumProviders", ScopeOracle, 3, 2, 15, 1, 2, "720h", "168h", RoleTechnicalCouncil, 7500, 6000, "168h", "providers"},
	{"bridge-exposure", "bridge-limits", "/bridge/exposureLimit", ScopeBridge, 50_000_000, 0, 500_000_000, 5_000_000, 10_000_000, "720h", "168h", RoleTechnicalCouncil, 7500, 6000, "168h", "microUSD"},
	{"exchange-leverage", "exchange-risk-bounds", "/exchange/maxLeverageBps", ScopeExchange, 30000, 10000, 100000, 5000, 10000, "720h", "168h", RoleTechnicalCouncil, 7500, 6000, "168h", "bps"},
	{"liquidation-parameter", "exchange-risk-bounds", "/exchange/maintenanceMarginBps", ScopeExchange, 1000, 100, 5000, 250, 500, "720h", "168h", RoleTechnicalCouncil, 7500, 6000, "168h", "bps"},
	{"dex-fee", "dex-fee", "/dex/feeBps", ScopeDEX, 30, 0, 1000, 25, 50, "720h", "72h", RoleTechnicalCouncil, 6667, 5000, "72h", "bps"},
	{"vault-limit", "quant-vault-bounds", "/vault/assetLimit", ScopeVault, 10_000_000, 0, 1_000_000_000, 1_000_000, 2_000_000, "720h", "168h", RoleTechnicalCouncil, 7500, 6000, "168h", "microUSD"},
	{"quant-risk", "quant-vault-bounds", "/vault/maxDrawdownBps", ScopeVault, 2000, 100, 5000, 250, 500, "720h", "168h", RoleSecurityCouncil, 8000, 6700, "168h", "bps"},
	{"safety-module-slash", "safety-module", "/safety/slashMaxBps", ScopeSafety, 1000, 0, 5000, 250, 500, "720h", "336h", RoleSecurityCouncil, 8000, 6700, "336h", "bps"},
	{"provider-bond", "resource-provider-rules", "/providers/minimumBond", ScopeResource, 1_000_000, 0, 1_000_000_000, 100_000, 200_000, "720h", "168h", RoleTechnicalCouncil, 7500, 6000, "168h", "microYNXT"},
	{"service-security-pool", "service-security-pool", "/securityPool/minimumBalance", ScopeServiceSecurity, 10_000_000, 0, 1_000_000_000, 1_000_000, 2_000_000, "720h", "336h", RoleSecurityCouncil, 8000, 6700, "336h", "microYNXT"},
	{"retention-days", "retention-policy", "/data/retentionDays", ScopeRetentionPolicy, 365, 7, 3650, 30, 90, "2160h", "168h", RoleTechnicalCouncil, 7500, 6000, "168h", "days"},
	{"emergency-max-duration", "security-policy", "/emergency/maximumDurationHours", ScopeSecurityPolicy, 168, 1, 168, 24, 48, "720h", "168h", RoleEmergencyCouncil, 8000, 6700, "168h", "hours"},
}

func defaultGovernanceRegistries(roles RoleRegistry) (GovernanceObjectRegistry, ParameterRegistry) {
	objects := GovernanceObjectRegistry{
		SchemaVersion: "ynx-governance-object-registry/v1",
		RegistryID:    "ynx-governance-objects-2026-07-25",
		Objects:       make([]GovernanceObjectDefinition, 0, len(governanceObjectSpecs)),
	}
	objectIndex := make(map[string]int, len(governanceObjectSpecs))
	for _, spec := range governanceObjectSpecs {
		objectID := "govobj." + spec.id
		emergencyScope := []string{}
		if spec.emergency {
			emergencyScope = []string{"temporary_pause"}
		}
		current := json.RawMessage(fmt.Sprintf(`{"scope":%q,"status":"genesis_registered"}`, spec.scope))
		objects.Objects = append(objects.Objects, GovernanceObjectDefinition{
			ObjectID: objectID, Name: spec.name, Owner: "ynx-governance",
			SchemaVersion: "ynx-governance-object/v1", CurrentValue: current,
			AllowedRange: AllowedRange{}, ChangeRateLimit: ChangeRateLimit{Window: "720h", Cooldown: "24h"},
			RequiredRole: spec.role, RequiredThresholdBPS: spec.threshold,
			RequiredQuorumBPS: spec.quorum, RequiredTimelock: spec.timelock,
			EmergencyScope:       emergencyScope,
			MigrationRequirement: "machine-readable migration or explicit no-migration evidence",
			RollbackRequirement:  "verified rollback plan and bounded rollback authority",
			SourceCommit:         registrySourceCommit, Release: registryRelease, EffectiveAt: registryEffectiveAt,
			LastChangedBy: "genesis-registry", Evidence: []string{"registry://governance-object/" + objectID},
			AuditID: "audit." + objectID + ".v1", ParameterIDs: []string{},
		})
		objectIndex[spec.id] = len(objects.Objects) - 1
	}
	parameters := ParameterRegistry{
		SchemaVersion: "ynx-governance-parameter-registry/v1",
		RegistryID:    "ynx-governance-parameters-2026-07-25",
		Parameters:    make([]ParameterRegistryEntry, 0, len(parameterSpecs)),
	}
	for _, spec := range parameterSpecs {
		parameterID := "govparam." + spec.id
		objectID := "govobj." + spec.objectID
		minimum, maximum := spec.minimum, spec.maximum
		parameters.Parameters = append(parameters.Parameters, ParameterRegistryEntry{
			ParameterID: parameterID, ObjectID: objectID, Path: spec.path, Scope: spec.scope,
			ValueType: "integer", CurrentValue: json.RawMessage(strconv.FormatInt(spec.current, 10)),
			AllowedRange:             AllowedRange{Minimum: &minimum, Maximum: &maximum, Unit: spec.unit},
			MaximumChangePerProposal: spec.perProposal, MaximumChangePerWindow: spec.perWindow,
			Window: spec.window, Cooldown: spec.cooldown, RequiredRole: spec.role,
			RequiredThresholdBPS: spec.threshold, RequiredQuorumBPS: spec.quorum,
			RequiredTimelock: spec.timelock, SourceCommit: registrySourceCommit, Release: registryRelease,
			Evidence: []string{"registry://governance-parameter/" + parameterID},
			AuditID:  "audit." + parameterID + ".v1",
		})
		if index, ok := objectIndex[spec.objectID]; ok {
			objects.Objects[index].ParameterIDs = append(objects.Objects[index].ParameterIDs, parameterID)
		}
	}
	manifestParameters := []struct {
		id, objectID, path string
		scope              Scope
		role               GovernanceRole
		threshold          uint64
		quorum             uint64
		timelock           string
	}{
		{"protocol-upgrade-manifest", "protocol-upgrade", "/protocol/upgradeManifestHash", ScopeProtocolUpgrade, RoleTechnicalCouncil, 8000, 6700, "336h"},
		{"consensus-upgrade-manifest", "consensus-upgrade", "/consensus/upgradeManifestHash", ScopeConsensusUpgrade, RoleTechnicalCouncil, 8000, 6700, "336h"},
	}
	for _, spec := range manifestParameters {
		parameterID := "govparam." + spec.id
		objectID := "govobj." + spec.objectID
		parameters.Parameters = append(parameters.Parameters, ParameterRegistryEntry{
			ParameterID: parameterID, ObjectID: objectID, Path: spec.path, Scope: spec.scope,
			ValueType: "sha256", CurrentValue: json.RawMessage(`""`), AllowedRange: AllowedRange{Unit: "sha256"},
			RequiredRole: spec.role, RequiredThresholdBPS: spec.threshold, RequiredQuorumBPS: spec.quorum,
			RequiredTimelock: spec.timelock, SourceCommit: registrySourceCommit, Release: registryRelease,
			Evidence: []string{"registry://governance-parameter/" + parameterID}, AuditID: "audit." + parameterID + ".v1",
		})
		if index, ok := objectIndex[spec.objectID]; ok {
			objects.Objects[index].ParameterIDs = append(objects.Objects[index].ParameterIDs, parameterID)
		}
	}
	return objects, parameters
}
