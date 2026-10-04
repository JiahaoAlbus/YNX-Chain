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
func (s *Service) savedPaperOrderReceipt(r *http.Request) (PaperOrder, error) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(query) != 1 || len(query["key"]) != 1 || !nativePaperIntentKey.MatchString(query.Get("key")) {
		return PaperOrder{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	release, err := s.lockAndReload()
	if err != nil {
		return PaperOrder{}, ErrUnavailable
	}
	defer release()
	var found *PaperOrder
	for _, row := range s.state.Paper.Orders {
		if row.IdempotencyKey == query.Get("key") {
			if found != nil {
				return PaperOrder{}, ErrConflict
			}
			copy := row
			found = &copy
		}
	}
	if found == nil {
		return PaperOrder{}, ErrUnavailable
	}
	return *found, nil
}
