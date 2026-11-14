//go:build pay_pq && pay_store_original

package payproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Uses the actual retained PUBLIC Store, not regenerated invoices or archives.
// Each operator invocation is a new normal CLI process. The existing normal
// HTTP child reopens each restored Store twice. Authority remains PUBLIC/read
// only; no native signing, Core execution or original54 receipt is recreated.
func TestNativeStoreActualOperatorBackupRestorePreservesOriginals(t *testing.T) {
	cli, source, fixture := os.Getenv("PAY_STORE_OPERATOR_BINARY"), os.Getenv("PAY_STORE_RETAINED_SOURCE"), os.Getenv("PAY_CORE_WORKFLOW_DIR")
	for _, path := range []string{cli, source, fixture} {
		if !filepath.IsAbs(path) {
			t.Fatal("exact frozen operator/source/fixture paths required")
		}
	}
	pinned := func(path, expected string) []byte {
		t.Helper()
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		hash := sha256.Sum256(raw)
		if len(expected) != 64 || hex.EncodeToString(hash[:]) != expected {
			t.Fatal("frozen input differs", filepath.Base(path))
		}
		return raw
	}
	pinned(cli, os.Getenv("PAY_STORE_OPERATOR_SHA256"))
	originalRaw := pinned(source, os.Getenv("PAY_STORE_RETAINED_SHA256"))
	key := bytes32(7) // original retained PUBLIC fixture only
	originalStore, err := OpenStore(source, key)
	if err != nil {
		t.Fatal(err)
	}
	var original Snapshot
	originalStore.View(func(s Snapshot) error { original = s; return nil })
	expectedDigests := map[string]bool{}
	for _, record := range original.BusinessDispatches {
		if record.Operation == "native.originals" {
			expectedDigests[record.RequestHash] = true
		}
	}
	if len(expectedDigests) != 3 || len(original.Deliveries) != 3 {
		t.Fatal("exact original archived/outbox fixture required")
	}
	raw, err := os.ReadFile(filepath.Join(fixture, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f nativeCoreWorkflowManifest
	if json.Unmarshal(raw, &f) != nil || len(f.Rows) != 3 {
		t.Fatal("retained three-row proof fixture required")
	}
	bootstrap, err := consensus.NewConsensusBootstrap(f.Genesis, f.Pins, f.Migration)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := consensus.NewPQEngineAuthorization(f.Schedule, f.ScheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := consensus.LoadPQEngineSnapshot(f.Migration, filepath.Join(fixture, "engine.state"), bootstrap, auth, f.EngineHeight, f.EngineAppHash)
	if err != nil {
		t.Fatal(err)
	}
	var trusted cmttypes.LightBlock
	if err = cmtjson.Unmarshal(f.Trusted, &trusted); err != nil {
		t.Fatal(err)
	}
	proofs := &nativeWorkflowProofSource{rows: f.Rows, trust: consensus.PQLightProofTrust{Snapshot: snapshot, TrustedLightBlock: &trusted, TrustingPeriod: time.Hour, MaxClockDrift: time.Second, TrustLevel: cmtmath.Fraction{Numerator: 1, Denominator: 3}, Now: f.Now}}
	outputDir := os.Getenv("PAY_STORE_RECOVERY_OUTPUT")
	if !filepath.IsAbs(outputDir) {
		t.Fatal("owned persistent PUBLIC recovery evidence directory required")
	}
	if err = os.MkdirAll(outputDir, 0700); err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(outputDir, "PUBLIC-operator-recovery-")
	if err != nil {
		t.Fatal(err)
	}
	invocations := 0
	operator := func(encodedKey string, wantSuccess bool, result any, args ...string) []byte {
		t.Helper()
		invocations++
		command := exec.CommandContext(t.Context(), cli, args...)
		for _, env := range os.Environ() {
			if !strings.HasPrefix(env, "YNX_PAY_PRODUCT_INTEGRITY_KEY=") {
				command.Env = append(command.Env, env)
			}
		}
		command.Env = append(command.Env, "YNX_PAY_PRODUCT_INTEGRITY_KEY="+encodedKey)
		output, e := command.CombinedOutput()
		if saveErr := os.WriteFile(filepath.Join(dir, fmt.Sprintf("%02d-%s.log", invocations, args[0])), output, 0600); saveErr != nil {
			t.Fatal(saveErr)
		}
		if (e == nil) != wantSuccess {
			t.Fatal("normal operator result", args[0], e, string(output))
		}
		if wantSuccess && result != nil && json.Unmarshal(output, result) != nil {
			t.Fatal("normal operator receipt invalid")
		}
		return output
	}
	encodedKey := hex.EncodeToString(key)
	missingOutput := filepath.Join(dir, "missing-output.json")
	operator(encodedKey, false, nil, "backup", "--store", filepath.Join(dir, "missing.json"), "--output", missingOutput)
	if _, e := os.Stat(missingOutput); !os.IsNotExist(e) {
		t.Fatal("missing source created backup")
	}
	wrongOutput := filepath.Join(dir, "wrong-key-output.json")
	operator(hex.EncodeToString(bytes32(9)), false, nil, "backup", "--store", source, "--output", wrongOutput)
	if _, e := os.Stat(wrongOutput); !os.IsNotExist(e) {
		t.Fatal("wrong key created backup")
	}
	backupPath := filepath.Join(dir, "backup.json")
	var backup StoreBackupReceipt
	operator(encodedKey, true, &backup, "backup", "--store", source, "--output", backupPath)
	if !backup.Verified || backup.RecordCount < len(original.BusinessDispatches) || backup.RecordCount == 0 {
		t.Fatal("native archive omitted from backup receipt")
	}
	var verification StoreBackupVerification
	operator(encodedKey, true, &verification, "verify", "--store", backupPath)
	if !verification.Verified || verification.SHA256 != backup.SHA256 || verification.RecordCount != backup.RecordCount {
		t.Fatal("backup receipt/verification differ")
	}
	backupBefore, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	operator(encodedKey, false, nil, "backup", "--store", source, "--output", backupPath)
	backupAfter, err := os.ReadFile(backupPath)
	if err != nil || !bytes.Equal(backupBefore, backupAfter) {
		t.Fatal("existing backup overwritten")
	}
	originalOrder := ""
	proofChecks := 0
	for _, mode := range []string{"new", "rollback", "quarantine"} {
		destination := filepath.Join(dir, mode+".json")
		if mode == "rollback" {
			if err = os.WriteFile(destination, originalRaw, 0600); err != nil {
				t.Fatal(err)
			}
		}
		corrupt := []byte("PUBLIC-unverified-original-preserve-me")
		if mode == "quarantine" {
			if err = os.WriteFile(destination, corrupt, 0600); err != nil {
				t.Fatal(err)
			}
		}
		var restore StoreRestoreReceipt
		operator(encodedKey, true, &restore, "restore", "--backup", backupPath, "--store", destination)
		if !restore.Verified || restore.RecordCount != backup.RecordCount || restore.SourceSHA256 != backup.SHA256 {
			t.Fatal("restore omitted original records", mode)
		}
		if mode == "rollback" {
			preserved, e := os.ReadFile(filepath.Join(dir, restore.RollbackArtifact))
			if e != nil || !restore.RollbackVerified || !bytes.Equal(preserved, originalRaw) {
				t.Fatal("valid prior Store rollback not preserved", e)
			}
		}
		if mode == "quarantine" {
			preserved, e := os.ReadFile(filepath.Join(dir, restore.QuarantineArtifact))
			if e != nil || restore.RollbackVerified || !bytes.Equal(preserved, corrupt) {
				t.Fatal("invalid prior Store not quarantined unchanged", e)
			}
		}
		cold, e := OpenStore(destination, key)
		if e != nil {
			t.Fatal(e)
		}
		cold.View(func(s Snapshot) error {
			if !reflect.DeepEqual(s, original) {
				t.Fatal("restored Store changed original custody/outbox", mode)
			}
			return nil
		})
		parent, e := New(Config{StorePath: destination, IntegrityKey: key, GatewayKey: bytes32(8), BootstrapKey: "PUBLIC-operator-recovery-fixture", PublicBaseURL: "https://public.invalid", PayAPI: &fakePay{}})
		if e != nil {
			t.Fatal(e)
		}
		// Derive the same frozen order/session from retained archive DATA. It
		// selects only the explicitly PUBLIC read authority below.
		for _, record := range original.BusinessDispatches {
			if record.Operation != "native.originals" {
				continue
			}
			text, e := parent.open(record.ResultCipher)
			if e != nil {
				t.Fatal(e)
			}
			var a NativePayOriginalArchive
			if json.Unmarshal([]byte(text), &a) != nil || a.SourceOrder == "" || a.SessionID != f.Terms.SessionID {
				t.Fatal("original archive binding missing")
			}
			if originalOrder != "" && originalOrder != a.SourceOrder {
				t.Fatal("original order forked")
			}
			originalOrder = a.SourceOrder
		}
		caller, e := NewNativePayHTTP("http://127.0.0.1:1", &http.Client{Transport: archiveOfflineTransport{}, Timeout: time.Second})
		if e != nil {
			t.Fatal(e)
		}
		readAuthority := archivePublicReadAuthority{archiveReadProcessConfig{Merchant: f.Merchant, InvoiceID: f.Terms.InvoiceID, SourceOrder: originalOrder, SessionID: f.Terms.SessionID}}
		n, e := NewNativePayService(parent, NativePayConfig{Genesis: f.Network, NativeChainID: f.NativeChainID, HTTP: caller, Authority: readAuthority})
		if e != nil {
			t.Fatal(e)
		}
		before := map[string]string{}
		for _, row := range f.Rows {
			hash := consensus.SignedTransactionHash(row.Wire)
			a, e := n.ReadOriginalArchive(context.Background(), f.Merchant, f.Terms.InvoiceID, hash)
			if e != nil || !expectedDigests[a.Digest] || !bytes.Equal(a.Original.Member, row.Wire) {
				t.Fatal("restored original archive identity differs", mode, e)
			}
			verified, e := verifyNativeArchiveReceipt(context.Background(), a, proofs)
			if e != nil || !verified.Finalized || !verified.Included || verified.NativeGrant {
				t.Fatal("independent historical proof no longer verifies", mode, e)
			}
			proofChecks++
			before[hash] = a.Digest
		}
		assertNativeArchiveTwoProcessRestartsAt(t, n, f, before, originalOrder)
	}
	after, err := os.ReadFile(source)
	if err != nil || !bytes.Equal(after, originalRaw) {
		t.Fatal("original retained source was modified", err)
	}
	t.Logf("ACTUAL_OPERATOR_NATIVE_RECOVERY processes=%d restores=3 normalHTTPRestarts=6 originalArchives=3 independentProofChecks=%d originalArchiveDigestsUnchanged=true nativeBusinessRecords=%d backupRecords=%d originalOutboxUnchanged=true unknownUnitControlRetained=true CoreExecution=0 moneyPOST=0 PUBLICSourceOnly=true old54Recovered=false retained=%s", invocations, proofChecks, len(original.BusinessDispatches), backup.RecordCount, dir)
}
