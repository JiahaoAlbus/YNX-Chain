// Adapted function-by-function from Docs ba8afbb, retaining Cloud schema7.
package cloud

import (
	"context"
	"strings"
)

func (s *Service) AddCommentThread(actor, id string, version int, body string, mentions []string, parentID string, anchor *CommentAnchor) (Comment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	obj, err := s.require(actor, id, 1)
	if err != nil {
		return Comment{}, err
	}
	if obj.Kind != KindDoc || obj.TrashedAt != nil || version < 1 || version > obj.Version || strings.TrimSpace(body) == "" || len(body) > 2000 || len(mentions) > 20 {
		return Comment{}, ErrInvalid
	}
	for _, mention := range mentions {
		if !validAccount(mention) {
			return Comment{}, ErrInvalid
		}
	}
	threadID := ""
	if parentID != "" {
		if anchor != nil {
			return Comment{}, ErrInvalid
		}
		for _, existing := range s.state.Comments[id] {
			if existing.ID == parentID {
				threadID = existing.ThreadID
				if threadID == "" {
					threadID = existing.ID
				}
				break
			}
		}
		if threadID == "" {
			return Comment{}, ErrNotFound
		}
		for _, existing := range s.state.Comments[id] {
			if existing.ID == threadID && existing.ResolvedAt != nil {
				return Comment{}, ErrInvalid
			}
		}
	}
	var normalizedAnchor *CommentAnchor
	if anchor != nil {
		if obj.Encryption.ClientSide {
			return Comment{}, ErrInvalid
		}
		if anchor.Start < 0 || anchor.End <= anchor.Start || len(anchor.Quote) > 2000 {
			return Comment{}, ErrInvalid
		}
		var selected *Version
		for i := range s.state.Versions[id] {
			if s.state.Versions[id][i].Number == version {
				v := s.state.Versions[id][i]
				selected = &v
				break
			}
		}
		if selected == nil {
			return Comment{}, ErrNotFound
		}
		content, err := s.cfg.ObjectStore.Get(context.Background(), selected.BlobPath, selected.Hash)
		if err != nil {
			return Comment{}, err
		}
		runes := []rune(string(content))
		if anchor.End > len(runes) {
			return Comment{}, ErrInvalid
		}
		quote := string(runes[anchor.Start:anchor.End])
		if anchor.Quote != "" && anchor.Quote != quote {
			return Comment{}, ErrInvalid
		}
		normalizedAnchor = &CommentAnchor{Start: anchor.Start, End: anchor.End, Quote: quote}
	}
	comment := Comment{ID: newID("comment"), ObjectID: id, Version: version, ThreadID: threadID, ParentID: parentID, Author: actor, Body: strings.TrimSpace(body), Mentions: append([]string(nil), mentions...), Anchor: normalizedAnchor, CreatedAt: s.cfg.Now()}
	if comment.ThreadID == "" {
		comment.ThreadID = comment.ID
	}
	s.state.Comments[id] = append(s.state.Comments[id], comment)
	if err := s.persist("comment.create", actor, id, map[string]any{"commentId": comment.ID, "threadId": comment.ThreadID, "parentId": comment.ParentID, "version": version, "mentions": len(mentions), "anchored": comment.Anchor != nil}); err != nil {
		return Comment{}, err
	}
	return comment, nil
}

func (s *Service) ResolveComment(actor, id, threadID string, resolved bool) (Comment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.require(actor, id, 2); err != nil {
		return Comment{}, err
	}
	comments := s.state.Comments[id]
	rootIndex := -1
	for i := range comments {
		if comments[i].ID == threadID && (comments[i].ThreadID == threadID || comments[i].ThreadID == "") {
			rootIndex = i
			break
		}
	}
	if rootIndex < 0 {
		return Comment{}, ErrNotFound
	}
	root := comments[rootIndex]
	now := s.cfg.Now()
	if resolved {
		if root.ResolvedAt != nil {
			return root, nil
		}
		root.ResolvedAt = &now
		root.ResolvedBy = actor
	} else {
		if root.ResolvedAt == nil {
			return root, nil
		}
		root.ResolvedAt = nil
		root.ResolvedBy = ""
	}
	comments[rootIndex] = root
	s.state.Comments[id] = comments
	action := "comment.reopen"
	if resolved {
		action = "comment.resolve"
	}
	if err := s.persist(action, actor, id, map[string]any{"threadId": threadID}); err != nil {
		return Comment{}, err
	}
	return root, nil
}
