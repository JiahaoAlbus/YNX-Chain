package faucet

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	bolt "go.etcd.io/bbolt"
)

var errAdmissionRate = errors.New("faucet rate limit exceeded")
var errAdmissionCapacity = errors.New("faucet admission capacity reached; retain existing request IDs")

var admissionBucket = []byte("requests-v1")
var quotaBucket = []byte("quota-v1")
var admissionMeta = []byte("metadata-v1")

type admissionRecord struct {
	RequestID   string             `json:"requestId"`
	Address     string             `json:"address"`
	Amount      int64              `json:"amount"`
	At          time.Time          `json:"at"`
	Transaction *chain.Transaction `json:"transaction,omitempty"`
}

type admissionStore struct {
	db  *bolt.DB
	cfg Config
}

func openAdmissionStore(cfg Config) (*admissionStore, error) {
	// A truncated existing store must never silently become a fresh quota/ID registry.
	if st, err := os.Lstat(cfg.AdmissionPath); err == nil {
		if !st.Mode().IsRegular() || st.Size() == 0 || st.Mode().Perm()&0077 != 0 {
			return nil, errors.New("admission database must be a nonempty private regular file")
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if err := ensureAdmissionDirectory(filepath.Dir(cfg.AdmissionPath)); err != nil {
		return nil, err
	}
	db, err := bolt.Open(cfg.AdmissionPath, 0600, &bolt.Options{Timeout: time.Second})
	if err != nil {
		return nil, err
	}
	store := &admissionStore{db: db, cfg: cfg}
	err = db.Update(func(tx *bolt.Tx) error {
		meta := tx.Bucket(admissionMeta)
		if meta != nil {
			if string(meta.Get([]byte("chainId"))) != strconv.FormatInt(cfg.ChainID, 10) || string(meta.Get([]byte("version"))) != chain.FaucetRequestVersion || tx.Bucket(admissionBucket) == nil || tx.Bucket(quotaBucket) == nil {
				return errors.New("admission database identity does not match faucet")
			}
			return nil
		}
		if tx.Bucket(admissionBucket) != nil || tx.Bucket(quotaBucket) != nil {
			return errors.New("incomplete admission schema")
		}
		for _, name := range [][]byte{admissionMeta, admissionBucket, quotaBucket} {
			if _, err := tx.CreateBucket(name); err != nil {
				return err
			}
		}
		meta = tx.Bucket(admissionMeta)
		if err := meta.Put([]byte("chainId"), []byte(strconv.FormatInt(cfg.ChainID, 10))); err != nil {
			return err
		}
		if err := meta.Put([]byte("version"), []byte(chain.FaucetRequestVersion)); err != nil {
			return err
		}
		return store.importLegacyQuota(tx)
	})
	if err == nil {
		err = syncAdmissionDirectory(filepath.Dir(cfg.AdmissionPath))
	}
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func ensureAdmissionDirectory(path string) error {
	st, err := os.Stat(path)
	if err == nil {
		if !st.IsDir() {
			return errors.New("admission parent is not a directory")
		}
		return nil
	}
	if !os.IsNotExist(err) {
		return err
	}
	parent := filepath.Dir(path)
	if err := ensureAdmissionDirectory(parent); err != nil {
		return err
	}
	if err := os.Mkdir(path, 0700); err != nil && !os.IsExist(err) {
		return err
	}
	return syncAdmissionDirectory(parent)
}

func syncAdmissionDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

func (s *Service) Close() error {
	if s.admissions != nil {
		return s.admissions.db.Close()
	}
	return nil
}

func quotaKey(ip, address string) []byte { key, _ := json.Marshal([]string{ip, address}); return key }

func (s *admissionStore) importLegacyQuota(tx *bolt.Tx) error {
	f, err := os.Open(s.cfg.RequestLog)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() > 64<<20 {
		return errors.New("legacy request log requires a bounded migration review")
	}
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 4096), MaxResponseBytes)
	cutoff := time.Now().Add(-s.cfg.Window)
	for scanner.Scan() {
		var entry LogEntry
		if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
			return fmt.Errorf("invalid legacy request log: %w", err)
		}
		if entry.Status != "sent" && entry.Status != "error" || !entry.At.After(cutoff) {
			continue
		}
		var times []time.Time
		key := quotaKey(entry.IP, entry.Address)
		if data := tx.Bucket(quotaBucket).Get(key); data != nil {
			if err := json.Unmarshal(data, &times); err != nil {
				return err
			}
		}
		times = append(times, entry.At)
		data, _ := json.Marshal(times)
		if err := tx.Bucket(quotaBucket).Put(key, data); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func (s *admissionStore) admit(id, address, ip string, amount int64, now time.Time) (admissionRecord, bool, error) {
	var record admissionRecord
	replayed := false
	err := s.db.Update(func(tx *bolt.Tx) error {
		requests := tx.Bucket(admissionBucket)
		if data := requests.Get([]byte(id)); data != nil {
			if err := json.Unmarshal(data, &record); err != nil {
				return err
			}
			if record.RequestID != id || record.Address != address || record.Amount != amount {
				return chain.ErrFaucetRequestConflict
			}
			replayed = true
			return nil
		}
		if requests.Stats().KeyN >= s.cfg.MaxAdmissions {
			return errAdmissionCapacity
		}
		quotas := tx.Bucket(quotaBucket)
		key := quotaKey(ip, address)
		var times []time.Time
		if data := quotas.Get(key); data != nil {
			if err := json.Unmarshal(data, &times); err != nil {
				return err
			}
		}
		cutoff := now.Add(-s.cfg.Window)
		kept := times[:0]
		for _, at := range times {
			if at.After(cutoff) {
				kept = append(kept, at)
			}
		}
		if len(kept) >= s.cfg.MaxRequests {
			return errAdmissionRate
		}
		data, _ := json.Marshal(append(kept, now))
		if err := quotas.Put(key, data); err != nil {
			return err
		}
		record = admissionRecord{RequestID: id, Address: address, Amount: amount, At: now}
		data, _ = json.Marshal(record)
		return requests.Put([]byte(id), data)
	})
	return record, replayed, err
}

func (s *admissionStore) complete(record admissionRecord, transaction chain.Transaction) error {
	return s.db.Update(func(tx *bolt.Tx) error {
		bucket := tx.Bucket(admissionBucket)
		data := bucket.Get([]byte(record.RequestID))
		var current admissionRecord
		if data == nil || json.Unmarshal(data, &current) != nil || current.RequestID != record.RequestID || current.Address != record.Address || current.Amount != record.Amount {
			return errors.New("durable admission binding disappeared")
		}
		if current.Transaction != nil && current.Transaction.Hash != transaction.Hash {
			return errors.New("faucet receipt changed")
		}
		current.Transaction = &transaction
		data, err := json.Marshal(current)
		if err != nil {
			return err
		}
		return bucket.Put([]byte(record.RequestID), data)
	})
}

func (s *admissionStore) lookup(id string) (admissionRecord, bool, error) {
	var record admissionRecord
	found := false
	err := s.db.View(func(tx *bolt.Tx) error {
		data := tx.Bucket(admissionBucket).Get([]byte(id))
		if data == nil {
			return nil
		}
		if err := json.Unmarshal(data, &record); err != nil {
			return err
		}
		if record.RequestID != id || record.Amount <= 0 {
			return errors.New("invalid stored faucet admission")
		}
		found = true
		return nil
	})
	return record, found, err
}
