package social

import "github.com/JiahaoAlbus/YNX-Chain/internal/chat"

// Page over server append order, never client timestamps. Cursors are scoped to
// the already-authorized conversation and device-visible history.
type MessagePage struct {
	Messages   []chat.Message `json:"messages"`
	NextCursor string         `json:"nextCursor"`
	HasMore    bool           `json:"hasMore"`
}

func paginateMessages(records []chat.Message, after string, limit int) (MessagePage, error) {
	if limit < 1 || limit > 100 {
		return MessagePage{}, ErrInvalid
	}
	start := 0
	if after != "" {
		found := false
		for index, message := range records {
			if message.ID == after {
				start = index + 1
				found = true
				break
			}
		}
		if !found {
			return MessagePage{}, ErrInvalid
		}
	}
	end := start + limit
	if end > len(records) {
		end = len(records)
	}
	page := MessagePage{Messages: append([]chat.Message{}, records[start:end]...), NextCursor: after, HasMore: end < len(records)}
	if end > start {
		page.NextCursor = records[end-1].ID
	}
	return page, nil
}
