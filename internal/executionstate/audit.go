package executionstate

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

type Options struct {
	SourceFamily    string `json:"sourceFamily"`
	SourceCommit    string `json:"sourceCommit"`
	TargetFamily    string `json:"targetFamily"`
	ExpectedSHA256  string `json:"expectedSha256"`
	CommittedHeight string `json:"committedHeight"`
	CommittedHash   string `json:"committedHash"`
	Durability      string `json:"durability"`
	Marker          []byte `json:"-"`
	Reference       []byte `json:"-"`
}
type Issue struct {
	Code   string `json:"code"`
	Module string `json:"module,omitempty"`
}
type Module struct {
	Name      string `json:"name"`
	Present   bool   `json:"present"`
	Records   int    `json:"records"`
	SHA256    string `json:"sha256,omitempty"`
	Treatment string `json:"treatment"`
}
type Verification struct {
	InputReadComplete           bool  `json:"inputReadComplete"`
	SchemaVerified              bool  `json:"schemaVerified"`
	FullModuleInventoryVerified bool  `json:"fullModuleInventoryVerified"`
	DigestMatchesDeclaration    bool  `json:"digestMatchesDeclaration"`
	EmbeddedIntegrityVerified   bool  `json:"embeddedIntegrityVerified"`
	MarkerVerified              bool  `json:"markerVerified"`
	AnchorMatchesDeclaration    bool  `json:"anchorMatchesDeclaration"`
	SourceCommitProven          bool  `json:"sourceCommitProven"`
	DurabilityProven            bool  `json:"durabilityProven"`
	CommittedStateBindingProven bool  `json:"committedStateBindingProven"`
	ReferenceEquivalent         *bool `json:"referenceEquivalent,omitempty"`
}
type AssetReconciliation struct {
	AssetIDSHA256       string `json:"assetIdSha256"`
	Decimals            string `json:"decimals"`
	AccountBalances     string `json:"accountBalancesStoredInteger"`
	PoolReserves        string `json:"poolReservesStoredInteger"`
	TotalHoldings       string `json:"totalHoldingsStoredInteger"`
	DeclaredSupply      string `json:"snapshotTotalSupplyStoredInteger"`
	HoldingsMinusSupply string `json:"holdingsMinusSupplyStoredInteger"`
	Balanced            bool   `json:"balanced"`
}
type Report struct {
	Schema                string                `json:"schema"`
	Status                string                `json:"status"`
	CompatibilityScope    string                `json:"compatibilityScope"`
	MigrationSafe         bool                  `json:"migrationSafe"`
	Declared              Options               `json:"declared"`
	Verified              Verification          `json:"verified"`
	CatalogCommit         string                `json:"catalogCommit,omitempty"`
	InputSHA256           string                `json:"inputSha256"`
	InputBytes            int64                 `json:"inputBytes"`
	CanonicalSHA256       string                `json:"canonicalSha256,omitempty"`
	ContentTreeSHA256     string                `json:"contentTreeSha256,omitempty"`
	ModuleDigestAlgorithm string                `json:"moduleDigestAlgorithm,omitempty"`
	Streaming             *StreamEvidence       `json:"streaming,omitempty"`
	NativeLedger          *NativeLedgerEvidence `json:"nativeLedger,omitempty"`
	AccountStateSHA256    string                `json:"accountStateSha256,omitempty"`
	ObservedHeight        string                `json:"observedHeight,omitempty"`
	Amounts               map[string]string     `json:"amounts"`
	AssetReconciliations  []AssetReconciliation `json:"assetReconciliations"`
	Modules               []Module              `json:"modules"`
	MissingTargetModules  []string              `json:"missingTargetModules"`
	UnverifiedModules     []string              `json:"unverifiedModules,omitempty"`
	Issues                []Issue               `json:"issues"`
	Limitations           []string              `json:"limitations"`
	issueKeys             map[string]struct{}
}

func digest(b []byte) string   { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }
func hashJSON(v any) string    { b, _ := json.Marshal(v); return digest(b) }
func obj(v any) map[string]any { m, _ := v.(map[string]any); return m }
func arr(v any) []any          { a, _ := v.([]any); return a }
func str(v any) string         { s, _ := v.(string); return s }
func num(v any) *big.Int {
	n, ok := v.(json.Number)
	if !ok {
		return new(big.Int)
	}
	z, ok := new(big.Int).SetString(string(n), 10)
	if !ok {
		return new(big.Int)
	}
	return z
}
func records(v any) int {
	switch x := v.(type) {
	case nil:
		return 0
	case []any:
		return len(x)
	case map[string]any:
		return len(x)
	case string:
		if x == "" {
			return 0
		}
	}
	return 1
}
func (r *Report) issue(code, module string) {
	if r.issueKeys == nil {
		r.issueKeys = map[string]struct{}{}
		for _, v := range r.Issues {
			r.issueKeys[v.Code+"\x00"+v.Module] = struct{}{}
		}
	}
	key := code + "\x00" + module
	if _, exists := r.issueKeys[key]; exists {
		return
	}
	r.issueKeys[key] = struct{}{}
	r.Issues = append(r.Issues, Issue{code, module})
}

// Audit checks supplied bytes against an immutable source-family schema and the
// explicitly implemented invariants. A compatible result is not a migration
// approval: provenance, fsync and a consensus commitment cannot be proven by a
// self-authenticating snapshot or operator flags.
func Audit(data []byte, o Options) Report {
	if o.TargetFamily == "" {
		o.TargetFamily = "vnext"
	}
	r := Report{Schema: "ynx.offline-state-preflight.v1", Status: "blocked", CompatibilityScope: "frozen-schema-and-offline-reconciliation-only", Declared: o, InputSHA256: digest(data), InputBytes: int64(len(data)), Amounts: map[string]string{}, AssetReconciliations: []AssetReconciliation{}, Modules: []Module{}, MissingTargetModules: []string{}, Issues: []Issue{}, Limitations: []string{
		"No state is migrated or emitted; migrationSafe is always false.",
		"Source commit, committed anchor and durability are operator declarations, not attestations.",
		"Embedded hashes verify content consistency, not trusted provenance or consensus finality. ABCI AppHash excludes height.",
		"Native block hashes commit header fields and transaction count, not transaction contents; no complete execution replay or Ethereum raw/nonce verification is implemented.",
		"Account liquid, staking, lot and DEX escrow totals are separate categories, not a verified global supply or a uint256 vNext state.",
		"Business modules without dedicated invariant checkers are inventoried by complete content hash and block semantic acceptance when populated.",
		"No canonical vNext execution schema exists in this candidate; selecting vnext always blocks.",
	}}
	r.Verified.InputReadComplete = true
	r.ModuleDigestAlgorithm = "canonical-json-sha256-v1"
	cs := catalogs()
	c, ok := cs[o.SourceFamily]
	if !ok {
		r.issue("UNKNOWN_SOURCE_FAMILY", "")
		return r
	}
	r.CatalogCommit = c.Commit
	if o.SourceCommit != c.Commit {
		r.issue("SOURCE_COMMIT_NOT_CATALOGUED", "")
	}
	if o.ExpectedSHA256 != r.InputSHA256 {
		r.issue("INPUT_DIGEST_MISMATCH_OR_MISSING", "")
	} else {
		r.Verified.DigestMatchesDeclaration = true
	}
	if o.Durability != "confirmed" {
		r.issue("DURABILITY_UNCONFIRMED", "")
	}
	m, e := decode(data)
	if e != nil {
		r.issue(e.Error(), "")
		return r
	}
	if e = strict(c, c.Root, m, "snapshot"); e != nil {
		r.issue(e.Error(), "")
		return r
	}
	r.Verified.SchemaVerified = true
	r.CanonicalSHA256 = hashJSON(m)
	if num(m["version"]).String() != new(big.Int).SetInt64(int64(c.Version)).String() {
		r.issue("SCHEMA_VERSION_FAMILY_MISMATCH", "version")
	}
	native := strings.HasPrefix(o.SourceFamily, "native-")
	if native {
		cfg := obj(m["config"])
		if num(cfg["chainId"]).String() != "6423" || str(cfg["slug"]) != "testnet" || str(cfg["nativeCurrencySymbol"]) != "YNXT" || num(cfg["decimals"]).String() != "18" {
			r.issue("NETWORK_IDENTITY_MISMATCH", "config")
		}
		if string(o.Marker) == "2\n" {
			r.Verified.MarkerVerified = true
		} else {
			r.issue("V2_MARKER_MISSING_OR_INVALID", "stateIntegrity")
		}
		if c.Version < 2 {
			r.issue("LEGACY_STATE_INTEGRITY_UNAVAILABLE", "stateIntegrity")
			if len(o.Marker) > 0 {
				r.issue("INTEGRITY_DOWNGRADE", "version")
			}
		} else {
			clone := cloneMap(m)
			clone["stateIntegrity"] = ""
			b, err := typedJSON(c, c.Root, clone)
			if err == nil && digest(append(append([]byte(c.Domain), 0), b...)) == str(m["stateIntegrity"]) {
				r.Verified.EmbeddedIntegrityVerified = true
			} else {
				r.issue("STATE_INTEGRITY_MISMATCH", "stateIntegrity")
			}
		}
		r.nativeHistory(m, o)
		r.nativePolicyAndValidators(m, c)
	} else {
		r.issue("ABCI_MIGRATION_ANCHOR_NOT_PROVIDED", "migrationStateHash")
		if num(m["chainId"]).String() != "6423" {
			r.issue("NETWORK_IDENTITY_MISMATCH", "chainId")
		}
		if m["initialized"] != true {
			r.issue("UNINITIALIZED_STATE_REQUIRES_MIGRATION_ANCHOR", "initialized")
		} else {
			hm := cloneMap(m)
			hm["domain"] = c.Domain
			b, err := typedJSON(c, c.HashRoot, hm)
			if err == nil && digest(b) == str(m["appHash"]) {
				r.Verified.EmbeddedIntegrityVerified = true
			} else {
				r.issue("APP_HASH_MISMATCH", "appHash")
			}
		}
		r.ObservedHeight = num(m["height"]).String()
		if r.ObservedHeight == o.CommittedHeight && str(m["appHash"]) == o.CommittedHash && validHash(o.CommittedHash) {
			r.Verified.AnchorMatchesDeclaration = true
		} else {
			r.issue("DECLARED_ANCHOR_MISMATCH", "height")
		}
		if num(m["height"]).Sign() < 0 {
			r.issue("NEGATIVE_HEIGHT", "height")
		}
	}
	r.accounts(m, native)
	r.dex(m, native)
	// All root fields are tracked, even metadata and absent optional modules.
	target, targetOK := cs[o.TargetFamily]
	targetFields := map[string]field{}
	if targetOK {
		for _, f := range target.Types[target.Root].Fields {
			targetFields[f.Name] = f
		}
	}
	safe := map[string]bool{"version": true, "savedAt": true, "stateIntegrity": true, "config": true, "chainId": true, "height": true, "appHash": true, "migrationStateHash": true, "initialized": true, "accounts": true, "pending": true, "blocks": true, "lots": true}
	if native {
		safe["resourceMarketPolicy"], safe["validators"] = true, true
	}
	for _, f := range c.Types[c.Root].Fields {
		v, present := m[f.Name]
		entry := Module{Name: f.Name, Present: present, Records: records(v), Treatment: "content-inventoried"}
		if present {
			entry.SHA256 = hashJSON(v)
		}
		if !safe[f.Name] && entry.Records > 0 {
			entry.Treatment = "content-preserved-in-input; invariant-checker-required"
			r.issue("MODULE_INVARIANTS_UNVERIFIED", f.Name)
		}
		if !targetOK {
			r.MissingTargetModules = append(r.MissingTargetModules, f.Name)
		} else if tf, exists := targetFields[f.Name]; !exists {
			r.MissingTargetModules = append(r.MissingTargetModules, f.Name)
		} else if schemaFingerprint(c, f.Type) != schemaFingerprint(target, tf.Type) {
			r.issue("TARGET_FIELD_SCHEMA_DIFFERS", f.Name)
		}
		r.Modules = append(r.Modules, entry)
	}
	if !targetOK {
		r.issue("TARGET_SCHEMA_NOT_IMPLEMENTED", "")
	} else if len(r.MissingTargetModules) > 0 {
		r.issue("TARGET_MODULES_MISSING", "")
	}
	r.Verified.FullModuleInventoryVerified = true
	if o.TargetFamily != o.SourceFamily {
		r.issue("CROSS_FAMILY_SEMANTIC_MAPPING_NOT_IMPLEMENTED", "")
	}
	if len(o.Reference) > 0 {
		same := false
		ref, err := decode(o.Reference)
		if err != nil || strict(c, c.Root, ref, "reference") != nil {
			r.issue("REFERENCE_SCHEMA_INVALID", "")
		} else {
			same = hashJSON(ref) == r.CanonicalSHA256
			for _, entry := range r.Modules {
				v, p := ref[entry.Name]
				if p != entry.Present || (p && hashJSON(v) != entry.SHA256) {
					r.issue("REFERENCE_CONTENT_DIFFERS", entry.Name)
				}
			}
		}
		r.Verified.ReferenceEquivalent = &same
		if !same {
			r.issue("REFERENCE_NOT_EQUIVALENT", "")
		}
	}
	sort.Slice(r.Issues, func(i, j int) bool {
		if r.Issues[i].Code == r.Issues[j].Code {
			return r.Issues[i].Module < r.Issues[j].Module
		}
		return r.Issues[i].Code < r.Issues[j].Code
	})
	sort.Strings(r.MissingTargetModules)
	if len(r.Issues) == 0 {
		r.Status = "compatible"
	}
	return r
}

// AuditDigestOnly describes a complete streamed byte digest when a caller's
// parsing budget was exceeded. No schema, module content, height or amount has
// been checked. A byte hash is never promoted to full-state verification.
func AuditDigestOnly(sha string, bytes, parseBudget int64, o Options) Report {
	r := Report{Schema: "ynx.offline-state-preflight.v1", Status: "blocked", CompatibilityScope: "whole-file-byte-digest-only", Declared: o, InputSHA256: sha, InputBytes: bytes, Amounts: map[string]string{}, AssetReconciliations: []AssetReconciliation{}, Modules: []Module{}, MissingTargetModules: []string{}, Issues: []Issue{{Code: "INPUT_EXCEEDS_FULL_PARSE_BUDGET"}}, Limitations: []string{
		"Entire regular file was hashed through EOF; no JSON parsing, schema validation, embedded integrity, module content reconciliation or migration was performed.",
		"Full parsing budget in bytes: " + strconv.FormatInt(parseBudget, 10),
		"Source identity, height/hash and durability remain unproven declarations. migrationSafe is always false; this report cannot satisfy a release gate.",
	}}
	r.Verified.InputReadComplete = true
	if o.TargetFamily == "" {
		r.Declared.TargetFamily = "vnext"
	}
	if c, ok := catalogs()[o.SourceFamily]; ok {
		r.CatalogCommit = c.Commit
		for _, f := range c.Types[c.Root].Fields {
			r.UnverifiedModules = append(r.UnverifiedModules, f.Name)
		}
		if c.Commit != o.SourceCommit {
			r.issue("SOURCE_COMMIT_NOT_CATALOGUED", "")
		}
	} else {
		r.issue("UNKNOWN_SOURCE_FAMILY", "")
	}
	r.Verified.DigestMatchesDeclaration = sha == o.ExpectedSHA256 && validHash(sha)
	if !r.Verified.DigestMatchesDeclaration {
		r.issue("INPUT_DIGEST_MISMATCH_OR_MISSING", "")
	}
	return r
}

func validHash(s string) bool { b, e := hex.DecodeString(s); return e == nil && len(b) == 32 }
func hashParts(parts ...string) string {
	return digest([]byte(strings.Join(parts, "\x00") + "\x00"))
}
func cloneMap(m map[string]any) map[string]any {
	n := map[string]any{}
	for k, v := range m {
		n[k] = v
	}
	return n
}
func schemaFingerprint(c catalog, name string) string {
	seen := map[string]bool{}
	all := map[string]shape{}
	var visit func(string)
	visit = func(n string) {
		if seen[n] {
			return
		}
		seen[n] = true
		if s, ok := c.Types[n]; ok {
			all[n] = s
			visit(s.Elem)
			for _, f := range s.Fields {
				visit(f.Type)
			}
		}
	}
	visit(name)
	return hashJSON(struct {
		Name  string
		Types map[string]shape
	}{name, all})
}

func (r *Report) nativeHistory(m map[string]any, o Options) {
	if len(arr(m["pending"])) > 0 {
		r.issue("PENDING_STATE_ALREADY_MAY_AFFECT_BALANCES", "pending")
	}
	blocks := arr(m["blocks"])
	if len(blocks) == 0 {
		r.issue("COMMITTED_HISTORY_MISSING", "blocks")
		return
	}
	genesis := digest([]byte("genesis\x00testnet\x006423\x00"))
	previous := ""
	seenTx := map[string]bool{}
	nonces := map[string]*big.Int{}
	for i, v := range blocks {
		b := obj(v)
		if num(b["height"]).Cmp(big.NewInt(int64(i))) != 0 {
			r.issue("NONCONTIGUOUS_BLOCK_HEIGHT", "blocks")
		}
		h := str(b["hash"])
		if !validHash(h) || str(b["parentHash"]) != previous || (i == 0 && h != genesis) {
			r.issue("BLOCK_HISTORY_IDENTITY_MISMATCH", "blocks")
		}
		if i > 0 {
			ts, _ := time.Parse(time.RFC3339Nano, str(b["time"]))
			if ts.Year() < 1678 || ts.Year() > 2261 || h != hashParts("block", num(b["height"]).String(), previous, strconv.FormatInt(ts.UnixNano(), 10), strconv.Itoa(len(arr(b["transactions"]))), str(b["validator"])) {
				r.issue("BLOCK_HASH_PREIMAGE_MISMATCH", "blocks")
			}
		}
		previous = h
		for _, tv := range arr(b["transactions"]) {
			tx := obj(tv)
			hash := str(tx["hash"])
			if hash == "" || seenTx[hash] {
				r.issue("DUPLICATE_OR_MISSING_TRANSACTION_HASH", "blocks")
			}
			seenTx[hash] = true
			if str(tx["blockHash"]) != h || num(tx["blockNumber"]).Cmp(num(b["height"])) != 0 {
				r.issue("TRANSACTION_BLOCK_IDENTITY_MISMATCH", "blocks")
			}
			if num(tx["amount"]).Sign() < 0 || num(tx["fee"]).Sign() < 0 {
				r.issue("NEGATIVE_TRANSACTION_AMOUNT", "blocks")
			}
			from := str(tx["from"])
			n := num(tx["nonce"])
			if from != "" && n.Sign() > 0 {
				canonical, e := accountaddress.Normalize(from)
				if e != nil {
					r.issue("HISTORY_ACCOUNT_ALIAS_UNRESOLVED", "blocks")
					continue
				}
				if last := nonces[canonical]; last != nil && n.Cmp(new(big.Int).Add(last, big.NewInt(1))) != 0 {
					r.issue("HISTORY_NONCE_GAP_OR_REPLAY", "blocks")
				} else if last == nil && n.Cmp(big.NewInt(1)) != 0 {
					r.issue("HISTORY_INITIAL_NONCE_UNRESOLVED", "blocks")
				}
				nonces[canonical] = new(big.Int).Set(n)
			}
		}
	}
	if len(seenTx) > 0 {
		r.issue("EXECUTED_STATE_REPLAY_NOT_IMPLEMENTED", "blocks")
	}
	last := obj(blocks[len(blocks)-1])
	r.ObservedHeight = num(last["height"]).String()
	if r.ObservedHeight == o.CommittedHeight && str(last["hash"]) == o.CommittedHash {
		r.Verified.AnchorMatchesDeclaration = true
	} else {
		r.issue("DECLARED_ANCHOR_MISMATCH", "blocks")
	}
	for _, av := range obj(m["accounts"]) {
		a := obj(av)
		canonical, e := accountaddress.Normalize(str(a["address"]))
		if e == nil {
			if n := nonces[canonical]; n != nil && n.Cmp(num(a["nonce"])) != 0 {
				r.issue("ACCOUNT_NONCE_HISTORY_MISMATCH", "accounts")
			} else if n == nil && num(a["nonce"]).Sign() != 0 {
				r.issue("ACCOUNT_NONCE_HISTORY_MISSING", "accounts")
			}
		}
	}
}

// These are local policy/set invariants only. Peer readiness and validator
// declarations cannot establish signatures, a quorum or CometBFT finality.
func (r *Report) nativePolicyAndValidators(m map[string]any, c catalog) {
	p := obj(m["resourceMarketPolicy"])
	invalid := str(p["id"]) == "" || str(p["version"]) == "" || str(p["currency"]) != "YNXT"
	shares := new(big.Int)
	for _, k := range []string{"providerShareBps", "protocolFeeBps"} {
		z := num(p[k])
		invalid = invalid || z.Sign() < 0 || z.Cmp(big.NewInt(10000)) > 0
		shares.Add(shares, z)
	}
	invalid = invalid || shares.Cmp(big.NewInt(10000)) != 0
	for _, k := range []string{"bandwidthUnit", "computeUnit", "minimumQuoteYnxt", "quoteTtlSeconds", "bandwidthStakeDivisor", "computeStakeDivisor", "aiCreditStakeDivisor", "trustStakeDivisor"} {
		invalid = invalid || num(p[k]).Sign() <= 0
	}
	prices := new(big.Int)
	for _, k := range []string{"bandwidthUnitPrice", "computeUnitPrice", "aiCreditUnitPrice", "trustCreditUnitPrice"} {
		invalid = invalid || num(p[k]).Sign() < 0
		prices.Add(prices, num(p[k]))
	}
	invalid = invalid || prices.Sign() == 0
	for _, k := range []string{"baseBandwidth", "baseCompute", "baseAiCredits", "baseTrustCredits"} {
		invalid = invalid || num(p[k]).Sign() < 0
	}
	clone := cloneMap(p)
	clone["policyHash"] = ""
	b, e := typedJSON(c, "chain.ResourceMarketPolicy", clone)
	if invalid || e != nil || str(p["policyHash"]) != hashParts("resource-market-policy", string(b)) {
		r.issue("RESOURCE_POLICY_INVALID_OR_UNSEALED", "resourceMarketPolicy")
	}
	seen := map[string]bool{}
	activePower := new(big.Int)
	for _, v := range arr(m["validators"]) {
		a := obj(v)
		canonical, e := accountaddress.Normalize(str(a["address"]))
		if e != nil || seen[canonical] || str(a["moniker"]) == "" || num(a["votingPower"]).Sign() < 0 {
			r.issue("VALIDATOR_IDENTITY_OR_POWER_INVALID", "validators")
		}
		seen[canonical] = true
		if a["active"] == true {
			activePower.Add(activePower, num(a["votingPower"]))
		}
	}
	if activePower.Sign() <= 0 {
		r.issue("ACTIVE_VALIDATOR_POWER_MISSING", "validators")
	}
	r.Amounts["declaredValidatorActiveVotingPower"] = activePower.String()
}

func (r *Report) accounts(m map[string]any, native bool) {
	type entry struct {
		key string
		v   any
	}
	entries := []entry{}
	if native {
		for key, v := range obj(m["lots"]) {
			lot := obj(v)
			if key == "" || str(lot["lotId"]) != key || num(lot["amount"]).Sign() < 0 || num(lot["riskWeightBps"]).Sign() < 0 || num(lot["riskWeightBps"]).Cmp(big.NewInt(10000)) > 0 {
				r.issue("LOT_METADATA_INVALID", "lots")
			}
		}
		for _, k := range sortedKeys(obj(m["accounts"])) {
			entries = append(entries, entry{k, obj(m["accounts"])[k]})
		}
	} else {
		for _, v := range arr(m["accounts"]) {
			entries = append(entries, entry{"", v})
		}
	}
	if len(entries) == 0 {
		r.issue("ACCOUNTS_MISSING", "accounts")
	}
	seen := map[string]bool{}
	liquid, staked, lotTotal := new(big.Int), new(big.Int), new(big.Int)
	normalized := map[string]any{}
	for _, x := range entries {
		a := obj(x.v)
		address := str(a["address"])
		canonical, e := accountaddress.Normalize(address)
		if e != nil {
			r.issue("ACCOUNT_ADDRESS_MAPPING_UNRESOLVED", "accounts")
			canonical = address
		}
		if seen[canonical] {
			r.issue("DUPLICATE_ACCOUNT_ALIAS", "accounts")
		}
		seen[canonical] = true
		if native && x.key != address {
			r.issue("ACCOUNT_MAP_KEY_MISMATCH", "accounts")
		}
		balance, stake := num(a["balance"]), num(a["staked"])
		if balance.Sign() < 0 || stake.Sign() < 0 {
			r.issue("NEGATIVE_ACCOUNT_AMOUNT", "accounts")
		}
		liquid.Add(liquid, balance)
		staked.Add(staked, stake)
		lots := new(big.Int)
		for key, v := range obj(a["lots"]) {
			z := num(v)
			if z.Sign() < 0 {
				r.issue("NEGATIVE_LOT_AMOUNT", "accounts")
			}
			lots.Add(lots, z)
			if native {
				if _, exists := obj(m["lots"])[key]; !exists {
					r.issue("LOT_METADATA_MISSING", "lots")
				}
			}
		}
		lotTotal.Add(lotTotal, lots)
		if lots.Cmp(balance) != 0 {
			r.issue("LOT_BALANCE_DELTA_REQUIRES_RECONCILIATION", "accounts")
		}
		for _, v := range obj(a["resourceUsage"]) {
			if num(v).Sign() < 0 {
				r.issue("NEGATIVE_RESOURCE_USAGE", "accounts")
			}
		}
		copy := cloneMap(a)
		copy["address"] = canonical
		normalized[canonical] = copy
	}
	r.AccountStateSHA256 = hashJSON(normalized)
	r.Amounts["accountLiquidStoredInteger"] = liquid.String()
	r.Amounts["accountStakedStoredInteger"] = staked.String()
	r.Amounts["accountLotsStoredInteger"] = lotTotal.String()
	r.Amounts["lotMinusLiquidStoredInteger"] = new(big.Int).Sub(lotTotal, liquid).String()
	if native {
		scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)
		for key, z := range map[string]*big.Int{"accountLiquidWei": liquid, "accountStakedWei": staked} {
			wei := new(big.Int).Mul(z, scale)
			r.Amounts[key] = wei.String()
			if wei.Sign() < 0 || wei.BitLen() > 256 {
				r.issue("YNXT_UINT256_RANGE_EXCEEDED", "accounts")
			}
		}
	} else {
		r.issue("ABCI_AMOUNT_UNIT_MAPPING_NOT_FROZEN", "accounts")
	}
}

// DEX supplies are independent per asset. Non-YNXT balances are never scaled by
// 10^18. Native pool reserves are escrow distinct from account liquid balances.
func (r *Report) dex(m map[string]any, native bool) {
	if !native {
		if records(m["dexAssets"])+records(m["dexBalances"])+records(m["dexPools"]) > 0 {
			r.issue("ABCI_DEX_SEMANTICS_UNVERIFIED", "dexPools")
		}
		return
	}
	assets := obj(m["dexAssets"])
	holdings := map[string]*big.Int{}
	accountTotals, poolTotals := map[string]*big.Int{}, map[string]*big.Int{}
	addCategory := func(category map[string]*big.Int, id string, z *big.Int) {
		if category[id] == nil {
			category[id] = new(big.Int)
		}
		category[id].Add(category[id], z)
	}
	add := func(id string, z *big.Int) {
		if holdings[id] == nil {
			holdings[id] = new(big.Int)
		}
		holdings[id].Add(holdings[id], z)
		if z.Sign() < 0 {
			r.issue("NEGATIVE_DEX_AMOUNT", "dexBalances")
		}
	}
	for asset, v := range obj(m["dexBalances"]) {
		if asset == "YNXT" {
			r.issue("DEX_NATIVE_BALANCE_DUPLICATES_ACCOUNT_LEDGER", "dexBalances")
		}
		for _, amount := range obj(v) {
			add(asset, num(amount))
			addCategory(accountTotals, asset, num(amount))
		}
	}
	nativeEscrow := new(big.Int)
	for key, v := range obj(m["dexPools"]) {
		p := obj(v)
		if str(p["id"]) != key {
			r.issue("DEX_POOL_ID_MISMATCH", "dexPools")
		}
		a0, a1 := str(p["asset0"]), str(p["asset1"])
		if a0 == a1 {
			r.issue("DEX_POOL_DUPLICATE_ASSET", "dexPools")
		}
		for i, id := range []string{a0, a1} {
			reserve := num(p[[]string{"reserve0", "reserve1"}[i]])
			add(id, reserve)
			addCategory(poolTotals, id, reserve)
			if id == "YNXT" {
				nativeEscrow.Add(nativeEscrow, reserve)
				lots := new(big.Int)
				for key, n := range obj(p[[]string{"nativeLots0", "nativeLots1"}[i]]) {
					lots.Add(lots, num(n))
					if num(n).Sign() < 0 || obj(m["lots"])[key] == nil {
						r.issue("DEX_NATIVE_LOT_INVALID", "dexPools")
					}
				}
				if lots.Cmp(reserve) != 0 {
					r.issue("DEX_NATIVE_LOT_RESERVE_MISMATCH", "dexPools")
				}
			}
		}
		shares := new(big.Int)
		for _, z := range obj(p["shares"]) {
			shares.Add(shares, num(z))
			if num(z).Sign() < 0 {
				r.issue("NEGATIVE_DEX_SHARES", "dexPools")
			}
		}
		if shares.Cmp(num(p["totalShares"])) != 0 {
			r.issue("DEX_SHARE_SUPPLY_MISMATCH", "dexPools")
		}
	}
	for id, z := range holdings {
		if id == "YNXT" {
			continue
		}
		asset, exists := assets[id]
		if !exists {
			r.issue("DEX_ASSET_METADATA_MISSING", "dexAssets")
			continue
		}
		a := obj(asset)
		if str(a["id"]) != id || num(a["decimals"]).Cmp(big.NewInt(18)) > 0 {
			r.issue("DEX_ASSET_ID_OR_DECIMALS_INVALID", "dexAssets")
		}
		if z.Cmp(num(a["totalSupply"])) != 0 {
			r.issue("DEX_TOKEN_SUPPLY_MISMATCH", "dexAssets")
		}
		if num(a["maxSupply"]).Cmp(num(a["totalSupply"])) < 0 {
			r.issue("DEX_TOKEN_MAX_SUPPLY_EXCEEDED", "dexAssets")
		}
	}
	for _, id := range sortedKeys(assets) {
		v := assets[id]
		a := obj(v)
		if id == "YNXT" || str(a["id"]) != id || num(a["decimals"]).Cmp(big.NewInt(18)) > 0 || num(a["totalSupply"]).Sign() < 0 || num(a["maxSupply"]).Sign() < 0 || num(a["maxSupply"]).Cmp(num(a["totalSupply"])) < 0 {
			r.issue("DEX_ASSET_METADATA_INVALID", "dexAssets")
		}
		if id != "YNXT" && holdings[id] == nil && num(a["totalSupply"]).Sign() != 0 {
			r.issue("DEX_SUPPLY_WITHOUT_HOLDINGS", "dexAssets")
		}
		if id != "YNXT" {
			if holdings[id] == nil {
				holdings[id] = new(big.Int)
			}
			if accountTotals[id] == nil {
				accountTotals[id] = new(big.Int)
			}
			if poolTotals[id] == nil {
				poolTotals[id] = new(big.Int)
			}
			delta := new(big.Int).Sub(holdings[id], num(a["totalSupply"]))
			r.AssetReconciliations = append(r.AssetReconciliations, AssetReconciliation{
				AssetIDSHA256: digest([]byte(id)), Decimals: num(a["decimals"]).String(),
				AccountBalances: accountTotals[id].String(), PoolReserves: poolTotals[id].String(),
				TotalHoldings: holdings[id].String(), DeclaredSupply: num(a["totalSupply"]).String(),
				HoldingsMinusSupply: delta.String(), Balanced: delta.Sign() == 0,
			})
		}
	}
	r.Amounts["dexNativeEscrowYNXT"] = nativeEscrow.String()
	nonNative := map[string]*big.Int{}
	for id, z := range holdings {
		if id != "YNXT" {
			nonNative[id] = z
		}
	}
	r.Amounts["dexNonNativeHoldingsSHA256"] = hashJSON(nonNative)
}
