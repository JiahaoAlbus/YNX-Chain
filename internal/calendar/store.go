package calendar

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
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
	if err = json.Unmarshal(b, &s.data); err != nil {
		return nil, err
	}
	s.normalize()
	return s, nil
}
func emptyState() State {
	return State{Users: map[string]User{}, Challenges: map[string]Challenge{}, Sessions: map[string]Session{}, Events: map[string]Event{}, ReminderDeliveries: map[string]ReminderDelivery{}, Changes: map[string]ChangePreview{}, Mutations: map[string]string{}, AIJobs: map[string]AIJob{}}
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
	if s.data.Events == nil {
		s.data.Events = map[string]Event{}
	}
	if s.data.ReminderDeliveries == nil {
		s.data.ReminderDeliveries = map[string]ReminderDelivery{}
	}
	if s.data.Changes == nil {
		s.data.Changes = map[string]ChangePreview{}
	}
	if s.data.Mutations == nil {
		s.data.Mutations = map[string]string{}
	}
	if s.data.AIJobs == nil {
		s.data.AIJobs = map[string]AIJob{}
	}
}
func (s *Store) update(fn func(*State) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, _ := json.Marshal(s.data)
	var next State
	_ = json.Unmarshal(b, &next)
	if err := fn(&next); err != nil {
		return err
	}
	if s.path != "" {
		if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
			return err
		}
		body, err := json.MarshalIndent(next, "", "  ")
		if err != nil {
			return err
		}
		tmp := s.path + ".tmp"
		if err = os.WriteFile(tmp, body, 0o600); err != nil {
			return err
		}
		if err = os.Rename(tmp, s.path); err != nil {
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
