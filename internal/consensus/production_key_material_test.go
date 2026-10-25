package consensus

import (
	"bytes"
	stded25519 "crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtcrypto "github.com/cometbft/cometbft/crypto"
	cmted25519 "github.com/cometbft/cometbft/crypto/ed25519"
	cmtsecp256k1 "github.com/cometbft/cometbft/crypto/secp256k1"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
)

type productionKeyMaterialFixture struct {
	directory, validator, node, state, manifest string
	record                                      ProductionKeyCeremonyRecord
}

func newProductionKeyMaterialFixture(t *testing.T) productionKeyMaterialFixture {
	t.Helper()
	root := t.TempDir()
	directory := filepath.Join(root, "original-custody")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	validatorPrivate := cmted25519.PrivKey(stded25519.NewKeyFromSeed(bytes.Repeat([]byte{0x31}, stded25519.SeedSize)))
	nodePrivate := cmted25519.PrivKey(stded25519.NewKeyFromSeed(bytes.Repeat([]byte{0x62}, stded25519.SeedSize)))
	defer clear(validatorPrivate)
	defer clear(nodePrivate)
	validatorPublic := cmted25519.PubKey(bytes.Clone(validatorPrivate[stded25519.SeedSize:]))
	nodePublic := cmted25519.PubKey(bytes.Clone(nodePrivate[stded25519.SeedSize:]))
	f := productionKeyMaterialFixture{directory: directory, validator: filepath.Join(directory, "priv_validator_key.json"), node: filepath.Join(directory, "node_key.json"), state: filepath.Join(directory, "priv_validator_state.json"), manifest: filepath.Join(root, "role-manifest.json")}
	f.record = ProductionKeyCeremonyRecord{Version: 1, Purpose: ProductionValidatorManifestPurpose, Role: "primary", ValidatorAddress: "ynx_validator_primary", ConsensusKeyType: chain.ConsensusPubKeyTypeEd25519, ConsensusPubKey: base64.StdEncoding.EncodeToString(validatorPublic), ConsensusAddress: strings.ToUpper(hex.EncodeToString(validatorPublic.Address())), NodeID: string(p2p.PubKeyToID(nodePublic)), CustodyBoundary: "owner-controlled-host-local"}
	validatorWire, err := cmtjson.Marshal(privval.FilePVKey{Address: validatorPublic.Address(), PubKey: validatorPublic, PrivKey: validatorPrivate})
	if err != nil {
		t.Fatal(err)
	}
	defer clear(validatorWire)
	nodeWire, err := cmtjson.Marshal(p2p.NodeKey{PrivKey: nodePrivate})
	if err != nil {
		t.Fatal(err)
	}
	defer clear(nodeWire)
	manifestWire, err := json.Marshal(ProductionCandidateRoleManifest{Version: ProductionCandidatePackageVersion, Purpose: ProductionValidatorManifestPurpose, ChainID: "ynx_6423-1", Node: ProductionValidatorNode{ValidatorAddress: f.record.ValidatorAddress, Role: f.record.Role, NodeID: f.record.NodeID, ConsensusKeyType: f.record.ConsensusKeyType, ConsensusPubKey: f.record.ConsensusPubKey, ConsensusAddress: f.record.ConsensusAddress}})
	if err != nil {
		t.Fatal(err)
	}
	for path, raw := range map[string][]byte{f.validator: validatorWire, f.node: nodeWire, f.state: []byte("{\"height\":\"0\",\"round\":0,\"step\":0}\n"), f.manifest: manifestWire} {
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func assertProductionKeyMaterialReadOnly(t *testing.T, f productionKeyMaterialFixture, inspect func()) {
	t.Helper()
	type original struct {
		path string
		raw  []byte
		info os.FileInfo
	}
	var originals []original
	defer func() {
		for _, value := range originals {
			clear(value.raw)
		}
	}()
	for _, path := range []string{f.validator, f.node, f.state, f.manifest} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		info, err := os.Lstat(path)
		if err != nil {
			clear(raw)
			t.Fatal(err)
		}
		originals = append(originals, original{path: path, raw: raw, info: info})
	}
	entries, err := os.ReadDir(f.directory)
	if err != nil {
		t.Fatal(err)
	}
	inspect()
	for _, value := range originals {
		raw, err := os.ReadFile(value.path)
		if err != nil {
			t.Fatal(err)
		}
		sameBytes := bytes.Equal(raw, value.raw)
		clear(raw)
		info, statErr := os.Lstat(value.path)
		if !sameBytes || statErr != nil || !os.SameFile(value.info, info) || info.Mode() != value.info.Mode() || info.Size() != value.info.Size() || !info.ModTime().Equal(value.info.ModTime()) {
			t.Fatalf("normal inspection changed original custody or public manifest: %s", filepath.Base(value.path))
		}
	}
	after, err := os.ReadDir(f.directory)
	if err != nil || len(after) != len(entries) {
		t.Fatal("normal inspection created or removed a custody file")
	}
	for index, entry := range entries {
		if entry.Name() != after[index].Name() {
			t.Fatal("normal inspection changed custody directory entries")
		}
	}
}

func TestProductionKeyMaterialExistingOriginalKeysRemainCompatibleAndReadOnly(t *testing.T) {
	f := newProductionKeyMaterialFixture(t)
	assertProductionKeyMaterialReadOnly(t, f, func() {
		for repeat := 0; repeat < 2; repeat++ {
			record, err := ReadProductionKeyRecord("primary", f.directory)
			if err != nil || record != f.record {
				t.Fatalf("normal original key record changed or was refused: %v", err)
			}
			if err := VerifyProductionKeyFiles(f.manifest, f.validator, f.node); err != nil {
				t.Fatalf("normal original keys no longer match the original manifest: %v", err)
			}
			if err := VerifyProductionNodeKeyFile(f.manifest, f.node); err != nil {
				t.Fatalf("normal original P2P key was refused: %v", err)
			}
		}
	})
}

func TestProductionKeyMaterialRejectsSeedTamperingThatPassesOriginalPublicHalfGate(t *testing.T) {
	for _, target := range []string{"validator", "node"} {
		t.Run(target, func(t *testing.T) {
			f := newProductionKeyMaterialFixture(t)
			path := f.validator
			if target == "node" {
				path = f.node
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			defer clear(raw)
			var wire []byte
			if target == "validator" {
				var key privval.FilePVKey
				if err := cmtjson.Unmarshal(raw, &key); err != nil {
					t.Fatal(err)
				}
				private := key.PrivKey.(cmted25519.PrivKey)
				defer clear(private)
				private[0] ^= 0x80
				// This is the actual old gate: PubKey copies only the unchanged
				// private-key tail, so the corrupt seed still appears authorized.
				if !bytes.Equal(key.PrivKey.PubKey().Bytes(), key.PubKey.Bytes()) || !bytes.Equal(key.Address, key.PubKey.Address()) {
					t.Fatal("validator counterexample no longer passes the original public-half gate")
				}
				wire, err = cmtjson.Marshal(key)
			} else {
				var key p2p.NodeKey
				if err := cmtjson.Unmarshal(raw, &key); err != nil {
					t.Fatal(err)
				}
				private := key.PrivKey.(cmted25519.PrivKey)
				defer clear(private)
				private[0] ^= 0x80
				if string(key.ID()) != f.record.NodeID {
					t.Fatal("node counterexample no longer passes the original P2P identity gate")
				}
				wire, err = cmtjson.Marshal(key)
			}
			if err != nil {
				t.Fatal(err)
			}
			defer clear(wire)
			if err := os.WriteFile(path, wire, 0o600); err != nil {
				t.Fatal(err)
			}
			assertProductionKeyMaterialReadOnly(t, f, func() {
				if _, err := ReadProductionKeyRecord("primary", f.directory); err == nil {
					t.Fatal("production public inspection accepted a corrupt private seed with its original public half")
				}
				if err := VerifyProductionKeyFiles(f.manifest, f.validator, f.node); err == nil {
					t.Fatal("production manifest check accepted a corrupt private seed with its original public half")
				}
				if err := VerifyProductionNodeKeyFile(f.manifest, f.node); (err != nil) != (target == "node") {
					t.Fatalf("P2P-only validation did not preserve its exact original scope: %v", err)
				}
			})
		})
	}
}

func TestProductionKeyMaterialRejectsIncompleteOrDifferentPrivateKeyType(t *testing.T) {
	for _, size := range []int{0, 1, 31, 32, 63, 65} {
		if _, err := validatedProductionEd25519PublicKey(cmted25519.PrivKey(make([]byte, size))); err == nil {
			t.Fatalf("incomplete or oversized private key was accepted: %d", size)
		}
	}
	for _, key := range []cmtcrypto.PrivKey{nil, cmtsecp256k1.PrivKey(make([]byte, 32))} {
		if _, err := validatedProductionEd25519PublicKey(key); err == nil {
			t.Fatal("absent or non-Ed25519 private key was accepted")
		}
	}
}
