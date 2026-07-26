package governance

import (
	"os"
	"runtime/debug"
	"sort"
	"strings"
	"time"
)

type DependencyStatus struct {
	Status   string `json:"status"`
	Required bool   `json:"required"`
	Detail   string `json:"detail"`
}

type RuntimeStatus struct {
	OK                      bool                        `json:"ok"`
	Service                 string                      `json:"service"`
	APIVersion              string                      `json:"apiVersion"`
	SchemaVersion           string                      `json:"schemaVersion"`
	RegistryDigest          string                      `json:"registryDigest"`
	Commit                  string                      `json:"commit"`
	CommitSource            string                      `json:"commitSource"`
	Release                 string                      `json:"release"`
	BuildTime               string                      `json:"buildTime"`
	StartedAt               time.Time                   `json:"startedAt"`
	DatabaseStatus          string                      `json:"databaseStatus"`
	ChainStatus             string                      `json:"chainStatus"`
	TimelockStatus          map[string]int              `json:"timelockStatus"`
	ExecutionQueue          map[string]int              `json:"executionQueue"`
	LastSuccessfulProposal  string                      `json:"lastSuccessfulProposal,omitempty"`
	LastSuccessfulExecution string                      `json:"lastSuccessfulExecution,omitempty"`
	PendingEmergencyActions int                         `json:"pendingEmergencyActions"`
	Degraded                bool                        `json:"degraded"`
	DegradedReasons         []string                    `json:"degradedReasons"`
	DependencyStatus        map[string]DependencyStatus `json:"dependencyStatus"`
}

type HealthResponse struct {
	RuntimeStatus
	Governance Health `json:"governance"`
}

type detectedBuild struct {
	commit       string
	commitSource string
	release      string
	buildTime    string
	modified     bool
}

func detectBuild() detectedBuild {
	out := detectedBuild{commit: registrySourceCommit, commitSource: "embedded_registry_source_commit", release: registryRelease, buildTime: "unknown"}
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return out
	}
	if version := strings.TrimSpace(info.Main.Version); version != "" && version != "(devel)" {
		out.release = version
	}
	for _, setting := range info.Settings {
		switch setting.Key {
		case "vcs.revision":
			if strings.TrimSpace(setting.Value) != "" {
				out.commit = setting.Value
				out.commitSource = "go_build_vcs"
			}
		case "vcs.time":
			if strings.TrimSpace(setting.Value) != "" {
				out.buildTime = setting.Value
			}
		case "vcs.modified":
			out.modified = setting.Value == "true"
		}
	}
	return out
}

func (s *Server) runtimeStatus() RuntimeStatus {
	now := s.now().UTC()
	build := detectBuild()
	status := RuntimeStatus{
		OK: true, Service: "ynx-governanced", APIVersion: apiVersion, SchemaVersion: snapshotVersion,
		RegistryDigest: s.service.RegistrySet().Digest, Commit: build.commit, CommitSource: build.commitSource,
		Release: build.release, BuildTime: build.buildTime, StartedAt: s.startedAt,
		ChainStatus: "not_integrated", TimelockStatus: map[string]int{}, ExecutionQueue: map[string]int{},
		DependencyStatus: map[string]DependencyStatus{
			"01-chain-core":   {Status: "not_integrated", Required: true, Detail: "canonical execution and final chain state are not connected"},
			"02-wallet-auth":  {Status: "gateway_assertion_adapter_configured", Required: true, Detail: "mutations require scoped product-session assertions"},
			"12-explorer":     {Status: "not_integrated", Required: true, Detail: "public proposal, vote, execution, and treasury evidence is not yet indexed"},
			"13-monitor":      {Status: "not_integrated", Required: true, Detail: "timelock, execution, and emergency alerts are not yet connected"},
			"15-trust":        {Status: "local_appeal_adapter_only", Required: true, Detail: "appeal records exist locally; central transparency integration is pending"},
			"26-data-fabric":  {Status: "not_integrated", Required: true, Detail: "canonical event and audit ledger publishing is pending"},
			"29-integration":  {Status: "not_accepted", Required: true, Detail: "shared protocol freeze and testnet acceptance are pending"},
			"30-security-sre": {Status: "not_integrated", Required: true, Detail: "external signer, release, backup, and incident control are pending"},
		},
	}
	if info, err := os.Stat(s.statePath); err == nil && info.Mode().IsRegular() {
		status.DatabaseStatus = "available"
	} else if os.IsNotExist(err) {
		status.DatabaseStatus = "missing"
		status.DegradedReasons = append(status.DegradedReasons, "governance_state_file_missing")
	} else {
		status.DatabaseStatus = "unavailable"
		status.OK = false
		status.DegradedReasons = append(status.DegradedReasons, "governance_state_file_unavailable")
	}
	if build.commitSource != "go_build_vcs" {
		status.DegradedReasons = append(status.DegradedReasons, "binary_commit_provenance_unavailable")
	}
	if build.modified {
		status.DegradedReasons = append(status.DegradedReasons, "binary_built_from_modified_tree")
	}
	status.DegradedReasons = append(status.DegradedReasons, "chain_execution_not_integrated", "central_evidence_dependencies_pending")

	for _, record := range s.service.ListTimelocks(now) {
		switch record.Status {
		case TimelockActive:
			if now.Before(record.EarliestExecution) {
				status.TimelockStatus["active"]++
			} else {
				status.TimelockStatus["elapsed"]++
			}
		default:
			status.TimelockStatus[string(record.Status)]++
		}
	}
	proposals := s.service.ListProposals()
	var lastVerified time.Time
	for _, proposal := range proposals {
		switch proposal.Status {
		case StatusExecutionReady:
			status.ExecutionQueue["ready"]++
		case StatusExecutionSubmitted:
			status.ExecutionQueue["submitted"]++
		case StatusExecutionFailed:
			status.ExecutionQueue["failed_waiting_rollback"]++
		case StatusRollbackPending:
			status.ExecutionQueue["rollback_pending"]++
		}
		if proposal.Status != StatusVerified {
			continue
		}
		verifiedAt := proposal.UpdatedAt
		for _, transition := range proposal.Transitions {
			if transition.To == StatusVerified {
				verifiedAt = transition.At
			}
		}
		if status.LastSuccessfulProposal == "" || verifiedAt.After(lastVerified) {
			lastVerified = verifiedAt
			status.LastSuccessfulProposal = proposal.ID
			if proposal.ExecutionReceipt != nil {
				status.LastSuccessfulExecution = proposal.ExecutionReceipt.TxHash
			}
		}
	}
	for _, action := range s.service.ListEmergencies(now) {
		if action.Status == "pending_approval" || action.Status == "active" {
			status.PendingEmergencyActions++
		}
	}
	status.Degraded = len(status.DegradedReasons) > 0
	sort.Strings(status.DegradedReasons)
	return status
}
