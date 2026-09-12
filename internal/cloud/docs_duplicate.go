package cloud

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
)

type DuplicateObjectRequest struct {
	ParentID string `json:"parentId"`
	Name     string `json:"name,omitempty"`
}

func (s *Service) DuplicateObject(actor, id string, req DuplicateObjectRequest) (Object, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	source, err := s.require(actor, id, 1)
	if err != nil {
		return Object{}, err
	}
	if source.TrashedAt != nil {
		return Object{}, ErrInvalid
	}
	if req.ParentID != "" {
		parent, err := s.require(actor, req.ParentID, 2)
		if err != nil || parent.Kind != KindFolder || parent.TrashedAt != nil || parent.Product != source.Product || parent.Owner != actor {
			return Object{}, ErrDenied
		}
		seen := map[string]bool{}
		for p := parent.ID; p != ""; {
			if p == id || seen[p] {
				return Object{}, ErrInvalid
			}
			seen[p] = true
			node, ok := s.state.Objects[p]
			if !ok || node.Product != source.Product {
				return Object{}, ErrDenied
			}
			p = node.ParentID
		}
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = source.Name + " copy"
	}
	if err := validateName(name); err != nil {
		return Object{}, err
	}
	ordered := []Object{source}
	visited := map[string]bool{source.ID: true}
	for cursor := 0; cursor < len(ordered); cursor++ {
		if len(ordered) > 10000 {
			return Object{}, errors.New("copy exceeds object limit")
		}
		if ordered[cursor].Kind != KindFolder {
			continue
		}
		children := []Object{}
		for _, candidate := range s.state.Objects {
			if candidate.ParentID != ordered[cursor].ID || candidate.TrashedAt != nil || rank(s.role(actor, candidate)) == 0 {
				continue
			}
			if candidate.Product != source.Product || visited[candidate.ID] {
				return Object{}, ErrInvalid
			}
			visited[candidate.ID] = true
			children = append(children, candidate)
		}
		sort.Slice(children, func(i, j int) bool { return children[i].ID < children[j].ID })
		ordered = append(ordered, children...)
	}
	versions := map[string]Version{}
	unique := map[string]bool{}
	var additional int64
	for _, original := range ordered {
		if original.Kind == KindFolder {
			continue
		}
		if original.StorageReadMode != StorageReadImmediate || original.StorageClass != StorageClassHot {
			return Object{}, errors.New("restore object to hot storage before copying")
		}
		found := false
		for _, version := range s.state.Versions[original.ID] {
			if version.Number != original.Version {
				continue
			}
			if version.Hash != original.Hash {
				return Object{}, ErrInvalid
			}
			versions[original.ID] = version
			if !unique[version.Hash] {
				additional += s.additionalLocked(actor, original.Product, version.Hash, version.Size)
				unique[version.Hash] = true
			}
			found = true
			break
		}
		if !found {
			return Object{}, ErrInvalid
		}
	}
	if s.usedLocked(actor)+additional > s.cfg.QuotaBytes {
		return Object{}, errors.New("storage quota exceeded")
	}
	// Cross-owner copies must materialize into the destination owner's product
	// namespace, never point at a different owner's removable storage reference.
	for _, original := range ordered {
		if original.Kind == KindFolder || original.Owner == actor {
			continue
		}
		version := versions[original.ID]
		body, err := s.cfg.ObjectStore.Get(context.Background(), version.BlobPath, version.Hash)
		if err != nil {
			return Object{}, err
		}
		path, err := s.putObjectBlob(context.Background(), actor, source.Product, version.Hash, body)
		if err != nil {
			return Object{}, err
		}
		version.BlobPath = path
		versions[original.ID] = version
	}
	s.settleStorageLocked(actor, source.Product)
	now := s.cfg.Now()
	mapped := map[string]string{}
	var result Object
	for _, original := range ordered {
		copy := original
		copy.ID, copy.Owner = newID("obj"), actor
		copy.CreatedAt, copy.UpdatedAt = now, now
		copy.Starred, copy.TrashedAt = false, nil
		if original.ID == id {
			copy.ParentID, copy.Name = req.ParentID, name
		} else {
			copy.ParentID = mapped[original.ParentID]
		}
		mapped[original.ID] = copy.ID
		if original.Kind != KindFolder {
			version := versions[original.ID]
			version.ObjectID, version.Number, version.Author, version.CreatedAt = copy.ID, 1, actor, now
			copy.Version = 1
			s.state.Versions[copy.ID] = []Version{version}
		}
		s.state.Objects[copy.ID] = copy
		if original.ID == id {
			result = copy
		}
	}
	if err := s.persist("object.duplicate", actor, result.ID, map[string]any{"sourceObjectId": id, "copiedObjects": len(ordered), "contentBytesAdded": additional}); err != nil {
		return Object{}, err
	}
	return result, nil
}

func (s *Server) duplicateObject(w http.ResponseWriter, r *http.Request, actor Session) {
	if !requireProductScope(w, actor, "files.write", "documents.write") {
		return
	}
	var input DuplicateObjectRequest
	if !decode(w, r, &input, 8192) {
		return
	}
	object, err := s.service.DuplicateObject(actor.Account, r.PathValue("id"), input)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, object)
}
