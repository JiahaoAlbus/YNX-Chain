package square

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
)

type AccountExport struct {
	Account       string         `json:"account"`
	Devices       []Device       `json:"devices"`
	Posts         []Post         `json:"posts"`
	Comments      []Comment      `json:"comments"`
	Reactions     []Reaction     `json:"reactions"`
	Follows       []Follow       `json:"follows"`
	Reports       []Report       `json:"reports"`
	Profile       *Profile       `json:"profile,omitempty"`
	Notifications []Notification `json:"notifications"`
	Audit         []AuditEvent   `json:"audit"`
}

func (s *Service) ExportAccount(actor Device) AccountExport {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := AccountExport{Account: actor.Account, Devices: []Device{}, Posts: []Post{}, Comments: []Comment{}, Reactions: []Reaction{}, Follows: []Follow{}, Reports: []Report{}, Notifications: []Notification{}, Audit: []AuditEvent{}}
	for _, device := range s.state.Devices {
		if device.Account == actor.Account {
			out.Devices = append(out.Devices, device)
		}
	}
	for _, post := range s.state.Posts {
		if post.Author == actor.Account {
			out.Posts = append(out.Posts, post)
		}
	}
	for _, comments := range s.state.Comments {
		for _, comment := range comments {
			if comment.Author == actor.Account {
				out.Comments = append(out.Comments, comment)
			}
		}
	}
	for _, reaction := range s.state.Reactions {
		if reaction.Account == actor.Account {
			out.Reactions = append(out.Reactions, reaction)
		}
	}
	for _, follow := range s.state.Follows {
		if follow.Follower == actor.Account || follow.Following == actor.Account {
			out.Follows = append(out.Follows, follow)
		}
	}
	for _, report := range s.state.Reports {
		if report.Reporter == actor.Account {
			out.Reports = append(out.Reports, report)
		}
	}
	if profile, ok := s.state.Profiles[actor.Account]; ok {
		copy := profile
		out.Profile = &copy
	}
	for _, notification := range s.state.Notifications {
		if notification.Recipient == actor.Account || notification.Actor == actor.Account {
			out.Notifications = append(out.Notifications, notification)
		}
	}
	for _, event := range s.state.Audit {
		if event.Actor == actor.Account {
			out.Audit = append(out.Audit, event)
		}
	}
	sort.Slice(out.Devices, func(i, j int) bool { return out.Devices[i].ID < out.Devices[j].ID })
	sort.Slice(out.Posts, func(i, j int) bool { return out.Posts[i].ID < out.Posts[j].ID })
	sort.Slice(out.Comments, func(i, j int) bool { return out.Comments[i].ID < out.Comments[j].ID })
	return out
}

func (s *Service) DeleteAccount(actor Device) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	before := cloneState(s.state)
	pseudonym := squarePrivacyPseudonym(actor.Account)
	deletedObjects := map[string]bool{}

	for id, device := range s.state.Devices {
		if device.Account == actor.Account {
			delete(s.state.Devices, id)
			deletedObjects[id] = true
		}
	}
	delete(s.state.Profiles, actor.Account)
	for id, post := range s.state.Posts {
		if post.Author == actor.Account {
			post.Author = pseudonym
			post.AuthorDevice = ""
			post.Content = "[deleted]"
			post.Tags = nil
			post.Status = "deleted"
			post.UpdatedAt = s.cfg.Now().UTC()
			s.state.Posts[id] = post
			deletedObjects[id] = true
		}
	}
	for postID, comments := range s.state.Comments {
		kept := comments[:0]
		removed := 0
		for _, comment := range comments {
			if comment.Author == actor.Account {
				deletedObjects[comment.ID] = true
				removed++
				continue
			}
			kept = append(kept, comment)
		}
		s.state.Comments[postID] = append([]Comment(nil), kept...)
		if removed > 0 {
			post := s.state.Posts[postID]
			post.CommentCount -= removed
			if post.CommentCount < 0 {
				post.CommentCount = 0
			}
			s.state.Posts[postID] = post
		}
	}
	for key, reaction := range s.state.Reactions {
		if reaction.Account == actor.Account {
			delete(s.state.Reactions, key)
			if reaction.Active {
				post := s.state.Posts[reaction.PostID]
				if post.ReactionCount > 0 {
					post.ReactionCount--
				}
				s.state.Posts[reaction.PostID] = post
			}
		}
	}
	for key, follow := range s.state.Follows {
		if follow.Follower == actor.Account || follow.Following == actor.Account {
			delete(s.state.Follows, key)
		}
	}
	for id, report := range s.state.Reports {
		if report.Reporter == actor.Account {
			delete(s.state.Reports, id)
			deletedObjects[id] = true
		}
	}
	for id, notification := range s.state.Notifications {
		if notification.Recipient == actor.Account || notification.Actor == actor.Account {
			delete(s.state.Notifications, id)
			deletedObjects[id] = true
		}
	}
	for key, record := range s.state.Idempotency {
		if deletedObjects[record.ObjectID] {
			delete(s.state.Idempotency, key)
		}
	}
	now := s.cfg.Now().UTC()
	s.appendAuditLocked("account_erased", "account", pseudonym, pseudonym, objectDigest(pseudonym), now)
	return s.saveOrRollbackLocked(before)
}

func squarePrivacyPseudonym(account string) string {
	digest := sha256.Sum256([]byte("ynx-square-erasure-v1\n" + account))
	return "erased:" + hex.EncodeToString(digest[:8])
}
