package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"unicode/utf8"
)

var ErrTaskPagesSourceNotSupplied = fmt.Errorf("%w: AI_BROWSER_PROTECTED_PAGE_READER_NOT_SUPPLIED", errTaskEffectSourceUnavailable)

// Optional callee on the ORIGINAL Auth Runtime, not a provider setter. Auth
// owns acquisition, protected Browser IPC, task/preparation binding and current
// qualification. This product interface deliberately uses only context/bytes,
// so the supplier never imports AI or duplicates a Grant/portable codec.
// Request is product selection DATA, response is the exact P05 batch DATA.
// The producer must not return bytes on failed/partial authorization.
type originalNativeTaskPageReader interface {
	Current(context.Context) error
	ReadOriginalBrowserPageReadout(context.Context, []byte) ([]byte, error)
}

type originalTaskPageReadSession struct {
	ID              string `json:"id"`
	Account         string `json:"account"`
	DeviceID        string `json:"deviceId"`
	ProductClientID string `json:"productClientId,omitempty"`
	BundleID        string `json:"bundleId,omitempty"`
	SessionBinding  string `json:"sessionBinding,omitempty"`
}
type originalTaskPageReadRequest struct {
	RunID            string                      `json:"runId"`
	Schema           string                      `json:"schema"`
	Session          originalTaskPageReadSession `json:"session"`
	Task             TaskRecord                  `json:"task"`
	References       []TaskPageReference         `json:"references"`
	QueryOriginal    bool                        `json:"queryOriginal"`
	AuthorizationRef string                      `json:"authorizationRef,omitempty"`
}

// This is the production bridge installed by the original prepared Server.
// There is no HTTP/ENV callback registration or unsigned file fallback. A
// supplier without the actual protected reader fails independently of model
// configuration: a missing reader is not a claim about provider availability.
func (a *nativeTaskRuntimeAuthority) ReadOriginalTaskPages(ctx context.Context, in OriginalTaskPagesRequest) ([]TaskPageSnapshot, error) {
	if a == nil || a.owner == nil {
		return nil, ErrTaskPagesSourceNotSupplied
	}
	reader, ok := any(a.owner).(originalNativeTaskPageReader)
	if !ok {
		return nil, ErrTaskPagesSourceNotSupplied
	}
	return readOriginalNativeTaskPages(ctx, reader, in)
}
func readOriginalNativeTaskPages(ctx context.Context, reader originalNativeTaskPageReader, in OriginalTaskPagesRequest) ([]TaskPageSnapshot, error) {
	if ctx == nil || missingTaskRuntimeOperand(reader) {
		return nil, ErrTaskPagesSourceNotSupplied
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !toolOperationID.MatchString(in.RunID) || in.Session.ID == "" || in.Session.Account != in.Task.Account || in.Session.DeviceID != in.Task.Holder || in.Task.ID == "" || in.Task.Revision == 0 || in.Task.Generation == 0 || len(in.References) == 0 || validateTaskPageReferences(in.References) != nil || len(in.AuthorizationRef) > 256 || !in.QueryOriginal && in.AuthorizationRef == "" {
		return nil, errToolInvalid
	}
	if err := reader.Current(ctx); err != nil {
		return nil, err
	}
	request := originalTaskPageReadRequest{Schema: "YNX_AI_BROWSER_PAGE_READ_REQUEST_V1", RunID: in.RunID, Session: originalTaskPageReadSession{ID: in.Session.ID, Account: in.Session.Account, DeviceID: in.Session.DeviceID, ProductClientID: in.Session.ProductClientID, BundleID: in.Session.BundleID, SessionBinding: in.Session.SessionBinding}, Task: in.Task, References: append([]TaskPageReference(nil), in.References...), QueryOriginal: in.QueryOriginal, AuthorizationRef: in.AuthorizationRef}
	data, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	if len(data) > 32<<10 {
		return nil, errToolInvalid
	}
	raw, err := reader.ReadOriginalBrowserPageReadout(ctx, data)
	// A partial response alongside an error is neither authority nor usable data.
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := reader.Current(ctx); err != nil {
		return nil, err
	}
	pages, err := decodeOriginalBrowserPageReadout(in.Task.ID, in.References, bytes.Clone(raw))
	if err != nil {
		return nil, err
	}
	if err := reader.Current(ctx); err != nil {
		return nil, err
	}
	return pages, ctx.Err()
}

// Decode ONLY the fixed original P05 readout. It is not Source verification.
// The caller must hold the original qualified Source, whose preceding read
// independently binds preparationID to actual task/session/revision/generation.
func decodeOriginalBrowserPageReadout(taskID string, refs []TaskPageReference, raw []byte) ([]TaskPageSnapshot, error) {
	var batch struct {
		Schema        string `json:"schema"`
		PreparationID string `json:"preparationID"`
		ProfileID     string `json:"profileID"`
		Pages         []struct {
			Reference    TaskPageReference `json:"reference"`
			TabID        string            `json:"tabId"`
			ProfileID    string            `json:"profileId"`
			Generation   uint64            `json:"generation"`
			Origin       string            `json:"origin"`
			Fields       []string          `json:"fields"`
			Bytes        int               `json:"bytes"`
			SHA3_512     string            `json:"sha3_512"`
			State        string            `json:"state"`
			SnapshotUTF8 *string           `json:"snapshotUTF8,omitempty"`
		} `json:"pages"`
	}
	if !utf8.Valid(raw) || len(raw) == 0 || len(raw) > 256<<10 || rejectDuplicateShopJSON(raw) != nil || strictToolJSON(bytes.NewReader(raw), &batch) != nil || batch.Schema != "YNX_BROWSER_SELECTED_PAGE_READOUT_V1" || batch.PreparationID == "" || len(batch.PreparationID) > 1024 || batch.ProfileID == "" || len(batch.ProfileID) > 1024 || len(batch.Pages) != len(refs) || len(refs) == 0 || validateTaskPageReferences(refs) != nil {
		return nil, errToolInvalid
	}
	out := make([]TaskPageSnapshot, len(refs))
	tabs := map[string]bool{}
	for i, row := range batch.Pages {
		if row.Reference != refs[i] || row.ProfileID != batch.ProfileID || row.TabID == "" || tabs[row.TabID] || row.Generation == 0 || row.Bytes < 1 || row.Bytes > 1<<20 {
			return nil, errToolConflict
		}
		tabs[row.TabID] = true
		p := TaskPageSnapshot{TaskID: taskID, PreparationID: batch.PreparationID, Reference: row.Reference, TabID: row.TabID, ProfileID: row.ProfileID, Generation: row.Generation, Origin: row.Origin, Fields: append([]string(nil), row.Fields...), Bytes: row.Bytes, SHA3_512: row.SHA3_512, State: row.State, SourceClass: taskBrowserPageSourceClass, ContentTrust: taskPageContentTrust}
		if row.State == "AVAILABLE" {
			if row.SnapshotUTF8 == nil {
				return nil, errToolInvalid
			}
			p.Content = []byte(*row.SnapshotUTF8)
		} else if row.State != "STALE" && row.State != "UNAVAILABLE" || row.SnapshotUTF8 != nil {
			return nil, errToolInvalid
		}
		// Source classification is fixed by the product, never accepted from DATA.
		if err := validateTaskPageSnapshot(taskID, refs[i], p); err != nil {
			return nil, err
		}
		out[i] = p
	}
	return out, nil
}

var _ OriginalTaskPagesAuthority = (*nativeTaskRuntimeAuthority)(nil)
