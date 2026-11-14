//go:build pay_pq

package payproduct

import (
	"context"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

const nativeArchiveProductPrefix = "/v5/pay/products/{product}/{sourceOrder}/invoices/{merchant}/{invoice}"

// IsNativePayOriginalArchiveWireRoute checks only the two finite read routes.
// It grants no transport/Root/Source permission. Only the exact canonical %3A
// encoding is accepted inside identifiers; no general escaped-path proxy.
func IsNativePayOriginalArchiveWireRoute(method, path string) bool {
	if method != http.MethodGet {
		return false
	}
	p := strings.Split(path, "/")
	if len(p) != 10 && len(p) != 12 {
		return false
	}
	if p[0] != "" || p[1] != "v5" || p[2] != "pay" || p[3] != "products" || (p[4] != "shop.order" && p[4] != "cloud.ide-usage") || p[6] != "invoices" {
		return false
	}
	for _, value := range []string{p[5], p[8]} {
		decoded, err := url.PathUnescape(value)
		if err != nil || !identifierRE.MatchString(decoded) || strings.ReplaceAll(decoded, ":", "%3A") != value {
			return false
		}
	}
	if len(p[7]) != 42 || !strings.HasPrefix(p[7], "0x") {
		return false
	}
	merchant, err := hex.DecodeString(p[7][2:])
	if err != nil || hex.EncodeToString(merchant) != p[7][2:] {
		return false
	}
	if len(p) == 10 {
		return p[9] == "archive-reconciliation"
	}
	return p[9] == "originals" && nativePayHTTPHash(p[10]) && p[11] == "receipt"
}

func (s *NativeInvoiceIntents) originalArchiveProduct(ctx context.Context, product, order, merchant, id string) (nativeInvoiceIntentRecord, NativeInvoiceIntentView, NativeInvoiceIntentBinding, error) {
	var empty nativeInvoiceIntentRecord
	var view NativeInvoiceIntentView
	var grant NativeInvoiceIntentBinding
	if !identifierRE.MatchString(product) || !identifierRE.MatchString(order) || !identifierRE.MatchString(id) {
		return empty, view, grant, errors.New("exact original archive product reference required")
	}
	selector := NativeInvoiceProductIntent{Genesis: hex.EncodeToString(s.native.cfg.Genesis), ProductID: product, SourceOrder: order, Merchant: merchant}
	record, grant, err := s.readRecord(ctx, nativeIntentSlot(selector), "read")
	if err != nil {
		return record, view, grant, err
	}
	if record.Request.ProductID != product || record.Request.SourceOrder != order || record.Merchant != merchant || record.Terms.InvoiceID != id {
		return empty, view, grant, errors.New("original archive product selection changed")
	}
	view, err = s.ReadInvoiceIntent(ctx, record.ID)
	return record, view, grant, err
}

func (s *NativeInvoiceIntents) ReadOriginalArchiveReceipt(ctx context.Context, product, order, merchant, id, hash string) (NativePayArchiveReceipt, error) {
	record, intent, grant, err := s.originalArchiveProduct(ctx, product, order, merchant, id)
	if err != nil {
		return NativePayArchiveReceipt{}, err
	}
	archive, err := s.native.ReadOriginalArchive(ctx, merchant, id, hash)
	if err != nil {
		return NativePayArchiveReceipt{}, err
	}
	receipt, err := nativeArchiveReceiptForIntent(ctx, record.Request, intent, hash, archive, s.native.cfg.ProofSource, func() error { return s.fence(ctx, grant) })
	if err != nil {
		return NativePayArchiveReceipt{}, err
	}
	if _, err = s.native.Read(ctx, merchant, id); err != nil {
		return NativePayArchiveReceipt{}, err
	}
	if err = s.fence(ctx, grant); err != nil {
		return NativePayArchiveReceipt{}, err
	}
	return receipt, nil
}

func (s *NativeInvoiceIntents) ReadOriginalArchiveReconciliation(ctx context.Context, product, order, merchant, id string) (NativePayArchiveReconciliation, error) {
	record, intent, grant, err := s.originalArchiveProduct(ctx, product, order, merchant, id)
	if err != nil {
		return NativePayArchiveReconciliation{}, err
	}
	return nativeArchiveReconciliationForIntent(record.Request, id, intent,
		func(hash string) (NativePayArchiveReceipt, error) {
			if err := s.fence(ctx, grant); err != nil {
				return NativePayArchiveReceipt{}, err
			}
			archive, err := s.native.ReadOriginalArchive(ctx, merchant, id, hash)
			if err != nil {
				return NativePayArchiveReceipt{}, err
			}
			return nativeArchiveReceiptForIntent(ctx, record.Request, intent, hash, archive, s.native.cfg.ProofSource, func() error { return s.fence(ctx, grant) })
		}, func() (NativeInvoiceIntentView, error) {
			if err := s.fence(ctx, grant); err != nil {
				return NativeInvoiceIntentView{}, err
			}
			return s.ReadInvoiceIntent(ctx, record.ID)
		})
}

func (s *NativeInvoiceIntents) mountOriginalArchiveReceipts(mux *http.ServeMux) {
	mux.HandleFunc("GET "+nativeArchiveProductPrefix+"/originals/{nativeHash}/receipt", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" || r.ContentLength != 0 {
			nativePayError(w, errors.New("exact archive receipt GET without body/query required"))
			return
		}
		receipt, err := s.ReadOriginalArchiveReceipt(r.Context(), r.PathValue("product"), r.PathValue("sourceOrder"), r.PathValue("merchant"), r.PathValue("invoice"), r.PathValue("nativeHash"))
		if err != nil {
			nativePayError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, receipt)
	})
	mux.HandleFunc("GET "+nativeArchiveProductPrefix+"/archive-reconciliation", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" || r.ContentLength != 0 {
			nativePayError(w, errors.New("exact archive reconciliation GET without body/query required"))
			return
		}
		receipt, err := s.ReadOriginalArchiveReconciliation(r.Context(), r.PathValue("product"), r.PathValue("sourceOrder"), r.PathValue("merchant"), r.PathValue("invoice"))
		if err != nil {
			nativePayError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, receipt)
	})
}
