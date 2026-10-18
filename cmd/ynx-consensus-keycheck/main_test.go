package main

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

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
