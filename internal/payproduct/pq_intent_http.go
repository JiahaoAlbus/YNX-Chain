//go:build pay_pq

package payproduct

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (s *NativeInvoiceIntents) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v5/pay/invoice-intents", func(w http.ResponseWriter, r *http.Request) {
		var input NativeInvoiceProductIntent
		if !nativePayBody(w, r, &input) {
			return
		}
		view, err := s.CreateInvoiceIntent(r.Context(), input, func() error { return r.Context().Err() })
		if err != nil {
			nativePayError(w, err)
			return
		}
		writeJSON(w, 202, view)
	})
	mux.HandleFunc("POST /v5/pay/invoice-intents/lookup", func(w http.ResponseWriter, r *http.Request) {
		var input NativeInvoiceProductIntent
		if !nativePayBody(w, r, &input) {
			return
		}
		view, err := s.LookupInvoiceIntent(r.Context(), input)
		if err != nil {
			nativePayError(w, err)
			return
		}
		writeJSON(w, 200, view)
	})
	mux.HandleFunc("GET /v5/pay/invoice-intents/{id}", func(w http.ResponseWriter, r *http.Request) {
		view, err := s.ReadInvoiceIntent(r.Context(), r.PathValue("id"))
		if err != nil {
			nativePayError(w, err)
			return
		}
		writeJSON(w, 200, view)
	})
	mux.HandleFunc("POST /v5/pay/invoice-intents/{id}/merchant-review", func(w http.ResponseWriter, r *http.Request) {
		var input struct{}
		if !nativePayBody(w, r, &input) {
			return
		}
		view, err := s.MerchantTermsReview(r.Context(), r.PathValue("id"))
		if err != nil {
			nativePayError(w, err)
			return
		}
		writeJSON(w, 200, view)
	})
	mux.HandleFunc("POST /v5/pay/invoice-intents/{id}/merchant-member", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Member []byte `json:"member"`
		}
		if !nativePayBody(w, r, &input) {
			return
		}
		view, err := s.SubmitMerchantTerms(r.Context(), r.PathValue("id"), input.Member)
		if err != nil {
			nativePayError(w, err)
			return
		}
		writeJSON(w, 202, view)
	})
	mux.HandleFunc("POST /v5/pay/invoice-intents/{id}/reconcile", func(w http.ResponseWriter, r *http.Request) {
		var input struct{}
		if !nativePayBody(w, r, &input) {
			return
		}
		view, err := s.ReconcileInvoiceIntent(r.Context(), r.PathValue("id"))
		if err != nil {
			nativePayError(w, err)
			return
		}
		writeJSON(w, 200, view)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.RawQuery != "" || r.URL.RawPath != "" || r.URL.Fragment != "" {
			nativePayError(w, errors.New("exact private native intent route required"))
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// This is the normal cross-product private HTTP adapter. The explicitly supplied
// transport must carry the real service/caller authentication. Nothing in the
// request builds a Source grant; no default transport, redirect or retry exists.
type NativeInvoiceIntentClient struct{ http *NativePayHTTP }

func NewNativeInvoiceIntentClient(origin string, client *http.Client) (*NativeInvoiceIntentClient, error) {
	caller, err := NewNativePayHTTP(origin, client)
	if err != nil {
		return nil, err
	}
	if caller.client.Timeout == 0 {
		caller.client.Timeout = 15 * time.Second
	}
	return &NativeInvoiceIntentClient{caller}, nil
}
func (c *NativeInvoiceIntentClient) call(ctx context.Context, method, path string, in, out any) error {
	return c.callBounded(ctx, method, path, in, out, 2<<20)
}
func (c *NativeInvoiceIntentClient) callBounded(ctx context.Context, method, path string, in, out any, limit int64) error {
	if c == nil || c.http == nil {
		return ErrNativePayUnavailable
	}
	var raw []byte
	var err error
	if in != nil {
		raw, err = json.Marshal(in)
		if err != nil {
			return err
		}
		if len(raw) > 2<<20 {
			return errors.New("bounded product invoice request required")
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.http.origin+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.GetBody = nil
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cache-Control", "no-store")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := c.http.client.Do(req)
	if err != nil {
		return nativePayHTTPFailure(method, path, 0, err)
	}
	defer response.Body.Close()
	media, _, e := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if e != nil || media != "application/json" || response.ContentLength > limit {
		return nativePayHTTPFailure(method, path, response.StatusCode, errors.New("bounded private invoice JSON response required"))
	}
	raw, err = io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || int64(len(raw)) > limit {
		return nativePayHTTPFailure(method, path, response.StatusCode, errors.New("private invoice response unavailable"))
	}
	if response.StatusCode == 503 {
		return nativePayHTTPFailure(method, path, 503, ErrNativePayUnavailable)
	}
	if response.StatusCode == 409 {
		var failure struct {
			Code  string `json:"code"`
			Error string `json:"error"`
		}
		if json.Unmarshal(raw, &failure) == nil && failure.Code == "NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE" {
			return nativePayHTTPFailure(method, path, 409, ErrNativePayOriginalArchiveUnavailable)
		}
	}
	if err = nativePayHTTPStatus(method, path, response.StatusCode); err != nil {
		return err
	}
	if err = nativePayHTTPDecode(raw, out); err != nil {
		return nativePayHTTPFailure(method, path, response.StatusCode, err)
	}
	return nil
}

// Public retained verification DATA only; the caller's real transport/Source
// owns this exact GET grant. No Wallet Member5 scope, approve, retry or current
// account snapshot can create a historical record or independent trust.
func (c *NativeInvoiceIntentClient) ReadOriginalArchive(ctx context.Context, merchant, id, nativeHash string, current func() error) (NativePayOriginalArchive, error) {
	var a NativePayOriginalArchive
	canonical, err := accountaddress.Normalize(merchant)
	if err != nil || canonical != merchant || !identifierRE.MatchString(id) || !nativePayHTTPHash(nativeHash) || current == nil {
		return a, errors.New("exact current original archive reference required")
	}
	if err = current(); err != nil {
		return a, err
	}
	if err = c.callBounded(ctx, "GET", "/v5/pay/invoices/"+merchant+"/"+id+"/originals/"+nativeHash, nil, &a, NativePayOriginalArchiveMaxBytes); err != nil {
		return NativePayOriginalArchive{}, err
	}
	if err = current(); err != nil {
		return NativePayOriginalArchive{}, err
	}
	if a.Version != "ynx.pay.native.originals/v1" || a.Digest != nativeArchiveDigest(a) || a.Original.Merchant != merchant || a.Original.InvoiceID != id || a.Original.NativeHash != nativeHash || a.Verified.NativeGrant {
		return NativePayOriginalArchive{}, errors.New("different original archive DATA returned")
	}
	return a, nil
}
func (c *NativeInvoiceIntentClient) CreateInvoiceIntent(ctx context.Context, input NativeInvoiceProductIntent, current func() error) (NativeInvoiceIntentView, error) {
	var view NativeInvoiceIntentView
	if current == nil {
		return view, ErrNativePayUnavailable
	}
	if err := current(); err != nil {
		return view, err
	}
	if err := c.call(ctx, "POST", "/v5/pay/invoice-intents", input, &view); err != nil {
		return view, err
	}
	if err := current(); err != nil {
		return NativeInvoiceIntentView{}, err
	}
	return view, validateNativeIntentReply(input, view)
}
func (c *NativeInvoiceIntentClient) LookupInvoiceIntent(ctx context.Context, input NativeInvoiceProductIntent) (NativeInvoiceIntentView, error) {
	var view NativeInvoiceIntentView
	if err := c.call(ctx, "POST", "/v5/pay/invoice-intents/lookup", input, &view); err != nil {
		return view, err
	}
	return view, validateNativeIntentReply(input, view)
}
func (c *NativeInvoiceIntentClient) ReadInvoiceIntent(ctx context.Context, id string) (NativeInvoiceIntentView, error) {
	var view NativeInvoiceIntentView
	if !nativeIntentID(id) {
		return view, errors.New("original intent ID required")
	}
	if err := c.call(ctx, "GET", "/v5/pay/invoice-intents/"+id, nil, &view); err != nil {
		return view, err
	}
	if view.IntentID != id {
		return NativeInvoiceIntentView{}, errors.New("private invoice returned a different original")
	}
	return view, validateNativeIntentReply(view.Request, view)
}
func (c *NativeInvoiceIntentClient) MerchantTermsReview(ctx context.Context, id string) (NativeMerchantTermsReview, error) {
	var view NativeMerchantTermsReview
	if !nativeIntentID(id) {
		return view, errors.New("original intent ID required")
	}
	if err := c.call(ctx, "POST", "/v5/pay/invoice-intents/"+id+"/merchant-review", struct{}{}, &view); err != nil {
		return view, err
	}
	if view.Intent.IntentID != id {
		return NativeMerchantTermsReview{}, errors.New("private review returned a different original")
	}
	if err := validateNativeIntentReply(view.Intent.Request, view.Intent); err != nil {
		return NativeMerchantTermsReview{}, err
	}
	action, err := ynxauth.DecodeAction(view.Message)
	if err != nil {
		return NativeMerchantTermsReview{}, err
	}
	payload, err := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
	terms, ok := payload.(ynxauth.InvoiceTermsPayload)
	if err != nil || !ok || action.Kind != ynxauth.ActionInvoiceTerms || action.Owner != view.Intent.Merchant || action.Owner != view.Owner || hex.EncodeToString(action.ChainID) != view.Intent.Request.Genesis || strconv.FormatUint(action.NativeChainID, 10) != view.Intent.Request.NativeChainID || strconv.FormatUint(action.Nonce, 10) != view.Nonce || action.Fee != 1 || view.FeeAtoms != "1" || nativeIntentMessageHash(view.Message) != view.Intent.SigningMessageHash || hashJSON(nativeIntentView(nativeInvoiceIntentRecord{Terms: terms}).Terms) != hashJSON(view.Intent.Terms) {
		return NativeMerchantTermsReview{}, errors.New("merchant native signing message differs from original intent")
	}
	return view, nil
}
func (c *NativeInvoiceIntentClient) SubmitMerchantTerms(ctx context.Context, id string, member []byte) (NativeInvoiceIntentView, error) {
	var view NativeInvoiceIntentView
	if !nativeIntentID(id) {
		return view, errors.New("original intent ID required")
	}
	if err := c.call(ctx, "POST", "/v5/pay/invoice-intents/"+id+"/merchant-member", struct {
		Member []byte `json:"member"`
	}{member}, &view); err != nil {
		return view, err
	}
	if view.IntentID != id {
		return NativeInvoiceIntentView{}, errors.New("private invoice returned a different original")
	}
	return view, validateNativeIntentReply(view.Request, view)
}
func nativeIntentID(id string) bool {
	if len(id) != 52 || !strings.HasPrefix(id, "npi_") {
		return false
	}
	for _, c := range id[4:] {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
func validateNativeIntentReply(request NativeInvoiceProductIntent, view NativeInvoiceIntentView) error {
	if hashJSON(request) != hashJSON(view.Request) || view.IntentID != nativeIntentSlot(request) || view.OriginalOperation != view.IntentID || view.Merchant != request.Merchant || view.Terms.Recipient != request.Recipient || view.Terms.AssetID != request.AssetID || view.Terms.UnitVersion != request.UnitVersion || view.Terms.AmountAtoms != request.AmountAtoms || (view.State != "PREPARED" && view.State != "ISSUED") {
		return errors.New("private producer returned a different original bill/Money binding")
	}
	hash, hashErr := hex.DecodeString(view.SigningMessageHash)
	if hashErr != nil || len(hash) != 32 || hex.EncodeToString(hash) != view.SigningMessageHash {
		return errors.New("original signing message identity missing")
	}
	if view.State == "ISSUED" && (!nativePayHTTPHash(view.TermsNativeHash) || !nativePayHTTPHash(view.TermsABCIHash) || view.Invoice == nil) {
		return errors.New("issued invoice lacks original proof-gated projection")
	}
	// Reuse the original CORE codec for all terms, including IDs, fees and height.
	raw, _ := json.Marshal(view.Terms)
	var fields map[string]json.RawMessage
	if err := nativePayHTTPDecode(raw, &fields); err != nil {
		return err
	}
	_, err := decodeNativeTermsInput(fields)
	return err
}
