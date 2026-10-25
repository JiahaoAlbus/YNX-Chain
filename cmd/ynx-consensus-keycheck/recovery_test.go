package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/privval"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

type keyRecoveryFixture struct {
	keycheckInspectionFixture
	output, pin string
}

func newKeyRecoveryFixture(t *testing.T) keyRecoveryFixture {
	t.Helper()
	f := newKeycheckInspectionFixture(t)
	// The original fixture canonicalizes custody but retains t.TempDir's public
	// path spelling, which can traverse /var on Darwin. Reuse its same file at
	// the canonical parent before supplying the production manifest path.
	f.role = filepath.Join(filepath.Dir(f.dir), filepath.Base(f.role))
	f.manifest.Node.ValidatorAddress = "ynx_validator_primary"
	f.manifest.Node.ConsensusKeyType = chain.ConsensusPubKeyTypeEd25519
	keycheckWriteJSON(t, f.role, f.manifest, false)
	keycheckWriteJSON(t, f.hrs, privval.FilePVLastSignState{}, true)
	parent := filepath.Join(filepath.Dir(f.dir), "private-recovery-parent")
	if err := os.Mkdir(parent, 0700); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(f.role)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	return keyRecoveryFixture{keycheckInspectionFixture: f, output: filepath.Join(parent, "once"), pin: hex.EncodeToString(digest[:])}
}

func (f keyRecoveryFixture) args() []string {
	return []string{"--verify-isolated-recovery", "--role", "primary", "--key-dir", f.dir, "--recovery-dir", f.output, "--role-manifest", f.role, "--role-manifest-sha256", f.pin}
}

func keyRecoveryWitnesses(t *testing.T, paths ...string) map[string]keycheckOriginalWitness {
	t.Helper()
	result := make(map[string]keycheckOriginalWitness)
	for _, path := range paths {
		info, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			result[path] = keycheckOriginalWitness{}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		var raw []byte
		if info.Mode().IsRegular() {
			raw, err = os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
		}
		result[path] = keycheckOriginalWitness{info: info, raw: raw}
	}
	t.Cleanup(func() {
		for _, witness := range result {
			clear(witness.raw)
		}
	})
	return result
}

func keyRecoveryOriginals(t *testing.T, f keyRecoveryFixture) map[string]keycheckOriginalWitness {
	t.Helper()
	return keyRecoveryWitnesses(t, f.dir, f.validator, f.node, f.hrs, f.role)
}

func assertKeyRecoveryWitnesses(t *testing.T, originals map[string]keycheckOriginalWitness) {
	t.Helper()
	for path, original := range originals {
		current, err := os.Lstat(path)
		if original.info == nil {
			if !errors.Is(err, os.ErrNotExist) {
				t.Fatal("recovery reconstructed an absent original")
			}
			continue
		}
		if err != nil || !os.SameFile(original.info, current) || original.info.Mode() != current.Mode() || original.info.Size() != current.Size() || !original.info.ModTime().Equal(current.ModTime()) {
			t.Fatal("recovery changed original custody or manifest identity, mode, size or mtime")
		}
		if original.info.Mode().IsRegular() {
			raw, err := os.ReadFile(path)
			equal := bytes.Equal(raw, original.raw)
			clear(raw)
			if err != nil || !equal {
				t.Fatal("recovery changed original protected bytes")
			}
		}
	}
}

func keyRecoveryCaseWitnesses(t *testing.T, output string) map[string]keycheckOriginalWitness {
	t.Helper()
	var paths []string
	if err := filepath.Walk(output, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		paths = append(paths, path)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return keyRecoveryWitnesses(t, paths...)
}

func assertIsolatedKeyRecoveryPublicReceipt(t *testing.T, f keyRecoveryFixture, raw []byte) isolatedKeyRecoveryReceipt {
	t.Helper()
	var receipt isolatedKeyRecoveryReceipt
	if err := json.Unmarshal(raw, &receipt); err != nil || receipt.Version != isolatedKeyRecoveryVersion || receipt.Role != "primary" || receipt.ServiceUID != os.Geteuid() || receipt.RoleManifestSHA256 != f.pin || receipt.SourceDirectory != f.dir || receipt.PrivateRecoveryDirectory != f.output {
		t.Fatal("recovery did not return its exact public identity and same-UID receipt")
	}
	if !receipt.SourceReadOnly || !receipt.SourceFilesUnchanged || !receipt.BackupBytesMatched || !receipt.RestoreBytesMatched || !receipt.RestoredIdentityMatched || !receipt.RestoredHRSConsistency || !receipt.ManifestMatched || !receipt.IsolatedRecoveryVerified || !receipt.SameHost {
		t.Fatal("actual isolated backup/restore checks were not reported")
	}
	if receipt.OffHostRecoveryVerified || receipt.HRSHistoryVerified || receipt.IndependentReview || receipt.AuthorityGranted || receipt.SigningPerformed || receipt.LiveRestorePerformed || receipt.ServiceChanged || receipt.RotationVerified {
		t.Fatal("same-host recovery implied off-host recovery, chain history, authority, signing or live changes")
	}
	if receipt.PublicRecord.Role != "primary" || receipt.PublicRecord.ValidatorAddress != f.manifest.Node.ValidatorAddress || receipt.PublicRecord.ConsensusKeyType != f.manifest.Node.ConsensusKeyType || receipt.PublicRecord.ConsensusPubKey != f.manifest.Node.ConsensusPubKey || receipt.PublicRecord.ConsensusAddress != f.manifest.Node.ConsensusAddress || receipt.PublicRecord.NodeID != f.manifest.Node.NodeID {
		t.Fatal("recovery substituted the original validator or P2P public tuple")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	names := []string{"version", "role", "serviceUID", "roleManifestSHA256", "sourceDirectory", "privateRecoveryDirectory", "publicRecord", "sourceReadOnly", "sourceFilesUnchanged", "backupBytesMatched", "restoreBytesMatched", "restoredIdentityMatched", "restoredHRSConsistency", "manifestMatched", "isolatedRecoveryVerified", "sameHost", "offHostRecoveryVerified", "hrsHistoryVerified", "independentReview", "authorityGranted", "signingPerformed", "liveRestorePerformed", "serviceChanged", "rotationVerified"}
	if len(fields) != len(names) || len(raw) > 8192 {
		t.Fatal("recovery receipt was not its bounded closed public object")
	}
	for _, name := range names {
		if _, ok := fields[name]; !ok {
			t.Fatal("recovery receipt omitted a closed public field")
		}
	}
	var public map[string]json.RawMessage
	if err := json.Unmarshal(fields["publicRecord"], &public); err != nil || len(public) != 9 {
		t.Fatal("recovery public identity contains an unexpected private or raw field")
	}
	for _, name := range []string{"version", "purpose", "role", "validatorAddress", "consensusKeyType", "consensusPubKey", "consensusAddress", "nodeId", "custodyBoundary"} {
		if _, ok := public[name]; !ok {
			t.Fatal("recovery omitted an original public identity field")
		}
	}
	for _, name := range []string{"priv_key", "privateKey", "seed", "privateSHA256", "signbytes", "signature"} {
		if bytes.Contains(raw, []byte(name)) {
			t.Fatal("public recovery receipt disclosed private or HRS payload fields")
		}
	}
	for _, path := range []string{f.validator, f.node, f.hrs} {
		private, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(private)
		leaked := bytes.Contains(raw, private) || bytes.Contains(raw, []byte(hex.EncodeToString(digest[:])))
		clear(private)
		if leaked {
			t.Fatal("public recovery receipt disclosed an original private file or its hash")
		}
	}
	privateWire, err := os.ReadFile(f.validator)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(privateWire)
	var key privval.FilePVKey
	if err := cmtjson.Unmarshal(privateWire, &key); err != nil {
		t.Fatal(err)
	}
	private := key.PrivKey.Bytes()
	defer clear(private)
	if bytes.Contains(raw, []byte(base64.StdEncoding.EncodeToString(private))) || bytes.Contains(raw, []byte(hex.EncodeToString(private[:32]))) {
		t.Fatal("public recovery receipt disclosed original key material")
	}
	return receipt
}

func TestKeyCheckIsolatedRecoveryCLIBacksUpThenRestoresActualBytesAndPreservesLiveSource(t *testing.T) {
	f := newKeyRecoveryFixture(t)
	originals := keyRecoveryOriginals(t, f)
	var out, diagnostics bytes.Buffer
	if code := runKeyCheck(f.args(), &out, &diagnostics); code != 0 || diagnostics.Len() != 0 {
		t.Fatal("normal same-host isolated recovery failed", code, diagnostics.String())
	}
	assertIsolatedKeyRecoveryPublicReceipt(t, f, out.Bytes())
	assertKeyRecoveryWitnesses(t, originals)
	for _, name := range recoveryPrivateNames {
		original := filepath.Join(f.dir, name)
		backup := filepath.Join(f.output, "backup", name)
		restored := filepath.Join(f.output, "restored", name)
		var witnesses []*keycheckCustodyInput
		for _, path := range []string{original, backup, restored} {
			input, err := openKeycheckCustody(path, false)
			if err != nil {
				t.Fatal("backup/restore did not create a private original-owner regular file")
			}
			defer input.file.Close()
			witnesses = append(witnesses, input)
		}
		if witnesses[0].digest != witnesses[1].digest || witnesses[1].digest != witnesses[2].digest || os.SameFile(witnesses[0].info, witnesses[1].info) || os.SameFile(witnesses[0].info, witnesses[2].info) || os.SameFile(witnesses[1].info, witnesses[2].info) {
			t.Fatal("backup and actual restore were not equal bytes in three independent original-owner files")
		}
	}
	for _, name := range []string{"backup", "restored"} {
		dir, err := openKeycheckCustody(filepath.Join(f.output, name), true)
		if err != nil {
			t.Fatal("isolated private directory did not retain the original UID")
		}
		dir.file.Close()
		entries, err := os.ReadDir(filepath.Join(f.output, name))
		if err != nil || len(entries) != 3 {
			t.Fatal("recovery copied files beyond the three fixed original custody names")
		}
	}
	saved, err := os.ReadFile(filepath.Join(f.output, "receipt.public.json"))
	if err != nil || !bytes.Equal(saved, bytes.TrimSuffix(out.Bytes(), []byte("\n"))) {
		t.Fatal("normal stdout differs from the retained original public receipt")
	}
	caseBefore := keyRecoveryCaseWitnesses(t, f.output)
	out.Reset()
	diagnostics.Reset()
	if code := runKeyCheck(f.args(), &out, &diagnostics); code == 0 || out.Len() != 0 {
		t.Fatal("original successful recovery was replayed or emitted a second success")
	}
	assertKeyRecoveryWitnesses(t, originals)
	assertKeyRecoveryWitnesses(t, caseBefore)
}

func TestKeyCheckIsolatedRecoveryRefusesOriginalUnknownAndUnsafeInputs(t *testing.T) {
	for _, name := range []string{"unknown", "missing-hrs", "source-symlink", "key-symlink", "hardlink", "wide-key", "wide-source", "wide-parent", "wrong-pin", "zero-pin", "wrong-role", "wrong-logical-role", "contained-output", "containing-output"} {
		t.Run(name, func(t *testing.T) {
			f := newKeyRecoveryFixture(t)
			source, role, pin := f.dir, "primary", f.pin
			switch name {
			case "unknown":
				if err := os.Mkdir(f.output, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(f.output, "original.UNKNOWN"), []byte("retained unknown original attempt\n"), 0600); err != nil {
					t.Fatal(err)
				}
			case "missing-hrs":
				if err := os.Remove(f.hrs); err != nil {
					t.Fatal(err)
				}
			case "source-symlink":
				source = filepath.Join(filepath.Dir(f.dir), "custody-alias")
				if err := os.Symlink(f.dir, source); err != nil {
					t.Fatal(err)
				}
			case "key-symlink":
				retained := f.validator + ".retained"
				if err := os.Rename(f.validator, retained); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(retained, f.validator); err != nil {
					t.Fatal(err)
				}
			case "hardlink":
				if err := os.Link(f.node, f.node+".alias"); err != nil {
					t.Fatal(err)
				}
			case "wide-key":
				if err := os.Chmod(f.node, 0644); err != nil {
					t.Fatal(err)
				}
			case "wide-source":
				if err := os.Chmod(f.dir, 0755); err != nil {
					t.Fatal(err)
				}
			case "wide-parent":
				if err := os.Chmod(filepath.Dir(f.output), 0755); err != nil {
					t.Fatal(err)
				}
			case "wrong-pin":
				pin = strings.Repeat("f", 64)
			case "zero-pin":
				pin = strings.Repeat("0", 64)
			case "wrong-role":
				role = "seoul"
			case "wrong-logical-role":
				f.manifest.Node.ValidatorAddress = "ynx_validator_seoul"
				keycheckWriteJSON(t, f.role, f.manifest, false)
				raw, err := os.ReadFile(f.role)
				if err != nil {
					t.Fatal(err)
				}
				digest := sha256.Sum256(raw)
				pin = hex.EncodeToString(digest[:])
			case "contained-output":
				f.output = filepath.Join(f.dir, "must-not-create")
			case "containing-output":
				f.output = filepath.Dir(f.dir)
			}
			originals := keyRecoveryOriginals(t, f)
			var priorCase map[string]keycheckOriginalWitness
			if name == "unknown" {
				priorCase = keyRecoveryCaseWitnesses(t, f.output)
			}
			receipt, err := verifyIsolatedKeyRecovery(role, source, f.output, f.role, pin, realKeyRecoveryIO())
			if err == nil || receipt != (isolatedKeyRecoveryReceipt{}) {
				t.Fatal("unsafe isolated recovery returned a success receipt")
			}
			assertKeyRecoveryWitnesses(t, originals)
			if priorCase != nil {
				assertKeyRecoveryWitnesses(t, priorCase)
			} else if name != "containing-output" {
				if _, err := os.Lstat(f.output); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("refused preconditions created or repaired an isolated recovery case")
				}
			}
		})
	}
}

func TestKeyCheckIsolatedRecoveryRetainsWriteUncertaintyWithoutRetry(t *testing.T) {
	for failAt := 1; failAt <= 8; failAt++ {
		t.Run(string(rune('0'+failAt)), func(t *testing.T) {
			f := newKeyRecoveryFixture(t)
			originals := keyRecoveryOriginals(t, f)
			writes := 0
			disk := keyRecoveryIO{writeExclusive: func(path string, raw []byte) error {
				writes++
				if err := writeKeyRecoveryExclusive(path, raw); err != nil {
					return err
				}
				if writes == failAt {
					return errors.New("PRIVATE_IO_DIAGNOSTIC_MUST_NOT_ESCAPE:" + path)
				}
				return nil
			}}
			receipt, err := verifyIsolatedKeyRecovery("primary", f.dir, f.output, f.role, f.pin, disk)
			if err == nil || receipt != (isolatedKeyRecoveryReceipt{}) || writes != failAt {
				t.Fatal("write uncertainty produced success, cleanup or an automatic retry")
			}
			wantStage := "BACKUP_RESTORE"
			if failAt == 1 {
				wantStage = "RESERVE_PRIVATE_CASE"
			} else if failAt == 8 {
				wantStage = "PUBLISH_PRIVATE_RECEIPT"
			}
			var stage keyRecoveryStageError
			if !errors.As(err, &stage) || stage.Stage != wantStage || err.Error() != "ISOLATED_KEY_RECOVERY_REFUSED:"+wantStage {
				t.Fatal("private IO diagnostic escaped the fixed recovery stage boundary")
			}
			caseBefore := keyRecoveryCaseWitnesses(t, f.output)
			var out, diagnostics bytes.Buffer
			if code := runKeyCheck(f.args(), &out, &diagnostics); code == 0 || out.Len() != 0 {
				t.Fatal("retained uncertain recovery was replayed through the normal CLI")
			}
			assertKeyRecoveryWitnesses(t, originals)
			assertKeyRecoveryWitnesses(t, caseBefore)
		})
	}
}

func TestKeyCheckIsolatedRecoveryPrivateParseErrorsReturnOnlyFixedStage(t *testing.T) {
	for _, target := range []string{"validator", "node", "hrs"} {
		t.Run(target, func(t *testing.T) {
			f := newKeyRecoveryFixture(t)
			path, wantStage := f.validator, "VERIFY_ORIGINAL_TUPLE"
			privateWire := []byte(`{"priv_key":{"type":"PRIVATE_PARSE_DIAGNOSTIC_MUST_NOT_ESCAPE","value":"not-a-key"}}`)
			if target == "node" {
				path = f.node
			} else if target == "hrs" {
				path, wantStage = f.hrs, "VERIFY_RESTORED_HRS"
				privateWire = []byte(`{"height":"PRIVATE_PARSE_DIAGNOSTIC_MUST_NOT_ESCAPE","round":0,"step":0}`)
			}
			if err := os.WriteFile(path, privateWire, 0600); err != nil {
				t.Fatal(err)
			}
			originals := keyRecoveryOriginals(t, f)
			var out, diagnostics bytes.Buffer
			if code := runKeyCheck(f.args(), &out, &diagnostics); code == 0 || out.Len() != 0 || diagnostics.String() != "ISOLATED_KEY_RECOVERY_REFUSED:"+wantStage+"\n" {
				t.Fatal("private parser error was not reduced to the fixed public stage code")
			}
			assertKeyRecoveryWitnesses(t, originals)
		})
	}
}

func TestKeyCheckIsolatedRecoveryDetectsBackupRestoreAndSourceChanges(t *testing.T) {
	for _, mutation := range []string{"backup", "restored", "source-hrs", "backup-after-receipt"} {
		t.Run(mutation, func(t *testing.T) {
			f := newKeyRecoveryFixture(t)
			originals := keyRecoveryOriginals(t, f)
			mutated := false
			disk := keyRecoveryIO{writeExclusive: func(path string, raw []byte) error {
				if err := writeKeyRecoveryExclusive(path, raw); err != nil {
					return err
				}
				var target string
				if !mutated && mutation == "backup" && path == filepath.Join(f.output, "backup", recoveryPrivateNames[0]) {
					target = path
				} else if !mutated && mutation == "restored" && path == filepath.Join(f.output, "restored", recoveryPrivateNames[0]) {
					target = path
				} else if !mutated && mutation == "source-hrs" && path == filepath.Join(f.output, "backup", recoveryPrivateNames[0]) {
					target = f.hrs
				} else if !mutated && mutation == "backup-after-receipt" && path == filepath.Join(f.output, "receipt.public.json") {
					target = filepath.Join(f.output, "backup", recoveryPrivateNames[0])
				}
				if target != "" {
					mutated = true
					if err := os.WriteFile(target, []byte("original mutation retained without repair\n"), 0600); err != nil {
						return err
					}
					if target == f.hrs {
						changed := keyRecoveryWitnesses(t, f.hrs)
						clear(originals[f.hrs].raw)
						originals[f.hrs] = changed[f.hrs]
					}
				}
				return nil
			}}
			if receipt, err := verifyIsolatedKeyRecovery("primary", f.dir, f.output, f.role, f.pin, disk); err == nil || receipt != (isolatedKeyRecoveryReceipt{}) || !mutated {
				t.Fatal("changed backup, restore or live HRS produced recovery success")
			}
			caseBefore := keyRecoveryCaseWitnesses(t, f.output)
			var out, diagnostics bytes.Buffer
			if code := runKeyCheck(f.args(), &out, &diagnostics); code == 0 || out.Len() != 0 {
				t.Fatal("changed original attempt was repaired or replayed")
			}
			assertKeyRecoveryWitnesses(t, originals)
			assertKeyRecoveryWitnesses(t, caseBefore)
		})
	}
}

func TestKeyCheckIsolatedRecoveryChecksRealSavedSignatureAndCoordinates(t *testing.T) {
	for _, mutation := range []string{"valid", "signature", "chain", "height", "step"} {
		t.Run(mutation, func(t *testing.T) {
			f := newKeyRecoveryFixture(t)
			raw, err := os.ReadFile(f.validator)
			if err != nil {
				t.Fatal(err)
			}
			defer clear(raw)
			var key privval.FilePVKey
			if err := cmtjson.Unmarshal(raw, &key); err != nil {
				t.Fatal(err)
			}
			defer clear(key.PrivKey.Bytes())
			network := "ynx_6423-1"
			if mutation == "chain" {
				network = "different-original-chain"
			}
			vote := &cmtproto.Vote{Type: cmtproto.PrevoteType, Height: 37, Round: 2, Timestamp: time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC), ValidatorAddress: key.Address, ValidatorIndex: 0}
			signBytes := cmttypes.VoteSignBytes(network, vote)
			signature, err := key.PrivKey.Sign(signBytes)
			if err != nil {
				t.Fatal(err)
			}
			state := privval.FilePVLastSignState{Height: 37, Round: 2, Step: 2, Signature: signature, SignBytes: signBytes}
			switch mutation {
			case "signature":
				state.Signature[0] ^= 1
			case "height":
				state.Height++
			case "step":
				state.Step = 3
			}
			keycheckWriteJSON(t, f.hrs, state, true)
			originals := keyRecoveryOriginals(t, f)
			var out, diagnostics bytes.Buffer
			code := runKeyCheck(f.args(), &out, &diagnostics)
			if mutation == "valid" {
				if code != 0 {
					t.Fatal("valid original signed HRS was refused", diagnostics.String())
				}
				assertIsolatedKeyRecoveryPublicReceipt(t, f, out.Bytes())
			} else if code == 0 || out.Len() != 0 {
				t.Fatal("bad saved signature or foreign chain/H/R/S was accepted or emitted public success")
			}
			assertKeyRecoveryWitnesses(t, originals)
		})
	}
}

type keyRecoveryUnavailableOutput struct{ writes int }

func (w *keyRecoveryUnavailableOutput) Write(raw []byte) (int, error) {
	w.writes++
	return 0, errors.New("public result delivery failed")
}

func TestKeyCheckIsolatedRecoveryPreservesOriginalResultWhenPublicDeliveryFails(t *testing.T) {
	f := newKeyRecoveryFixture(t)
	originals := keyRecoveryOriginals(t, f)
	output := &keyRecoveryUnavailableOutput{}
	var diagnostics bytes.Buffer
	if code := runKeyCheck(f.args(), output, &diagnostics); code == 0 || output.writes != 1 || !strings.Contains(diagnostics.String(), isolatedKeyRecoveryDeliveryUnknown) {
		t.Fatal("lost public result did not retain its original UNKNOWN without retry")
	}
	caseBefore := keyRecoveryCaseWitnesses(t, f.output)
	var out bytes.Buffer
	if code := runKeyCheck(f.args(), &out, &diagnostics); code == 0 || out.Len() != 0 {
		t.Fatal("lost public result was replaced by another recovery")
	}
	assertKeyRecoveryWitnesses(t, originals)
	assertKeyRecoveryWitnesses(t, caseBefore)
}

func TestKeyCheckIsolatedRecoveryArgumentsRefuseBeforeCustodyIO(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "never-open-original")
	base := []string{"--verify-isolated-recovery", "--role", "primary", "--key-dir", missing, "--recovery-dir", missing + "-recovery", "--role-manifest", missing + "-manifest", "--role-manifest-sha256", strings.Repeat("a", 64)}
	cases := map[string][]string{
		"duplicate-mode":   append(bytesToArgs(base), "--verify-isolated-recovery=true"),
		"duplicate-role":   append(bytesToArgs(base), "--role=primary"),
		"duplicate-source": append(bytesToArgs(base), "--key-dir="+missing),
		"duplicate-output": append(bytesToArgs(base), "--recovery-dir="+missing+"-recovery"),
		"duplicate-pin":    append(bytesToArgs(base), "--role-manifest-sha256="+strings.Repeat("a", 64)),
		"inspect-mode":     append(bytesToArgs(base), "--inspect-public-identity"),
		"node-mode":        append(bytesToArgs(base), "--node-only"),
		"validator-path":   append(bytesToArgs(base), "--private-validator-key="),
		"node-path":        append(bytesToArgs(base), "--node-key="),
		"false-mode":       {"--verify-isolated-recovery=false"},
		"orphan-output":    {"--recovery-dir", missing},
		"orphan-pin":       {"--role-manifest-sha256", strings.Repeat("a", 64)},
		"positional":       append(bytesToArgs(base), "extra"),
		"unknown":          append(bytesToArgs(base), "--foreign=true"),
	}
	for name, args := range cases {
		t.Run(name, func(t *testing.T) {
			var out, diagnostics bytes.Buffer
			if code := runKeyCheck(args, &out, &diagnostics); code == 0 || out.Len() != 0 || diagnostics.Len() == 0 || strings.Contains(diagnostics.String(), "not confirmed") {
				t.Fatal("invalid recovery arguments reached the custody callee or emitted a result")
			}
			for _, path := range []string{missing, missing + "-recovery", missing + "-manifest"} {
				if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("invalid arguments created an original or recovery path")
				}
			}
		})
	}
}
