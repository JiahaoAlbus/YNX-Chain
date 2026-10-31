package commerce

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const nativePayProductLimit = 2 << 20

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
		return out, ErrUnavailable
	}
	defer resp.Body.Close()
	out.Status = resp.StatusCode
	raw, err := io.ReadAll(io.LimitReader(resp.Body, nativePayProductLimit+1))
	if err != nil || len(raw) > nativePayProductLimit {
		return out, ErrUnavailable
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
