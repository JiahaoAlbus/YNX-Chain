package commerce

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

const nativePayProductLimit = 2 << 20

// Existing P06 NativePayOriginalArchiveMaxBytes contract: Core proof80MiB +
// archive overhead16MiB. This bound applies ONLY to original archive reads.
const nativePayOriginalArchiveLimit = 96 << 20

var ErrNativeShopPayOriginalArchiveUnavailable = errors.New("NATIVE_PAY_SETTLEMENT_ARCHIVE_UNAVAILABLE")

// P06 product DATA only. Its real joint Source independently checks every
// field against the registered merchant, original order and approved price.
type NativeShopInvoiceRequestDATA struct {
	ProductID     string          `json:"productId"`
	StoreID       string          `json:"storeId,omitempty"`
	SourceOrder   string          `json:"sourceOrder"`
	Merchant      string          `json:"merchant"`
	Recipient     string          `json:"recipient"`
	Genesis       string          `json:"genesis"`
	NativeChainID string          `json:"nativeChainId"`
	AssetID       string          `json:"assetId"`
	UnitVersion   string          `json:"unitVersion"`
	AmountAtoms   string          `json:"amountAtoms"`
	DomainData    json.RawMessage `json:"domainData"`
}

func (c *NativeShopPayClient) CreateOriginalInvoiceIntentDATA(ctx context.Context, input NativeShopInvoiceRequestDATA) (NativeShopPayExchange, error) {
	input.DomainData = bytes.Clone(input.DomainData)
	return c.exchange(ctx, "POST", "/v5/pay/invoice-intents", input, true)
}

func (c *NativeShopPayClient) LookupOriginalInvoiceIntentDATA(ctx context.Context, input NativeShopInvoiceRequestDATA) (NativeShopPayExchange, error) {
	input.DomainData = bytes.Clone(input.DomainData)
	return c.exchange(ctx, "POST", "/v5/pay/invoice-intents/lookup", input, false)
}

// NativeShopPayTerms is P06's product DATA, not CORE signing bytes or approval.
// Amounts remain exact atom strings. Legacy order decimals are never converted.
type NativeShopPayTerms struct {
	InvoiceID       string `json:"invoiceId"`
	SessionID       string `json:"sessionId"`
	Recipient       string `json:"recipient"`
	Payer           string `json:"payer"`
	AssetID         string `json:"assetId"`
	UnitVersion     string `json:"unitVersion"`
	FeeRule         string `json:"feeRule"`
	KeyEpoch        string `json:"keyEpoch"`
	Revision        string `json:"revision"`
	AmountAtoms     string `json:"amountAtoms"`
	MaxFeeAtoms     string `json:"maxFeeAtoms"`
	ExpiresAtHeight string `json:"expiresAtHeight"`
}

// NativeShopPayExchange preserves exact original request/response for the
// existing Shop BusinessEffects journal. It is not a verified funds receipt.
// A failed mutation after dispatch remains uncertain even on HTTP rejection;
// callers recover the retained original hash, never resend a new Member.
type NativeShopPayExchange struct {
	Method, Path      string
	Request, Response []byte
	Status            int
	Uncertain         bool
}

// NativeShopPayClient is only the P06 product transport consumer. The original
// Source must separately bind Store/order/product merchant/payer/approved bill,
// and the original Wallet must approve/sign the sole CORE Member. This client
// supplies none of those authorities and never changes inventory or paid state.
type NativeShopPayClient struct {
	origin string
	client http.Client
}

func NewOriginalNativeShopPayClient(origin string, original *http.Client) (*NativeShopPayClient, error) {
	if original == nil || original.Transport == nil {
		return nil, ErrUnavailable
	}
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Opaque != "" || u.Path != "" || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawFragment != "" || origin != "https://"+u.Host {
		return nil, ErrInvalidState
	}
	owned := *original
	if owned.Timeout == 0 {
		owned.Timeout = 15 * time.Second
	}
	owned.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &NativeShopPayClient{origin: origin, client: owned}, nil
}

func nativeShopPaySegment(v string) bool {
	if len(v) == 0 || len(v) > 256 || v == "." || v == ".." {
		return false
	}
	for _, c := range v {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("-_.:", c)) {
			return false
		}
	}
	return true
}

func nativeShopPayInvoicePath(merchant, invoice string) (string, error) {
	if !nativeShopPaySegment(merchant) || !nativeShopPaySegment(invoice) {
		return "", ErrInvalidState
	}
	return "/v5/pay/invoices/" + merchant + "/" + invoice, nil
}

func (c *NativeShopPayClient) exchange(ctx context.Context, method, path string, input any, mutation bool) (out NativeShopPayExchange, err error) {
	return c.exchangeBounded(ctx, method, path, input, mutation, nativePayProductLimit)
}

func (c *NativeShopPayClient) exchangeBounded(ctx context.Context, method, path string, input any, mutation bool, responseLimit int64) (out NativeShopPayExchange, err error) {
	out.Method, out.Path = method, path
	if c == nil || c.client.Transport == nil || ctx == nil {
		return out, ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	if input != nil {
		out.Request, err = json.Marshal(input)
		if err != nil || len(out.Request) > nativePayProductLimit {
			return out, ErrInvalidState
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.origin+path, bytes.NewReader(out.Request))
	if err != nil {
		return out, err
	}
	// Prevent net/http from obtaining a replay body after a failed connection.
	req.GetBody = nil
	req.Header.Set("Accept", "application/json")
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	out.Uncertain = mutation
	resp, err := c.client.Do(req) // exactly one dispatch, no retry or fallback
	if err != nil {
		return out, errors.Join(err, ErrUnavailable)
	}
	defer resp.Body.Close()
	out.Status = resp.StatusCode
	if responseLimit <= 0 || resp.ContentLength > responseLimit {
		return out, ErrUnavailable
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, responseLimit+1))
	if err != nil || int64(len(raw)) > responseLimit {
		return out, errors.Join(err, ErrUnavailable)
	}
	// Retain original bounded bytes even when unusable. They must not be
	// silently replaced by a later observation or reinterpreted as success.
	out.Response = bytes.Clone(raw)
	if len(resp.Header.Values("Content-Type")) != 1 || resp.Header.Get("Content-Type") != "application/json" || !json.Valid(raw) || resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return out, ErrUnavailable
	}
	out.Uncertain = false
	return out, nil
}

// ReadOriginalArchiveDATA consumes P06's existing retained-public-archive GET.
// It preserves original response bytes even on late current failure, so the
// owning caller can retain/reconcile them. Neither JSON finalized/authority
// fields nor a successful transport grant Source/funds authority. Use P06's
// actual normal typed archive client/validator for the historical DATA; only a
// genuine qualified receipt consumer may subsequently apply a financial claim.
// There is no lookup/create/reconcile POST or current-account backfill here.
func (c *NativeShopPayClient) ReadOriginalArchiveDATA(ctx context.Context, merchant, invoice, nativeHash string, current func() error) (out NativeShopPayExchange, err error) {
	canonical, e := accountaddress.Normalize(merchant)
	hash, he := hex.DecodeString(vPrefix(nativeHash, "0x"))
	path, pe := nativeShopPayInvoicePath(merchant, invoice)
	if e != nil || canonical != merchant || he != nil || len(hash) != 32 || "0x"+hex.EncodeToString(hash) != nativeHash || pe != nil {
		return out, ErrInvalidState
	}
	if ctx == nil || current == nil {
		return out, ErrUnavailable
	}
	if err = ctx.Err(); err != nil {
		return out, err
	}
	if err = current(); err != nil {
		return out, err
	}
	out, err = c.exchangeBounded(ctx, "GET", path+"/originals/"+nativeHash, nil, false, nativePayOriginalArchiveLimit)
	if out.Status == http.StatusConflict {
		var failure struct {
			Code string `json:"code"`
		}
		if json.Unmarshal(out.Response, &failure) == nil && failure.Code == ErrNativeShopPayOriginalArchiveUnavailable.Error() {
			return out, errors.Join(err, ErrNativeShopPayOriginalArchiveUnavailable)
		}
	}
	if err != nil {
		return out, err
	}
	if err = current(); err != nil {
		return out, err
	}
	return out, ctx.Err()
}

func (c *NativeShopPayClient) ReviewTerms(ctx context.Context, order string, terms NativeShopPayTerms) (NativeShopPayExchange, error) {
	if order == "" || len(order) > 256 {
		return NativeShopPayExchange{}, ErrInvalidState
	}
	return c.exchange(ctx, "POST", "/v5/pay/invoice-terms/review", struct {
		SourceOrder string             `json:"sourceOrder"`
		Terms       NativeShopPayTerms `json:"terms"`
	}{order, terms}, false)
}

func (c *NativeShopPayClient) RegisterTerms(ctx context.Context, order string, member []byte) (NativeShopPayExchange, error) {
	if order == "" || len(order) > 256 || len(member) == 0 || len(member) > 1<<20 {
		return NativeShopPayExchange{}, ErrInvalidState
	}
	return c.exchange(ctx, "POST", "/v5/pay/invoices", struct {
		SourceOrder string `json:"sourceOrder"`
		Member      []byte `json:"member"`
	}{order, bytes.Clone(member)}, true)
}

func (c *NativeShopPayClient) Read(ctx context.Context, merchant, invoice string) (NativeShopPayExchange, error) {
	path, err := nativeShopPayInvoicePath(merchant, invoice)
	if err != nil {
		return NativeShopPayExchange{}, err
	}
	return c.exchange(ctx, "GET", path, nil, false)
}

func (c *NativeShopPayClient) ReviewSettlement(ctx context.Context, merchant, invoice string) (NativeShopPayExchange, error) {
	path, err := nativeShopPayInvoicePath(merchant, invoice)
	if err != nil {
		return NativeShopPayExchange{}, err
	}
	return c.exchange(ctx, "POST", path+"/review", struct{}{}, false)
}

func (c *NativeShopPayClient) ReviewRefund(ctx context.Context, merchant, invoice, refund, amount string) (NativeShopPayExchange, error) {
	path, err := nativeShopPayInvoicePath(merchant, invoice)
	n, numberErr := strconv.ParseUint(amount, 10, 64)
	if err != nil || !nativeShopPaySegment(refund) || numberErr != nil || n == 0 || strconv.FormatUint(n, 10) != amount {
		return NativeShopPayExchange{}, ErrInvalidState
	}
	return c.exchange(ctx, "POST", path+"/refund-review", struct {
		RefundID string `json:"refundId"`
		Amount   string `json:"amountAtoms"`
	}{refund, amount}, false)
}

func (c *NativeShopPayClient) submit(ctx context.Context, merchant, invoice string, member []byte, refund bool) (NativeShopPayExchange, error) {
	path, err := nativeShopPayInvoicePath(merchant, invoice)
	if err != nil || len(member) == 0 || len(member) > 1<<20 {
		return NativeShopPayExchange{}, ErrInvalidState
	}
	suffix := "/settlements"
	if refund {
		suffix = "/refunds"
	}
	return c.exchange(ctx, "POST", path+suffix, struct {
		Member []byte `json:"member"`
	}{bytes.Clone(member)}, true)
}

func (c *NativeShopPayClient) SubmitSettlement(ctx context.Context, merchant, invoice string, member []byte) (NativeShopPayExchange, error) {
	return c.submit(ctx, merchant, invoice, member, false)
}
func (c *NativeShopPayClient) SubmitRefund(ctx context.Context, merchant, invoice string, member []byte) (NativeShopPayExchange, error) {
	return c.submit(ctx, merchant, invoice, member, true)
}

func (c *NativeShopPayClient) Reconcile(ctx context.Context, merchant, invoice, originalHash string) (NativeShopPayExchange, error) {
	path, err := nativeShopPayInvoicePath(merchant, invoice)
	hash, hashErr := hex.DecodeString(originalHash)
	if err != nil || hashErr != nil || len(hash) != 32 || hex.EncodeToString(hash) != originalHash {
		return NativeShopPayExchange{}, ErrInvalidState
	}
	return c.exchange(ctx, "POST", path+"/operations/"+originalHash+"/reconcile", struct{}{}, false)
}

// P06's stable product operation is the original intent ID, not a later native
// or ABCI hash. These are read/reconcile-only consumer routes. In particular,
// PREPARED/signed_not_submitted lookup must not create, review, sign or send.
func originalNativeShopPayIntentPath(operation string) (string, error) {
	if len(operation) != 52 || !strings.HasPrefix(operation, "npi_") {
		return "", ErrInvalidState
	}
	raw, err := hex.DecodeString(operation[4:])
	if err != nil || len(raw) != 24 || hex.EncodeToString(raw) != operation[4:] {
		return "", ErrInvalidState
	}
	return "/v5/pay/invoice-intents/" + operation, nil
}

// ReadOriginalInvoiceIntent carries the existing original operation only. The
// original Pay Source checks sourceOrder/merchant/store/caller and returns its
// retained request; Shop never reconstructs that approved bill from current
// prices. Raw response DATA is not a paid/refunded acknowledgement.
func (c *NativeShopPayClient) ReadOriginalInvoiceIntent(ctx context.Context, originalOperation string) (NativeShopPayExchange, error) {
	path, err := originalNativeShopPayIntentPath(originalOperation)
	if err != nil {
		return NativeShopPayExchange{}, err
	}
	return c.exchange(ctx, "GET", path, nil, false)
}

func (c *NativeShopPayClient) ReconcileOriginalInvoiceIntent(ctx context.Context, originalOperation string) (NativeShopPayExchange, error) {
	path, err := originalNativeShopPayIntentPath(originalOperation)
	if err != nil {
		return NativeShopPayExchange{}, err
	}
	return c.exchange(ctx, "POST", path+"/reconcile", struct{}{}, false)
}
