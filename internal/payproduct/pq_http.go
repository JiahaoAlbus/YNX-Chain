//go:build pay_pq

package payproduct

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const nativePayBroadcastPath = "/transactions/pq/actions/broadcast"
const nativePayOriginalPath = "/transactions/pq/actions/originals/"

// NativePayHTTPError preserves whether a failed call may already have sent a
// Member. Uncertain is conservative for every failed POST after dispatch. The
// caller must retain its original operation and reconcile; it must not resubmit
// with another nonce or interpret an HTTP rejection as finalized execution.
type NativePayHTTPError struct {
	Method, Path string
	StatusCode   int
	Uncertain    bool
	Err          error
}

func (e *NativePayHTTPError) Error() string {
	return fmt.Sprintf("native Pay HTTP %s %s (status %d): %v", e.Method, e.Path, e.StatusCode, e.Err)
}

func (e *NativePayHTTPError) Unwrap() error { return e.Err }

// NativePayHTTP carries complete original Members and configured-RPC
// observations. It neither owns funds nor independently verifies finality.
// Response URLs never select a request destination. Every call uses the sole
// constructor-pinned origin and the explicitly supplied transport.
type NativePayHTTP struct {
	origin      string
	client      *http.Client
	routePolicy *nativePayRoutePolicy
}

// NewNativePayHTTP requires an explicit transport, for example the LINK-owned
// authenticated service transport. A supplied client with nil Transport would
// silently select http.DefaultTransport and is therefore rejected. HTTP is
// permitted only for loopback fixtures/local service entry; other origins use
// HTTPS. This constructor does not claim that a transport qualifies as S3.
func NewNativePayHTTP(baseURL string, client *http.Client) (*NativePayHTTP, error) {
	if client == nil || client.Transport == nil {
		return nil, errors.New("native Pay requires an explicitly supplied HTTP transport")
	}
	u, err := url.Parse(baseURL)
	if err != nil || u == nil || u.Opaque != "" || u.User != nil || u.Host == "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawFragment != "" || u.RawPath != "" || (u.Path != "" && u.Path != "/") || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, errors.New("native Pay requires a strict service origin")
	}
	if baseURL != u.Scheme+"://"+u.Host && baseURL != u.Scheme+"://"+u.Host+"/" {
		return nil, errors.New("native Pay origin must have no alternate spelling or path")
	}
	host := u.Hostname()
	if host == "" || host != strings.ToLower(host) || strings.HasSuffix(host, ".") {
		return nil, errors.New("native Pay origin host is not canonical")
	}
	ip := net.ParseIP(host)
	if ip != nil {
		if ip.String() != host {
			return nil, errors.New("native Pay origin IP is not canonical")
		}
	} else {
		for _, label := range strings.Split(host, ".") {
			if label == "" || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
				return nil, errors.New("native Pay origin host is invalid")
			}
			for _, c := range label {
				if c != '-' && (c < 'a' || c > 'z') && (c < '0' || c > '9') {
					return nil, errors.New("native Pay origin host is invalid")
				}
			}
		}
	}
	if port := u.Port(); port != "" {
		n, err := strconv.ParseUint(port, 10, 16)
		if err != nil || n == 0 || strconv.FormatUint(n, 10) != port {
			return nil, errors.New("native Pay origin port is not canonical")
		}
	} else if strings.HasSuffix(u.Host, ":") {
		return nil, errors.New("native Pay origin port is empty")
	}
	if u.Scheme == "http" && host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return nil, errors.New("native Pay non-loopback origin requires HTTPS")
	}
	owned := *client
	owned.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &NativePayHTTP{origin: u.Scheme + "://" + u.Host, client: &owned}, nil
}

// Submit dispatches exactly one original Member to the actual frozen gateway
// broadcast route. It invokes client.Do once, supplies no replay body and never
// retries. Even a matching committed RPC observation is not payment finality.
func (h *NativePayHTTP) Submit(ctx context.Context, member []byte) (bftgateway.PQActionView, error) {
	wire := bytes.Clone(member)
	transport, action, err := nativePayHTTPMember(wire)
	if err != nil {
		return bftgateway.PQActionView{}, err
	}
	var view bftgateway.PQActionView
	status, err := h.request(ctx, http.MethodPost, nativePayBroadcastPath, wire, &view, consensus.MaxPQWalletQueryBytes)
	if err == nil {
		err = nativePayHTTPActionIdentity(view, wire, transport, action)
	}
	if err != nil {
		return bftgateway.PQActionView{}, nativePayHTTPFailure(http.MethodPost, nativePayBroadcastPath, status, err)
	}
	return view, nativePayHTTPStatus(http.MethodPost, nativePayBroadcastPath, status)
}

// Original always queries the original native hash. Missing original bytes are
// unresolved, even if an endpoint returns HTTP 200; no replacement is created.
func (h *NativePayHTTP) Original(ctx context.Context, nativeHash string) (bftgateway.PQActionView, error) {
	if !nativePayHTTPHash(nativeHash) {
		return bftgateway.PQActionView{}, errors.New("canonical native transaction hash is required")
	}
	path := nativePayOriginalPath + nativeHash
	var view bftgateway.PQActionView
	status, err := h.request(ctx, http.MethodGet, path, nil, &view, consensus.MaxPQWalletQueryBytes)
	if err == nil {
		var transport []byte
		var action ynxauth.Action
		transport, action, err = nativePayHTTPMember(view.Wire)
		if err == nil && consensus.SignedTransactionHash(view.Wire) != nativeHash {
			err = errors.New("original response differs from requested native hash")
		}
		if err == nil {
			err = nativePayHTTPActionIdentity(view, view.Wire, transport, action)
		}
	}
	if err != nil {
		return bftgateway.PQActionView{}, nativePayHTTPFailure(http.MethodGet, path, status, err)
	}
	return view, nativePayHTTPStatus(http.MethodGet, path, status)
}

// Finality fetches the original collector proof DTO only. Collected/pending
// observations remain unverified until the caller's independently pinned CORE
// proof verifier accepts them. An RPC cannot claim independentFinality here.
func (h *NativePayHTTP) Finality(ctx context.Context, nativeHash string) (bftgateway.PQFinalityView, error) {
	if !nativePayHTTPHash(nativeHash) {
		return bftgateway.PQFinalityView{}, errors.New("canonical native transaction hash is required")
	}
	path := nativePayOriginalPath + nativeHash + "/pq-finality-proof"
	var view bftgateway.PQFinalityView
	status, err := h.request(ctx, http.MethodGet, path, nil, &view, consensus.MaxPQTransactionProofRequestBytes+(1<<20))
	if err == nil && (view.NativeTransactionHash != nativeHash || view.Version != "YNX-PQ-RPC-TRANSACTION-PROOF/v1" || view.Source != "configured-comet-rpc" || view.IndependentFinality || view.ProofVerification != "not-performed" || (view.Status != "pending" && view.Status != "unavailable" && view.Status != "collected")) {
		err = errors.New("finality collector response identity or authority classification mismatch")
	}
	if err == nil && view.Status == "collected" && (view.Proof == nil || view.ExecutionHeight == 0 || view.CometIndex == nil || !nativePayHTTPHash(view.ABCITransactionHash)) {
		err = errors.New("collected finality response lacks original execution coordinates or proof")
	}
	if err != nil {
		return bftgateway.PQFinalityView{}, nativePayHTTPFailure(http.MethodGet, path, status, err)
	}
	return view, nativePayHTTPStatus(http.MethodGet, path, status)
}

// Invoice fetches the actual CORE observation, binding its subject via the
// sole native codec. The caller must validate its complete signed history and
// independently anchored state before accepting any payment/refund facts.
func (h *NativePayHTTP) Invoice(ctx context.Context, merchant, id string) (consensus.PQInvoiceView, error) {
	if _, err := ynxauth.EncodeActionPayload(ynxauth.ActionInvoiceSettle, ynxauth.InvoiceSettlePayload{Merchant: merchant, InvoiceID: id, TermsHash: bytes.Repeat([]byte{1}, 32), Amount: 1}); err != nil {
		return consensus.PQInvoiceView{}, errors.New("canonical native merchant and invoice IDs are required")
	}
	path := "/invoices/pq/" + merchant + "/" + id
	var view consensus.PQInvoiceView
	status, err := h.request(ctx, http.MethodGet, path, nil, &view, consensus.MaxPQWalletQueryBytes)
	if err == nil && (view.Source != "comet-rpc" || view.Record.Merchant != merchant || view.Record.InvoiceID != id || view.CommittedHeight <= 0) {
		err = errors.New("invoice response does not match requested committed subject")
	}
	if err != nil {
		return consensus.PQInvoiceView{}, nativePayHTTPFailure(http.MethodGet, path, status, err)
	}
	return view, nativePayHTTPStatus(http.MethodGet, path, status)
}

func nativePayHTTPMember(wire []byte) ([]byte, ynxauth.Action, error) {
	var action ynxauth.Action
	if len(wire) == 0 || len(wire) > chain.MaxPQActionMemberBytes {
		return nil, action, errors.New("original native Pay Member exceeds protocol bounds")
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return nil, action, err
	}
	canonical, err := ynxbatch.EncodeMember(member)
	if err != nil || !bytes.Equal(wire, canonical) {
		return nil, action, errors.New("native Pay Member is not canonical")
	}
	action, err = ynxauth.DecodeAction(member.Message)
	if err != nil || !ynxauth.IsInvoiceAction(action.Kind) || !bytes.Equal(action.ChainID, member.Certificate.ChainID) || action.Owner != member.Certificate.Owner || member.Certificate.Purpose != ynxauth.TransactionPurpose {
		return nil, action, errors.New("native Pay requires a matching canonical invoice Action Member")
	}
	transport, err := consensus.EncodePQNativeActionTransaction(wire)
	return transport, action, err
}

func nativePayHTTPActionIdentity(v bftgateway.PQActionView, wire, transport []byte, action ynxauth.Action) error {
	nativeHash, abciHash := consensus.SignedTransactionHash(wire), consensus.SignedTransactionHash(transport)
	if v.NativeTransactionHash != nativeHash || v.ABCITransactionHash != abciHash || !bytes.Equal(v.Wire, wire) || !bytes.Equal(v.Transport, transport) || v.Type != action.Kind || v.From != action.Owner || v.Nonce != action.Nonce || v.Fee != action.Fee || v.Source != "comet-rpc" || v.ReadbackURL != nativePayOriginalPath+nativeHash || v.ABCIReadbackURL != "/transactions/pq/actions/"+abciHash || (v.Status != "unknown" && v.Status != "committed" && v.Status != "rejected") || v.Committed != (v.Status == "committed") {
		return errors.New("native Pay response differs from exact original Member or transport identity")
	}
	if v.Committed && (v.ExecutionHeight == 0 || v.CometIndex == nil || len(v.ExecutionData) == 0 || len(v.Effects) == 0) {
		return errors.New("committed RPC observation lacks original execution coordinates and data")
	}
	return nil
}

func nativePayHTTPHash(hash string) bool {
	if len(hash) != 66 || !strings.HasPrefix(hash, "0x") {
		return false
	}
	raw, err := hex.DecodeString(hash[2:])
	return err == nil && len(raw) == 32 && "0x"+hex.EncodeToString(raw) == hash
}

func (h *NativePayHTTP) request(ctx context.Context, method, path string, body []byte, out any, limit int) (int, error) {
	if h == nil || h.client == nil || h.client.Transport == nil || ctx == nil {
		return 0, errors.New("native Pay HTTP caller is not configured")
	}
	request, err := http.NewRequestWithContext(ctx, method, h.origin+path, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	request.GetBody = nil // No redirect/retry may replay a dispatched Member.
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Cache-Control", "no-store")
	if method == http.MethodPost {
		request.Header.Set("Content-Type", "application/octet-stream")
	}
	response, err := h.client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	if response.ContentLength > int64(limit) {
		return response.StatusCode, errors.New("native Pay response exceeds bounded read")
	}
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return response.StatusCode, errors.New("native Pay response is not JSON")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, int64(limit)+1))
	if err != nil {
		return response.StatusCode, err
	}
	if len(raw) > limit {
		return response.StatusCode, errors.New("native Pay response exceeds bounded read")
	}
	if err := nativePayHTTPDecode(raw, out); err != nil {
		return response.StatusCode, err
	}
	return response.StatusCode, nil
}

func nativePayHTTPFailure(method, path string, status int, err error) error {
	return &NativePayHTTPError{Method: method, Path: path, StatusCode: status, Uncertain: method == http.MethodPost, Err: err}
}

func nativePayHTTPStatus(method, path string, status int) error {
	if status >= 200 && status < 300 {
		return nil
	}
	return nativePayHTTPFailure(method, path, status, errors.New("unexpected HTTP response status; no funds outcome inferred"))
}

func nativePayHTTPDecode(raw []byte, out any) error {
	if !utf8.Valid(raw) || len(bytes.TrimSpace(raw)) == 0 || bytes.TrimSpace(raw)[0] != '{' {
		return errors.New("native Pay response must be one UTF-8 JSON object")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var value func(int) error
	value = func(depth int) error {
		if depth > 64 {
			return errors.New("native Pay JSON nesting exceeds bound")
		}
		token, err := d.Token()
		if err != nil {
			return err
		}
		switch token {
		case json.Delim('{'):
			seen := map[string]bool{}
			for d.More() {
				key, err := d.Token()
				name, ok := key.(string)
				if err != nil || !ok || seen[name] {
					return errors.New("native Pay JSON contains an invalid or duplicate field")
				}
				seen[name] = true
				if err := value(depth + 1); err != nil {
					return err
				}
			}
			_, err = d.Token()
		case json.Delim('['):
			for d.More() {
				if err := value(depth + 1); err != nil {
					return err
				}
			}
			_, err = d.Token()
		}
		return err
	}
	if err := value(0); err != nil {
		return err
	}
	if _, err := d.Token(); !errors.Is(err, io.EOF) {
		return errors.New("native Pay response contains trailing JSON")
	}
	d = json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	d.UseNumber()
	if err := d.Decode(out); err != nil {
		return fmt.Errorf("invalid native Pay response DTO: %w", err)
	}
	return nil
}
