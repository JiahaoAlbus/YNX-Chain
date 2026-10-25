package assetauth

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"time"
)

type GuardianRecoveryPolicy struct {
	Guardians map[string][]byte `json:"guardians"`
	Threshold int               `json:"threshold"`
	Delay     time.Duration     `json:"delay"`
	Epoch     uint64            `json:"epoch"`
}

func (policy GuardianRecoveryPolicy) Validate() error {
	if len(policy.Guardians) == 0 {
		return errors.New("guardian recovery policy has no guardians")
	}
	if policy.Threshold < 1 || policy.Threshold > len(policy.Guardians) || policy.Delay < time.Hour || policy.Delay > 30*24*time.Hour {
		return errors.New("guardian recovery threshold or delay is invalid")
	}
	for id, publicKey := range policy.Guardians {
		if id == "" || len(publicKey) != ed25519.PublicKeySize {
			return errors.New("guardian recovery member is invalid")
		}
	}
	return nil
}

func (policy GuardianRecoveryPolicy) clone() GuardianRecoveryPolicy {
	guardians := make(map[string][]byte, len(policy.Guardians))
	for id, publicKey := range policy.Guardians {
		guardians[id] = append([]byte(nil), publicKey...)
	}
	policy.Guardians = guardians
	return policy
}

type GuardianApproval struct {
	GuardianID string `json:"guardianId"`
	Signature  []byte `json:"signature"`
}

type RecoveryProposal struct {
	ID                string             `json:"id"`
	Account           string             `json:"account"`
	PolicyEpoch       uint64             `json:"policyEpoch"`
	NewOwnerAlgorithm string             `json:"newOwnerAlgorithm"`
	NewOwnerPublicKey []byte             `json:"newOwnerPublicKey"`
	CreatedAt         time.Time          `json:"createdAt"`
	ExecutableAt      time.Time          `json:"executableAt"`
	Approvals         []GuardianApproval `json:"approvals"`
}

func NewRecoveryProposal(account SmartAccount, algorithm string, publicKey []byte, at time.Time) (RecoveryProposal, error) {
	if err := account.Validate(); err != nil {
		return RecoveryProposal{}, err
	}
	if err := validatePublicKey(algorithm, publicKey); err != nil {
		return RecoveryProposal{}, err
	}
	domain := fmt.Sprintf("YNX_GUARDIAN_RECOVERY_ID_V1\x00%s\x00%d\x00%s\x00%x\x00%s", account.Address, account.Recovery.Epoch, algorithm, publicKey, at.UTC().Format(time.RFC3339Nano))
	sum := sha256.Sum256([]byte(domain))
	return RecoveryProposal{ID: "recovery_" + hex.EncodeToString(sum[:12]), Account: account.Address, PolicyEpoch: account.Recovery.Epoch, NewOwnerAlgorithm: algorithm, NewOwnerPublicKey: append([]byte(nil), publicKey...), CreatedAt: at.UTC(), ExecutableAt: at.UTC().Add(account.Recovery.Delay), Approvals: []GuardianApproval{}}, nil
}

func (proposal RecoveryProposal) ApprovalMessage() []byte {
	domain := fmt.Sprintf("YNX_GUARDIAN_RECOVERY_APPROVAL_V1\x00%s\x00%s\x00%d\x00%s\x00%x\x00%s", proposal.ID, proposal.Account, proposal.PolicyEpoch, proposal.NewOwnerAlgorithm, proposal.NewOwnerPublicKey, proposal.ExecutableAt.UTC().Format(time.RFC3339Nano))
	sum := sha256.Sum256([]byte(domain))
	return sum[:]
}

func (proposal RecoveryProposal) AddApproval(policy GuardianRecoveryPolicy, approval GuardianApproval) (RecoveryProposal, error) {
	if err := policy.Validate(); err != nil {
		return proposal, err
	}
	publicKey, ok := policy.Guardians[approval.GuardianID]
	if !ok || !ed25519.Verify(ed25519.PublicKey(publicKey), proposal.ApprovalMessage(), approval.Signature) {
		return proposal, errors.New("guardian recovery approval is invalid")
	}
	for _, existing := range proposal.Approvals {
		if existing.GuardianID == approval.GuardianID {
			return proposal, errors.New("guardian recovery approval is duplicated")
		}
	}
	proposal.Approvals = append(append([]GuardianApproval(nil), proposal.Approvals...), GuardianApproval{GuardianID: approval.GuardianID, Signature: append([]byte(nil), approval.Signature...)})
	sort.Slice(proposal.Approvals, func(i, j int) bool { return proposal.Approvals[i].GuardianID < proposal.Approvals[j].GuardianID })
	return proposal, nil
}

func (account SmartAccount) ExecuteRecovery(proposal RecoveryProposal, at time.Time) (SmartAccount, error) {
	if err := account.Validate(); err != nil {
		return account, err
	}
	if proposal.Account != account.Address || proposal.PolicyEpoch != account.Recovery.Epoch || at.Before(proposal.ExecutableAt) {
		return account, errors.New("guardian recovery account, epoch, or delay is invalid")
	}
	if err := validatePublicKey(proposal.NewOwnerAlgorithm, proposal.NewOwnerPublicKey); err != nil {
		return account, err
	}
	seen := map[string]struct{}{}
	valid := 0
	for _, approval := range proposal.Approvals {
		if _, duplicate := seen[approval.GuardianID]; duplicate {
			return account, errors.New("guardian recovery approval is duplicated")
		}
		publicKey, ok := account.Recovery.Guardians[approval.GuardianID]
		if !ok || !ed25519.Verify(ed25519.PublicKey(publicKey), proposal.ApprovalMessage(), approval.Signature) {
			return account, errors.New("guardian recovery approval is invalid")
		}
		seen[approval.GuardianID] = struct{}{}
		valid++
	}
	if valid < account.Recovery.Threshold {
		return account, errors.New("guardian recovery threshold is not met")
	}
	account = account.clone()
	account.OwnerAlgorithm = proposal.NewOwnerAlgorithm
	account.OwnerPublicKey = append([]byte(nil), proposal.NewOwnerPublicKey...)
	account.SessionKeys = map[string]SessionKey{}
	account.Recovery.Epoch++
	for domain := range account.NonceByDomain {
		account.NonceByDomain[domain]++
	}
	return account, nil
}
