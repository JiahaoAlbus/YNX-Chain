package commerce

import (
	"fmt"
	"math"
	"net/http"
	"strconv"
)

// Decimal strings preserve the original int64 operands across Native/CLI JSON.
// This is a same-Store inventory action, never receipt of goods or funds proof.
type InventoryBatchItem struct {
	ProductID, VariantID, ExpectedRevision, Inventory string
}
type InventoryBatchInput struct {
	StoreID, IdempotencyKey string
	Items                   []InventoryBatchItem
}
type InventoryBatchResult struct {
	StoreID, RequestHash string
	Products             []InventoryBatchProduct
	OriginalApplied      bool
	QueryOnly            bool
}
type InventoryBatchProduct struct {
	ID, StoreID, Revision string
	Variants              []InventoryBatchVariant
}
type InventoryBatchVariant struct{ ID, Inventory, Reserved string }
type InventorySelectionItem struct{ ProductID, VariantID string }
type InventorySelectionInput struct {
	StoreID string
	Items   []InventorySelectionItem
}
type InventorySelectionResult struct {
	StoreID   string
	Products  []InventoryBatchProduct
	QueryOnly bool
}

func (s *Store) ReadInventorySelection(actor string, in InventorySelectionInput) (InventorySelectionResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(in.Items) == 0 || len(in.Items) > 100 {
		return InventorySelectionResult{}, ErrInvalidState
	}
	if err := s.requireSellerPermissionLocked(in.StoreID, actor, permissionInventoryWrite); err != nil {
		return InventorySelectionResult{}, err
	}
	selected := InventoryBatchInput{StoreID: in.StoreID}
	for _, item := range in.Items {
		if item.ProductID == "" || item.VariantID == "" {
			return InventorySelectionResult{}, ErrInvalidState
		}
		selected.Items = append(selected.Items, InventoryBatchItem{ProductID: item.ProductID, VariantID: item.VariantID})
	}
	view, err := s.inventoryBatchReadbackLocked(selected, true)
	if err != nil {
		return InventorySelectionResult{}, err
	}
	return InventorySelectionResult{in.StoreID, view.Products, true}, nil
}

func (s *Server) inventorySelection(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in InventorySelectionInput
	if !decode(w, r, &in) {
		return
	}
	result, err := s.store.ReadInventorySelection(sess.Account, in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, 200, result)
}

func inventoryOperand(value string) (int64, error) {
	n, err := strconv.ParseInt(value, 10, 64)
	if err != nil || n < 0 || strconv.FormatInt(n, 10) != value {
		return 0, ErrInvalidState
	}
	return n, nil
}

// Called under the original Store lock. Readback intentionally returns current
// products, not a manufactured historical inventory snapshot. The original
// idempotency record separately proves that this exact batch was committed.
func (s *Store) inventoryBatchReadbackLocked(in InventoryBatchInput, query bool) (InventoryBatchResult, error) {
	out := InventoryBatchResult{StoreID: in.StoreID, RequestHash: requestHash(in), OriginalApplied: true, QueryOnly: query}
	indexes := make(map[string]int)
	seen := make(map[returnSKU]bool)
	for _, item := range in.Items {
		p, ok := s.s.Products[item.ProductID]
		if !ok || p.ID != item.ProductID || p.StoreID != in.StoreID || p.Revision < 0 || seen[returnSKU{item.ProductID, item.VariantID}] {
			return InventoryBatchResult{}, ErrConflict
		}
		seen[returnSKU{item.ProductID, item.VariantID}] = true
		index, exists := indexes[p.ID]
		if !exists {
			index = len(out.Products)
			indexes[p.ID] = index
			out.Products = append(out.Products, InventoryBatchProduct{ID: p.ID, StoreID: p.StoreID, Revision: strconv.FormatInt(p.Revision, 10)})
		}
		found := false
		for _, v := range p.Variants {
			if v.ID != item.VariantID {
				continue
			}
			if found || v.Inventory < 0 || v.Reserved < 0 || v.Inventory < v.Reserved {
				return InventoryBatchResult{}, ErrInventory
			}
			found = true
			out.Products[index].Variants = append(out.Products[index].Variants, InventoryBatchVariant{v.ID, strconv.FormatInt(v.Inventory, 10), strconv.FormatInt(v.Reserved, 10)})
		}
		if !found {
			return InventoryBatchResult{}, ErrConflict
		}
	}
	return out, nil
}

func (s *Store) SetInventoryBatch(actor string, in InventoryBatchInput) (InventoryBatchResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(in.Items) == 0 || len(in.Items) > 100 {
		return InventoryBatchResult{}, ErrInvalidState
	}
	if err := s.requireSellerPermissionLocked(in.StoreID, actor, permissionInventoryWrite); err != nil {
		return InventoryBatchResult{}, err
	}
	route := "inventory.batch." + in.StoreID
	hash, replay, err := s.idempotencyLocked(actor, route, in.IdempotencyKey, in)
	if err != nil {
		return InventoryBatchResult{}, err
	}
	if replay {
		if hash != in.StoreID {
			return InventoryBatchResult{}, ErrConflict
		}
		return s.inventoryBatchReadbackLocked(in, true)
	}
	products := make(map[string]Product)
	seen := make(map[returnSKU]bool)
	for _, item := range in.Items {
		key := returnSKU{item.ProductID, item.VariantID}
		if item.ProductID == "" || item.VariantID == "" || seen[key] {
			return InventoryBatchResult{}, ErrInvalidState
		}
		seen[key] = true
		revision, e := inventoryOperand(item.ExpectedRevision)
		count, f := inventoryOperand(item.Inventory)
		if e != nil || f != nil {
			return InventoryBatchResult{}, ErrInvalidState
		}
		p, staged := products[item.ProductID]
		if !staged {
			original, ok := s.s.Products[item.ProductID]
			if !ok || original.ID != item.ProductID || original.StoreID != in.StoreID {
				return InventoryBatchResult{}, ErrNotFound
			}
			p = cloneProduct(original)
		}
		if p.Revision != revision || p.Revision == math.MaxInt64 {
			return InventoryBatchResult{}, ErrConflict
		}
		index := -1
		for i, v := range p.Variants {
			if v.ID == item.VariantID {
				if index != -1 {
					return InventoryBatchResult{}, ErrInventory
				}
				index = i
			}
		}
		if index == -1 {
			return InventoryBatchResult{}, ErrNotFound
		}
		v := &p.Variants[index]
		if v.Reserved < 0 || v.Inventory < v.Reserved || count < v.Reserved {
			return InventoryBatchResult{}, ErrInventory
		}
		v.Inventory = count
		products[p.ID] = p
	}
	before, err := cloneSnapshot(s.s)
	if err != nil {
		return InventoryBatchResult{}, err
	}
	for id, p := range products {
		p.Revision++ // once per product, including multiple SKUs in this batch
		p.UpdatedAt = s.now()
		s.s.Products[id] = p
	}
	s.recordIdempotencyLocked(actor, route, in.IdempotencyKey, hash, in.StoreID)
	s.auditLocked(actor, "seller", "inventory_batch_set", "store", in.StoreID, "approved", fmt.Sprintf("products=%d skus=%d; inventory only", len(products), len(in.Items)))
	if err := s.persistLocked(); err != nil {
		s.s = before
		return InventoryBatchResult{}, err
	}
	return s.inventoryBatchReadbackLocked(in, false)
}

func (s *Server) inventoryBatch(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.auth(w, r, "seller")
	if !ok {
		return
	}
	var in InventoryBatchInput
	if !decode(w, r, &in) {
		return
	}
	result, err := s.store.SetInventoryBatch(sess.Account, in)
	if err != nil {
		fail(w, status(err), err)
		return
	}
	write(w, http.StatusOK, result)
}
