package cloud

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
)

var objectRequestID = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)
var errObjectOperationConflict = errors.New("object request identity is already bound to different input")
var errObjectOperationRetired = errors.New("original object was deleted; this request cannot create another object")

// This is a single-authoritative-snapshot replay tombstone, not a grant or a
// multi-instance uniqueness claim. It contains no content, name, token or account.
type objectCreateOperation struct {
	Fingerprint string `json:"fingerprint"`
	ObjectID    string `json:"objectId"`
}

type ObjectOperationObservation struct {
	Outcome  string         `json:"outcome"`
	ObjectID string         `json:"objectId,omitempty"`
	Version  int            `json:"version,omitempty"`
	Binding  *ObjectBinding `json:"binding,omitempty"`
	Deleted  bool           `json:"deleted,omitempty"`
}

type objectCreateRequestKey struct{}

// CreateObjectOnce only adds stable request identity to the normal Create path.
// Current authenticated actor/product and every existing ACL/scanner/quota check
// still apply. No separate write engine or account admission is introduced.
func (s *Service) CreateObjectOnce(ctx context.Context, actor, requestID string, req CreateObjectRequest) (Object, error) {
	if ctx == nil || !objectRequestID.MatchString(requestID) || len(req.Content) > MaxUploadBytes {
		return Object{}, ErrInvalid
	}
	// Retain owned input while scanner/provider run outside client control.
	req.Content = append([]byte(nil), req.Content...)
	if req.Artifact != nil {
		raw, err := json.Marshal(req.Artifact)
		if err != nil {
			return Object{}, err
		}
		var artifact Artifact
		if err = json.Unmarshal(raw, &artifact); err != nil {
			return Object{}, err
		}
		req.Artifact = &artifact
	}
	return s.Create(context.WithValue(ctx, objectCreateRequestKey{}, requestID), actor, req)
}

func objectOperationKey(actor, product, requestID string) string {
	return hashBytes([]byte("cloud.object.create/v1\x00" + actor + "\x00" + product + "\x00" + requestID))
}

func (s *Service) prepareObjectCreateLocked(ctx context.Context, actor string, req CreateObjectRequest) (objectCreateOperation, string, error) {
	requestID, _ := ctx.Value(objectCreateRequestKey{}).(string)
	if requestID == "" {
		return objectCreateOperation{}, "", nil
	}
	binding := bindObjectBytes(req.Content)
	req.Content = nil
	req.Name = strings.TrimSpace(req.Name)
	input, err := json.Marshal(struct {
		Request CreateObjectRequest
		Binding ObjectBinding
	}{req, binding})
	if err != nil {
		return objectCreateOperation{}, "", err
	}
	key := objectOperationKey(actor, req.Product, requestID)
	operation := objectCreateOperation{Fingerprint: hashBytes(input)}
	if original, ok := s.state.ObjectOperations[key]; ok {
		if original.Fingerprint != operation.Fingerprint {
			return objectCreateOperation{}, "", errObjectOperationConflict
		}
		return original, key, nil
	}
	return operation, key, nil
}

// Observation never writes, retries, signs, changes ACL or returns body bytes.
// UNKNOWN remains UNKNOWN until original durable reconciliation succeeds.
func (s *Service) GetObjectOperation(actor, product, requestID string) (ObjectOperationObservation, error) {
	if !validAccount(actor) || (product != "cloud" && product != "docs") || !objectRequestID.MatchString(requestID) {
		return ObjectOperationObservation{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	original, ok := s.state.ObjectOperations[objectOperationKey(actor, product, requestID)]
	if s.objectWriteErr != nil {
		return ObjectOperationObservation{Outcome: "UNKNOWN"}, nil
	}
	if !ok {
		return ObjectOperationObservation{}, ErrNotFound
	}
	observation := ObjectOperationObservation{Outcome: "COMMITTED", ObjectID: original.ObjectID, Version: 1}
	obj, exists := s.state.Objects[original.ObjectID]
	if !exists {
		observation.Deleted = true
		return observation, nil
	}
	if obj.Owner != actor || obj.Product != product {
		return ObjectOperationObservation{}, ErrDenied
	}
	if versions := s.state.Versions[obj.ID]; len(versions) > 0 {
		if versions[0].Binding != nil {
			binding := *versions[0].Binding
			observation.Binding = &binding
		}
	}
	return observation, nil
}

func (s *Service) linkTokenHashLocked(link ShareLink) string {
	if hash := s.state.LinkTokenHashes[link.ID]; hash != "" {
		return hash
	}
	return link.TokenHash // Existing in-memory legacy link; missing persisted hash fails closed.
}

func (s *Server) objectOperation(w http.ResponseWriter, r *http.Request, session Session) {
	if !requireProductScope(w, session, "files.write", "documents.write") {
		return
	}
	observation, err := s.service.GetObjectOperation(session.Account, session.Product, r.PathValue("request"))
	writeResult(w, observation, err)
}
