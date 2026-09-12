package cloud

import (
	"net/http"
	"strings"
)

// UpdateObjectRequest preserves the Docs name/move wire contract while retaining
// schema7 product, storage lifecycle, artifact and version metadata.
type UpdateObjectRequest struct {
	Name     *string `json:"name"`
	ParentID *string `json:"parentId"`
}

func (s *Service) UpdateObject(actor, id string, req UpdateObjectRequest) (Object, error) {
	if req.Name == nil && req.ParentID == nil {
		return Object{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	obj, err := s.require(actor, id, 2)
	if err != nil {
		return Object{}, err
	}
	if obj.TrashedAt != nil {
		return Object{}, ErrInvalid
	}
	details := map[string]any{}
	if req.Name != nil {
		if err := validateName(*req.Name); err != nil {
			return Object{}, err
		}
		name := strings.TrimSpace(*req.Name)
		if name != obj.Name {
			obj.Name = name
			details["name"] = name
		}
	}
	if req.ParentID != nil {
		if obj.Owner != actor {
			return Object{}, ErrDenied
		}
		parentID := strings.TrimSpace(*req.ParentID)
		if parentID == id {
			return Object{}, ErrInvalid
		}
		if parentID != "" {
			parent, err := s.require(actor, parentID, 2)
			if err != nil || parent.Kind != KindFolder || parent.TrashedAt != nil || parent.Product != obj.Product || parent.Owner != obj.Owner {
				return Object{}, ErrDenied
			}
			// Detect pre-existing corruption too, rather than loop forever or
			// move a valid object into an already cyclic ancestry.
			visited := map[string]bool{}
			for ancestor := parentID; ancestor != ""; {
				if ancestor == id || visited[ancestor] {
					return Object{}, ErrInvalid
				}
				visited[ancestor] = true
				current, ok := s.state.Objects[ancestor]
				if !ok || current.Product != obj.Product {
					return Object{}, ErrDenied
				}
				ancestor = current.ParentID
			}
		}
		if parentID != obj.ParentID {
			obj.ParentID = parentID
			details["parentId"] = parentID
		}
	}
	if len(details) == 0 {
		return obj, nil
	}
	obj.UpdatedAt = s.cfg.Now()
	s.state.Objects[id] = obj
	if err := s.persist("object.update", actor, id, details); err != nil {
		return Object{}, err
	}
	return obj, nil
}

func (s *Server) updateObject(w http.ResponseWriter, r *http.Request, actor Session) {
	if !requireProductScope(w, actor, "files.write", "documents.write") {
		return
	}
	var input UpdateObjectRequest
	if !decode(w, r, &input, 8192) {
		return
	}
	object, err := s.service.UpdateObject(actor.Account, r.PathValue("id"), input)
	writeResult(w, object, err)
}
