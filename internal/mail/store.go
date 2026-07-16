package mail

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Store struct {
	mu   sync.Mutex
	path string
	data State
}

func NewStore(path string) (*Store, error) {
	s := &Store{path: path, data: emptyState()}
	if path == "" {
		return s, nil
	}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &s.data); err != nil {
		return nil, err
	}
	s.normalize()
	return s, nil
}

func emptyState() State {
	return State{Users: map[string]User{}, Challenges: map[string]Challenge{}, Sessions: map[string]Session{}, WalletRequests: map[string]bool{}, Drafts: map[string]Draft{}, Messages: map[string]Message{}, Blocks: map[string]map[string]bool{}, Reports: map[string]AbuseReport{}, AIJobs: map[string]AIJob{}, Rate: map[string][]time.Time{}}
}

func (s *Store) normalize() {
	if s.data.Users == nil {
		s.data.Users = map[string]User{}
	}
	if s.data.Challenges == nil {
		s.data.Challenges = map[string]Challenge{}
	}
	if s.data.Sessions == nil {
		s.data.Sessions = map[string]Session{}
	}
	if s.data.WalletRequests == nil {
		s.data.WalletRequests = map[string]bool{}
	}
	if s.data.Drafts == nil {
		s.data.Drafts = map[string]Draft{}
	}
	if s.data.Messages == nil {
		s.data.Messages = map[string]Message{}
	}
	if s.data.Blocks == nil {
		s.data.Blocks = map[string]map[string]bool{}
	}
	if s.data.Reports == nil {
		s.data.Reports = map[string]AbuseReport{}
	}
	if s.data.AIJobs == nil {
		s.data.AIJobs = map[string]AIJob{}
	}
	if s.data.Rate == nil {
		s.data.Rate = map[string][]time.Time{}
	}
}

func (s *Store) update(fn func(*State) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	copyBytes, _ := json.Marshal(s.data)
	var next State
	_ = json.Unmarshal(copyBytes, &next)
	if err := fn(&next); err != nil {
		return err
	}
	if s.path != "" {
		if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
			return err
		}
		b, err := json.MarshalIndent(next, "", "  ")
		if err != nil {
			return err
		}
		tmp := s.path + ".tmp"
		if err := os.WriteFile(tmp, b, 0o600); err != nil {
			return err
		}
		if err := os.Rename(tmp, s.path); err != nil {
			return err
		}
	}
	s.data = next
	return nil
}

func (s *Store) view(fn func(State) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, _ := json.Marshal(s.data)
	var snap State
	_ = json.Unmarshal(b, &snap)
	return fn(snap)
}
