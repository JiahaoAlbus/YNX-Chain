package dex

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type recoveryTestFixture struct {
	root           string
	statePath      string
	cursorPath     string
	bundleDir      string
	restoredState  string
	restoredCursor string
	sourceCommit   string
	bindings       RecoveryBindings
}

func newRecoveryTestFixture(t *testing.T, nextBlock uint64, lastBlockHash string) recoveryTestFixture {
	t.Helper()
	root := t.TempDir()
	fixture := recoveryTestFixture{
		root:           root,
		statePath:      filepath.Join(root, "live", "state.json"),
		cursorPath:     filepath.Join(root, "live", "cursor.json"),
		bundleDir:      filepath.Join(root, "bundle"),
		restoredState:  filepath.Join(root, "restore", "state.json"),
		restoredCursor: filepath.Join(root, "restore", "cursor.json"),
		sourceCommit:   strings.Repeat("a", 40),
		bindings: RecoveryBindings{
			Factory:       recoveryAddress(100),
			StableFactory: recoveryAddress(101),
			StrategyVault: recoveryAddress(102),
			FairFlow:      recoveryAddress(103),
			LPProtection:  recoveryAddress(104),
			StartBlock:    10,
		},
	}
	stateKey, cursorKey, _ := recoveryTestKeys()
	store, err := OpenStore(fixture.statePath, stateKey)
	if err != nil {
		t.Fatal(err)
	}
	if created, err := store.Append(recoveryPoolEvent()); err != nil || !created {
		t.Fatalf("append pool event: created=%v err=%v", created, err)
	}
	if created, err := store.Append(vaultFixture(7)); err != nil || !created {
		t.Fatalf("append Vault event: created=%v err=%v", created, err)
	}
	if created, err := store.AppendFairFlow(fairFlowFixture(1)); err != nil || !created {
		t.Fatalf("append FairFlow event: created=%v err=%v", created, err)
	}
	if created, err := store.AppendLPProtection(lpProtectionFixture(1)); err != nil || !created {
		t.Fatalf("append LP protection event: created=%v err=%v", created, err)
	}
	cursor := pollCursor{
		SchemaVersion: 6,
		Factory:       fixture.bindings.Factory,
		StrategyVault: fixture.bindings.StrategyVault,
		FairFlow:      fixture.bindings.FairFlow,
		LPProtection:  fixture.bindings.LPProtection,
		StableFactory: fixture.bindings.StableFactory,
		NextBlock:     nextBlock,
		LastBlockHash: lastBlockHash,
		Pools: []poolIdentity{
			{Address: recoveryAddress(201), Token0: recoveryAddress(202), Token1: recoveryAddress(203), CreatedBlock: 20, ContractVersion: "ynx-dex-cpmm-v1", SwapFeeBps: 30},
			{Address: recoveryAddress(204), Token0: recoveryAddress(205), Token1: recoveryAddress(206), CreatedBlock: 30, ContractVersion: "ynx-stableswap-v1", SwapFeeBps: 4},
		},
	}
	writeRecoveryCursor(t, fixture.cursorPath, cursor, cursorKey)
	return fixture
}

func (fixture recoveryTestFixture) bundleConfig() RecoveryBundleConfig {
	stateKey, cursorKey, bundleKey := recoveryTestKeys()
	return RecoveryBundleConfig{
		StatePath:    fixture.statePath,
		CursorPath:   fixture.cursorPath,
		BundleDir:    fixture.bundleDir,
		StateSecret:  stateKey,
		CursorSecret: cursorKey,
		BundleSecret: bundleKey,
		SourceCommit: fixture.sourceCommit,
		Bindings:     fixture.bindings,
		CreatedAt:    time.Date(2026, 7, 27, 16, 0, 0, 0, time.UTC),
	}
}

func (fixture recoveryTestFixture) restoreConfig() RecoveryRestoreConfig {
	stateKey, cursorKey, bundleKey := recoveryTestKeys()
	return RecoveryRestoreConfig{
		BundleDir:    fixture.bundleDir,
		StatePath:    fixture.restoredState,
		CursorPath:   fixture.restoredCursor,
		StateSecret:  stateKey,
		CursorSecret: cursorKey,
		BundleSecret: bundleKey,
		SourceCommit: fixture.sourceCommit,
		Bindings:     fixture.bindings,
	}
}

func recoveryTestKeys() ([]byte, []byte, []byte) {
	return bytes.Repeat([]byte{0x31}, 32), bytes.Repeat([]byte{0x32}, 32), bytes.Repeat([]byte{0x33}, 32)
}

func TestRecoveryDrillRestoresAuthenticatedStateAndCursor(t *testing.T) {
	fixture := newRecoveryTestFixture(t, 500, recoveryHash(499))
	report, err := RunRecoveryDrill(RecoveryDrillConfig{Bundle: fixture.bundleConfig(), Restore: fixture.restoreConfig()})
	if err != nil {
		t.Fatal(err)
	}
	if report.Status != "pass" || !report.IntegrityVerified || !report.SemanticEqualityVerified {
		t.Fatalf("report=%#v", report)
	}
	if report.PointInTimeRPOEvents != 0 || report.PointInTimeRPOBlocks != 0 || report.OperationalRPOProven {
		t.Fatalf("RPO classification=%#v", report)
	}
	if report.ObservedRTOMillis < 1 || !strings.Contains(report.Classification, "not a production SLO") {
		t.Fatalf("RTO classification=%#v", report)
	}
	if report.StateBytes < 1 || report.CursorBytes < 1 || !validLowerHex(report.StateSHA256, 32) || !validLowerHex(report.CursorSHA256, 32) {
		t.Fatalf("artifact evidence=%#v", report)
	}
	paths := []string{
		fixture.restoredState,
		fixture.restoredCursor,
		filepath.Join(fixture.bundleDir, "manifest.json"),
		filepath.Join(fixture.bundleDir, "state.json"),
		filepath.Join(fixture.bundleDir, "cursor.json"),
	}
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0o600 {
			t.Fatalf("private artifact %s: info=%v err=%v", path, info, err)
		}
	}
	if _, err := RestoreRecoveryBundle(fixture.restoreConfig()); err != nil {
		t.Fatalf("exact idempotent restore rejected: %v", err)
	}
	stateKey, _, _ := recoveryTestKeys()
	restored, err := OpenStore(fixture.restoredState, stateKey)
	if err != nil || len(restored.Events()) != 2 || len(restored.FairFlowEvents("")) != 1 || len(restored.LPProtectionEvents("", "")) != 1 {
		t.Fatalf("restored projections: store=%#v err=%v", restored, err)
	}
}

func TestRecoveryBundleRejectsWrongSecretsBindingsSourceAndTampering(t *testing.T) {
	fixture := newRecoveryTestFixture(t, 500, recoveryHash(499))
	if _, err := CreateRecoveryBundle(fixture.bundleConfig()); err != nil {
		t.Fatal(err)
	}
	wrongBundle := fixture.restoreConfig()
	wrongBundle.BundleSecret = bytes.Repeat([]byte{0x44}, 32)
	if _, err := VerifyRecoveryBundle(wrongBundle); err == nil {
		t.Fatal("wrong recovery manifest secret accepted")
	}
	wrongState := fixture.restoreConfig()
	wrongState.StateSecret = bytes.Repeat([]byte{0x45}, 32)
	if _, err := VerifyRecoveryBundle(wrongState); err == nil {
		t.Fatal("wrong DEX state secret accepted")
	}
	wrongSource := fixture.restoreConfig()
	wrongSource.SourceCommit = strings.Repeat("b", 40)
	if _, err := VerifyRecoveryBundle(wrongSource); err == nil {
		t.Fatal("wrong source commit accepted")
	}
	wrongBindings := fixture.restoreConfig()
	wrongBindings.Bindings.Factory = recoveryAddress(999)
	if _, err := VerifyRecoveryBundle(wrongBindings); err == nil {
		t.Fatal("wrong deployment binding accepted")
	}
	statePath := filepath.Join(fixture.bundleDir, "state.json")
	data, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statePath, append(data, byte('\n')), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyRecoveryBundle(fixture.restoreConfig()); err == nil {
		t.Fatal("tampered bundle state accepted")
	}
}

func TestRecoveryRestoreRejectsPartialOrDifferentDestinations(t *testing.T) {
	fixture := newRecoveryTestFixture(t, 500, recoveryHash(499))
	if _, err := CreateRecoveryBundle(fixture.bundleConfig()); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(fixture.restoredState), 0o700); err != nil {
		t.Fatal(err)
	}
	original := []byte("operator-owned-existing-state")
	if err := os.WriteFile(fixture.restoredState, original, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := RestoreRecoveryBundle(fixture.restoreConfig()); err == nil {
		t.Fatal("partial restore destination accepted")
	}
	after, err := os.ReadFile(fixture.restoredState)
	if err != nil || !bytes.Equal(after, original) {
		t.Fatalf("existing state changed: %q err=%v", after, err)
	}
	if _, err := os.Stat(fixture.restoredCursor); !os.IsNotExist(err) {
		t.Fatalf("partial cursor unexpectedly installed: %v", err)
	}
}

func TestRecoveryBundleRecordsReplayBoundaryAndRejectsInconsistentHash(t *testing.T) {
	replay := newRecoveryTestFixture(t, 300, "")
	manifest, err := CreateRecoveryBundle(replay.bundleConfig())
	if err != nil {
		t.Fatal(err)
	}
	if !manifest.Snapshot.ReplayRequired || manifest.Snapshot.ReplayFromBlock != 300 || manifest.Snapshot.LatestStateBlock < 300 {
		t.Fatalf("replay snapshot=%#v", manifest.Snapshot)
	}
	inconsistent := newRecoveryTestFixture(t, 300, recoveryHash(299))
	if _, err := CreateRecoveryBundle(inconsistent.bundleConfig()); err == nil {
		t.Fatal("state ahead of a hash-bound durable cursor accepted")
	}
}

func TestRecoveryBundleDirectoryIsImmutableAndOriginalRemainsVerifiable(t *testing.T) {
	fixture := newRecoveryTestFixture(t, 500, recoveryHash(499))
	first, err := CreateRecoveryBundle(fixture.bundleConfig())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := CreateRecoveryBundle(fixture.bundleConfig()); err == nil {
		t.Fatal("existing recovery bundle directory overwritten")
	}
	verified, err := VerifyRecoveryBundle(fixture.restoreConfig())
	if err != nil || verified.BundleID != first.BundleID {
		t.Fatalf("original bundle lost: verified=%#v err=%v", verified, err)
	}
}

func writeRecoveryCursor(t *testing.T, path string, cursor pollCursor, secret []byte) {
	t.Helper()
	payload, err := json.Marshal(cursor)
	if err != nil {
		t.Fatal(err)
	}
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write(payload)
	data, err := json.MarshalIndent(cursorEnvelope{Cursor: cursor, Integrity: hex.EncodeToString(mac.Sum(nil))}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func recoveryPoolEvent() Event            { return fixture(1, "liquidity-add") }
func recoveryAddress(value uint64) string { return fmt.Sprintf("0x%040x", value) }
func recoveryHash(value uint64) string    { return fmt.Sprintf("0x%064x", value) }
