package streambft

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
)

type WorkerBatch struct {
	Version        int      `json:"version"`
	ChainID        string   `json:"chainId"`
	Epoch          uint64   `json:"epoch"`
	Round          uint64   `json:"round"`
	WorkerID       string   `json:"workerId"`
	ParentIDs      []string `json:"parentIds"`
	TransactionIDs []string `json:"transactionIds"`
	Digest         string   `json:"digest"`
}

func NewWorkerBatch(epoch, round uint64, workerID string, parents, transactionIDs []string) (WorkerBatch, error) {
	batch := WorkerBatch{
		Version: CandidateVersion, ChainID: ChainID, Epoch: epoch, Round: round, WorkerID: workerID,
		ParentIDs: uniqueSorted(parents), TransactionIDs: uniqueSorted(transactionIDs),
	}
	if err := batch.validateFields(); err != nil {
		return WorkerBatch{}, err
	}
	digest, err := batch.hashWithoutDigest()
	if err != nil {
		return WorkerBatch{}, err
	}
	batch.Digest = digest
	return batch, nil
}

func (b WorkerBatch) validateFields() error {
	if b.Version != CandidateVersion || b.ChainID != ChainID || b.WorkerID == "" || len(b.TransactionIDs) == 0 {
		return errors.New("worker batch identity or transactions are invalid")
	}
	if !sort.StringsAreSorted(b.ParentIDs) || !sort.StringsAreSorted(b.TransactionIDs) ||
		len(uniqueSorted(b.ParentIDs)) != len(b.ParentIDs) || len(uniqueSorted(b.TransactionIDs)) != len(b.TransactionIDs) {
		return errors.New("worker batch parents and transactions must be unique and sorted")
	}
	return nil
}

func (b WorkerBatch) hashWithoutDigest() (string, error) {
	b.Digest = ""
	payload, err := json.Marshal(b)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func (b WorkerBatch) Validate() error {
	if err := b.validateFields(); err != nil {
		return err
	}
	digest, err := b.hashWithoutDigest()
	if err != nil {
		return err
	}
	if digest != b.Digest {
		return errors.New("worker batch digest mismatch")
	}
	return nil
}

type AvailabilityCertificate struct {
	ChainID     string `json:"chainId"`
	BatchDigest string `json:"batchDigest"`
	Votes       []Vote `json:"votes"`
}

func AvailabilityMessage(batchDigest string) []byte {
	return []byte("YNX_STREAMBFT_DA_V1|" + ChainID + "|" + batchDigest)
}

func (certificate AvailabilityCertificate) Validate(batch WorkerBatch, validators []Validator) error {
	if err := batch.Validate(); err != nil {
		return err
	}
	if certificate.ChainID != ChainID || certificate.BatchDigest != batch.Digest {
		return errors.New("availability certificate does not bind the batch")
	}
	validatorByID := make(map[string]Validator, len(validators))
	var totalPower uint64
	for _, validator := range validators {
		if validator.ID == "" || len(validator.PublicKey) != ed25519.PublicKeySize || validator.Power == 0 {
			return errors.New("validator set contains an invalid member")
		}
		validatorByID[validator.ID] = validator
		totalPower += validator.Power
	}
	seen := map[string]struct{}{}
	var availablePower uint64
	for _, vote := range certificate.Votes {
		validator, ok := validatorByID[vote.ValidatorID]
		if !ok {
			return fmt.Errorf("availability vote uses unknown validator %s", vote.ValidatorID)
		}
		if _, duplicate := seen[vote.ValidatorID]; duplicate {
			return fmt.Errorf("duplicate availability vote from %s", vote.ValidatorID)
		}
		if !ed25519.Verify(validator.PublicKey, AvailabilityMessage(batch.Digest), vote.Signature) {
			return fmt.Errorf("invalid availability vote from %s", vote.ValidatorID)
		}
		seen[vote.ValidatorID] = struct{}{}
		availablePower += validator.Power
	}
	if totalPower == 0 || availablePower*3 <= totalPower*2 {
		return fmt.Errorf("insufficient availability power: available=%d total=%d", availablePower, totalPower)
	}
	return nil
}
