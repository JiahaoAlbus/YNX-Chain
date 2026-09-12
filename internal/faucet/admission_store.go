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

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	bolt "go.etcd.io/bbolt"
)

var errAdmissionRate = errors.New("faucet rate limit exceeded")
var errAdmissionCapacity = errors.New("faucet admission capacity reached; retain existing request IDs")

var admissionBucket = []byte("requests-v1")
var quotaBucket = []byte("quota-v1")
var addressQuotaBucket = []byte("address-quota-v2")
var ipQuotaBucket = []byte("ip-quota-v2")
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
			return store.migrateQuotaV2(tx)
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
		if err := store.importLegacyQuota(tx); err != nil {
			return err
		}
		return store.migrateQuotaV2(tx)
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
		for _, q := range []struct {
			bucket []byte
			key    string
			window time.Duration
			max    int
		}{{addressQuotaBucket, address, s.cfg.Window, s.cfg.MaxRequests}, {ipQuotaBucket, ip, s.cfg.IPWindow, s.cfg.IPMaxRequests}} {
			var times []time.Time
			bucket := tx.Bucket(q.bucket)
			if data := bucket.Get([]byte(q.key)); data != nil {
				if err := json.Unmarshal(data, &times); err != nil {
					return err
				}
			}
			kept := times[:0]
			for _, at := range times {
				if at.After(now.Add(-q.window)) {
					kept = append(kept, at)
				}
			}
			if len(kept) >= q.max {
				return errAdmissionRate
			}
			data, _ := json.Marshal(append(kept, now))
			if err := bucket.Put([]byte(q.key), data); err != nil {
				return err
			}
		}

		record = admissionRecord{RequestID: id, Address: address, Amount: amount, At: now}
		data, _ := json.Marshal(record)
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

// Migrate historical pair quotas once, retaining every charged admission. Address
// quota survives IP changes; the independent wider IP budget allows shared NATs.
func (s *admissionStore) migrateQuotaV2(tx *bolt.Tx) error {
	if string(tx.Bucket(admissionMeta).Get([]byte("quotaVersion"))) == "2" {
		if tx.Bucket(addressQuotaBucket) == nil || tx.Bucket(ipQuotaBucket) == nil {
			return errors.New("incomplete v2 quota schema")
		}
		return nil
	}
	for _, name := range [][]byte{addressQuotaBucket, ipQuotaBucket} {
		if tx.Bucket(name) != nil {
			return errors.New("unmarked v2 quota bucket")
		}
		if _, err := tx.CreateBucket(name); err != nil {
			return err
		}
	}
	err := tx.Bucket(quotaBucket).ForEach(func(k, v []byte) error {
		var pair []string
		var times []time.Time
		if json.Unmarshal(k, &pair) != nil || len(pair) != 2 || json.Unmarshal(v, &times) != nil {
			return errors.New("invalid legacy quota record")
		}
		address := pair[1]
		if canonical, err := accountaddress.Normalize(address); err == nil {
			address = canonical
		}
		for _, q := range []struct {
			bucket []byte
			key    string
		}{{addressQuotaBucket, address}, {ipQuotaBucket, pair[0]}} {
			b := tx.Bucket(q.bucket)
			var existing []time.Time
			if data := b.Get([]byte(q.key)); data != nil {
				if err := json.Unmarshal(data, &existing); err != nil {
					return err
				}
			}
			data, _ := json.Marshal(append(existing, times...))
			if err := b.Put([]byte(q.key), data); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return tx.Bucket(admissionMeta).Put([]byte("quotaVersion"), []byte("2"))
}
