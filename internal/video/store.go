package video

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

type Store struct {
	mu              sync.RWMutex
	root, statePath string
	state           State
}

func OpenStore(root string) (*Store, error) {
	if root == "" {
		return nil, errors.New("video store root is required")
	}
	if err := os.MkdirAll(filepath.Join(root, "objects"), 0700); err != nil {
		return nil, err
	}
	s := &Store{root: root, statePath: filepath.Join(root, "state.json"), state: emptyState()}
	b, err := os.ReadFile(s.statePath)
	if err == nil {
		if err = json.Unmarshal(b, &s.state); err != nil {
			return nil, err
		}
		normalize(&s.state)
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return s, nil
}

func emptyState() State { s := State{}; normalize(&s); return s }
func normalize(s *State) {
	if s.Videos == nil {
		s.Videos = map[string]*Video{}
	}
	if s.Channels == nil {
		s.Channels = map[string]*Channel{}
	}
	if s.Subscriptions == nil {
		s.Subscriptions = map[string]Subscription{}
	}
	if s.Playlists == nil {
		s.Playlists = map[string]*Playlist{}
	}
	if s.Comments == nil {
		s.Comments = map[string]*Comment{}
	}
	if s.WatchEvents == nil {
		s.WatchEvents = map[string]WatchEvent{}
	}
	if s.Reports == nil {
		s.Reports = map[string]*Report{}
	}
	if s.Appeals == nil {
		s.Appeals = map[string]*Appeal{}
	}
	if s.Monetization == nil {
		s.Monetization = map[string]*Monetization{}
	}
	if s.PayoutIntents == nil {
		s.PayoutIntents = map[string]*PayoutIntent{}
	}
	if s.Revenue == nil {
		s.Revenue = map[string]*RevenueRecord{}
	}
	if s.Disputes == nil {
		s.Disputes = map[string]*Dispute{}
	}
	if s.AIJobs == nil {
		s.AIJobs = map[string]*AIJob{}
	}
}
func (s *Store) read(fn func(State) error) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return fn(s.state)
}
func (s *Store) update(fn func(*State) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := fn(&s.state); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.statePath + ".tmp"
	if err = os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	f, err := os.OpenFile(tmp, os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	f.Close()
	return os.Rename(tmp, s.statePath)
}
