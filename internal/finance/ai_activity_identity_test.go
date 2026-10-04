package finance

import (
	"context"
	"testing"
)

func TestOriginalAIActivityIdentityRefusesBeforeProviderOrJournal(t *testing.T) {
	for name, input := range map[string]struct {
		activity []Activity
		ids      []string
	}{
		"missing":          {[]Activity{{ID: ""}}, []string{""}},
		"duplicate":        {[]Activity{{ID: "same", Amount: 1}, {ID: "same", Amount: 2}}, []string{"same"}},
		"padded":           {[]Activity{{ID: " same"}}, []string{"same"}},
		"repeat-selection": {[]Activity{{ID: "same"}}, []string{"same", "same"}},
		"foreign":          {[]Activity{{ID: "same"}}, []string{"other"}},
	} {
		t.Run(name, func(t *testing.T) {
			store, err := OpenStore("")
			if err != nil {
				t.Fatal(err)
			}
			if err = store.Update(testAccount, "privacy", "ai", func(s *AccountState) error { s.Privacy.AllowAIActivityContext = true; return nil }); err != nil {
				t.Fatal(err)
			}
			// A nil provider would panic if the rejection reached Status; no provider,
			// fake grant, journal or external effect is supplied to these source cases.
			service := &Service{Store: store}
			before := len(store.Audit(testAccount))
			if _, err = service.StartAIWithIntent(context.Background(), testAccount, "categorize", input.ids, []string{"owned_activity"}, true, Portfolio{Activity: input.activity}, "en", nil); err == nil {
				t.Fatal("ambiguous activity accepted")
			}
			if len(store.Account(testAccount).AIJobs) != 0 || len(store.Audit(testAccount)) != before {
				t.Fatal("rejected context changed original journal")
			}
		})
	}
}
func TestOriginalAIActivitySelectionPreservesIDsAndOrdering(t *testing.T) {
	rows := []Activity{{ID: "hash-a", Amount: 1}, {ID: "hash-b", Amount: 2}}
	selected, err := selectOriginalAIActivityContext(rows, []string{"hash-b", "hash-a"})
	if err != nil || len(selected) != 2 || selected[0].ID != "hash-b" || selected[1].ID != "hash-a" || selected[0].Amount != 2 {
		t.Fatalf("%+v %v", selected, err)
	}
	selected, err = selectOriginalAIActivityContext(nil, nil)
	if err != nil || len(selected) != 0 {
		t.Fatal("original explicit empty broker context changed")
	}
}
