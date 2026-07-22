package governance

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func runtimeFixture(t *testing.T) (RuntimeConfig, time.Time) {
	t.Helper()
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	mk := func(account string, role GovernanceRole, count uint64) RoleAssignmentInput {
		return RoleAssignmentInput{Account: account, Role: role, Scopes: []Scope{ScopeBridge}, TermStartsAt: now, TermEndsAt: now.Add(365 * 24 * time.Hour), DecisionThreshold: count, ConflictDisclosure: "No provider ownership or compensation conflict disclosed.", Evidence: []string{"sha256:public-genesis-nomination"}}
	}
	roles := []RoleAssignmentInput{mk("tech-1", RoleTechnicalCouncil, 2), mk("tech-2", RoleTechnicalCouncil, 2), mk("security-1", RoleSecurityCouncil, 3), mk("security-2", RoleSecurityCouncil, 3), mk("security-3", RoleSecurityCouncil, 3), mk("treasury-1", RoleTreasuryCouncil, 2), mk("treasury-2", RoleTreasuryCouncil, 2)}
	manifest, _ := GenesisRoleManifestHash(roles)
	dir := t.TempDir()
	keyPath := filepath.Join(dir, "gateway.key")
	if err := os.WriteFile(keyPath, []byte(hex.EncodeToString([]byte(strings.Repeat("k", 32)))), 0o600); err != nil {
		t.Fatal(err)
	}
	return RuntimeConfig{SchemaVersion: "ynx-governanced-config/v1", HTTPAddress: "127.0.0.1:6441", StatePath: filepath.Join(dir, "state.json"), GatewayKeyPath: keyPath, Policy: RuntimePolicyConfig{MinimumDeposit: 100, QuorumBPS: 5000, ThresholdBPS: 6667, VotingPeriod: "1h", Timelock: "2h", MaxLifetime: "720h", EmergencyThreshold: 3, EmergencyMaxDuration: "24h", ParameterRules: map[string]ParameterRule{"/bridge/dailyLimit": {Scope: ScopeBridge, Numeric: true, Minimum: 10, Maximum: 100}}, GenesisRoleManifestHash: manifest, ElectorateApprovalThreshold: 2}, GenesisRoles: roles}, now
}

func TestRuntimeInitializesRestoresAndRejectsUnsafeConfig(t *testing.T) {
	cfg, now := runtimeFixture(t)
	service, auth, err := OpenRuntime(cfg, now)
	if err != nil || service == nil || auth == nil || len(service.ListRoles()) != 7 {
		t.Fatalf("open: %v roles=%d", err, len(service.ListRoles()))
	}
	restored, _, err := OpenRuntime(cfg, now.Add(time.Hour))
	if err != nil || len(restored.ListRoles()) != 7 {
		t.Fatalf("restore: %v", err)
	}
	cfg.Policy.QuorumBPS = 6000
	if _, _, err = OpenRuntime(cfg, now); err == nil {
		t.Fatal("policy drift accepted")
	}
	cfg, _ = runtimeFixture(t)
	if err = os.Chmod(cfg.GatewayKeyPath, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err = OpenRuntime(cfg, now); err == nil {
		t.Fatal("insecure key mode accepted")
	}
	cfg, _ = runtimeFixture(t)
	cfg.HTTPAddress = "0.0.0.0:6441"
	if _, _, err = OpenRuntime(cfg, now); err == nil {
		t.Fatal("public bind accepted")
	}
}
