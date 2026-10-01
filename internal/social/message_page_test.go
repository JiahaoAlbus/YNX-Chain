package social

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/chat"
	"testing"
)

func TestMessagePageAppendOrdering(t *testing.T) {
	records := []chat.Message{{ID: "a"}, {ID: "b"}, {ID: "c"}}
	first, err := paginateMessages(records, "", 2)
	if err != nil || len(first.Messages) != 2 || first.NextCursor != "b" || !first.HasMore {
		t.Fatalf("first: %+v %v", first, err)
	}
	records = append(records, chat.Message{ID: "d"})
	next, err := paginateMessages(records, first.NextCursor, 2)
	if err != nil || len(next.Messages) != 2 || next.Messages[0].ID != "c" || next.NextCursor != "d" || next.HasMore {
		t.Fatalf("next: %+v %v", next, err)
	}
	if _, err = paginateMessages(records, "other-conversation", 2); err == nil {
		t.Fatal("foreign cursor accepted")
	}
	for _, limit := range []int{0, 101, -1} {
		if _, err = paginateMessages(records, "", limit); err == nil {
			t.Fatal("invalid limit accepted")
		}
	}
}
