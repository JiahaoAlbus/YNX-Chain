package executionstate

import (
	"bufio"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"math/big"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

const treeDigestAlgorithm = "ynx-json-tree-sha256-v1"

type StreamLimits struct {
	MaxTokenBytes       int    `json:"maxTokenBytes"`
	MaxObjectIndexBytes int64  `json:"maxObjectIndexBytes"`
	MaxCaptureBytes     int64  `json:"maxCaptureBytes"`
	MaxHeapBytes        uint64 `json:"maxHeapBytes"`
	MaxRSSBytes         int64  `json:"maxRssBytes"`
	MaxDepth            int    `json:"maxDepth"`
}
type StreamEvidence struct {
	Limits                           StreamLimits          `json:"limits"`
	Tokens                           int64                 `json:"tokens"`
	Blocks                           uint64                `json:"blocks"`
	Transactions                     uint64                `json:"transactions"`
	BlockPreimageMismatchCount       uint64                `json:"blockPreimageMismatchCount"`
	FirstBlockPreimageMismatchHeight string                `json:"firstBlockPreimageMismatchHeight,omitempty"`
	LastBlockPreimageMismatchHeight  string                `json:"lastBlockPreimageMismatchHeight,omitempty"`
	BlockPreimageMismatchSamples     []StreamBlockMismatch `json:"blockPreimageMismatchSamples,omitempty"`
	PeakObservedHeapBytes            uint64                `json:"peakObservedHeapBytes"`
	ProcessPeakRSSBytes              int64                 `json:"processPeakRssBytes"`
	PeakCaptureEstimateBytes         int64                 `json:"peakCaptureEstimateBytes"`
	PeakObjectIndexEstimateBytes     int64                 `json:"peakObjectIndexEstimateBytes"`
}
type StreamBlockMismatch struct {
	Height           string `json:"height"`
	ObservedHash     string `json:"observedHash,omitempty"`
	ExpectedBe9Hash  string `json:"expectedBe9Hash"`
	ParentHash       string `json:"parentHash,omitempty"`
	TimeUTC          string `json:"timeUtc"`
	TransactionCount int    `json:"transactionCount"`
	ValidatorSHA256  string `json:"validatorSha256"`
}

func DefaultStreamLimits() StreamLimits {
	return StreamLimits{MaxTokenBytes: 1 << 20, MaxObjectIndexBytes: 8 << 20, MaxCaptureBytes: 32 << 20, MaxHeapBytes: 128 << 20, MaxRSSBytes: 256 << 20, MaxDepth: 128}
}

type streamNode struct {
	digest  [32]byte
	value   any
	records int
}
type streamShape struct {
	shape
	fields map[string]field
}
type countedReader struct {
	io.Reader
	count int64
}

func (r *countedReader) Read(p []byte) (int, error) {
	n, e := r.Reader.Read(p)
	r.count += int64(n)
	return n, e
}

type streamAudit struct {
	c            catalog
	o            Options
	r            *Report
	lexer        *streamLexer
	shapes       map[string]streamShape
	limits       StreamLimits
	retained     map[string]any
	captureBytes int64
	indexBytes   int64
	seenModules  map[string]bool
	previousHash string
	lastHeight   string
}

func newTreeHash(kind string) hash.Hash {
	h := sha256.New()
	h.Write([]byte(treeDigestAlgorithm + "\x00" + kind + "\x00"))
	return h
}
func putLength(h hash.Hash, n uint64) {
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], n)
	h.Write(b[:])
}
func sumTree(h hash.Hash) [32]byte { var b [32]byte; copy(b[:], h.Sum(nil)); return b }
func leafDigest(v any) [32]byte {
	var h hash.Hash
	switch x := v.(type) {
	case nil:
		h = newTreeHash("null")
	case string:
		h = newTreeHash("string")
		h.Write([]byte(x))
	case json.Number:
		h = newTreeHash("number")
		h.Write([]byte(x))
	case bool:
		h = newTreeHash("bool")
		if x {
			h.Write([]byte("true"))
		} else {
			h.Write([]byte("false"))
		}
	default:
		panic("unhandled JSON leaf")
	}
	return sumTree(h)
}
func (a *streamAudit) capture(n int64) error {
	if n < 0 || a.captureBytes > a.limits.MaxCaptureBytes-n {
		return errors.New("STREAM_CAPTURE_BUDGET_EXCEEDED")
	}
	a.captureBytes += n
	if a.captureBytes > a.r.Streaming.PeakCaptureEstimateBytes {
		a.r.Streaming.PeakCaptureEstimateBytes = a.captureBytes
	}
	return nil
}
func (a *streamAudit) memory() error {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	if m.HeapAlloc > a.r.Streaming.PeakObservedHeapBytes {
		a.r.Streaming.PeakObservedHeapBytes = m.HeapAlloc
	}
	if rss := processPeakRSS(); rss > a.r.Streaming.ProcessPeakRSSBytes {
		a.r.Streaming.ProcessPeakRSSBytes = rss
	}
	if a.r.Streaming.ProcessPeakRSSBytes <= 0 {
		return errors.New("STREAM_RSS_MEASUREMENT_UNAVAILABLE")
	}
	if m.HeapAlloc > a.limits.MaxHeapBytes {
		return errors.New("STREAM_HEAP_BUDGET_EXCEEDED")
	}
	if a.r.Streaming.ProcessPeakRSSBytes > a.limits.MaxRSSBytes {
		return errors.New("STREAM_RSS_BUDGET_EXCEEDED")
	}
	return nil
}
func (a *streamAudit) token() (streamToken, error) {
	if a.lexer.tokens%8192 == 0 {
		if e := a.memory(); e != nil {
			return streamToken{}, e
		}
	}
	return a.lexer.next()
}
func (a *streamAudit) parse(typ, path string, capture bool, depth int) (streamNode, error) {
	t, e := a.token()
	if e != nil {
		return streamNode{}, e
	}
	return a.parseToken(typ, path, capture, depth, t)
}
func (a *streamAudit) parseToken(typ, path string, capture bool, depth int, t streamToken) (streamNode, error) {
	if depth > a.limits.MaxDepth {
		return streamNode{}, errors.New("JSON_DEPTH_LIMIT")
	}
	s, known := a.shapes[typ]
	if known && (s.Kind == "alias" || s.Kind == "pointer") {
		if s.Kind == "pointer" && t.kind == '0' {
			return streamNode{digest: leafDigest(nil)}, nil
		}
		return a.parseToken(s.Elem, path, capture, depth, t)
	}
	if t.kind == '0' && known && (s.Kind == "map" || s.Kind == "slice") {
		return streamNode{digest: leafDigest(nil)}, nil
	}
	generic := typ == "any" || typ == "json.RawMessage"
	if (known && (s.Kind == "map" || s.Kind == "struct")) || (generic && t.kind == '{') {
		if t.kind != '{' {
			return streamNode{}, fmt.Errorf("EXPECTED_OBJECT at %s", path)
		}
		return a.object(s, path, capture, depth, generic)
	}
	if known && s.Kind == "slice" && s.Elem == "uint8" {
		if t.kind != 's' {
			return streamNode{}, fmt.Errorf("INVALID_BYTES at %s", path)
		}
		if _, e := base64.StdEncoding.DecodeString(str(t.value)); e != nil {
			return streamNode{}, fmt.Errorf("INVALID_BYTES at %s", path)
		}
	} else if (known && s.Kind == "slice") || (generic && t.kind == '[') {
		if t.kind != '[' {
			return streamNode{}, fmt.Errorf("EXPECTED_ARRAY at %s", path)
		}
		elem := s.Elem
		if generic {
			elem = "any"
		}
		return a.array(elem, path, capture, depth)
	} else {
		if t.kind != 's' && t.kind != 'n' && t.kind != 'b' && t.kind != '0' {
			return streamNode{}, errors.New("INVALID_JSON_VALUE")
		}
		if n, ok := t.value.(json.Number); ok && (strings.HasPrefix(typ, "int") || strings.HasPrefix(typ, "uint")) && len(n) > 21 {
			return streamNode{}, fmt.Errorf("INTEGER_OUT_OF_RANGE at %s", path)
		}
		if e := strict(a.c, typ, t.value, path); e != nil {
			return streamNode{}, e
		}
	}
	n := streamNode{digest: leafDigest(t.value), records: records(t.value)}
	if capture {
		cost := int64(32)
		if text, ok := t.value.(string); ok {
			cost += int64(len(text))
		}
		if number, ok := t.value.(json.Number); ok {
			cost += int64(len(number))
		}
		if e := a.capture(cost); e != nil {
			return streamNode{}, e
		}
		n.value = t.value
	}
	return n, nil
}

func (a *streamAudit) object(s streamShape, path string, capture bool, depth int, generic bool) (streamNode, error) {
	entries := map[string][32]byte{}
	var value map[string]any
	if capture {
		if e := a.capture(64); e != nil {
			return streamNode{}, e
		}
		value = map[string]any{}
	}
	var localBytes int64
	defer func() { a.indexBytes -= localBytes }()
	t, e := a.token()
	if e != nil {
		return streamNode{}, e
	}
	for t.kind != '}' {
		if t.kind != 's' {
			return streamNode{}, errors.New("EXPECTED_JSON_OBJECT_KEY")
		}
		key := str(t.value)
		if _, exists := entries[key]; exists {
			return streamNode{}, errors.New("DUPLICATE_JSON_KEY")
		}
		cost := int64(len(key)) + 160
		if localBytes > a.limits.MaxObjectIndexBytes-cost || a.indexBytes > 3*a.limits.MaxObjectIndexBytes-cost {
			return streamNode{}, errors.New("STREAM_OBJECT_INDEX_BUDGET_EXCEEDED")
		}
		localBytes += cost
		a.indexBytes += cost
		if a.indexBytes > a.r.Streaming.PeakObjectIndexEstimateBytes {
			a.r.Streaming.PeakObjectIndexEstimateBytes = a.indexBytes
		}
		typ, childPath := "any", path+".*"
		if !generic && s.Kind == "struct" {
			f, exists := s.fields[key]
			if !exists {
				return streamNode{}, fmt.Errorf("UNKNOWN_FIELD at %s.<unknown>", path)
			}
			typ, childPath = f.Type, path+"."+f.Name
		} else if !generic {
			typ = s.Elem
		}
		colon, e := a.token()
		if e != nil || colon.kind != ':' {
			return streamNode{}, errors.New("EXPECTED_JSON_COLON")
		}
		childCapture := capture
		if path == "snapshot" {
			childCapture = retainedStreamModule(key)
		}
		n, e := a.parse(typ, childPath, childCapture, depth+1)
		if e != nil {
			return streamNode{}, e
		}
		entries[key] = n.digest
		if capture {
			if e := a.capture(int64(len(key)) + 96); e != nil {
				return streamNode{}, e
			}
			value[key] = n.value
		}
		if path == "snapshot" {
			a.module(key, n)
			if childCapture {
				a.retained[key] = n.value
			}
		}
		t, e = a.token()
		if e != nil {
			return streamNode{}, e
		}
		if t.kind == '}' {
			break
		}
		if t.kind != ',' {
			return streamNode{}, errors.New("EXPECTED_JSON_COMMA")
		}
		t, e = a.token()
		if e != nil {
			return streamNode{}, e
		}
		if t.kind == '}' {
			return streamNode{}, errors.New("TRAILING_JSON_COMMA")
		}
	}
	if !generic && s.Kind == "struct" {
		for _, f := range s.Fields {
			if _, ok := entries[f.Name]; !ok && !f.Optional {
				return streamNode{}, fmt.Errorf("MISSING_FIELD at %s.%s", path, f.Name)
			}
		}
	}
	keys := make([]string, 0, len(entries))
	for key := range entries {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	h := newTreeHash("object")
	for _, key := range keys {
		putLength(h, uint64(len(key)))
		h.Write([]byte(key))
		d := entries[key]
		h.Write(d[:])
	}
	putLength(h, uint64(len(keys)))
	return streamNode{digest: sumTree(h), value: value, records: len(keys)}, nil
}
func (a *streamAudit) array(elem, path string, capture bool, depth int) (streamNode, error) {
	h := newTreeHash("array")
	count := 0
	var value []any
	if capture {
		if e := a.capture(32); e != nil {
			return streamNode{}, e
		}
		value = []any{}
	}
	t, e := a.token()
	if e != nil {
		return streamNode{}, e
	}
	for t.kind != ']' {
		before := a.captureBytes
		block := path == "snapshot.blocks"
		n, e := a.parseToken(elem, path+"[]", capture || block, depth+1, t)
		if e != nil {
			return streamNode{}, e
		}
		h.Write(n.digest[:])
		count++
		if block {
			a.block(obj(n.value))
			a.captureBytes = before
		}
		if capture {
			if e := a.capture(24); e != nil {
				return streamNode{}, e
			}
			value = append(value, n.value)
		}
		t, e = a.token()
		if e != nil {
			return streamNode{}, e
		}
		if t.kind == ']' {
			break
		}
		if t.kind != ',' {
			return streamNode{}, errors.New("EXPECTED_JSON_COMMA")
		}
		t, e = a.token()
		if e != nil {
			return streamNode{}, e
		}
		if t.kind == ']' {
			return streamNode{}, errors.New("TRAILING_JSON_COMMA")
		}
	}
	putLength(h, uint64(count))
	return streamNode{digest: sumTree(h), value: value, records: count}, nil
}
func retainedStreamModule(name string) bool {
	switch name {
	case "version", "config", "savedAt", "stateIntegrity", "accounts", "lots", "dexAssets", "dexBalances", "dexPools", "validators", "resourceMarketPolicy", "resourceDelegations", "resourceRentals", "resourceIncome":
		return true
	}
	return false
}
func (a *streamAudit) module(name string, n streamNode) {
	a.seenModules[name] = true
	a.r.Modules = append(a.r.Modules, Module{Name: name, Present: true, Records: n.records, SHA256: hex.EncodeToString(n.digest[:]), Treatment: "streaming-strict-schema-and-tree-content-digest"})
	if name == "pending" && n.records > 0 {
		a.r.issue("PENDING_STATE_ALREADY_MAY_AFFECT_BALANCES", "pending")
	}
}
func (a *streamAudit) block(b map[string]any) {
	i := a.r.Streaming.Blocks
	if num(b["height"]).Cmp(new(big.Int).SetUint64(i)) != 0 {
		a.r.issue("NONCONTIGUOUS_BLOCK_HEIGHT", "blocks")
	}
	h := str(b["hash"])
	if !validHash(h) || str(b["parentHash"]) != a.previousHash || (i == 0 && h != hashParts("genesis", "testnet", "6423")) {
		a.r.issue("BLOCK_HISTORY_IDENTITY_MISMATCH", "blocks")
	}
	if i > 0 {
		ts, _ := time.Parse(time.RFC3339Nano, str(b["time"]))
		expected := hashParts("block", num(b["height"]).String(), a.previousHash, strconv.FormatInt(ts.UnixNano(), 10), strconv.Itoa(len(arr(b["transactions"]))), str(b["validator"]))
		if ts.Year() < 1678 || ts.Year() > 2261 || h != expected {
			a.r.issue("BLOCK_HASH_PREIMAGE_MISMATCH", "blocks")
			s := a.r.Streaming
			s.BlockPreimageMismatchCount++
			height := num(b["height"]).String()
			if s.FirstBlockPreimageMismatchHeight == "" {
				s.FirstBlockPreimageMismatchHeight = height
			}
			s.LastBlockPreimageMismatchHeight = height
			sample := StreamBlockMismatch{Height: height, ExpectedBe9Hash: expected, TimeUTC: ts.UTC().Format(time.RFC3339Nano), TransactionCount: len(arr(b["transactions"])), ValidatorSHA256: digest([]byte(str(b["validator"])))}
			if validHash(h) {
				sample.ObservedHash = h
			}
			if validHash(str(b["parentHash"])) {
				sample.ParentHash = str(b["parentHash"])
			}
			if len(s.BlockPreimageMismatchSamples) < 4 {
				s.BlockPreimageMismatchSamples = append(s.BlockPreimageMismatchSamples, sample)
			} else {
				s.BlockPreimageMismatchSamples[3] = sample
			}
		}
	}
	for _, v := range arr(b["transactions"]) {
		tx := obj(v)
		a.r.ledgerTransaction(tx)
		if str(tx["blockHash"]) != h || num(tx["blockNumber"]).Cmp(num(b["height"])) != 0 {
			a.r.issue("TRANSACTION_BLOCK_IDENTITY_MISMATCH", "blocks")
		}
	}
	a.r.Streaming.Transactions += uint64(len(arr(b["transactions"])))
	a.r.Streaming.Blocks++
	a.previousHash = h
	a.lastHeight = num(b["height"]).String()
}

// AuditNativeStream validates the exact be9 native schema and complete module
// contents with bounded tokens/indexes/captured modules. It never retains more
// than one block (including its transactions), and never emits migrated state.
func AuditNativeStream(input io.Reader, o Options, limits StreamLimits) Report {
	if limits == (StreamLimits{}) {
		limits = DefaultStreamLimits()
	}
	if o.TargetFamily == "" {
		o.TargetFamily = "vnext"
	}
	r := Report{Schema: "ynx.offline-state-preflight.v1", Status: "blocked", CompatibilityScope: "streaming-schema-and-selected-reconciliation-only", Declared: o, Amounts: map[string]string{}, AssetReconciliations: []AssetReconciliation{}, Modules: []Module{}, MissingTargetModules: []string{}, Issues: []Issue{}, ModuleDigestAlgorithm: treeDigestAlgorithm, Streaming: &StreamEvidence{Limits: limits}, Limitations: []string{
		"Full input byte SHA and strict schema/tree content hashes do not establish provenance, finality or migration safety. migrationSafe remains false.",
		"Module SHA values use ynx-json-tree-sha256-v1, not canonical JSON SHA-256. Object keys are sorted, array order and exact numeric text are retained.",
		"Embedded snapshot seal is not recomputed in this streaming mode. Source commit/durability/committed state binding remain unproven.",
		"One block is retained at a time. Full transaction replay, raw signature/nonce verification, business module invariants and global supply are unverified.",
	}}
	if o.SourceFamily != "native-baseline-v2" {
		r.issue("STREAM_SOURCE_FAMILY_NOT_IMPLEMENTED", "")
		return r
	}
	if limits.MaxTokenBytes < 1 || limits.MaxObjectIndexBytes < 1 || limits.MaxCaptureBytes < 1 || limits.MaxHeapBytes < 1 || limits.MaxRSSBytes < 1 || limits.MaxDepth < 1 {
		r.issue("INVALID_STREAM_LIMITS", "")
		return r
	}
	c := catalogs()[o.SourceFamily]
	r.CatalogCommit = c.Commit
	if o.SourceCommit != c.Commit {
		r.issue("SOURCE_COMMIT_NOT_CATALOGUED", "")
	}
	if o.Durability != "confirmed" {
		r.issue("DURABILITY_UNCONFIRMED", "")
	}
	if len(o.Reference) > 0 {
		r.issue("STREAM_REFERENCE_COMPARISON_NOT_IMPLEMENTED", "")
	}
	h := sha256.New()
	counter := &countedReader{Reader: io.TeeReader(input, h)}
	a := &streamAudit{c: c, o: o, r: &r, limits: limits, lexer: &streamLexer{r: bufio.NewReaderSize(counter, 64<<10), max: limits.MaxTokenBytes}, shapes: map[string]streamShape{}, retained: map[string]any{}, seenModules: map[string]bool{}}
	for name, s := range c.Types {
		compiled := streamShape{shape: s, fields: map[string]field{}}
		for _, f := range s.Fields {
			compiled.fields[f.Name] = f
		}
		a.shapes[name] = compiled
	}
	n, err := a.parse(c.Root, "snapshot", false, 0)
	if err == nil {
		if _, e := a.token(); e != io.EOF {
			err = errors.New("TRAILING_JSON_OR_READ_FAILED")
		}
	}
	r.InputBytes = counter.count
	r.Streaming.Tokens = a.lexer.tokens
	if memErr := a.memory(); err == nil && memErr != nil {
		err = memErr
	}
	if err != nil {
		r.issue(err.Error(), "")
		for _, f := range c.Types[c.Root].Fields {
			if !a.seenModules[f.Name] {
				r.UnverifiedModules = append(r.UnverifiedModules, f.Name)
			}
		}
		return r
	}
	r.InputSHA256 = hex.EncodeToString(h.Sum(nil))
	r.Verified.InputReadComplete = true
	r.Verified.DigestMatchesDeclaration = r.InputSHA256 == o.ExpectedSHA256
	if !r.Verified.DigestMatchesDeclaration {
		r.issue("INPUT_DIGEST_MISMATCH_OR_MISSING", "")
	}
	r.Verified.SchemaVerified = true
	r.Verified.FullModuleInventoryVerified = true
	r.ContentTreeSHA256 = hex.EncodeToString(n.digest[:])
	m := a.retained
	if num(m["version"]).String() != "2" {
		r.issue("SCHEMA_VERSION_FAMILY_MISMATCH", "version")
	}
	cfg := obj(m["config"])
	if num(cfg["chainId"]).String() != "6423" || str(cfg["slug"]) != "testnet" || str(cfg["nativeCurrencySymbol"]) != "YNXT" || num(cfg["decimals"]).String() != "18" {
		r.issue("NETWORK_IDENTITY_MISMATCH", "config")
	}
	if string(o.Marker) == "2\n" {
		r.Verified.MarkerVerified = true
	} else {
		r.issue("V2_MARKER_MISSING_OR_INVALID", "stateIntegrity")
	}
	r.ObservedHeight = a.lastHeight
	if a.r.Streaming.Blocks == 0 {
		r.issue("COMMITTED_HISTORY_MISSING", "blocks")
	}
	if a.lastHeight == o.CommittedHeight && a.previousHash == o.CommittedHash {
		r.Verified.AnchorMatchesDeclaration = true
	} else {
		r.issue("DECLARED_ANCHOR_MISMATCH", "blocks")
	}
	r.issue("STREAM_EMBEDDED_INTEGRITY_NOT_VERIFIED", "stateIntegrity")
	r.issue("STREAM_EXECUTION_AND_NONCE_REPLAY_NOT_IMPLEMENTED", "blocks")
	r.accounts(m, true)
	r.dex(m, true)
	if err := a.ledgerState(); err != nil {
		r.issue(err.Error(), "accounts")
	}
	r.nativePolicyAndValidators(m, c)
	safe := map[string]bool{"version": true, "savedAt": true, "stateIntegrity": true, "config": true, "accounts": true, "lots": true, "blocks": true, "pending": true, "validators": true, "resourceMarketPolicy": true}
	for i := range r.Modules {
		entry := &r.Modules[i]
		if !safe[entry.Name] && entry.Records > 0 {
			entry.Treatment = "strict-schema-and-content-digest; invariant-checker-required"
			r.issue("MODULE_INVARIANTS_UNVERIFIED", entry.Name)
		}
	}
	for _, f := range c.Types[c.Root].Fields {
		if !a.seenModules[f.Name] {
			r.Modules = append(r.Modules, Module{Name: f.Name, Present: false, Treatment: "optional-field-absent"})
		}
	}
	if o.TargetFamily != "native-baseline-v2" {
		r.issue("STREAM_TARGET_MAPPING_NOT_IMPLEMENTED", "")
		for _, f := range c.Types[c.Root].Fields {
			r.MissingTargetModules = append(r.MissingTargetModules, f.Name)
		}
	}
	sort.Slice(r.Modules, func(i, j int) bool { return r.Modules[i].Name < r.Modules[j].Name })
	sort.Slice(r.Issues, func(i, j int) bool {
		if r.Issues[i].Code == r.Issues[j].Code {
			return r.Issues[i].Module < r.Issues[j].Module
		}
		return r.Issues[i].Code < r.Issues[j].Code
	})
	if e := a.memory(); e != nil {
		r.issue(e.Error(), "")
	}
	return r
}
