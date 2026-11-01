package participation

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"reflect"
	"sort"
	"time"
)

const DefaultHistoryLimit = 20
const MaxHistoryLimit = 50
const MaxHistoryCursorBytes = 512
const MaxHistoryPageBytes = 8 << 10

// HistoryEntry is a projection of the original local outbox. It deliberately
// excludes intent bytes, account data, signatures, Wallet results and approval.
type HistoryEntry struct {
	ID        string `json:"id"`
	RequestID string `json:"requestId"`
	Action    string `json:"action"`
	State     string `json:"state"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}
type HistoryPage struct {
	Entries    []HistoryEntry `json:"entries"`
	NextCursor string         `json:"nextCursor,omitempty"`
}
type historyCursor struct {
	Version  int    `json:"version"`
	Snapshot string `json:"snapshot"`
	After    string `json:"after"`
}
type historyRow struct {
	entry   HistoryEntry
	created time.Time
	network Network
}

// ResolveRequest reads the original correlation index, including legitimate
// semantic aliases. The query is a local request ID, never Main/Wallet's UUID
// or approval. Original Entry/Intent/UNKNOWN is returned unchanged; a miss does
// not prepare, refresh, sign, look up Wallet or allocate a replacement record.
func (s *Service) ResolveRequest(requestID string) (Entry, bool, error) {
	if !reference(requestID) {
		return Entry{}, false, ErrInvalid
	}
	if s == nil {
		return Entry{}, false, ErrUnavailable
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.persistErr != nil || s.reader == nil || s.lock == nil || s.lock.Check() != nil {
		return Entry{}, false, ErrUnavailable
	}
	id, exists := s.data.Requests[requestID]
	if !exists {
		return Entry{}, false, nil
	}
	entry, exists := s.data.Entries[id]
	if !exists || entry.ID != id {
		return Entry{}, false, ErrUnavailable
	}
	return cloneEntry(entry), true, nil
}

// ListHistory reads the existing journal under its original lock. Cursor binds
// the journal/configuration and immutable row identities, never a file path to
// open. Entry state changes and normal reopen keep ordering; insertion causes
// an explicit conflict so callers refresh rather than silently omit a new row.
// A stopped live service remains readable. Closed/lost ownership never looks
// like a successfully read empty history. This method performs no remote call.
func (s *Service) ListHistory(cursor string, limit int) (HistoryPage, error) {
	out := HistoryPage{Entries: []HistoryEntry{}}
	if s == nil {
		return out, ErrUnavailable
	}
	if limit == 0 {
		limit = DefaultHistoryLimit
	}
	if limit < 1 || limit > MaxHistoryLimit || len(cursor) > MaxHistoryCursorBytes {
		return out, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.persistErr != nil || s.reader == nil || s.lock == nil || s.lock.Check() != nil {
		return out, ErrUnavailable
	}
	if len(s.data.Entries) > 128 {
		return out, ErrUnavailable
	}
	rows := make([]historyRow, 0, len(s.data.Entries))
	for id, original := range s.data.Entries {
		created, e1 := time.Parse(time.RFC3339Nano, original.CreatedAt)
		updated, e2 := time.Parse(time.RFC3339Nano, original.UpdatedAt)
		action := original.Intent.Request.Action
		if id != original.ID || !reference(id) || !reference(original.Intent.Request.RequestID) || e1 != nil || e2 != nil || created.UTC().Format(time.RFC3339Nano) != original.CreatedAt || updated.UTC().Format(time.RFC3339Nano) != original.UpdatedAt || !entryState(original.State) || (action != Vote && action != Delegate && action != Unbond && action != Withdraw) {
			return out, ErrUnavailable // Never silently discard a malformed UNKNOWN.
		}
		rows = append(rows, historyRow{entry: HistoryEntry{ID: id, RequestID: original.Intent.Request.RequestID, Action: original.Intent.Request.Action, State: original.State, CreatedAt: original.CreatedAt, UpdatedAt: original.UpdatedAt}, created: created, network: original.Intent.Network})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].created.Equal(rows[j].created) {
			return rows[i].entry.ID < rows[j].entry.ID
		}
		return rows[i].created.Before(rows[j].created)
	})
	configuration := struct {
		Journal, Reader, Governance, Chain string
		Network                            *Network
	}{Journal: s.path, Reader: reflect.TypeOf(s.reader).String()}
	if reader, ok := s.reader.(*HTTPReader); ok {
		if reader == nil {
			return out, ErrUnavailable
		}
		network := reader.network
		configuration.Network = &network
		configuration.Governance, configuration.Chain = reader.governance, reader.chain
	}
	identities := make([]any, 0, len(rows))
	for _, row := range rows {
		identities = append(identities, struct {
			ID, RequestID, Action, CreatedAt string
			Network                          Network
		}{row.entry.ID, row.entry.RequestID, row.entry.Action, row.entry.CreatedAt, row.network})
	}
	raw, _ := json.Marshal(struct{ Configuration, Rows any }{configuration, identities})
	sum := sha256.Sum256(raw)
	snapshot := hex.EncodeToString(sum[:])
	start := 0
	if cursor != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil || base64.RawURLEncoding.EncodeToString(decoded) != cursor {
			return out, ErrInvalid
		}
		var position historyCursor
		decoder := json.NewDecoder(bytes.NewReader(decoded))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&position) != nil || decoder.Decode(new(any)) != io.EOF {
			return out, ErrInvalid
		}
		canonical, _ := json.Marshal(position)
		if !bytes.Equal(canonical, decoded) || position.Version != 1 || !hexString(position.Snapshot, 64) || !reference(position.After) {
			return out, ErrInvalid
		}
		if position.Snapshot != snapshot {
			return out, ErrConflict
		}
		found := false
		for i, row := range rows {
			if row.entry.ID == position.After {
				start, found = i+1, true
				break
			}
		}
		if !found {
			return out, ErrInvalid
		}
	}
	used, index := 2, start
	for index < len(rows) && len(out.Entries) < limit {
		encoded, _ := json.Marshal(rows[index].entry)
		if used+len(encoded)+1 > MaxHistoryPageBytes {
			if len(out.Entries) == 0 {
				return out, ErrUnavailable
			}
			break
		}
		out.Entries = append(out.Entries, rows[index].entry)
		used += len(encoded) + 1
		index++
	}
	if index < len(rows) && len(out.Entries) != 0 {
		position, _ := json.Marshal(historyCursor{Version: 1, Snapshot: snapshot, After: out.Entries[len(out.Entries)-1].ID})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(position)
	}
	return out, nil
}
