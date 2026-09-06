package executionstate

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const testAddress = "0x1111111111111111111111111111111111111111"
const testAddress2 = "0x2222222222222222222222222222222222222222"

func zero(c catalog, name string) any {
	if s, ok := c.Types[name]; ok {
		switch s.Kind {
		case "alias":
			return zero(c, s.Elem)
		case "pointer":
			return nil
		case "slice":
			return []any{}
		case "map":
			return map[string]any{}
		case "struct":
			m := map[string]any{}
			for _, f := range s.Fields {
				if !f.Optional {
					m[f.Name] = zero(c, f.Type)
				}
			}
			return m
		}
	}
	switch name {
	case "string":
		return ""
	case "time.Time":
		return "2026-09-06T00:00:00Z"
	case "bool":
		return false
	case "any", "json.RawMessage":
		return nil
	}
	return json.Number("0")
}
func nativeFixture(t *testing.T) (map[string]any, Options) {
	t.Helper()
	c := catalogs()["native-a-v2"]
	m := zero(c, c.Root).(map[string]any)
	m["version"] = json.Number("2")
	cfg := obj(m["config"])
	cfg["chainId"] = json.Number("6423")
	cfg["slug"] = "testnet"
	cfg["nativeCurrencySymbol"] = "YNXT"
	cfg["decimals"] = json.Number("18")
	a := obj(zero(c, "chain.Account"))
	a["address"] = testAddress
	a["balance"] = json.Number("100")
	a["lots"] = map[string]any{"genesis-lot": json.Number("100")}
	m["accounts"] = map[string]any{testAddress: a}
	lot := obj(zero(c, "chain.TrustTraceLot"))
	lot["lotId"] = "genesis-lot"
	lot["amount"] = json.Number("100")
	m["lots"] = map[string]any{"genesis-lot": lot}
	genesis := digest([]byte("genesis\x00testnet\x006423\x00"))
	b := obj(zero(c, "chain.Block"))
	b["hash"] = genesis
	b["validator"] = testAddress
	m["blocks"] = []any{b}
	p, err := json.Marshal(chain.DefaultResourceMarketPolicy())
	if err != nil {
		t.Fatal(err)
	}
	m["resourceMarketPolicy"], err = decode(p)
	if err != nil {
		t.Fatal(err)
	}
	v := obj(zero(c, "chain.Validator"))
	v["address"], v["moniker"], v["active"], v["votingPower"] = testAddress, "fixture", true, json.Number("1")
	m["validators"] = []any{v}
	return m, Options{SourceFamily: "native-a-v2", SourceCommit: c.Commit, TargetFamily: "native-a-v2", CommittedHeight: "0", CommittedHash: genesis, Durability: "confirmed", Marker: []byte("2\n")}
}
func seal(t *testing.T, m map[string]any, o Options) ([]byte, Options) {
	t.Helper()
	c := catalogs()[o.SourceFamily]
	if strings.HasPrefix(o.SourceFamily, "native-") {
		m["stateIntegrity"] = ""
		b, e := typedJSON(c, c.Root, m)
		if e != nil {
			t.Fatal(e)
		}
		if c.Version == 2 {
			m["stateIntegrity"] = digest(append(append([]byte(c.Domain), 0), b...))
		}
	} else {
		doc := cloneMap(m)
		doc["domain"] = c.Domain
		b, e := typedJSON(c, c.HashRoot, doc)
		if e != nil {
			t.Fatal(e)
		}
		m["appHash"] = digest(b)
		o.CommittedHash = str(m["appHash"])
	}
	b, e := json.Marshal(m)
	if e != nil {
		t.Fatal(e)
	}
	o.ExpectedSHA256 = digest(b)
	return b, o
}
func has(r Report, code string) bool {
	for _, e := range r.Issues {
		if strings.HasPrefix(e.Code, code) {
			return true
		}
	}
	return false
}

func TestNativeStaticCompatibilityIsNotMigrationApproval(t *testing.T) {
	m, o := nativeFixture(t)
	b, o := seal(t, m, o)
	r := Audit(b, o)
	if r.Status != "compatible" || r.MigrationSafe || !r.Verified.SchemaVerified || !r.Verified.EmbeddedIntegrityVerified || r.Verified.SourceCommitProven || r.Verified.DurabilityProven || r.Verified.CommittedStateBindingProven {
		t.Fatalf("unexpected report: status=%s issues=%+v", r.Status, r.Issues)
	}
	if r.Amounts["accountLiquidWei"] != "100000000000000000000" {
		t.Fatal(r.Amounts)
	}
	o.TargetFamily = "vnext"
	r = Audit(b, o)
	if r.Status != "blocked" || !has(r, "TARGET_SCHEMA_NOT_IMPLEMENTED") || len(r.MissingTargetModules) != len(catalogs()[o.SourceFamily].Types["chain.devnetSnapshot"].Fields) {
		t.Fatal(r)
	}
}

func TestBaselineHasItsOwnExactSourcePin(t *testing.T) {
	m, o := nativeFixture(t)
	baseline := catalogs()["native-baseline-v2"]
	if schemaFingerprint(baseline, baseline.Root) != schemaFingerprint(catalogs()[o.SourceFamily], baseline.Root) {
		t.Fatal("baseline/candidate schema difference needs explicit handling")
	}
	o.SourceFamily, o.TargetFamily, o.SourceCommit = "native-baseline-v2", "native-baseline-v2", baseline.Commit
	b, o := seal(t, m, o)
	r := Audit(b, o)
	if r.Status != "compatible" || !r.Verified.EmbeddedIntegrityVerified || r.Verified.SourceCommitProven {
		t.Fatal(r.Issues)
	}
	o.SourceCommit = catalogs()["native-a-v2"].Commit
	if !has(Audit(b, o), "SOURCE_COMMIT_NOT_CATALOGUED") {
		t.Fatal("source commit was silently relabeled")
	}
}

func TestRealSourceSnapshotHashAndFullSchemaParity(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	b, e := d.ReplicationSnapshotJSON()
	if e != nil {
		t.Fatal(e)
	}
	m, e := decode(b)
	if e != nil {
		t.Fatal(e)
	}
	blocks := arr(m["blocks"])
	last := obj(blocks[len(blocks)-1])
	r := Audit(b, Options{SourceFamily: "native-a-v2", SourceCommit: catalogs()["native-a-v2"].Commit, TargetFamily: "vnext", ExpectedSHA256: digest(b), CommittedHeight: num(last["height"]).String(), CommittedHash: str(last["hash"]), Durability: "confirmed", Marker: []byte("2\n")})
	if !r.Verified.SchemaVerified || !r.Verified.EmbeddedIntegrityVerified {
		t.Fatalf("real-source serialization not independently reproduced: %+v", r.Issues)
	}
	if r.Status != "blocked" || r.MigrationSafe {
		t.Fatal("source snapshot is not a migration authorization")
	}
}

func TestRealInMemoryPendingAlreadyChangesBalanceAtOldHeight(t *testing.T) {
	// This source fixture has no persistence path, network connection or signer.
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet(testAddress, 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	before, _ := d.Account(testAddress)
	if _, err := d.Transfer(testAddress, testAddress2, 7); err != nil {
		t.Fatal(err)
	}
	after, _ := d.Account(testAddress)
	if before.Balance != 100 || after.Balance != 92 || after.Nonce != before.Nonce+1 {
		t.Fatal("real source pending semantics changed")
	}
	b, err := d.ReplicationSnapshotJSON()
	if err != nil {
		t.Fatal(err)
	}
	m, _ := decode(b)
	last := obj(arr(m["blocks"])[len(arr(m["blocks"]))-1])
	r := Audit(b, Options{SourceFamily: "native-a-v2", SourceCommit: catalogs()["native-a-v2"].Commit, TargetFamily: "native-a-v2", ExpectedSHA256: digest(b), CommittedHeight: "1", CommittedHash: str(last["hash"]), Durability: "confirmed", Marker: []byte("2\n")})
	if r.ObservedHeight != "1" || !r.Verified.EmbeddedIntegrityVerified || !r.Verified.AnchorMatchesDeclaration || !has(r, "PENDING_STATE_ALREADY_MAY_AFFECT_BALANCES") || r.Status != "blocked" || r.MigrationSafe {
		t.Fatal(r.Issues)
	}
	if has(r, "BLOCK_HASH_PREIMAGE_MISMATCH") {
		t.Fatal("source producer preimage was not reproduced")
	}
}

func TestFailClosedBoundaryMatrix(t *testing.T) {
	cases := []struct {
		name, code string
		change     func(map[string]any, *Options)
	}{
		{"pending_already_in_balance_old_height", "PENDING_STATE_ALREADY", func(m map[string]any, o *Options) {
			tx := zero(catalogs()[o.SourceFamily], "chain.Transaction")
			m["pending"] = []any{tx}
			a := obj(obj(m["accounts"])[testAddress])
			a["balance"] = json.Number("99")
			a["lots"] = map[string]any{"genesis-lot": json.Number("99")}
		}},
		{"height_mismatch", "DECLARED_ANCHOR_MISMATCH", func(m map[string]any, o *Options) { o.CommittedHeight = "1" }},
		{"wrong_chain", "NETWORK_IDENTITY", func(m map[string]any, o *Options) { obj(m["config"])["chainId"] = json.Number("9102") }},
		{"unknown_module", "UNKNOWN_FIELD", func(m map[string]any, o *Options) { m["privateFutureModule"] = map[string]any{"secret": "never print"} }},
		{"unknown_nested_field", "UNKNOWN_FIELD", func(m map[string]any, o *Options) {
			obj(obj(m["accounts"])[testAddress])["futureLocked"] = json.Number("1")
		}},
		{"missing_nonoptional", "MISSING_FIELD", func(m map[string]any, o *Options) { delete(m, "payIntents") }},
		{"negative_balance", "NEGATIVE_ACCOUNT_AMOUNT", func(m map[string]any, o *Options) {
			obj(obj(m["accounts"])[testAddress])["balance"] = json.Number("-1")
		}},
		{"lot_delta", "LOT_BALANCE_DELTA", func(m map[string]any, o *Options) {
			obj(obj(m["accounts"])[testAddress])["balance"] = json.Number("99")
		}},
		{"missing_lot_metadata", "LOT_METADATA_MISSING", func(m map[string]any, o *Options) { m["lots"] = map[string]any{} }},
		{"missing_marker", "V2_MARKER_MISSING", func(m map[string]any, o *Options) { o.Marker = nil }},
		{"invalid_policy", "RESOURCE_POLICY_INVALID", func(m map[string]any, o *Options) { obj(m["resourceMarketPolicy"])["bandwidthUnit"] = json.Number("0") }},
		{"missing_validators", "ACTIVE_VALIDATOR_POWER_MISSING", func(m map[string]any, o *Options) { m["validators"] = []any{} }},
		{"nonce_without_committed_history", "ACCOUNT_NONCE_HISTORY_MISSING", func(m map[string]any, o *Options) { obj(obj(m["accounts"])[testAddress])["nonce"] = json.Number("1") }},
		{"negative_lot_metadata", "LOT_METADATA_INVALID", func(m map[string]any, o *Options) { obj(obj(m["lots"])["genesis-lot"])["amount"] = json.Number("-1") }},
		{"uncertain", "DURABILITY_UNCONFIRMED", func(m map[string]any, o *Options) { o.Durability = "uncertain" }},
		{"wrong_commit", "SOURCE_COMMIT_NOT_CATALOGUED", func(m map[string]any, o *Options) { o.SourceCommit = strings.Repeat("f", 40) }},
		{"version_family_conflict", "SCHEMA_VERSION_FAMILY_MISMATCH", func(m map[string]any, o *Options) { m["version"] = json.Number("13") }},
		{"map_key_mismatch", "ACCOUNT_MAP_KEY_MISMATCH", func(m map[string]any, o *Options) {
			a := obj(obj(m["accounts"])[testAddress])
			a["address"] = testAddress2
		}},
		{"alias_duplicate", "DUPLICATE_ACCOUNT_ALIAS", func(m map[string]any, o *Options) {
			alias, _ := accountaddress.Encode(testAddress)
			a := cloneMap(obj(obj(m["accounts"])[testAddress]))
			a["address"] = alias
			obj(m["accounts"])[alias] = a
		}},
		{"business_payload", "MODULE_INVARIANTS_UNVERIFIED", func(m map[string]any, o *Options) {
			p := zero(catalogs()[o.SourceFamily], "chain.PayIntent")
			m["payIntents"] = map[string]any{"test": p}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m, o := nativeFixture(t)
			tc.change(m, &o)
			b, o := seal(t, m, o)
			r := Audit(b, o)
			if r.Status != "blocked" || !has(r, tc.code) {
				t.Fatalf("expected %s: %+v", tc.code, r.Issues)
			}
		})
	}
}

func TestParserRejectsDuplicatesFractionsOverflowAndSecrets(t *testing.T) {
	m, o := nativeFixture(t)
	b, o := seal(t, m, o)
	for _, tc := range []struct {
		name string
		data []byte
		code string
	}{
		{"duplicate", bytes.Replace(b, []byte(`"balance":100`), []byte(`"balance":100,"balance":99`), 1), "DUPLICATE_JSON_KEY"},
		{"fraction", bytes.Replace(b, []byte(`"balance":100`), []byte(`"balance":1.5`), 1), "EXPECTED_EXACT_INTEGER"},
		{"exponent", bytes.Replace(b, []byte(`"balance":100`), []byte(`"balance":1e2`), 1), "EXPECTED_EXACT_INTEGER"},
		{"overflow", bytes.Replace(b, []byte(`"balance":100`), []byte(`"balance":9223372036854775808`), 1), "INTEGER_OUT_OF_RANGE"},
		{"nonce_overflow", bytes.Replace(b, []byte(`"nonce":0`), []byte(`"nonce":18446744073709551616`), 1), "INTEGER_OUT_OF_RANGE"},
		{"quoted_integer", bytes.Replace(b, []byte(`"balance":100`), []byte(`"balance":"100"`), 1), "EXPECTED_EXACT_INTEGER"},
		{"null_integer", bytes.Replace(b, []byte(`"balance":100`), []byte(`"balance":null`), 1), "EXPECTED_EXACT_INTEGER"},
		{"trailing", append(append([]byte{}, b...), []byte(` {}`)...), "TRAILING_JSON"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := Audit(tc.data, o)
			if !has(r, tc.code) {
				t.Fatalf("expected %s: %+v", tc.code, r.Issues)
			}
		})
	}
	m["confidential-unexpected-field"] = map[string]any{"mnemonic": "do-not-print-test-secret"}
	bad, _ := json.Marshal(m)
	r := Audit(bad, o)
	report, _ := json.Marshal(r)
	for _, s := range []string{"do-not-print-test-secret", "confidential-unexpected-field", testAddress} {
		if bytes.Contains(report, []byte(s)) {
			t.Fatalf("report leaked %s", s)
		}
	}
}

func TestCanonicalComparisonUsesContentsNotCounts(t *testing.T) {
	m, o := nativeFixture(t)
	original, o := seal(t, m, o)
	o.Reference = original
	r1 := Audit(original, o)
	if r1.Verified.ReferenceEquivalent == nil || !*r1.Verified.ReferenceEquivalent {
		t.Fatal(r1)
	}
	a := obj(obj(m["accounts"])[testAddress])
	a["nonce"] = json.Number("1")
	changed, o := seal(t, m, o)
	r2 := Audit(changed, o)
	if !has(r2, "REFERENCE_CONTENT_DIFFERS") || r1.AccountStateSHA256 == r2.AccountStateSHA256 {
		t.Fatal("same count hid changed nonce")
	}
	var formatted bytes.Buffer
	if e := json.Indent(&formatted, original, "", "  "); e != nil {
		t.Fatal(e)
	}
	o.ExpectedSHA256 = digest(formatted.Bytes())
	r3 := Audit(formatted.Bytes(), o)
	if r3.CanonicalSHA256 != r1.CanonicalSHA256 || r3.Verified.ReferenceEquivalent == nil || !*r3.Verified.ReferenceEquivalent {
		t.Fatal("whitespace changed semantic comparison")
	}
}

func TestBlockPreimageAndNonceHistoryDoNotProveExecution(t *testing.T) {
	m, o := nativeFixture(t)
	c := catalogs()[o.SourceFamily]
	b := obj(zero(c, "chain.Block"))
	b["height"], b["parentHash"], b["validator"] = json.Number("1"), o.CommittedHash, testAddress
	ts, _ := time.Parse(time.RFC3339Nano, str(b["time"]))
	tx := obj(zero(c, "chain.Transaction"))
	tx["hash"], tx["from"], tx["nonce"], tx["blockNumber"] = "fixture-transaction", testAddress, json.Number("1"), json.Number("1")
	b["hash"] = hashParts("block", "1", o.CommittedHash, fmt.Sprint(ts.UnixNano()), "1", testAddress)
	tx["blockHash"], b["transactions"] = b["hash"], []any{tx}
	m["blocks"] = append(arr(m["blocks"]), b)
	obj(obj(m["accounts"])[testAddress])["nonce"] = json.Number("1")
	o.CommittedHeight, o.CommittedHash = "1", str(b["hash"])
	data, o := seal(t, m, o)
	r := Audit(data, o)
	if !r.Verified.EmbeddedIntegrityVerified || !r.Verified.AnchorMatchesDeclaration || !has(r, "EXECUTED_STATE_REPLAY_NOT_IMPLEMENTED") || has(r, "BLOCK_HASH_PREIMAGE_MISMATCH") || has(r, "ACCOUNT_NONCE_HISTORY_MISMATCH") || r.MigrationSafe {
		t.Fatal(r.Issues)
	}
	// Resealing the snapshot and declaring its new hash cannot authenticate a
	// forged block preimage or the claimed account state at this height.
	b["hash"], tx["blockHash"] = strings.Repeat("a", 64), strings.Repeat("a", 64)
	o.CommittedHash = str(b["hash"])
	data, o = seal(t, m, o)
	if !has(Audit(data, o), "BLOCK_HASH_PREIMAGE_MISMATCH") {
		t.Fatal("forged self-sealed block passed")
	}
	b["hash"], tx["blockHash"] = hashParts("block", "1", str(b["parentHash"]), fmt.Sprint(ts.UnixNano()), "1", testAddress), hashParts("block", "1", str(b["parentHash"]), fmt.Sprint(ts.UnixNano()), "1", testAddress)
	o.CommittedHash = str(b["hash"])
	obj(obj(m["accounts"])[testAddress])["nonce"] = json.Number("2")
	data, o = seal(t, m, o)
	if !has(Audit(data, o), "ACCOUNT_NONCE_HISTORY_MISMATCH") {
		t.Fatal("uncommitted account nonce accepted")
	}
}

func TestNativeDEXEscrowUsesExactUppercaseAssetIdentity(t *testing.T) {
	m, o := nativeFixture(t)
	c := catalogs()[o.SourceFamily]
	pool := obj(zero(c, "chain.NativeDexPool"))
	pool["id"], pool["asset0"], pool["asset1"] = "dex_fixture", "YNXT", "usd-test"
	pool["reserve0"], pool["nativeLots0"] = json.Number("7"), map[string]any{"genesis-lot": json.Number("7")}
	m["dexPools"] = map[string]any{"dex_fixture": pool}
	b, o := seal(t, m, o)
	r := Audit(b, o)
	if r.Amounts["dexNativeEscrowYNXT"] != "7" || !has(r, "MODULE_INVARIANTS_UNVERIFIED") {
		t.Fatal(r.Amounts, r.Issues)
	}
	pool["nativeLots0"] = map[string]any{"genesis-lot": json.Number("6")}
	b, o = seal(t, m, o)
	if !has(Audit(b, o), "DEX_NATIVE_LOT_RESERVE_MISMATCH") {
		t.Fatal("native escrow provenance delta accepted")
	}
}

func TestExactMaximumBalancesAndNonNativeDecimals(t *testing.T) {
	m, o := nativeFixture(t)
	a := obj(obj(m["accounts"])[testAddress])
	a["balance"] = json.Number("9223372036854775807")
	a["nonce"] = json.Number("18446744073709551615")
	a["lots"] = map[string]any{"genesis-lot": json.Number("9223372036854775807")}
	c := catalogs()[o.SourceFamily]
	token := obj(zero(c, "chain.NativeDexAsset"))
	token["id"] = "usd-test"
	token["decimals"] = json.Number("6")
	token["maxSupply"] = json.Number("1000000")
	token["totalSupply"] = json.Number("123456")
	m["dexAssets"] = map[string]any{"usd-test": token}
	m["dexBalances"] = map[string]any{"usd-test": map[string]any{testAddress: json.Number("123456")}}
	b, o := seal(t, m, o)
	r := Audit(b, o)
	if !r.Verified.SchemaVerified || r.Amounts["accountLiquidWei"] != "9223372036854775807000000000000000000" || !has(r, "ACCOUNT_NONCE_HISTORY_MISSING") || !has(r, "MODULE_INVARIANTS_UNVERIFIED") {
		t.Fatalf("exact boundary: amounts=%+v issues=%+v", r.Amounts, r.Issues)
	}
	token["totalSupply"] = json.Number("123457")
	b, o = seal(t, m, o)
	if !has(Audit(b, o), "DEX_TOKEN_SUPPLY_MISMATCH") {
		t.Fatal("same asset count hid token supply mismatch")
	}
}

func TestDEXSelfTransferInflationIncludesAllPoolSidesAndExcludesShares(t *testing.T) {
	m, o := nativeFixture(t)
	c := catalogs()[o.SourceFamily]
	asset := obj(zero(c, "chain.NativeDexAsset"))
	asset["id"], asset["decimals"], asset["maxSupply"], asset["totalSupply"] = "usd-test", json.Number("6"), json.Number("10000"), json.Number("10000")
	m["dexAssets"] = map[string]any{"usd-test": asset}
	balances := map[string]any{testAddress: json.Number("8000")}
	m["dexBalances"] = map[string]any{"usd-test": balances}
	pools := map[string]any{}
	for i := 0; i < 2; i++ {
		p := obj(zero(c, "chain.NativeDexPool"))
		id := fmt.Sprintf("dex_fixture_%d", i)
		p["id"], p["totalShares"], p["shares"] = id, json.Number("1000"), map[string]any{testAddress: json.Number("1000")}
		if i == 0 {
			p["asset0"], p["asset1"], p["reserve0"] = "usd-test", "YNXT", json.Number("1000")
		} else {
			p["asset0"], p["asset1"], p["reserve1"] = "YNXT", "usd-test", json.Number("1000")
		}
		pools[id] = p
	}
	m["dexPools"] = pools
	b, o := seal(t, m, o)
	r := Audit(b, o)
	if has(r, "DEX_TOKEN_SUPPLY_MISMATCH") || len(r.AssetReconciliations) != 1 || !r.AssetReconciliations[0].Balanced || r.AssetReconciliations[0].PoolReserves != "2000" || r.AssetReconciliations[0].TotalHoldings != "10000" {
		t.Fatal(r.AssetReconciliations, r.Issues)
	}
	balances[testAddress] = json.Number("8050")
	b, o = seal(t, m, o)
	r = Audit(b, o)
	if r.Status != "blocked" || !has(r, "DEX_TOKEN_SUPPLY_MISMATCH") || r.AssetReconciliations[0].HoldingsMinusSupply != "50" || r.AssetReconciliations[0].Balanced || r.Amounts["accountLiquidStoredInteger"] != "100" {
		t.Fatal(r.AssetReconciliations, r.Issues)
	}
}

func TestABCISeparateFamiliesAndFullModuleCoverage(t *testing.T) {
	for _, family := range []string{"abci-a-v14", "abci-c-v13"} {
		t.Run(family, func(t *testing.T) {
			c := catalogs()[family]
			m := obj(zero(c, c.Root))
			m["version"] = json.Number(fmt.Sprint(c.Version))
			m["chainId"] = json.Number("6423")
			m["initialized"] = true
			m["migrationStateHash"] = strings.Repeat("a", 64)
			a := obj(zero(c, "chain.ConsensusAccount"))
			a["address"] = testAddress
			m["accounts"] = []any{a}
			o := Options{SourceFamily: family, SourceCommit: c.Commit, TargetFamily: family, CommittedHeight: "0", Durability: "confirmed"}
			b, o := seal(t, m, o)
			r := Audit(b, o)
			if !r.Verified.SchemaVerified || !r.Verified.EmbeddedIntegrityVerified || !has(r, "ABCI_AMOUNT_UNIT_MAPPING_NOT_FROZEN") {
				t.Fatal(r)
			}
			if len(r.Modules) != len(c.Types[c.Root].Fields) {
				t.Fatal("lost root field")
			}
			// The actual ABCI hash document excludes Height. Matching a caller's
			// edited height declaration must not become an attested commitment.
			m["height"] = json.Number("7")
			edited, _ := json.Marshal(m)
			o.CommittedHeight, o.ExpectedSHA256 = "7", digest(edited)
			heightOnly := Audit(edited, o)
			if !heightOnly.Verified.EmbeddedIntegrityVerified || !heightOnly.Verified.AnchorMatchesDeclaration || heightOnly.Verified.CommittedStateBindingProven || heightOnly.MigrationSafe {
				t.Fatal("height declaration became consensus evidence")
			}
			if family == "abci-c-v13" {
				o.TargetFamily = "abci-a-v14"
				r = Audit(b, o)
				for _, required := range []string{"smartAccounts", "strategyVaults", "strategyMandates", "paymasters", "stakeDelegations", "unbondings", "userOperationEvents", "assetAuditEvents"} {
					found := false
					for _, v := range r.MissingTargetModules {
						found = found || v == required
					}
					if !found {
						t.Fatalf("missing lost module %s", required)
					}
				}
				o.SourceFamily = "abci-a-v14"
				if !has(Audit(b, o), "UNKNOWN_FIELD") {
					t.Fatal("accepted C snapshot as A")
				}
			}
		})
	}
}

func TestLegacyDowngradeNeverAcceptsMarkerAsProof(t *testing.T) {
	m, o := nativeFixture(t)
	o.SourceFamily = "native-a-v1"
	o.TargetFamily = "native-a-v1"
	m["version"] = json.Number("1")
	b, o := seal(t, m, o)
	r := Audit(b, o)
	if !has(r, "INTEGRITY_DOWNGRADE") || !has(r, "LEGACY_STATE_INTEGRITY_UNAVAILABLE") || r.Verified.EmbeddedIntegrityVerified {
		t.Fatal(r)
	}
}
