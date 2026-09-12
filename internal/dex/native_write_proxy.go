package dex

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"
)

const (
	nativeSubmitPath            = "/v1/native-transactions"
	nativeWriteOrigin           = "https://dex.ynxweb4.com"
	nativeActionMaxBytes        = 16 << 10
	nativeActionPayloadMaxBytes = 8 << 10
	nativeWriteConcurrency      = 8
	// The accepted browser SDK intentionally refuses rounded JSON numbers.
	nativeSDKMaxInteger = 9007199254740991
)

var nativeWritePool = regexp.MustCompile(`^dex_[a-z0-9][a-z0-9_-]{2,59}$`)
var nativeWriteAsset = regexp.MustCompile(`^(?:YNXT|[a-z][a-z0-9-]{2,31})$`)
var nativeWriteAccount = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
var nativeWritePublicKey = regexp.MustCompile(`^0[23][0-9a-f]{64}$`)
var nativeWriteSignature = regexp.MustCompile(`^30(?:[0-9a-f]{2}){7,71}$`)

// NativeWriteProxy is an opt-in transport for already reviewed, Wallet-signed
// DEX application actions. It neither signs nor allocates a nonce, authenticates
// a private Product Session, caches admission, nor retries a transaction. Core
// remains the sole signature, nonce, state-transition and durability authority.
type NativeWriteProxy struct {
	core    *NativeReadProxy
	enabled bool
	slots   chan struct{}
}

func NewNativeWriteProxy(core *NativeReadProxy, enabled bool) (*NativeWriteProxy, error) {
	if enabled && (core == nil || core.origin == nil || core.client == nil) {
		return nil, errors.New("native writes require an operator-pinned Core origin")
	}
	return &NativeWriteProxy{core: core, enabled: enabled, slots: make(chan struct{}, nativeWriteConcurrency)}, nil
}

// This is an existing SDK envelope projection for format/path validation only.
// Its field order matches Core SignedApplicationAction. Re-encoding is used
// only to reject noncanonical bytes; the original input is always transmitted.
// DEX has no trustUnits field because the canonical zero value is omitted.
type nativeWriteEnvelope struct {
	Version     int             `json:"version"`
	ChainID     int64           `json:"chainId"`
	Type        string          `json:"type"`
	Signer      string          `json:"signer"`
	Nonce       uint64          `json:"nonce"`
	Action      string          `json:"action"`
	Payload     json.RawMessage `json:"payload"`
	PayloadHash string          `json:"payloadHash"`
	Fee         int64           `json:"fee"`
	AIUnits     int64           `json:"aiUnits"`
	PayUnits    int64           `json:"payUnits"`
	PublicKey   string          `json:"publicKey"`
	Signature   string          `json:"signature"`
}

type nativeWriteIntent struct {
	envelope          nativeWriteEnvelope
	pool, route, hash string
}

func strictNativeJSON(body []byte) bool {
	if len(body) == 0 || !utf8.Valid(body) {
		return false
	}
	d := json.NewDecoder(bytes.NewReader(body))
	d.UseNumber()
	if !nativeJSONValue(d, 0) {
		return false
	}
	_, err := d.Token()
	return err == io.EOF
}

func canonicalNativeProjection(raw []byte, value any) bool {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(value) != nil {
		return false
	}
	encoded, err := json.Marshal(value)
	return err == nil && bytes.Equal(raw, encoded)
}

func nativeSDKAmount(n int64, zero bool) bool {
	return n >= 0 && (zero || n != 0) && n <= nativeSDKMaxInteger
}

func parseNativeWriteIntent(raw []byte) (nativeWriteIntent, bool) {
	var intent nativeWriteIntent
	if len(raw) > nativeActionMaxBytes || !strictNativeJSON(raw) || !canonicalNativeProjection(raw, &intent.envelope) {
		return intent, false
	}
	e := intent.envelope
	if e.Version != 1 || e.ChainID != 6423 || e.Type != "application_action" || !nativeWriteAccount.MatchString(e.Signer) || e.Nonce == 0 || e.Nonce > nativeSDKMaxInteger || e.Fee != 1 || e.AIUnits != 0 || e.PayUnits != 0 || !nativeWritePublicKey.MatchString(e.PublicKey) || !nativeWriteSignature.MatchString(e.Signature) || len(e.Payload) == 0 || len(e.Payload) > nativeActionPayloadMaxBytes {
		return intent, false
	}
	payloadHash := sha256.Sum256(e.Payload)
	if e.PayloadHash != hex.EncodeToString(payloadHash[:]) {
		return intent, false
	}
	// A past deadline is deliberately not rejected here: Core deduplicates an
	// existing exact hash before checking nonce/deadline. Only Core decides.
	switch e.Action {
	case "dex_swap_exact_input":
		var p struct {
			Pool     string `json:"poolId"`
			Asset    string `json:"assetIn"`
			Amount   int64  `json:"amountIn"`
			Minimum  int64  `json:"minAmountOut"`
			Deadline int64  `json:"deadlineUnix"`
		}
		if !canonicalNativeProjection(e.Payload, &p) || !nativeWriteAsset.MatchString(p.Asset) || p.Asset == "ynxt" || !nativeSDKAmount(p.Amount, false) || !nativeSDKAmount(p.Minimum, false) || !nativeSDKAmount(p.Deadline, false) {
			return intent, false
		}
		intent.pool, intent.route = p.Pool, "swaps/exact-input"
	case "dex_swap_exact_output":
		var p struct {
			Pool     string `json:"poolId"`
			Asset    string `json:"assetOut"`
			Amount   int64  `json:"amountOut"`
			Maximum  int64  `json:"maxAmountIn"`
			Deadline int64  `json:"deadlineUnix"`
		}
		if !canonicalNativeProjection(e.Payload, &p) || !nativeWriteAsset.MatchString(p.Asset) || p.Asset == "ynxt" || !nativeSDKAmount(p.Amount, false) || !nativeSDKAmount(p.Maximum, false) || !nativeSDKAmount(p.Deadline, false) {
			return intent, false
		}
		intent.pool, intent.route = p.Pool, "swaps/exact-output"
	case "dex_liquidity_add":
		var p struct {
			Pool     string `json:"poolId"`
			Amount0  int64  `json:"amount0"`
			Amount1  int64  `json:"amount1"`
			Minimum  int64  `json:"minShares"`
			Deadline int64  `json:"deadlineUnix"`
		}
		if !canonicalNativeProjection(e.Payload, &p) || !nativeSDKAmount(p.Amount0, false) || !nativeSDKAmount(p.Amount1, false) || !nativeSDKAmount(p.Minimum, false) || !nativeSDKAmount(p.Deadline, false) {
			return intent, false
		}
		intent.pool, intent.route = p.Pool, "liquidity/add"
	case "dex_liquidity_remove":
		var p struct {
			Pool     string `json:"poolId"`
			Shares   int64  `json:"shares"`
			Minimum0 int64  `json:"minAmount0"`
			Minimum1 int64  `json:"minAmount1"`
			Deadline int64  `json:"deadlineUnix"`
		}
		if !canonicalNativeProjection(e.Payload, &p) || !nativeSDKAmount(p.Shares, false) || !nativeSDKAmount(p.Minimum0, true) || !nativeSDKAmount(p.Minimum1, true) || !nativeSDKAmount(p.Deadline, false) {
			return intent, false
		}
		intent.pool, intent.route = p.Pool, "liquidity/remove"
	default:
		return intent, false
	}
	if !nativeWritePool.MatchString(intent.pool) {
		return intent, false
	}
	hash := sha256.Sum256(raw)
	intent.hash = "0x" + hex.EncodeToString(hash[:])
	intent.route = "/dex/pools/" + intent.pool + "/" + intent.route
	return intent, true
}

func nativeWriteFailure(w http.ResponseWriter, code int, reason, hash string) {
	// Never reflect upstream error text, request body, signature or credentials.
	v := map[string]any{"status": "unknown", "code": reason, "scope": "native-core-write", "retryAutomatically": false, "consensusFinality": false}
	if hash != "" {
		v["transactionHash"] = hash
	}
	writeJSON(w, code, v)
}

func (p *NativeWriteProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		nativeWriteFailure(w, 405, "NATIVE_WRITE_POST_REQUIRED", "")
		return
	}
	if r.URL.Path != nativeSubmitPath || r.URL.IsAbs() || r.URL.Opaque != "" || r.URL.RawPath != "" || r.URL.RawQuery != "" || r.URL.ForceQuery || r.URL.Fragment != "" {
		nativeWriteFailure(w, 400, "INVALID_NATIVE_WRITE_PATH", "")
		return
	}
	if p == nil || !p.enabled {
		nativeWriteFailure(w, 503, "NATIVE_WRITES_DISABLED", "")
		return
	}
	if len(r.Header.Values("Origin")) != 1 || r.Header.Get("Origin") != nativeWriteOrigin || (r.Header.Get("Sec-Fetch-Site") != "" && r.Header.Get("Sec-Fetch-Site") != "same-origin") {
		nativeWriteFailure(w, 403, "NATIVE_WRITE_ORIGIN_REJECTED", "")
		return
	}
	media, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if len(r.Header.Values("Content-Type")) != 1 || err != nil || media != "application/json" || len(params) > 1 || (len(params) == 1 && !strings.EqualFold(params["charset"], "utf-8")) || r.Header.Get("Content-Encoding") != "" {
		nativeWriteFailure(w, 415, "NATIVE_WRITE_JSON_REQUIRED", "")
		return
	}
	headerHash := r.Header.Get("X-YNX-Transaction-Hash")
	if len(r.Header.Values("X-YNX-Transaction-Hash")) != 1 || !nativeReadHash.MatchString(headerHash) {
		nativeWriteFailure(w, 400, "NATIVE_SIGNED_HASH_REQUIRED", "")
		return
	}
	if r.ContentLength > nativeActionMaxBytes {
		nativeWriteFailure(w, 413, "NATIVE_ACTION_TOO_LARGE", headerHash)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, nativeActionMaxBytes)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		var max *http.MaxBytesError
		if errors.As(err, &max) {
			nativeWriteFailure(w, 413, "NATIVE_ACTION_TOO_LARGE", headerHash)
		} else {
			nativeWriteFailure(w, 400, "NATIVE_ACTION_READ_FAILED", headerHash)
		}
		return
	}
	intent, valid := parseNativeWriteIntent(raw)
	if !valid {
		nativeWriteFailure(w, 400, "INVALID_NATIVE_SIGNED_ACTION", headerHash)
		return
	}
	if intent.hash != headerHash {
		nativeWriteFailure(w, 400, "NATIVE_SIGNED_HASH_MISMATCH", headerHash)
		return
	}
	select {
	case p.slots <- struct{}{}:
		defer func() { <-p.slots }()
	default:
		nativeWriteFailure(w, 503, "NATIVE_CORE_BUSY", headerHash)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), nativeReadTimeout)
	defer cancel()
	u := *p.core.origin
	u.Path = intent.route
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(raw))
	if err != nil {
		nativeWriteFailure(w, 503, "NATIVE_CORE_UNAVAILABLE", headerHash)
		return
	}
	// Do not supply GetBody/Idempotency-Key: one request, no transport replay.
	request.GetBody = nil
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Accept-Encoding", "identity")
	request.Header.Set("User-Agent", "YNX-DEX-Native-Write/1")
	response, err := p.core.client.Do(request)
	if err != nil {
		nativeWriteFailure(w, 503, "NATIVE_CORE_ACK_UNKNOWN", headerHash)
		return
	}
	defer response.Body.Close()
	media, _, err = mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || media != "application/json" || response.Header.Get("Content-Encoding") != "" || response.ContentLength > nativeReceiptMaxBytes {
		nativeWriteFailure(w, 503, "NATIVE_CORE_INVALID_ACK", headerHash)
		return
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, nativeReceiptMaxBytes+1))
	if err != nil || len(body) > nativeReceiptMaxBytes || !strictNativeJSON(body) {
		nativeWriteFailure(w, 503, "NATIVE_CORE_INVALID_ACK", headerHash)
		return
	}
	if response.StatusCode == 200 && nativeWriteACK(body, intent) {
		// POST numbers remain original raw bytes. Exact decimal-string state and
		// durability are obtained by a separate user-visible same-hash GET.
		w.WriteHeader(200)
		_, _ = w.Write(body)
		return
	}
	var rejected struct {
		Error  string `json:"error"`
		Status string `json:"status"`
		Hash   string `json:"transactionHash"`
	}
	if json.Unmarshal(body, &rejected) != nil || rejected.Error == "" {
		nativeWriteFailure(w, 503, "NATIVE_CORE_INVALID_ACK", headerHash)
		return
	}
	if response.StatusCode == 503 && rejected.Status == "transaction_durability_uncertain" && rejected.Hash == headerHash {
		nativeWriteFailure(w, 503, "NATIVE_DURABILITY_UNCERTAIN", headerHash)
		return
	}
	// A Core rejection is not a new-intent authorization. Prior lost ACKs are
	// still reconciled by the existing same-hash read, never auto-resubmitted.
	if response.StatusCode == 409 {
		nativeWriteFailure(w, 409, "NATIVE_CORE_NONCE_OR_CONFLICT", headerHash)
		return
	}
	if response.StatusCode == 422 {
		reason := "NATIVE_CORE_ACTION_REJECTED"
		if strings.Contains(rejected.Error, "expired") {
			reason = "NATIVE_CORE_ACTION_EXPIRED"
		}
		nativeWriteFailure(w, 422, reason, headerHash)
		return
	}
	if response.StatusCode == 400 || response.StatusCode == 413 || response.StatusCode == 415 {
		nativeWriteFailure(w, response.StatusCode, "NATIVE_CORE_ACTION_INVALID", headerHash)
		return
	}
	nativeWriteFailure(w, 503, "NATIVE_CORE_ACK_UNKNOWN", headerHash)
}

func nativeWriteACK(body []byte, intent nativeWriteIntent) bool {
	var root struct {
		Source      string `json:"source"`
		Mainnet     *bool  `json:"mainnet"`
		Replayed    *bool  `json:"replayed"`
		Transaction struct {
			Hash  string `json:"hash"`
			Type  string `json:"type"`
			From  string `json:"from"`
			To    string `json:"to"`
			Nonce uint64 `json:"nonce"`
			Fee   int64  `json:"fee"`
		} `json:"transaction"`
		Result struct {
			Event struct {
				Hash   string `json:"transactionHash"`
				Action string `json:"type"`
				Signer string `json:"signer"`
				Pool   string `json:"poolId"`
			} `json:"event"`
			Pool *struct {
				ID   string `json:"id"`
				Hash string `json:"transactionHash"`
			} `json:"pool"`
		} `json:"result"`
	}
	if json.Unmarshal(body, &root) != nil || root.Source != nativeReadSource || root.Mainnet == nil || *root.Mainnet || root.Replayed == nil {
		return false
	}
	tx, e := root.Transaction, root.Result.Event
	if tx.Hash != intent.hash || tx.Type != intent.envelope.Action || tx.From != intent.envelope.Signer || tx.To != intent.pool || tx.Nonce != intent.envelope.Nonce || tx.Fee != 1 || e.Hash != intent.hash || e.Action != intent.envelope.Action || e.Signer != intent.envelope.Signer || e.Pool != intent.pool {
		return false
	}
	if root.Result.Pool == nil {
		return *root.Replayed
	}
	return root.Result.Pool.ID == intent.pool && root.Result.Pool.Hash == intent.hash
}
