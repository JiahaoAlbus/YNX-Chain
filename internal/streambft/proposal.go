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

type LanePolicy struct {
	Limit      Resources `json:"limit"`
	MinimumFee uint64    `json:"minimumFee"`
}

type ProposalPolicy struct {
	GlobalLimit Resources           `json:"globalLimit"`
	Lanes       map[Lane]LanePolicy `json:"lanes"`
}

func (p ProposalPolicy) Validate() error {
	for _, lane := range orderedLanes {
		policy, ok := p.Lanes[lane]
		if !ok {
			return fmt.Errorf("missing policy for lane %s", lane)
		}
		if policy.Limit == (Resources{}) {
			return fmt.Errorf("lane %s has zero resource limit", lane)
		}
	}
	if p.GlobalLimit == (Resources{}) {
		return errors.New("global resource limit is zero")
	}
	return nil
}

type Proposal struct {
	Version       int           `json:"version"`
	ChainID       string        `json:"chainId"`
	Height        uint64        `json:"height"`
	View          uint64        `json:"view"`
	Leader        string        `json:"leader"`
	ParentID      string        `json:"parentId"`
	Transactions  []Transaction `json:"transactions"`
	LaneResources []LaneUsage   `json:"laneResources"`
	Resources     Resources     `json:"resources"`
	ID            string        `json:"id"`
}

type LaneUsage struct {
	Lane      Lane      `json:"lane"`
	Resources Resources `json:"resources"`
}

func BuildProposal(height, view uint64, leader, parentID string, candidates []Transaction, policy ProposalPolicy) (Proposal, error) {
	if height == 0 || leader == "" || parentID == "" {
		return Proposal{}, errors.New("height, leader, and parent ID are required")
	}
	if err := policy.Validate(); err != nil {
		return Proposal{}, err
	}
	ordered := append([]Transaction(nil), candidates...)
	for _, transaction := range ordered {
		if err := transaction.Validate(); err != nil {
			return Proposal{}, fmt.Errorf("invalid candidate %s: %w", transaction.ID, err)
		}
	}
	SortTransactions(ordered)
	seen := map[string]struct{}{}
	selected := make([]Transaction, 0, len(ordered))
	laneUsage := make(map[Lane]Resources, len(orderedLanes))
	var global Resources
	for _, transaction := range ordered {
		if _, exists := seen[transaction.ID]; exists {
			return Proposal{}, fmt.Errorf("duplicate transaction ID %s", transaction.ID)
		}
		seen[transaction.ID] = struct{}{}
		lanePolicy := policy.Lanes[transaction.Lane]
		if transaction.FeeCap < lanePolicy.MinimumFee {
			continue
		}
		candidateLane, laneOK := laneUsage[transaction.Lane].checkedAdd(transaction.Resources)
		candidateGlobal, globalOK := global.checkedAdd(transaction.Resources)
		if !laneOK || !globalOK {
			continue
		}
		if !candidateLane.Fits(lanePolicy.Limit) || !candidateGlobal.Fits(policy.GlobalLimit) {
			continue
		}
		laneUsage[transaction.Lane] = candidateLane
		global = candidateGlobal
		selected = append(selected, transaction)
	}
	usage := make([]LaneUsage, 0, len(orderedLanes))
	for _, lane := range orderedLanes {
		usage = append(usage, LaneUsage{Lane: lane, Resources: laneUsage[lane]})
	}
	proposal := Proposal{Version: CandidateVersion, ChainID: ChainID, Height: height, View: view, Leader: leader, ParentID: parentID, Transactions: selected, LaneResources: usage, Resources: global}
	id, err := proposal.hashWithoutID()
	if err != nil {
		return Proposal{}, err
	}
	proposal.ID = id
	return proposal, nil
}

func (p Proposal) hashWithoutID() (string, error) {
	p.ID = ""
	payload, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func (p Proposal) Validate(policy ProposalPolicy) error {
	if p.Version != CandidateVersion || p.ChainID != ChainID || p.Height == 0 || p.Leader == "" || p.ParentID == "" {
		return errors.New("proposal identity is invalid")
	}
	rebuilt, err := BuildProposal(p.Height, p.View, p.Leader, p.ParentID, p.Transactions, policy)
	if err != nil {
		return err
	}
	if rebuilt.ID != p.ID || !equalTransactions(rebuilt.Transactions, p.Transactions) {
		return errors.New("proposal is not canonical")
	}
	return nil
}

type Validator struct {
	ID        string            `json:"id"`
	PublicKey ed25519.PublicKey `json:"publicKey"`
	Power     uint64            `json:"power"`
}

type Vote struct {
	ValidatorID string `json:"validatorId"`
	Signature   []byte `json:"signature"`
}

type QuorumCertificate struct {
	ChainID  string `json:"chainId"`
	View     uint64 `json:"view"`
	BlockID  string `json:"blockId"`
	Votes    []Vote `json:"votes"`
	Fallback bool   `json:"fallback"`
}

func QuorumMessage(view uint64, blockID string, fallback bool) []byte {
	return []byte(fmt.Sprintf("YNX_STREAMBFT_QC_V1|%s|%d|%s|%t", ChainID, view, blockID, fallback))
}

func (q QuorumCertificate) Validate(validators []Validator) error {
	if q.ChainID != ChainID || q.BlockID == "" {
		return errors.New("quorum certificate identity is invalid")
	}
	validatorByID := make(map[string]Validator, len(validators))
	var totalPower uint64
	for _, validator := range validators {
		if validator.ID == "" || len(validator.PublicKey) != ed25519.PublicKeySize || validator.Power == 0 {
			return errors.New("validator set contains an invalid member")
		}
		if _, duplicate := validatorByID[validator.ID]; duplicate {
			return errors.New("validator set contains a duplicate ID")
		}
		validatorByID[validator.ID] = validator
		totalPower += validator.Power
	}
	seen := map[string]struct{}{}
	var signedPower uint64
	message := QuorumMessage(q.View, q.BlockID, q.Fallback)
	for _, vote := range q.Votes {
		validator, ok := validatorByID[vote.ValidatorID]
		if !ok {
			return fmt.Errorf("vote uses unknown validator %s", vote.ValidatorID)
		}
		if _, duplicate := seen[vote.ValidatorID]; duplicate {
			return fmt.Errorf("duplicate vote from validator %s", vote.ValidatorID)
		}
		if !ed25519.Verify(validator.PublicKey, message, vote.Signature) {
			return fmt.Errorf("invalid vote from validator %s", vote.ValidatorID)
		}
		seen[vote.ValidatorID] = struct{}{}
		signedPower += validator.Power
	}
	if totalPower == 0 || signedPower*3 <= totalPower*2 {
		return fmt.Errorf("insufficient quorum power: signed=%d total=%d", signedPower, totalPower)
	}
	return nil
}

func DeterministicLeader(validators []Validator, view uint64) (string, error) {
	if len(validators) == 0 {
		return "", errors.New("validator set is empty")
	}
	ordered := append([]Validator(nil), validators...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].ID < ordered[j].ID })
	return ordered[view%uint64(len(ordered))].ID, nil
}

func equalTransactions(left, right []Transaction) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		leftPayload, _ := json.Marshal(left[index])
		rightPayload, _ := json.Marshal(right[index])
		if string(leftPayload) != string(rightPayload) {
			return false
		}
	}
	return true
}
