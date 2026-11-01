// Package productreadsource supplies original protected Product Source reads.
// It does not register a Root, mint a Pay signer, or turn transport into Source.
package productreadsource

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"regexp"
)

var (
	ErrNotSupplied = errors.New("PRODUCT_READ_SOURCE_NOT_SUPPLIED")
	ErrDenied      = errors.New("PRODUCT_READ_SOURCE_DENIED")
	ErrRetired     = errors.New("PRODUCT_READ_SOURCE_RETIRED")
	ErrPending     = errors.New("PRODUCT_READ_SOURCE_CHILDREN_PENDING")
	ErrUnknown     = errors.New("PRODUCT_READ_SOURCE_CLOSE_UNKNOWN")
)

const Purpose = "wallet-native-product-source-v1"
const SelectionKey = "walletNativeProductV1"

type ProductReference struct {
	ProductID   string `json:"productId"`
	SourceOrder string `json:"sourceOrder"`
}
type ScopeDATA struct {
	Version              int                `json:"version"`
	NetworkID            string             `json:"networkId"`
	Account              string             `json:"account"`
	ProtectedResourceRef string             `json:"protectedResourceRef"`
	Operations           []string           `json:"operations"`
	Products             []ProductReference `json:"products"`
}
type ProfileDATA struct {
	Realm, Tenant, Purpose string
	Epoch                  uint64
	Socket, Service        string
	PeerUID                uint32
	PeerPID                int
	Orders                 []string
}
type ReadScopeDATA struct {
	Realm, Tenant, Purpose                       string
	Epoch                                        uint64
	Actor, Role, StoreID, ProductID, SourceOrder string
}

var token = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$`)
var network = regexp.MustCompile(`^[a-f0-9]{64}$`)
var owner = regexp.MustCompile(`^0x[a-f0-9]{40}$`)
var operations = map[string]bool{"createInvoiceIntent": true, "lookupInvoiceIntent": true, "merchantTermsReview": true, "readInvoiceIntent": true, "readInvoice": true, "readInvoiceEvents": true, "reviewSettlement": true, "reviewRefund": true, "reconcileInvoiceIntent": true, "reconcileOperation": true, "readOriginalInvoiceIntent": true, "readInvoiceOriginals": true}

func validateScope(s ScopeDATA) error {
	if s.Version != 1 || !network.MatchString(s.NetworkID) || !owner.MatchString(s.Account) || !token.MatchString(s.ProtectedResourceRef) || len(s.Operations) < 1 || len(s.Operations) > 12 || len(s.Products) > 64 {
		return ErrDenied
	}
	seen := map[string]bool{}
	read := false
	for _, v := range s.Operations {
		if !operations[v] || seen[v] {
			return ErrDenied
		}
		seen[v] = true
		if v == "readOriginalInvoiceIntent" {
			read = true
		}
	}
	seen = map[string]bool{}
	for _, v := range s.Products {
		k := v.ProductID + "/" + v.SourceOrder
		if (v.ProductID != "shop.order" && v.ProductID != "cloud.ide-usage") || !token.MatchString(v.SourceOrder) || seen[k] {
			return ErrDenied
		}
		seen[k] = true
	}
	if read && len(s.Products) == 0 {
		return ErrDenied
	}
	return nil
}

// Exact decoding rejects duplicate keys as well as unknown fields. DATA is
// never treated as qualification; only the private verified constructor uses it.
func decode(raw []byte, out any) error {
	if len(raw) == 0 || len(raw) > 2<<20 {
		return ErrDenied
	}
	scan := json.NewDecoder(bytes.NewReader(raw))
	var walk func() error
	walk = func() error {
		t, e := scan.Token()
		if e != nil {
			return e
		}
		if d, ok := t.(json.Delim); ok {
			switch d {
			case '{':
				seen := map[string]bool{}
				for scan.More() {
					k, e := scan.Token()
					s, ok := k.(string)
					if e != nil || !ok || seen[s] {
						return ErrDenied
					}
					seen[s] = true
					if e = walk(); e != nil {
						return e
					}
				}
			case '[':
				for scan.More() {
					if e := walk(); e != nil {
						return e
					}
				}
			default:
				return ErrDenied
			}
			_, e = scan.Token()
			return e
		}
		return nil
	}
	if walk() != nil {
		return ErrDenied
	}
	if _, e := scan.Token(); e != io.EOF {
		return ErrDenied
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(out) != nil || d.Decode(new(any)) != io.EOF {
		return ErrDenied
	}
	return nil
}
