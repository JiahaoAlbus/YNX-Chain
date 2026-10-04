package quantlab

import (
	"net/http"
	"net/url"
	"regexp"
)

var nativePaperIntentKey = regexp.MustCompile(`^quant-native-paper-[0-9a-f-]{36}$`)

// Read an original durable receipt only. Missing is not proof that an unknown
// submission never executed. No new order/risk/strategy is created here.
// Owner authorization/mapping is completed by privatePaper before this call.
func paperReceiptSelector(r *http.Request) (string, error) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(query) != 1 || len(query["key"]) != 1 || !nativePaperIntentKey.MatchString(query.Get("key")) {
		return "", ErrInvalid
	}
	return query.Get("key"), nil
}
func (s *Service) savedPaperOrderReceipt(r *http.Request) (PaperOrder, error) {
	key, err := paperReceiptSelector(r)
	if err != nil {
		return PaperOrder{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	latest, found, err := s.store.load()
	if err != nil || !found {
		return PaperOrder{}, ErrUnavailable
	}
	var receipt *PaperOrder
	for _, row := range latest.Paper.Orders {
		if row.IdempotencyKey == key {
			if receipt != nil {
				return PaperOrder{}, ErrConflict
			}
			copy := row
			receipt = &copy
		}
	}
	if receipt == nil {
		return PaperOrder{}, ErrUnavailable
	}
	return *receipt, nil
}
