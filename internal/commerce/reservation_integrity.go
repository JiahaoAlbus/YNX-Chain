package commerce

import (
	"fmt"
	"math"
)

// applyReservationLocked validates the complete original reservation before
// changing any SKU. It never repairs/clamps a damaged legacy relationship or
// synthesizes a missing product. The caller owns the Store transaction/lock.
func (s *Store) applyReservationLocked(order Order, consume bool) error {
	if len(order.Lines) == 0 || order.StoreID == "" {
		return fmt.Errorf("%w: original reservation lines missing", ErrInventory)
	}
	products := make(map[string]Product)
	seen := make(map[struct{ product, variant string }]bool)
	for _, line := range order.Lines {
		key := struct{ product, variant string }{line.ProductID, line.VariantID}
		if line.Quantity <= 0 || line.ProductID == "" || line.VariantID == "" || seen[key] {
			return fmt.Errorf("%w: invalid or duplicate original reservation line", ErrInventory)
		}
		seen[key] = true
		p, staged := products[line.ProductID]
		if !staged {
			original, exists := s.s.Products[line.ProductID]
			if !exists || original.ID != line.ProductID || original.StoreID != order.StoreID {
				return fmt.Errorf("%w: original reservation product binding missing", ErrInventory)
			}
			if original.Revision < 0 || original.Revision == math.MaxInt64 {
				return fmt.Errorf("%w: inventory revision exhausted or invalid", ErrInventory)
			}
			p = cloneProduct(original)
		}
		index := -1
		for i, v := range p.Variants {
			if v.ID == line.VariantID {
				if index != -1 {
					return fmt.Errorf("%w: ambiguous original reservation SKU", ErrInventory)
				}
				index = i
			}
		}
		if index == -1 {
			return fmt.Errorf("%w: original reservation SKU missing", ErrInventory)
		}
		v := &p.Variants[index]
		if v.Reserved < line.Quantity || v.Inventory < v.Reserved {
			return fmt.Errorf("%w: original reservation quantity unavailable", ErrInventory)
		}
		v.Reserved -= line.Quantity
		if consume {
			v.Inventory -= line.Quantity
		}
		products[p.ID] = p
	}
	for id, p := range products {
		p.Revision++
		s.s.Products[id] = p
	}
	return nil
}
