package centralbrowserfamily

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"time"

	bolt "go.etcd.io/bbolt"
)

// Each transaction is fsynced by bbolt. Credentials and pending request bodies
// are sealed; neither refresh handles nor authorization codes appear on disk.
type durableStore struct {
	db      *bolt.DB
	seal    cipher.AEAD
	binding string
}
type loginIntent struct {
	State, PreviousFamilyID, RequestID string
	Deadline                           time.Time
	Fenced                             bool
	Input                              *PKCEInput
	ResultID                           string
}
type familyRecord struct {
	Grant                       Grant
	CentralID, Handle           string
	Epoch                       int64
	Fenced                      bool
	PendingRenew, PendingRevoke string
	IntentID                    string
}
type durableState struct {
	Version  int
	Intents  map[string]*loginIntent
	Families map[string]*familyRecord
}

func openStore(file string, key []byte, binding string) (*durableStore, error) {
	if !filepath.IsAbs(file) || len(key) != 32 {
		return nil, &Error{Code: CodeConfiguration}
	}
	parent, err := os.Lstat(filepath.Dir(file))
	if err != nil || !parent.IsDir() || parent.Mode().Perm()&0077 != 0 {
		return nil, &Error{Code: CodeConfiguration}
	}
	if st, ok := parent.Sys().(*syscall.Stat_t); !ok || st.Uid != uint32(os.Getuid()) {
		return nil, &Error{Code: CodeConfiguration}
	}
	if st, e := os.Lstat(file); e == nil {
		if !st.Mode().IsRegular() || st.Mode().Perm() != 0600 {
			return nil, &Error{Code: CodeConfiguration}
		}
		if stat, ok := st.Sys().(*syscall.Stat_t); !ok || stat.Uid != uint32(os.Getuid()) || stat.Nlink != 1 {
			return nil, &Error{Code: CodeConfiguration}
		}
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	seal, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	db, err := bolt.Open(file, 0600, &bolt.Options{Timeout: time.Second, NoSync: false})
	if err != nil {
		return nil, err
	}
	// Persist the new database directory entry before any intent can be issued.
	dir, err := os.Open(filepath.Dir(file))
	if err != nil {
		db.Close()
		return nil, err
	}
	err = dir.Sync()
	dir.Close()
	if err != nil {
		db.Close()
		return nil, err
	}
	s := &durableStore{db: db, seal: seal, binding: binding}
	err = s.update(func(_ *durableState) error { return nil })
	if err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}
func (s *durableStore) update(fn func(*durableState) error) error {
	return s.db.Update(func(tx *bolt.Tx) error {
		b, err := tx.CreateBucketIfNotExists([]byte("finite-family-v1"))
		if err != nil {
			return err
		}
		state, err := s.load(b)
		if err != nil {
			return err
		}
		before, err := json.Marshal(state)
		if err != nil {
			return err
		}
		if err := fn(&state); err != nil {
			return err
		}
		raw, err := json.Marshal(state)
		if err != nil {
			return err
		}
		if b.Get([]byte("sealed-state")) != nil && bytes.Equal(before, raw) {
			return nil
		}
		nonce := make([]byte, s.seal.NonceSize())
		if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
			return err
		}
		return b.Put([]byte("sealed-state"), s.seal.Seal(nonce, nonce, raw, []byte(s.binding)))
	})
}
func (s *durableStore) load(b *bolt.Bucket) (durableState, error) {
	state := durableState{Version: 1, Intents: map[string]*loginIntent{}, Families: map[string]*familyRecord{}}
	if b == nil {
		return state, &Error{Code: CodeConfiguration}
	}
	data := b.Get([]byte("sealed-state"))
	if data == nil {
		return state, nil
	}
	if len(data) < s.seal.NonceSize() {
		return state, &Error{Code: CodeConfiguration}
	}
	raw, err := s.seal.Open(nil, data[:s.seal.NonceSize()], data[s.seal.NonceSize():], []byte(s.binding))
	if err != nil {
		return state, &Error{Code: CodeConfiguration}
	}
	if json.Unmarshal(raw, &state) != nil || state.Version != 1 || state.Intents == nil || state.Families == nil {
		return state, &Error{Code: CodeConfiguration}
	}
	return state, nil
}
func (s *durableStore) view(fn func(*durableState) error) error {
	return s.db.View(func(tx *bolt.Tx) error {
		state, err := s.load(tx.Bucket([]byte("finite-family-v1")))
		if err != nil {
			return err
		}
		return fn(&state)
	})
}

// Retain expired intent fences beyond the bounded 5s call. Unconfirmed revoke
// targets survive until the original absolute lease has also expired.
func (s *durableState) collect(now time.Time) {
	for id, in := range s.Intents {
		if !in.Deadline.Add(time.Minute).After(now) {
			delete(s.Intents, id)
		}
	}
	for id, f := range s.Families {
		deadline := f.Grant.AbsoluteExpiresAt
		if f.PendingRevoke == "" && f.Grant.IdleExpiresAt.Before(deadline) {
			deadline = f.Grant.IdleExpiresAt
		}
		if !deadline.Add(time.Minute).After(now) {
			delete(s.Families, id)
		}
	}
}
func (s *durableStore) close() error { return s.db.Close() }
