package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

func initialFixturePublic(t *testing.T, public ynxbatch.PublicKey) (initialInputs, ynxauth.RegistrationIntent) {
	t.Helper()
	owner := "0x" + strings.Repeat("1", 40)
	network := bytes.Repeat([]byte{0x42}, 32)
	configuration := initialGenesisConfiguration{Version: initialAccountsVersion, NetworkID: hex.EncodeToString(network), EnableAt: "2", BirthFee: "0",
		Accounts: []initialGenesisBinding{{Owner: owner, PKA: hex.EncodeToString(public.PKA), PKB: hex.EncodeToString(public.PKB)}}}
	// A complete synthetic Comet Genesis is encoded by its real normal codec,
	// then the existing top-level account configuration is added. It is never
	// a public deployment, Root, account approval or real operator assignment.
	validator := ed25519.GenPrivKeyFromSecret([]byte("account-initial-cabi-synthetic-validator"))
	doc := &cmttypes.GenesisDoc{GenesisTime: time.Date(2026, 10, 25, 1, 2, 3, 0, time.UTC), ChainID: "ynx_6423-1", InitialHeight: 2,
		ConsensusParams: cmttypes.DefaultConsensusParams(), Validators: []cmttypes.GenesisValidator{{Address: validator.PubKey().Address(), PubKey: validator.PubKey(), Power: 1, Name: "synthetic"}}, AppHash: network, AppState: json.RawMessage(`{}`)}
	must(t, doc.ValidateAndComplete())
	raw, err := cmtjson.Marshal(doc)
	must(t, err)
	var fields map[string]json.RawMessage
	must(t, json.Unmarshal(raw, &fields))
	fields["pq_initial_accounts"], err = json.Marshal(configuration)
	must(t, err)
	raw, err = json.Marshal(fields)
	must(t, err)
	digest := sha256.Sum256(raw)
	intent := ynxauth.RegistrationIntent{ChainID: network, Owner: owner, PKA: public.PKA, PKB: public.PKB, NewRevision: 1, LedgerNonce: 1, ActivateAt: 3}
	message, err := intent.SigningBytes()
	must(t, err)
	return initialInputs{message: message, genesis: raw, expected: initialExpected{GenesisSHA256: bytes.Clone(digest[:]), NetworkID: bytes.Clone(network), Owner: owner,
		NativeChainID: 6423, ExecutionHeight: "2", PKA: bytes.Clone(public.PKA), PKB: bytes.Clone(public.PKB)}}, intent
}

func initialFixture(t *testing.T) (initialInputs, ynxauth.RegistrationIntent, ynxbatch.KeyMaterial) {
	t.Helper()
	key, public, err := ynxbatch.KeyGen()
	must(t, err)
	t.Cleanup(key.Destroy)
	material, err := ynxbatch.ExportKeyMaterial(key)
	must(t, err)
	t.Cleanup(material.Clear)
	in, intent := initialFixturePublic(t, public)
	return in, intent, material
}

func requireInitialPlan(t *testing.T, in initialInputs) initialPlan {
	t.Helper()
	plan, code := prepareInitial(in, initialMemberCapacity)
	if code != resultOK {
		t.Fatal("synthetic independent-Genesis initial preflight refused")
	}
	return plan
}

func repinInitialFixture(in initialInputs) initialInputs {
	// Synthetic negative-test bytes only. This does NOT authenticate or approve
	// a replacement Genesis. Production expectedpin remains Main/Auth-owned.
	digest := sha256.Sum256(in.genesis)
	in.expected.GenesisSHA256 = bytes.Clone(digest[:])
	return in
}

func mutateInitialConfiguration(t *testing.T, in initialInputs, edit func(*initialGenesisConfiguration)) initialInputs {
	t.Helper()
	var fields map[string]json.RawMessage
	must(t, json.Unmarshal(in.genesis, &fields))
	var config initialGenesisConfiguration
	must(t, json.Unmarshal(fields["pq_initial_accounts"], &config))
	edit(&config)
	var err error
	fields["pq_initial_accounts"], err = json.Marshal(config)
	must(t, err)
	in.genesis, err = json.Marshal(fields)
	must(t, err)
	return repinInitialFixture(in)
}

func TestAccountInitialCoreActualANDAndExactProfile(t *testing.T) {
	in, _, material := initialFixture(t)
	plan := requireInitialPlan(t, in)
	before := cloneMaterial(material)
	defer before.Clear()
	wire, code, cleanup := signInitialPrepared(plan, material)
	defer clear(wire)
	if code != resultOK || cleanup != cleanupLogicalComplete || len(wire) == 0 || len(wire) > initialMemberCapacity {
		t.Fatal("initial fixed signing/cleanup failed")
	}
	must(t, inspectInitialMember(plan, wire))
	intent, err := ynxauth.VerifyPQInitialRegistrationPossession(wire, plan.trusted, 2)
	must(t, err)
	if intent.PriorRevision != 0 || intent.NewRevision != 1 || intent.LedgerNonce != 1 || intent.ActivateAt != 3 {
		t.Fatal("initial profile changed registration fields")
	}
	for _, tc := range []struct {
		name string
		edit func(*ynxbatch.Member)
	}{
		{"ML-DSA signature", func(m *ynxbatch.Member) { m.Certificate.SigmaA[0] ^= 1 }},
		{"SLH-DSA signature", func(m *ynxbatch.Member) { m.Certificate.SigmaB[0] ^= 1 }},
		{"wrong purpose", func(m *ynxbatch.Member) { m.Certificate.Purpose = "ACCOUNT-MIGRATION" }},
		{"wrong count", func(m *ynxbatch.Member) { m.Certificate.N = 2 }},
		{"wrong index", func(m *ynxbatch.Member) { m.Index = 1 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, err := ynxbatch.DecodeMember(wire)
			must(t, err)
			tc.edit(&m)
			bad, err := ynxbatch.EncodeMember(m)
			if err == nil && inspectInitialMember(plan, bad) == nil {
				t.Fatal("wrong initial member accepted")
			}
		})
	}
	equalMaterial(t, material, before)
	// Detachment: no original mutable Genesis/public/message alias can replace
	// the source selected before private import.
	in.message[0] ^= 1
	in.genesis[0] ^= 1
	in.expected.NetworkID[0] ^= 1
	in.expected.PKA[0] ^= 1
	in.expected.PKB[0] ^= 1
	in.expected.GenesisSHA256[0] ^= 1
	must(t, inspectInitialMember(plan, wire))
}

func TestAccountInitialRejectsGenesisAndContext(t *testing.T) {
	in, _, _ := initialFixture(t)
	for _, tc := range []struct {
		name string
		edit func(initialInputs) initialInputs
	}{
		{"wrong independent SHA", func(x initialInputs) initialInputs { x.expected.GenesisSHA256 = make([]byte, 32); return x }},
		{"changed original bytes", func(x initialInputs) initialInputs { x.genesis = append(bytes.Clone(x.genesis), ' '); return x }},
		{"network", func(x initialInputs) initialInputs { x.expected.NetworkID = bytes.Repeat([]byte{0x43}, 32); return x }},
		{"owner", func(x initialInputs) initialInputs { x.expected.Owner = "0x" + strings.Repeat("2", 40); return x }},
		{"native chain", func(x initialInputs) initialInputs { x.expected.NativeChainID++; return x }},
		{"current alias", func(x initialInputs) initialInputs { x.expected.ExecutionHeight = "02"; return x }},
		{"not yet active", func(x initialInputs) initialInputs { x.expected.ExecutionHeight = "1"; return x }},
		{"expired activation", func(x initialInputs) initialInputs { x.expected.ExecutionHeight = "3"; return x }},
		{"current overflow", func(x initialInputs) initialInputs { x.expected.ExecutionHeight = "9223372036854775807"; return x }},
		{"pair A", func(x initialInputs) initialInputs { x.expected.PKA = make([]byte, ynxbatch.PublicKeyASize); return x }},
		{"pair B", func(x initialInputs) initialInputs { x.expected.PKB = make([]byte, ynxbatch.PublicKeyBSize); return x }},
		{"missing config", func(x initialInputs) initialInputs {
			x.genesis = bytes.Replace(x.genesis, []byte(`"pq_initial_accounts":`), []byte(`"not_initial_accounts":`), 1)
			return repinInitialFixture(x)
		}},
		{"duplicate top", func(x initialInputs) initialInputs {
			x.genesis = append(bytes.Clone(x.genesis[:len(x.genesis)-1]), []byte(`,"chain_id":"ynx_6423-1"}`)...)
			return repinInitialFixture(x)
		}},
		{"trailing JSON", func(x initialInputs) initialInputs {
			x.genesis = append(bytes.Clone(x.genesis), []byte(`{}`)...)
			return repinInitialFixture(x)
		}},
		{"unknown config", func(x initialInputs) initialInputs {
			x.genesis = bytes.Replace(x.genesis, []byte(`"birthFee":"0"`), []byte(`"birthFee":"0","approved":true`), 1)
			return repinInitialFixture(x)
		}},
		{"duplicate config", func(x initialInputs) initialInputs {
			x.genesis = bytes.Replace(x.genesis, []byte(`"birthFee":"0"`), []byte(`"birthFee":"0","birthFee":"0"`), 1)
			return repinInitialFixture(x)
		}},
		{"numeric initial height", func(x initialInputs) initialInputs {
			x.genesis = bytes.Replace(x.genesis, []byte(`"initial_height":"2"`), []byte(`"initial_height":2`), 1)
			return repinInitialFixture(x)
		}},
		{"version", func(x initialInputs) initialInputs {
			return mutateInitialConfiguration(t, x, func(c *initialGenesisConfiguration) { c.Version = "unrecognized" })
		}},
		{"birth fee", func(x initialInputs) initialInputs {
			return mutateInitialConfiguration(t, x, func(c *initialGenesisConfiguration) { c.BirthFee = "1" })
		}},
		{"enable alias", func(x initialInputs) initialInputs {
			return mutateInitialConfiguration(t, x, func(c *initialGenesisConfiguration) { c.EnableAt = "02" })
		}},
		{"missing full A", func(x initialInputs) initialInputs {
			return mutateInitialConfiguration(t, x, func(c *initialGenesisConfiguration) { c.Accounts[0].PKA = c.Accounts[0].PKA[2:] })
		}},
		{"zero full B", func(x initialInputs) initialInputs {
			return mutateInitialConfiguration(t, x, func(c *initialGenesisConfiguration) { c.Accounts[0].PKB = strings.Repeat("0", 128) })
		}},
		{"duplicate owner", func(x initialInputs) initialInputs {
			return mutateInitialConfiguration(t, x, func(c *initialGenesisConfiguration) { c.Accounts = append(c.Accounts, c.Accounts[0]) })
		}},
		{"unsorted owners", func(x initialInputs) initialInputs {
			return mutateInitialConfiguration(t, x, func(c *initialGenesisConfiguration) {
				b := c.Accounts[0]
				b.Owner = "0x" + strings.Repeat("0", 39) + "1"
				c.Accounts = append(c.Accounts, b)
			})
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			x := tc.edit(in)
			if _, code := prepareInitial(x, initialMemberCapacity); code != resultPublicBinding {
				t.Fatal("invalid original Genesis/context accepted")
			}
		})
	}
	for _, capacity := range []uint64{0, initialMemberCapacity - 1, initialMemberCapacity + 1, ^uint64(0)} {
		if _, code := prepareInitial(in, capacity); code != resultCapacity {
			t.Fatal("fixed initial capacity changed")
		}
	}
	x := in
	x.message = make([]byte, initialMessageMaximum+1)
	if _, code := prepareInitial(x, initialMemberCapacity); code != resultBounds {
		t.Fatal("oversized initial message accepted")
	}
}

func TestAccountInitialRejectsOtherMessagesAndPrivateMismatch(t *testing.T) {
	in, intent, material := initialFixture(t)
	plan := requireInitialPlan(t, in)
	for _, edit := range []func(*ynxauth.RegistrationIntent){
		func(r *ynxauth.RegistrationIntent) { r.PriorRevision = 1; r.NewRevision = 2 },
		func(r *ynxauth.RegistrationIntent) { r.LedgerNonce = 2 },
		func(r *ynxauth.RegistrationIntent) { r.ActivateAt = 2 },
		func(r *ynxauth.RegistrationIntent) { r.ActivateAt = math.MaxUint64 },
	} {
		r := intent
		edit(&r)
		raw, err := r.SigningBytes()
		must(t, err)
		x := in
		x.message = raw
		if _, code := prepareInitial(x, initialMemberCapacity); code != resultPublicBinding {
			t.Fatal("noninitial registration intent accepted")
		}
	}
	transfer, err := (ynxauth.Transfer{ChainID: in.expected.NetworkID, NativeChainID: 6423, From: in.expected.Owner, To: "0x" + strings.Repeat("2", 40), Amount: 1, Fee: 1, Nonce: 2}).SigningBytes()
	must(t, err)
	x := in
	x.message = transfer
	if _, code := prepareInitial(x, initialMemberCapacity); code != resultPublicBinding {
		t.Fatal("ordinary TX message accepted as account birth")
	}
	for _, edit := range []func(*ynxbatch.KeyMaterial){func(m *ynxbatch.KeyMaterial) { m.PKCS8A[0] ^= 1 }, func(m *ynxbatch.KeyMaterial) { m.PKCS8B[118] ^= 1 }, func(m *ynxbatch.KeyMaterial) { m.PKA[0] ^= 1 }, func(m *ynxbatch.KeyMaterial) { m.PKB[0] ^= 1 }} {
		bad := cloneMaterial(material)
		edit(&bad)
		before := cloneMaterial(bad)
		out, code, cleanup := signInitialPrepared(plan, bad)
		if len(out) != 0 || code != resultKeyMaterial || cleanup != cleanupLogicalComplete {
			t.Fatal("wrong initial custody released output")
		}
		equalMaterial(t, bad, before)
		bad.Clear()
		before.Clear()
	}
	clear(material.PKCS8A)
	clear(material.PKCS8B)
	if out, code, cleanup := signInitialPrepared(plan, material); len(out) != 0 || code != resultKeyMaterial || cleanup != cleanupLogicalComplete {
		t.Fatal("initial signer retained private key")
	}
}

func initialFundedFixture(t *testing.T, in initialInputs) initialInputs {
	t.Helper()
	intent, err := ynxauth.DecodeRegistrationIntent(in.message)
	must(t, err)
	// Real normal source preparation supplies the two public identifiers. This
	// test deliberately exercises only Native parsing/math, not the bootstrap's
	// separate complete ledger, latest-block receipt and lot validation.
	source := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	must(t, source.EnableAccountPQ(2))
	receipt, err := source.Faucet(in.expected.Owner, 100)
	must(t, err)
	source.ProduceBlock()
	migration, err := source.ExportConsensusMigrationState()
	must(t, err)
	network, err := hex.DecodeString(migration.OriginalGenesisHash)
	must(t, err)
	in.expected.NetworkID = network
	intent.ChainID = bytes.Clone(network)
	in.message, err = intent.SigningBytes()
	must(t, err)
	var fields map[string]json.RawMessage
	must(t, json.Unmarshal(in.genesis, &fields))
	var configuration initialGenesisConfiguration
	must(t, json.Unmarshal(fields["pq_initial_accounts"], &configuration))
	configuration.NetworkID = migration.OriginalGenesisHash
	configuration.Accounts[0].PreparedFunding = &initialGenesisPreparedFunding{SourceStateHash: migration.StateHash, FaucetHash: receipt.Hash}
	fields["pq_initial_accounts"], err = json.Marshal(configuration)
	must(t, err)
	fields["app_hash"], err = json.Marshal(strings.ToUpper(migration.StateHash))
	must(t, err)
	fields["app_state"], err = migration.CanonicalJSON()
	must(t, err)
	in.genesis, err = json.Marshal(fields)
	must(t, err)
	return repinInitialFixture(in)
}

func TestAccountInitialPreparedFundingFromNormalSourceReceipt(t *testing.T) {
	in, _, material := initialFixture(t)
	zeroConfiguration := bytes.Clone(in.genesis)
	if bytes.Contains(zeroConfiguration, []byte(`"preparedFunding"`)) {
		t.Fatal("optional funding changed the original zero-balance Genesis bytes")
	}
	in = initialFundedFixture(t, in)
	plan := requireInitialPlan(t, in)
	wire, code, cleanup := signInitialPrepared(plan, material)
	defer clear(wire)
	if code != resultOK || cleanup != cleanupLogicalComplete {
		t.Fatal("normal source-prepared funding metadata blocked Native initial signing")
	}
	must(t, inspectInitialMember(plan, wire))
	for _, tc := range []struct {
		name string
		edit func(initialInputs) initialInputs
	}{
		{"zero source hash", func(x initialInputs) initialInputs {
			return mutateInitialConfiguration(t, x, func(c *initialGenesisConfiguration) {
				c.Accounts[0].PreparedFunding.SourceStateHash = strings.Repeat("0", 64)
			})
		}},
		{"uppercase source hash", func(x initialInputs) initialInputs {
			return mutateInitialConfiguration(t, x, func(c *initialGenesisConfiguration) {
				c.Accounts[0].PreparedFunding.SourceStateHash = strings.Repeat("A", 64)
			})
		}},
		{"faucet without prefix", func(x initialInputs) initialInputs {
			return mutateInitialConfiguration(t, x, func(c *initialGenesisConfiguration) {
				c.Accounts[0].PreparedFunding.FaucetHash = strings.Repeat("1", 64)
			})
		}},
		{"uppercase faucet hash", func(x initialInputs) initialInputs {
			return mutateInitialConfiguration(t, x, func(c *initialGenesisConfiguration) {
				c.Accounts[0].PreparedFunding.FaucetHash = "0x" + strings.Repeat("A", 64)
			})
		}},
		{"balance self-grant field", func(x initialInputs) initialInputs {
			x.genesis = bytes.Replace(x.genesis, []byte(`"sourceStateHash":`), []byte(`"balance":"100","sourceStateHash":`), 1)
			return repinInitialFixture(x)
		}},
		{"wrong network profile", func(x initialInputs) initialInputs {
			var original map[string]json.RawMessage
			must(t, json.Unmarshal(x.genesis, &original))
			original["chain_id"] = json.RawMessage(`"ynx_1-1"`)
			var err error
			x.genesis, err = json.Marshal(original)
			must(t, err)
			x.expected.NativeChainID = 1
			return repinInitialFixture(x)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, code := prepareInitial(tc.edit(in), initialMemberCapacity); code != resultPublicBinding {
				t.Fatal("invalid optional source-funding metadata accepted")
			}
		})
	}
}

func TestAccountInitialCABIProcess(t *testing.T) {
	mode := os.Getenv("YNX_INITIAL_CABI_FIXTURE_MODE")
	if mode == "" {
		return
	}
	directory := os.Getenv("YNX_INITIAL_CABI_FIXTURE_DIRECTORY")
	if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		t.Fatal("absolute synthetic initial fixture required")
	}
	write := func(name string, raw []byte) {
		t.Helper()
		f, err := os.OpenFile(filepath.Join(directory, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		must(t, err)
		n, err := f.Write(raw)
		if err != nil || n != len(raw) {
			_ = f.Close()
			t.Fatal("synthetic initial fixture write")
		}
		must(t, f.Sync())
		must(t, f.Close())
	}
	if mode == "generate" {
		must(t, os.Mkdir(directory, 0700))
		in, _, material := initialFixture(t)
		for name, raw := range map[string][]byte{"message.bin": in.message, "genesis.json": in.genesis, "genesis-sha256.bin": in.expected.GenesisSHA256, "pk-a.bin": material.PKA, "pk-b.bin": material.PKB, "SYNTHETIC-ONLY-a.der": material.PKCS8A, "SYNTHETIC-ONLY-b.der": material.PKCS8B} {
			write(name, raw)
		}
		funded := initialFundedFixture(t, in)
		for name, raw := range map[string][]byte{"funded-message.bin": funded.message, "funded-genesis.json": funded.genesis,
			"funded-genesis-sha256.bin": funded.expected.GenesisSHA256, "funded-network-id.bin": funded.expected.NetworkID} {
			write(name, raw)
		}
		return
	}
	if mode != "verify" {
		t.Fatal("unknown synthetic initial fixture operation")
	}
	read := func(name string, max int) []byte {
		t.Helper()
		path := filepath.Join(directory, name)
		info, err := os.Lstat(path)
		must(t, err)
		if !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() < 1 || info.Size() > int64(max) {
			t.Fatal("bounded synthetic initial fixture required")
		}
		raw, err := os.ReadFile(path)
		must(t, err)
		return raw
	}
	public := ynxbatch.PublicKey{PKA: read("pk-a.bin", ynxbatch.PublicKeyASize), PKB: read("pk-b.bin", ynxbatch.PublicKeyBSize)}
	in, _ := initialFixturePublic(t, public)
	if !bytes.Equal(in.genesis, read("genesis.json", initialGenesisMaximum)) || !bytes.Equal(in.expected.GenesisSHA256, read("genesis-sha256.bin", 32)) || !bytes.Equal(in.message, read("message.bin", initialMessageMaximum)) {
		t.Fatal("independent synthetic Genesis/intent original changed")
	}
	plan := requireInitialPlan(t, in)
	wire := read("memberOriginal.bin", initialMemberCapacity)
	must(t, inspectInitialMember(plan, wire))
	for _, branch := range []string{"A", "B"} {
		m, err := ynxbatch.DecodeMember(wire)
		must(t, err)
		if branch == "A" {
			m.Certificate.SigmaA[0] ^= 1
		} else {
			m.Certificate.SigmaB[0] ^= 1
		}
		bad, err := ynxbatch.EncodeMember(m)
		must(t, err)
		if _, err := ynxauth.VerifyPQInitialRegistrationPossession(bad, plan.trusted, plan.height); err == nil {
			t.Fatal("actual initial C output accepted corrupt AND branch")
		}
	}
	// This is a second real C call with the SAME borrowed pair/archive and a
	// source-prepared funded configuration. Independently check its original
	// synthetic source record, then only claim Native parsing and AND math.
	funded := initialInputs{message: read("funded-message.bin", initialMessageMaximum), genesis: read("funded-genesis.json", initialGenesisMaximum),
		expected: initialExpected{GenesisSHA256: read("funded-genesis-sha256.bin", 32), NetworkID: read("funded-network-id.bin", 32),
			Owner: in.expected.Owner, NativeChainID: 6423, ExecutionHeight: "2", PKA: public.PKA, PKB: public.PKB}}
	var fundedFields map[string]json.RawMessage
	must(t, json.Unmarshal(funded.genesis, &fundedFields))
	var source chain.ConsensusMigrationState
	must(t, json.Unmarshal(fundedFields["app_state"], &source))
	must(t, source.Validate())
	var fundingConfig initialGenesisConfiguration
	must(t, json.Unmarshal(fundedFields["pq_initial_accounts"], &fundingConfig))
	if len(fundingConfig.Accounts) != 1 || fundingConfig.Accounts[0].PreparedFunding == nil || source.Runtime == nil ||
		fundingConfig.Accounts[0].PreparedFunding.SourceStateHash != source.StateHash || source.OriginalGenesisHash != hex.EncodeToString(funded.expected.NetworkID) {
		t.Fatal("actual C funded fixture lost its original source tuple")
	}
	funding := fundingConfig.Accounts[0].PreparedFunding
	foundReceipt := 0
	for _, block := range source.Runtime.Blocks {
		for _, tx := range block.Transactions {
			if tx.Hash == funding.FaucetHash && tx.Type == "faucet" && tx.From == chain.FaucetAddress && tx.To == funded.expected.Owner && tx.Amount == 100 {
				foundReceipt++
			}
		}
	}
	if foundReceipt != 1 {
		t.Fatal("actual C funding fixture did not retain its normal Faucet receipt")
	}
	fundedPlan := requireInitialPlan(t, funded)
	fundedWire := read("fundedMemberOriginal.bin", initialMemberCapacity)
	must(t, inspectInitialMember(fundedPlan, fundedWire))
	fundedDigest := sha256.Sum256(fundedWire)
	digest := sha256.Sum256(wire)
	raw, err := json.Marshal(map[string]any{"version": "YNX-ACCOUNT-INITIAL-CABI-PUBLIC-INTEROP/v1", "classification": "synthetic-data", "actualCABIExecuted": true, "purpose": ynxauth.TransactionPurpose, "keyVersion": "1", "networkId": hex.EncodeToString(in.expected.NetworkID), "owner": in.expected.Owner, "nativeChainId": "6423", "executionHeight": "2", "genesisSHA256": hex.EncodeToString(in.expected.GenesisSHA256), "genesisOriginalBase64Url": base64.RawURLEncoding.EncodeToString(in.genesis), "messageOriginalBase64Url": base64.RawURLEncoding.EncodeToString(in.message), "memberOriginalBase64Url": base64.RawURLEncoding.EncodeToString(wire), "memberSHA256": hex.EncodeToString(digest[:]), "memberBytes": len(wire),
		"funded": map[string]any{"actualCABIExecuted": true, "networkId": hex.EncodeToString(funded.expected.NetworkID), "genesisSHA256": hex.EncodeToString(funded.expected.GenesisSHA256),
			"genesisOriginalBase64Url": base64.RawURLEncoding.EncodeToString(funded.genesis), "messageOriginalBase64Url": base64.RawURLEncoding.EncodeToString(funded.message),
			"memberOriginalBase64Url": base64.RawURLEncoding.EncodeToString(fundedWire), "memberSHA256": hex.EncodeToString(fundedDigest[:]), "memberBytes": len(fundedWire),
			"sourceStateHash": funding.SourceStateHash, "faucetHash": funding.FaucetHash, "bootstrapFundingAuthorized": false}, "rootGranted": false, "authorityGranted": false, "submitted": false})
	must(t, err)
	write("PUBLIC-INTEROP.json", append(raw, '\n'))
	raw, err = json.Marshal(map[string]any{"version": "YNX-ACCOUNT-INITIAL-CABI-RECEIPT/v1", "actualCABIExecuted": true, "goANDVerified": true, "memberSHA256": hex.EncodeToString(digest[:]), "memberBytes": len(wire),
		"actualFundedCABIExecuted": true, "fundedGoANDVerified": true, "fundedMemberSHA256": hex.EncodeToString(fundedDigest[:]), "fundedMemberBytes": len(fundedWire), "bootstrapFundingAuthorized": false,
		"privateUploaded": false, "rootGranted": false, "authorityGranted": false})
	must(t, err)
	write("PUBLIC-RECEIPT.json", append(raw, '\n'))
}
