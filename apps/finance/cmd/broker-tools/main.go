// Operator diagnostics and activation planning. No secrets/arguments are
// printed; this binary never creates accounts, transfers funds, submits orders
// or cancels orders.
package main

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance"
	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
)

type verificationResult struct {
	Assets    brokerage.AssetResult
	Snapshot  brokerage.AccountSnapshot
	Quote     brokerage.Quote
	StoreMode string
}

type verificationProbe func(context.Context, brokerage.Config) (verificationResult, error)
type readinessProbe func(context.Context, string, string, string, time.Time) (finance.BrokerActivationReadiness, error)
type authorityFactory func(finance.NodeEndpointAuthorityConfig) (finance.EndpointAuthorityGate, error)

func main() { os.Exit(run(os.Args[1:])) }
func run(args []string) int {
	return runWith(args, os.Getenv, func(ctx context.Context, cfg brokerage.Config) (verificationResult, error) {
		statePath := strings.TrimSpace(os.Getenv("YNX_FINANCE_STATE_PATH"))
		owner := strings.TrimSpace(os.Getenv("YNX_FINANCE_BROKER_VERIFY_ACCOUNT"))
		if statePath == "" || owner == "" {
			return verificationResult{}, &brokerage.Error{Code: "OWNER_VERIFICATION_CONTEXT_REQUIRED"}
		}
		store, err := finance.OpenStoreWithDatabase(statePath, os.Getenv("YNX_FINANCE_DATABASE_URL"))
		if err != nil {
			return verificationResult{}, &brokerage.Error{Code: "STATE_STORE_UNAVAILABLE"}
		}
		adapter := brokerage.NewAlpaca(cfg)
		assets, err := adapter.Assets(ctx)
		if err != nil {
			return verificationResult{}, err
		}
		snapshot, err := adapter.Reconcile(ctx, owner, store)
		if err != nil {
			return verificationResult{}, err
		}
		var quote brokerage.Quote
		for _, asset := range assets.Assets {
			if asset.Tradable {
				quote, err = adapter.Quote(ctx, asset.Symbol)
				break
			}
		}
		if err != nil || quote.Symbol == "" {
			if err != nil {
				return verificationResult{}, err
			}
			return verificationResult{}, &brokerage.Error{Code: "TRADABLE_ASSET_REQUIRED"}
		}
		return verificationResult{Assets: assets, Snapshot: snapshot, Quote: quote, StoreMode: store.StateStoreMode()}, nil
	}, os.Stdout)
}
func runWith(args []string, get func(string) string, probe verificationProbe, output io.Writer) int {
	return runWithReadiness(args, get, probe, finance.InspectBrokerActivationReadiness, output)
}

func runWithReadiness(args []string, get func(string) string, probe verificationProbe, readinessProbe readinessProbe, output io.Writer) int {
	return runWithDependencies(args, get, probe, readinessProbe, finance.NewNodeEndpointAuthority, output)
}

func runWithDependencies(args []string, get func(string) string, probe verificationProbe, readinessProbe readinessProbe, newAuthority authorityFactory, output io.Writer) int {
	mode := "doctor"
	network := false
	localReadOnly := false
	if len(args) > 0 {
		mode = args[0]
	}
	if (mode != "doctor" && mode != "sandbox-verify" && mode != "activation-plan") || len(args) > 2 || (len(args) == 2 && args[1] != "--network-read-only" && args[1] != "--local-read-only") || (len(args) == 2 && mode == "activation-plan" && args[1] != "--local-read-only") || (len(args) == 2 && mode != "activation-plan" && args[1] != "--network-read-only") {
		_ = json.NewEncoder(output).Encode(map[string]any{"error": "USAGE: doctor|sandbox-verify [--network-read-only] | activation-plan [--local-read-only]"})
		return 2
	}
	network = len(args) == 2 && args[1] == "--network-read-only"
	localReadOnly = len(args) == 2 && args[1] == "--local-read-only"
	cfg := brokerage.LoadConfig(get)
	status := cfg.Status()
	authorityConfigured := strings.TrimSpace(get("YNX_FINANCE_ENDPOINT_AUTHORITY_V2_NODE_BINARY")) != "" || strings.TrimSpace(get("YNX_FINANCE_ENDPOINT_AUTHORITY_V2_MANIFEST_FILE")) != ""
	authorityReport := map[string]any{"bundledManifestPresent": true, "bundledFinancePinBuildVerified": true, "configured": authorityConfigured, "verificationAttempted": false, "checkpointMayAdvance": false, "centralSignedManifestActive": false, "installedWalletCallbackVerified": false, "officialSandboxVerified": false, "providerVerified": false, "productionApproved": false, "result": "BLOCKED_SHARED_AUTHORITY_EVIDENCE"}
	// The Endpoint Authority verifier owns an append-only checkpoint CAS. It is
	// therefore deliberately excluded from configuration-only and
	// activation-plan --local-read-only modes. Only the explicit bounded
	// network diagnostic may advance that local checkpoint.
	if authorityConfigured && network {
		authorityReport["verificationAttempted"] = true
		authorityReport["checkpointMayAdvance"] = true
		gate, authorityErr := newAuthority(finance.NodeEndpointAuthorityConfig{
			NodeBinary: get("YNX_FINANCE_ENDPOINT_AUTHORITY_V2_NODE_BINARY"), Script: get("YNX_FINANCE_ENDPOINT_AUTHORITY_V2_SCRIPT"), TrustRootFile: get("YNX_FINANCE_ENDPOINT_AUTHORITY_V2_TRUST_ROOT_FILE"), ManifestFile: get("YNX_FINANCE_ENDPOINT_AUTHORITY_V2_MANIFEST_FILE"), CheckpointFile: get("YNX_FINANCE_ENDPOINT_AUTHORITY_V2_CHECKPOINT_FILE"), TrustedTimeFile: get("YNX_FINANCE_ENDPOINT_AUTHORITY_V2_TRUSTED_TIME_FILE"), Timeout: 3 * time.Second,
		})
		if authorityErr != nil {
			authorityReport["result"] = "FINANCE_AUTHORITY_V2_CONFIGURATION_REJECTED"
		} else {
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
			authorityErr = gate.Authorize(ctx)
			cancel()
			if authorityErr == nil {
				authorityReport["centralSignedManifestActive"] = true
				authorityReport["result"] = "FINANCE_PRIVATE_AUTHORITY_VERIFIED_PROVIDER_GATES_FALSE"
			} else {
				authorityReport["result"] = "FINANCE_PRIVATE_AUTHORITY_DEGRADED"
			}
		}
	}
	report := map[string]any{"mode": mode, "configuration": status, "networkAttempted": false, "localReadOnlyAttempted": false, "accountLinkVerified": false, "dataEntitlementVerified": false, "officialSandboxVerified": false, "productionApproved": false, "writeAttempted": false, "walletOrderApproval": "manual_wallet_approval_required", "durableOrderJournal": "implemented_state_v2", "providerPost": "activation_gated_operator_only", "sharedEndpointAuthority": authorityReport}
	code := 0
	if mode == "activation-plan" {
		report["activationReceiptConfigured"] = status.SubmissionEnabled
		report["activationScope"] = "sandbox_only_single_operator_worker_no_public_submit_route"
		feePolicyReady := finance.ValidateBrokerFeePolicy(get("YNX_FINANCE_BROKER_MAX_FEE_USD"), get("YNX_FINANCE_BROKER_FEE_BOUND_SOURCE"), get("YNX_FINANCE_BROKER_FEE_EVIDENCE_REF")) == nil
		report["feePolicyReady"] = feePolicyReady
		report["requiredPreconditions"] = []string{"Central-issued and signed shared endpoint authority manifest", "Finance pin bound to the current authority manifest", "installed Wallet callback verified read-only", "configured sandbox credentials", "persistent per-user account mapping", "read-only provider verification", "trusted fee bound", "Wallet order approval", "64-hex activation receipt", "one exact execution-requested outbox for worker dispatch"}
		report["safeEnable"] = []string{"verify owner mapping and provider reads", "record exact Wallet-approved order id", "set server-side activation receipt and sandbox write flag", "run one operator dispatch-one command", "query and reconcile before any further action"}
		report["rollback"] = []string{"set FINANCE_SANDBOX_WRITES_ENABLED=false", "restart only the operator worker environment if one exists", "query and reconcile ambiguous provider state", "do not retry an order with provider correlation"}
		localReady := false
		if localReadOnly {
			report["localReadOnlyAttempted"] = true
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			readiness, err := readinessProbe(ctx, strings.TrimSpace(get("YNX_FINANCE_STATE_PATH")), strings.TrimSpace(get("YNX_FINANCE_DATABASE_URL")), strings.TrimSpace(get("YNX_FINANCE_BROKER_VERIFY_ACCOUNT")), time.Now().UTC())
			if err != nil {
				report["localReadinessResult"] = "LOCAL_READINESS_UNAVAILABLE"
			} else {
				report["localReadinessResult"] = "LOCAL_READINESS_INSPECTED"
				report["localReadiness"] = readiness
				localReady = readiness.ReadyForWorkerDispatch
			}
		}
		report["localWorkerCandidateReady"] = localReady
		report["externalActivationGatesReady"] = false
		if status.SubmissionEnabled && feePolicyReady && localReadOnly && localReady {
			report["configurationReadyNotExecuted"] = true
			report["result"] = "SANDBOX_LOCAL_WORKER_CANDIDATE_READY_EXTERNAL_GATES_UNVERIFIED"
			code = 2
		} else {
			report["configurationReadyNotExecuted"] = false
			report["result"] = "SANDBOX_WRITE_ACTIVATION_BLOCKED"
			code = 2
		}
	} else if mode == "sandbox-verify" && !network {
		report["result"] = "BLOCKED_OFFICIAL_SANDBOX_WRITE_CONFIRMATION"
		code = 2
	} else if network {
		if status.State != "CONFIGURED_NOT_VERIFIED" {
			report["result"] = "BLOCKED_CONFIGURATION"
			code = 2
		} else {
			report["networkAttempted"] = true
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			verification, err := probe(ctx, cfg)
			if err != nil {
				report["result"] = brokerage.ErrorCode(err)
				code = 1
			} else {
				report["result"] = "BROKER_OWNER_READS_VERIFIED_ONLY"
				report["assetCount"] = len(verification.Assets.Assets)
				report["providerRequestId"] = verification.Assets.RequestID
				report["accountLinkVerified"] = verification.Snapshot.Account.ID != ""
				report["dataEntitlementVerified"] = verification.Quote.Symbol != ""
				report["positionCount"] = len(verification.Snapshot.Positions)
				report["orderCount"] = len(verification.Snapshot.Orders)
				report["stateBackend"] = verification.StoreMode
			}
		}
	} else {
		report["result"] = "CONFIGURATION_ONLY_NO_NETWORK"
		if status.State == "NOT_CONFIGURED" || status.State == "CONFIGURATION_REJECTED" {
			code = 2
		}
	}
	_ = json.NewEncoder(output).Encode(report)
	return code
}
