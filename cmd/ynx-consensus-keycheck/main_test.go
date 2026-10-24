package main

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
)

type keycheckFixture struct {
	role, node, validator, hrs string
	manifest                   consensus.ProductionCandidateRoleManifest
}

func newKeycheckFixture(t *testing.T, localValidator bool) keycheckFixture {
	t.Helper()
	dir := t.TempDir()
	f := keycheckFixture{role: filepath.Join(dir, "role.json"), node: filepath.Join(dir, "node.json"), validator: filepath.Join(dir, "validator.json"), hrs: filepath.Join(dir, "original-hrs")}
	node := &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}
	defer clear(node.PrivKey.Bytes())
	validator := cmted.GenPrivKey()
	defer clear(validator)
	pub := validator.PubKey()
	f.manifest = consensus.ProductionCandidateRoleManifest{Version: consensus.ProductionCandidatePackageVersion, Purpose: consensus.ProductionValidatorManifestPurpose, ChainID: "ynx_6423-1", Node: consensus.ProductionValidatorNode{Role: "primary", NodeID: string(node.ID()), ConsensusKeyType: cmted.KeyType, ConsensusPubKey: base64.StdEncoding.EncodeToString(pub.Bytes()), ConsensusAddress: strings.ToUpper(hex.EncodeToString(pub.Address()))}}
	keycheckWriteJSON(t, f.role, f.manifest, false)
	keycheckWriteJSON(t, f.node, node, true)
	if localValidator {
		keycheckWriteJSON(t, f.validator, privval.FilePVKey{Address: pub.Address(), PubKey: pub, PrivKey: validator}, true)
	}
	if err := os.WriteFile(f.hrs, []byte("original HRS must not be read, reset or created by keycheck\n"), 0600); err != nil {
		t.Fatal(err)
	}
	return f
}

func keycheckWriteJSON(t *testing.T, path string, value any, comet bool) {
	t.Helper()
	var wire []byte
	var err error
	if comet {
		wire, err = cmtjson.Marshal(value)
	} else {
		wire, err = json.Marshal(value)
	}
	if err != nil {
		t.Fatal(err)
	}
	defer clear(wire)
	if err = os.WriteFile(path, wire, 0600); err != nil {
		t.Fatal(err)
	}
}

func (f keycheckFixture) originals(t *testing.T) map[string][]byte {
	t.Helper()
	before := make(map[string][]byte)
	for _, path := range []string{f.role, f.node, f.validator, f.hrs} {
		wire, err := os.ReadFile(path)
		if err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		before[path] = wire
	}
	t.Cleanup(func() {
		for _, wire := range before {
			clear(wire)
		}
	})
	return before
}

func assertKeycheckPreserved(t *testing.T, before map[string][]byte) {
	t.Helper()
	for path, wire := range before {
		after, err := os.ReadFile(path)
		if wire == nil {
			if !os.IsNotExist(err) {
				t.Fatal("keycheck created missing identity", path, err)
			}
		} else if err != nil || !bytes.Equal(wire, after) {
			t.Fatal("keycheck changed original source/key/HRS", path, err)
		}
		clear(after)
	}
}

func TestKeyCheckNodeOnlyUsesActualNodeIdentityWithoutLocalValidator(t *testing.T) {
	f := newKeycheckFixture(t, false)
	before := f.originals(t)
	var out, diagnostics bytes.Buffer
	code := runKeyCheck([]string{"-node-only", "-role-manifest", f.role, "-node-key", f.node}, &out, &diagnostics)
	if code != 0 || diagnostics.Len() != 0 || out.String() != "production node key matches the approved public role manifest (P2P identity only)\n" {
		t.Fatal("actual node-only verification failed", code, diagnostics.String())
	}
	assertKeycheckPreserved(t, before)
	// Omitting the explicit mode must continue requiring the original validator.
	out.Reset()
	diagnostics.Reset()
	if code = runKeyCheck([]string{"-role-manifest", f.role, "-node-key", f.node}, &out, &diagnostics); code == 0 || out.Len() != 0 || !strings.Contains(diagnostics.String(), "private-validator-key is required") {
		t.Fatal("legacy full-key mode silently became node-only")
	}
	assertKeycheckPreserved(t, before)
}

func TestKeyCheckOriginalFullValidatorAndNodeChecksRemainRequired(t *testing.T) {
	f := newKeycheckFixture(t, true)
	before := f.originals(t)
	var out, diagnostics bytes.Buffer
	args := []string{"-role-manifest", f.role, "-private-validator-key", f.validator, "-node-key", f.node}
	if code := runKeyCheck(args, &out, &diagnostics); code != 0 || diagnostics.Len() != 0 || out.String() != "production validator and node keys match the approved public role manifest\n" {
		t.Fatal("normal full-key verification changed", code, diagnostics.String())
	}
	assertKeycheckPreserved(t, before)
	wrong := newKeycheckFixture(t, true)
	args[3] = wrong.validator
	out.Reset()
	diagnostics.Reset()
	if code := runKeyCheck(args, &out, &diagnostics); code == 0 || out.Len() != 0 || diagnostics.Len() == 0 {
		t.Fatal("wrong original consensus validator bypassed full keycheck")
	}
	assertKeycheckPreserved(t, before)
}

func TestKeyCheckNodeOnlyRejectsAmbiguousOrPartialOptions(t *testing.T) {
	f := newKeycheckFixture(t, true)
	base := []string{"-node-only", "-role-manifest", f.role, "-node-key", f.node}
	cases := map[string][]string{
		"unknown":                append(bytesToArgs(base), "-foreign"),
		"positional":             append(bytesToArgs(base), "extra"),
		"after_separator":        append(bytesToArgs(base), "--", "extra"),
		"duplicate_mode":         append(bytesToArgs(base), "--node-only=true"),
		"duplicate_node":         append(bytesToArgs(base), "--node-key="+f.node),
		"duplicate_role":         append(bytesToArgs(base), "-role-manifest", f.role),
		"forbidden_validator":    append(bytesToArgs(base), "-private-validator-key", f.validator),
		"forbidden_empty_equals": append(bytesToArgs(base), "-private-validator-key="),
		"forbidden_empty_split":  append(bytesToArgs(base), "-private-validator-key", ""),
		"forbidden_before_mode":  {"-private-validator-key=", "-node-only", "-role-manifest", f.role, "-node-key", f.node},
		"false_mode":             {"-node-only=false", "-role-manifest", f.role, "-private-validator-key", f.validator, "-node-key", f.node},
		"empty_mode":             {"-node-only=", "-role-manifest", f.role, "-node-key", f.node},
		"missing_role":           {"-node-only", "-node-key", f.node},
		"missing_node":           {"-node-only", "-role-manifest", f.role},
		"empty_role":             {"-node-only", "-role-manifest=", "-node-key", f.node},
		"empty_node":             {"-node-only", "-role-manifest", f.role, "-node-key="},
		"half_value":             {"-node-only", "-role-manifest", f.role, "-node-key"},
		"legacy_duplicate":       {"-role-manifest", f.role, "-private-validator-key", f.validator, "-node-key", f.node, "-private-validator-key", f.validator},
	}
	before := f.originals(t)
	for name, args := range cases {
		t.Run(name, func(t *testing.T) {
			var out, diagnostics bytes.Buffer
			if code := runKeyCheck(args, &out, &diagnostics); code == 0 || out.Len() != 0 || diagnostics.Len() == 0 {
				t.Fatal("ambiguous arguments acquired a successful mode", code)
			}
			assertKeycheckPreserved(t, before)
		})
	}
}

func bytesToArgs(args []string) []string { return append([]string(nil), args...) }

func TestKeyCheckNodeOnlyRejectsActualWrongOrMalformedKeys(t *testing.T) {
	for _, name := range []string{"wrong_node", "private_public_mismatch", "permissive", "symlink", "purpose", "missing"} {
		t.Run(name, func(t *testing.T) {
			f := newKeycheckFixture(t, false)
			switch name {
			case "wrong_node":
				keycheckWriteJSON(t, f.node, &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}, true)
			case "private_public_mismatch":
				raw, err := os.ReadFile(f.node)
				if err != nil {
					t.Fatal(err)
				}
				defer clear(raw)
				var key p2p.NodeKey
				if err = cmtjson.Unmarshal(raw, &key); err != nil {
					t.Fatal(err)
				}
				defer clear(key.PrivKey.Bytes())
				key.PrivKey.Bytes()[63] ^= 1
				// Even an approved ID derived from the forged cached public half
				// cannot replace the seed-derived full key consistency check.
				f.manifest.Node.NodeID = string(key.ID())
				keycheckWriteJSON(t, f.role, f.manifest, false)
				keycheckWriteJSON(t, f.node, &key, true)
			case "permissive":
				if err := os.Chmod(f.node, 0644); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				original := f.node
				f.node = filepath.Join(filepath.Dir(f.node), "linked-node.json")
				if err := os.Symlink(original, f.node); err != nil {
					t.Fatal(err)
				}
			case "purpose":
				f.manifest.Purpose = "not-an-approved-production-role"
				keycheckWriteJSON(t, f.role, f.manifest, false)
			case "missing":
				if err := os.Remove(f.node); err != nil {
					t.Fatal(err)
				}
			}
			before := f.originals(t)
			var out, diagnostics bytes.Buffer
			if code := runKeyCheck([]string{"-node-only", "-role-manifest", f.role, "-node-key", f.node}, &out, &diagnostics); code == 0 || out.Len() != 0 || diagnostics.Len() == 0 {
				t.Fatal("invalid original node identity accepted", name)
			}
			assertKeycheckPreserved(t, before)
		})
	}
}

type keycheckInspectionFixture struct {
	keycheckFixture
	dir string
}

func newKeycheckInspectionFixture(t *testing.T) keycheckInspectionFixture {
	t.Helper()
	f := newKeycheckFixture(t, true)
	parent, err := filepath.EvalSymlinks(filepath.Dir(f.node))
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(parent, "original-custody")
	if err = os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		path *string
		name string
	}{{&f.validator, "priv_validator_key.json"}, {&f.node, "node_key.json"}, {&f.hrs, "priv_validator_state.json"}} {
		destination := filepath.Join(dir, item.name)
		if err = os.Rename(*item.path, destination); err != nil {
			t.Fatal(err)
		}
		*item.path = destination
	}
	// A nonzero synthetic original H/R/S must remain opaque and unchanged. The
	// public inspection never claims this file proves historical signing use.
	if err = os.WriteFile(f.hrs, []byte("{\"height\":\"37\",\"round\":2,\"step\":3}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	return keycheckInspectionFixture{keycheckFixture: f, dir: dir}
}

type keycheckOriginalWitness struct {
	info os.FileInfo
	raw  []byte
}

func keycheckInspectionOriginals(t *testing.T, f keycheckInspectionFixture) map[string]keycheckOriginalWitness {
	t.Helper()
	originals := make(map[string]keycheckOriginalWitness)
	for _, path := range []string{f.dir, f.validator, f.node, f.hrs} {
		info, err := os.Lstat(path)
		if err != nil {
			t.Fatal(err)
		}
		var raw []byte
		if !info.IsDir() {
			raw, err = os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
		}
		originals[path] = keycheckOriginalWitness{info: info, raw: raw}
	}
	t.Cleanup(func() {
		for _, witness := range originals {
			clear(witness.raw)
		}
	})
	return originals
}

func assertKeycheckInspectionOriginals(t *testing.T, originals map[string]keycheckOriginalWitness) {
	t.Helper()
	for path, before := range originals {
		after, err := os.Lstat(path)
		if err != nil || !os.SameFile(before.info, after) || before.info.Mode() != after.Mode() || before.info.Size() != after.Size() || !before.info.ModTime().Equal(after.ModTime()) {
			t.Fatal("public inspection changed original custody inode, mode, size or mtime", err)
		}
		if before.raw != nil {
			raw, err := os.ReadFile(path)
			equal := bytes.Equal(before.raw, raw)
			clear(raw)
			if err != nil || !equal {
				t.Fatal("public inspection changed original custody bytes", err)
			}
		}
	}
}

func TestKeyCheckInspectPublicIdentityPreservesCustodyAndEmitsOnlyPublicData(t *testing.T) {
	f := newKeycheckInspectionFixture(t)
	before := keycheckInspectionOriginals(t, f)
	var out, diagnostics bytes.Buffer
	if code := runKeyCheck([]string{"--inspect-public-identity", "--role=primary", "-key-dir", f.dir}, &out, &diagnostics); code != 0 || diagnostics.Len() != 0 {
		t.Fatal("normal public identity inspection failed", code, diagnostics.String())
	}
	var receipt keycheckPublicIdentityReceipt
	if err := json.Unmarshal(out.Bytes(), &receipt); err != nil {
		t.Fatal(err)
	}
	if receipt.Version != "YNX-CONSENSUS-KEYCHECK-PUBLIC-IDENTITY/v1" || !receipt.PublicDataOnly || !receipt.SourceReadOnly || !receipt.HRSUnchanged || receipt.ManifestMatched || receipt.AuthorityGranted || receipt.HRSHistoryVerified || receipt.SigningPerformed || receipt.FilesCreated {
		t.Fatal("inspection implied manifest, historical HRS, signing or authority qualification")
	}
	want := consensus.ProductionKeyCeremonyRecord{Version: 1, Purpose: consensus.ProductionValidatorManifestPurpose, Role: "primary", ValidatorAddress: "ynx_validator_primary", ConsensusKeyType: f.manifest.Node.ConsensusKeyType, ConsensusPubKey: f.manifest.Node.ConsensusPubKey, ConsensusAddress: f.manifest.Node.ConsensusAddress, NodeID: f.manifest.Node.NodeID, CustodyBoundary: "owner-controlled-host-local"}
	if receipt.PublicRecord != want {
		t.Fatal("inspection did not return the actual original public identity")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(out.Bytes(), &fields); err != nil || len(fields) != 10 {
		t.Fatal("public receipt is not its closed ten-field DATA object", err)
	}
	for _, name := range []string{"version", "publicRecord", "publicDataOnly", "sourceReadOnly", "manifestMatched", "authorityGranted", "hrsUnchanged", "hrsHistoryVerified", "signingPerformed", "filesCreated"} {
		if _, ok := fields[name]; !ok {
			t.Fatal("missing closed public field", name)
		}
	}
	var public map[string]json.RawMessage
	if err := json.Unmarshal(fields["publicRecord"], &public); err != nil || len(public) != 9 {
		t.Fatal("public record contains an unexpected private or raw field", err)
	}
	for _, name := range []string{"version", "purpose", "role", "validatorAddress", "consensusKeyType", "consensusPubKey", "consensusAddress", "nodeId", "custodyBoundary"} {
		if _, ok := public[name]; !ok {
			t.Fatal("unexpected public record shape", name)
		}
	}
	for _, name := range []string{"priv_key", "privateKey", "seed", f.dir} {
		if strings.Contains(out.String(), name) {
			t.Fatal("public receipt disclosed private material or original paths")
		}
	}
	assertKeycheckInspectionOriginals(t, before)
	entries, err := os.ReadDir(f.dir)
	if err != nil || len(entries) != 3 {
		t.Fatal("inspection created a custody intent or public output", err)
	}
}

func TestKeyCheckInspectPublicIdentityArgumentsFailBeforeCustody(t *testing.T) {
	// No existing custody path is needed to reject these arguments. Reaching
	// the filesystem inspector would produce the distinct sanitized custody
	// diagnostic, which none of these cases may reach.
	missing := filepath.Join(t.TempDir(), "must-not-open")
	base := []string{"-inspect-public-identity", "-role", "primary", "-key-dir", missing}
	cases := map[string][]string{
		"manifest":             append(bytesToArgs(base), "-role-manifest", missing),
		"empty_manifest":       append(bytesToArgs(base), "-role-manifest="),
		"validator":            append(bytesToArgs(base), "-private-validator-key", missing),
		"empty_validator":      append(bytesToArgs(base), "-private-validator-key="),
		"node":                 append(bytesToArgs(base), "-node-key", missing),
		"node_only":            append(bytesToArgs(base), "-node-only"),
		"duplicate_mode":       append(bytesToArgs(base), "--inspect-public-identity=true"),
		"duplicate_role":       append(bytesToArgs(base), "--role=primary"),
		"duplicate_key_dir":    append(bytesToArgs(base), "--key-dir="+missing),
		"unknown":              append(bytesToArgs(base), "-foreign=unused"),
		"abbreviation":         {"-inspect-public", "-role", "primary", "-key-dir", missing},
		"positional":           append(bytesToArgs(base), "extra"),
		"separator_positional": append(bytesToArgs(base), "--", "extra"),
		"mode_false":           {"-inspect-public-identity=false", "-role", "primary", "-key-dir", missing},
		"mode_empty":           {"-inspect-public-identity=", "-role", "primary", "-key-dir", missing},
		"unknown_role":         {"-inspect-public-identity", "-role", "replacement", "-key-dir", missing},
		"spaced_role":          {"-inspect-public-identity", "-role", " primary", "-key-dir", missing},
		"missing_role":         {"-inspect-public-identity", "-key-dir", missing},
		"missing_key_dir":      {"-inspect-public-identity", "-role", "primary"},
		"empty_key_dir":        {"-inspect-public-identity", "-role", "primary", "-key-dir="},
		"relative_key_dir":     {"-inspect-public-identity", "-role", "primary", "-key-dir", "relative"},
		"unclean_key_dir":      {"-inspect-public-identity", "-role", "primary", "-key-dir", missing + "/../must-not-open"},
		"null_key_dir":         {"-inspect-public-identity", "-role", "primary", "-key-dir", missing + "\x00"},
		"role_without_mode":    {"-role", "primary", "-role-manifest", missing, "-private-validator-key", missing, "-node-key", missing},
		"dir_without_mode":     {"-key-dir", missing, "-node-only", "-role-manifest", missing, "-node-key", missing},
	}
	for name, args := range cases {
		t.Run(name, func(t *testing.T) {
			var out, diagnostics bytes.Buffer
			if code := runKeyCheck(args, &out, &diagnostics); code != 1 || out.Len() != 0 || diagnostics.Len() == 0 || strings.Contains(diagnostics.String(), "could not be inspected") || strings.Contains(diagnostics.String(), missing) {
				t.Fatal("invalid public-mode arguments reached custody or produced public output", code, diagnostics.String())
			}
			if _, err := os.Lstat(missing); !os.IsNotExist(err) {
				t.Fatal("invalid arguments created custody", err)
			}
		})
	}
}

func TestKeyCheckInspectPublicIdentityRejectsUnprotectedOrInvalidCustody(t *testing.T) {
	for _, name := range []string{"missing", "directory_symlink", "ancestor_symlink", "validator_symlink", "node_symlink", "hrs_symlink", "public_directory", "public_key", "readonly_key", "hardlink", "empty", "oversize", "invalid_validator", "invalid_node", "missing_hrs"} {
		t.Run(name, func(t *testing.T) {
			f := newKeycheckInspectionFixture(t)
			directory := f.dir
			switch name {
			case "missing":
				directory = filepath.Join(filepath.Dir(f.dir), "missing")
			case "directory_symlink":
				directory = filepath.Join(filepath.Dir(f.dir), "linked")
				if err := os.Symlink(f.dir, directory); err != nil {
					t.Fatal(err)
				}
			case "ancestor_symlink":
				alias := filepath.Join(filepath.Dir(f.dir), "alias")
				if err := os.Symlink(filepath.Dir(f.dir), alias); err != nil {
					t.Fatal(err)
				}
				directory = filepath.Join(alias, filepath.Base(f.dir))
			case "validator_symlink", "node_symlink", "hrs_symlink":
				path := map[string]string{"validator_symlink": f.validator, "node_symlink": f.node, "hrs_symlink": f.hrs}[name]
				if err := os.Rename(path, path+".retained"); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(path+".retained", path); err != nil {
					t.Fatal(err)
				}
			case "public_directory":
				if err := os.Chmod(f.dir, 0755); err != nil {
					t.Fatal(err)
				}
			case "public_key", "readonly_key":
				mode := os.FileMode(0644)
				if name == "readonly_key" {
					mode = 0400
				}
				if err := os.Chmod(f.validator, mode); err != nil {
					t.Fatal(err)
				}
			case "hardlink":
				if err := os.Link(f.node, filepath.Join(f.dir, "retained-node-link")); err != nil {
					t.Fatal(err)
				}
			case "empty", "oversize", "invalid_validator", "invalid_node":
				path, raw := f.validator, []byte("not a private key")
				if name == "empty" {
					raw = nil
				} else if name == "oversize" {
					raw = bytes.Repeat([]byte("x"), (64<<10)+1)
				} else if name == "invalid_node" {
					path = f.node
				}
				if err := os.WriteFile(path, raw, 0600); err != nil {
					t.Fatal(err)
				}
			case "missing_hrs":
				if err := os.Rename(f.hrs, f.hrs+".retained"); err != nil {
					t.Fatal(err)
				}
				// The remaining files must be preserved and the missing HRS must
				// never be initialized as a side effect of inspection.
				f.hrs += ".retained"
			}
			before := keycheckInspectionOriginals(t, f)
			var out, diagnostics bytes.Buffer
			if code := runKeyCheck([]string{"-inspect-public-identity", "-role", "primary", "-key-dir", directory}, &out, &diagnostics); code != 1 || out.Len() != 0 || diagnostics.String() != "existing private custody could not be inspected read-only\n" {
				t.Fatal("invalid custody escaped the explicit read-only boundary", code, diagnostics.String())
			}
			assertKeycheckInspectionOriginals(t, before)
			if name == "missing_hrs" {
				if _, err := os.Lstat(filepath.Join(f.dir, "priv_validator_state.json")); !os.IsNotExist(err) {
					t.Fatal("inspection initialized missing HRS", err)
				}
			}
		})
	}
}

type keycheckMetadataInfo struct {
	os.FileInfo
	sys any
	mod time.Time
}

func (i keycheckMetadataInfo) Sys() any { return i.sys }
func (i keycheckMetadataInfo) ModTime() time.Time {
	if !i.mod.IsZero() {
		return i.mod
	}
	return i.FileInfo.ModTime()
}

func TestKeyCheckCustodyIdentityRequiresOwnerAndNanosecondChangeTime(t *testing.T) {
	f := newKeycheckInspectionFixture(t)
	info, err := os.Lstat(f.validator)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := keycheckCustodyIdentity(info, false)
	if err != nil {
		t.Fatal(err)
	}
	copyStat := func() reflect.Value {
		original := reflect.ValueOf(info.Sys())
		value := reflect.New(original.Elem().Type())
		value.Elem().Set(original.Elem())
		return value
	}
	foreign := copyStat()
	uid := foreign.Elem().FieldByName("Uid")
	if os.Geteuid() == 0 {
		uid.SetUint(1)
	} else {
		uid.SetUint(0)
	}
	if _, err := keycheckCustodyIdentity(keycheckMetadataInfo{FileInfo: info, sys: foreign.Interface()}, false); err == nil {
		t.Fatal("foreign synthetic metadata acquired the current owner's custody")
	}
	if _, err := keycheckCustodyIdentity(keycheckMetadataInfo{FileInfo: info, sys: &struct{ Dev, Ino, Uid, Gid, Nlink uint64 }{1, 1, uint64(os.Geteuid()), 1, 1}}, false); err == nil {
		t.Fatal("missing nanosecond ctime metadata was accepted")
	}
	for _, kind := range []string{"atime", "ctime", "mtime"} {
		value := copyStat()
		observed := keycheckMetadataInfo{FileInfo: info, sys: value.Interface()}
		if kind == "mtime" {
			observed.mod = info.ModTime().Add(time.Nanosecond)
		} else {
			aliases := []string{"Atim", "Atimespec"}
			if kind == "ctime" {
				aliases = []string{"Ctim", "Ctimespec"}
			}
			found := false
			for _, name := range aliases {
				stamp := value.Elem().FieldByName(name)
				if stamp.IsValid() {
					sec := stamp.FieldByName("Sec")
					sec.SetInt(sec.Int() + 1)
					found = true
					break
				}
			}
			if !found {
				t.Fatal("platform lacks expected synthetic timestamp metadata")
			}
		}
		after, err := keycheckCustodyIdentity(observed, false)
		if err != nil || (kind == "atime") != (after == identity) {
			t.Fatal("atime exemption weakened mtime/ctime identity", kind, err)
		}
	}
}

func TestKeyCheckCustodyHeldIdentityRejectsReplacementAndChanges(t *testing.T) {
	for _, change := range []string{"bytes", "replacement", "symlink", "mode"} {
		t.Run(change, func(t *testing.T) {
			f := newKeycheckInspectionFixture(t)
			input, err := openKeycheckCustody(f.hrs, false)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = input.file.Close() })
			switch change {
			case "bytes":
				if err = os.WriteFile(f.hrs, []byte("changed original HRS"), 0600); err != nil {
					t.Fatal(err)
				}
			case "replacement", "symlink":
				if err = os.Rename(f.hrs, f.hrs+".retained"); err != nil {
					t.Fatal(err)
				}
				if change == "replacement" {
					err = os.WriteFile(f.hrs, []byte("replacement"), 0600)
				} else {
					err = os.Symlink(f.hrs+".retained", f.hrs)
				}
				if err != nil {
					t.Fatal(err)
				}
			case "mode":
				if err = os.Chmod(f.hrs, 0644); err != nil {
					t.Fatal(err)
				}
			}
			if err = input.unchanged(); err == nil {
				t.Fatal("changed held custody was reported unchanged", change)
			}
		})
	}
}
