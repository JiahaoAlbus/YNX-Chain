package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type BFTResourcePool struct {
	chain.ResourcePool
	LastAction  string `json:"lastAction"`
	LastSigner  string `json:"lastSigner"`
	BlockHeight int64  `json:"blockHeight"`
	TxHash      string `json:"txHash"`
	AuditHash   string `json:"auditHash"`
}

type BFTResourceSponsorship struct {
	chain.ResourceSponsorship
	Signer      string `json:"signer"`
	BlockHeight int64  `json:"blockHeight"`
	TxHash      string `json:"txHash"`
	AuditHash   string `json:"auditHash"`
}

type BFTResourceSponsorIdempotency struct {
	ID                  string                  `json:"id"`
	Signer              string                  `json:"signer"`
	IdempotencyKey      string                  `json:"idempotencyKey"`
	Action              string                  `json:"action"`
	RequestHash         string                  `json:"requestHash"`
	ObjectType          string                  `json:"objectType"`
	ObjectID            string                  `json:"objectId"`
	TxHash              string                  `json:"txHash"`
	PoolSnapshot        *BFTResourcePool        `json:"poolSnapshot,omitempty"`
	SponsorshipSnapshot *BFTResourceSponsorship `json:"sponsorshipSnapshot,omitempty"`
}

type BFTResourceSponsorActionRef struct {
	ID            string `json:"id"`
	ActionRef     string `json:"actionReference"`
	SponsorshipID string `json:"sponsorshipId"`
	TxHash        string `json:"txHash"`
}

type BFTResourceSponsorAudit struct {
	ID           string    `json:"id"`
	Sequence     uint64    `json:"sequence"`
	Action       string    `json:"action"`
	Signer       string    `json:"signer"`
	PoolID       string    `json:"poolId,omitempty"`
	ObjectID     string    `json:"objectId"`
	RequestHash  string    `json:"requestHash"`
	PreviousHash string    `json:"previousHash,omitempty"`
	BlockHeight  int64     `json:"blockHeight"`
	TxHash       string    `json:"txHash"`
	CreatedAt    time.Time `json:"createdAt"`
	AuditHash    string    `json:"auditHash"`
}

func ResourceSponsorIdempotencyID(signer, key string) string {
	sum := sha256.Sum256([]byte("YNX_BFT_RESOURCE_SPONSOR_IDEMPOTENCY_V1|" + signer + "|" + key))
	return hex.EncodeToString(sum[:])[:32]
}

func ResourceSponsorActionRefID(actionRef string) string {
	sum := sha256.Sum256([]byte("YNX_BFT_RESOURCE_SPONSOR_ACTION_REF_V1|" + actionRef))
	return hex.EncodeToString(sum[:])[:32]
}

func cloneBFTResourcePools(values []BFTResourcePool) []BFTResourcePool {
	out := append([]BFTResourcePool(nil), values...)
	for i := range out {
		out[i].AllowedBeneficiaries = append([]string(nil), out[i].AllowedBeneficiaries...)
		out[i].AllowedScopes = append([]string(nil), out[i].AllowedScopes...)
		out[i].AllowedResourceTypes = append([]string(nil), out[i].AllowedResourceTypes...)
	}
	return out
}

func cloneBFTResourceSponsorIdempotency(values []BFTResourceSponsorIdempotency) []BFTResourceSponsorIdempotency {
	out := append([]BFTResourceSponsorIdempotency(nil), values...)
	for i := range out {
		if out[i].PoolSnapshot != nil {
			pool := cloneBFTResourcePools([]BFTResourcePool{*out[i].PoolSnapshot})[0]
			out[i].PoolSnapshot = &pool
		}
		if out[i].SponsorshipSnapshot != nil {
			value := *out[i].SponsorshipSnapshot
			out[i].SponsorshipSnapshot = &value
		}
	}
	return out
}

func validateResourceSponsorCommittedState(s CommittedState) error {
	poolByID := make(map[string]BFTResourcePool, len(s.ResourcePools))
	previous := ""
	for _, pool := range s.ResourcePools {
		if !validBFTResourcePoolID(pool.ID) || previous != "" && pool.ID <= previous || !IsNativeAddress(pool.Owner) || pool.PoolType != "merchant" && pool.PoolType != "dapp" || pool.Name == "" || pool.Status != "active" && pool.Status != "paused" && pool.Status != "revoked" || pool.CreatedAt.IsZero() || pool.UpdatedAt.Before(pool.CreatedAt) || !pool.ExpiresAt.After(pool.CreatedAt) || pool.PolicyHash != chain.ResourcePoolPolicyHash(pool.ResourcePool) || !isResourceSponsorAction(pool.LastAction) || !IsNativeAddress(pool.LastSigner) || pool.LastAction != ActionResourceSponsor && pool.LastSigner != pool.Owner || pool.BlockHeight <= 0 || !validResourceTxHash(pool.TxHash) || pool.AuditHash != resourcePoolAuditHash(pool) {
			return errors.New("committed Resource sponsor pools must be canonical, policy-bound, and sorted")
		}
		if pool.Public == (len(pool.AllowedBeneficiaries) != 0) || !strictSortedStrings(pool.AllowedBeneficiaries) || !strictSortedStrings(pool.AllowedScopes) || !strictSortedStrings(pool.AllowedResourceTypes) || !validBFTResourceUnits(pool.PerActionLimit, true) || !validBFTResourceUnits(pool.CumulativeAllowance, true) || !validBFTResourceUnits(pool.Consumed, false) || !resourceUnitsWithin(pool.PerActionLimit, pool.CumulativeAllowance) || !resourceUnitsWithin(pool.Consumed, pool.CumulativeAllowance) || !resourceUnitsMatchTypes(pool.PerActionLimit, pool.AllowedResourceTypes, true) {
			return errors.New("committed Resource sponsor pool policy or accounting is invalid")
		}
		for _, address := range pool.AllowedBeneficiaries {
			if !IsNativeAddress(address) {
				return errors.New("committed Resource sponsor pool beneficiary is invalid")
			}
		}
		for _, scope := range pool.AllowedScopes {
			if _, ok := bftResourceScopes[scope]; !ok {
				return errors.New("committed Resource sponsor pool scope is invalid")
			}
		}
		for _, kind := range pool.AllowedResourceTypes {
			if _, ok := bftResourceTypes[kind]; !ok {
				return errors.New("committed Resource sponsor pool type is invalid")
			}
		}
		poolByID[pool.ID], previous = pool, pool.ID
	}
	sponsorshipByID := make(map[string]BFTResourceSponsorship, len(s.ResourceSponsorships))
	previous = ""
	for _, value := range s.ResourceSponsorships {
		pool, ok := poolByID[value.PoolID]
		if !ok || !strings.HasPrefix(value.ID, "rss_") || len(value.ID) != 28 || previous != "" && value.ID <= previous || !IsNativeAddress(value.Signer) || value.Signer != value.Beneficiary || value.Payer != value.Beneficiary || value.Sponsor != pool.Owner || value.PoolType != pool.PoolType || value.ResourceSource != pool.PoolType+"-resource-pool" || value.Amount <= 0 || value.ActionReference == "" || value.IdempotencyKey == "" || value.TransactionHash != value.TxHash || value.BlockHeight <= 0 || value.CreatedAt.IsZero() || !validResourceTxHash(value.TxHash) || value.AuditHash != resourceSponsorshipAuditHash(value) {
			return errors.New("committed Resource sponsorships must be complete, owner-bound, and sorted")
		}
		if _, ok := bftResourceScopes[value.Scope]; !ok {
			return errors.New("committed Resource sponsorship scope is unsupported")
		}
		if _, ok := bftResourceTypes[value.ResourceType]; !ok {
			return errors.New("committed Resource sponsorship type is unsupported")
		}
		sponsorshipByID[value.ID], previous = value, value.ID
	}
	for _, pool := range s.ResourcePools {
		if pool.LastAction != ActionResourceSponsor {
			continue
		}
		matched := false
		for _, value := range s.ResourceSponsorships {
			if value.TxHash == pool.TxHash && value.PoolID == pool.ID && value.Beneficiary == pool.LastSigner {
				matched = true
				break
			}
		}
		if !matched {
			return errors.New("committed Resource pool sponsor update lacks matching sponsorship")
		}
	}
	previous = ""
	for _, value := range s.ResourceSponsorIdempotency {
		if len(value.ID) != 32 || previous != "" && value.ID <= previous || !IsNativeAddress(value.Signer) || !validResourceIdempotencyKey(value.IdempotencyKey) || !isResourceSponsorAction(value.Action) || !payHashPattern.MatchString(value.RequestHash) || !validResourceTxHash(value.TxHash) || value.ID != ResourceSponsorIdempotencyID(value.Signer, value.IdempotencyKey) {
			return errors.New("committed Resource sponsor idempotency records must be canonical and sorted")
		}
		if value.ObjectType == "pool" {
			if value.PoolSnapshot == nil || value.SponsorshipSnapshot != nil || value.ObjectID != value.PoolSnapshot.ID || value.TxHash != value.PoolSnapshot.TxHash {
				return errors.New("Resource pool replay snapshot is inconsistent")
			}
		} else if value.ObjectType == "sponsorship" {
			if value.SponsorshipSnapshot == nil || value.PoolSnapshot != nil || value.ObjectID != value.SponsorshipSnapshot.ID || value.TxHash != value.SponsorshipSnapshot.TxHash {
				return errors.New("Resource sponsorship replay snapshot is inconsistent")
			}
		} else {
			return errors.New("Resource sponsor replay object type is unsupported")
		}
		previous = value.ID
	}
	previous = ""
	seenRefs := make(map[string]struct{}, len(s.ResourceSponsorActionRefs))
	for _, value := range s.ResourceSponsorActionRefs {
		sponsorship, ok := sponsorshipByID[value.SponsorshipID]
		if !ok || len(value.ID) != 32 || previous != "" && value.ID <= previous || value.ID != ResourceSponsorActionRefID(value.ActionRef) || value.ActionRef != sponsorship.ActionReference || value.TxHash != sponsorship.TxHash {
			return errors.New("committed Resource sponsor action references must be unique, sorted, and reconciled")
		}
		seenRefs[value.ActionRef], previous = struct{}{}, value.ID
	}
	if len(seenRefs) != len(s.ResourceSponsorships) || len(s.ResourceSponsorIdempotency) != len(s.ResourceSponsorAudit) {
		return errors.New("committed Resource sponsor idempotency, audit, or action-reference counts do not reconcile")
	}
	previousHash := ""
	for i, value := range s.ResourceSponsorAudit {
		if value.Sequence != uint64(i+1) || !payIDPattern.MatchString(value.ID) || !isResourceSponsorAction(value.Action) || !IsNativeAddress(value.Signer) || value.ObjectID == "" || !payHashPattern.MatchString(value.RequestHash) || value.PreviousHash != previousHash || value.BlockHeight <= 0 || value.CreatedAt.IsZero() || !validResourceTxHash(value.TxHash) || value.AuditHash != resourceSponsorAuditHash(value) {
			return errors.New("committed Resource sponsor audit chain is invalid")
		}
		previousHash = value.AuditHash
	}
	reserved := make(map[string]chain.ResourceUnits)
	for _, pool := range s.ResourcePools {
		if pool.Status == "revoked" {
			continue
		}
		remaining, err := subtractBFTResourceUnits(pool.CumulativeAllowance, pool.Consumed)
		if err != nil {
			return err
		}
		reserved[pool.Owner], err = addBFTResourceUnits(reserved[pool.Owner], remaining)
		if err != nil {
			return err
		}
	}
	for owner, units := range reserved {
		index, ok := accountIndex(s.Accounts, owner)
		if !ok || s.Accounts[index].ResourceUsage.BandwidthUsed < units.Bandwidth || s.Accounts[index].ResourceUsage.ComputeUsed < units.Compute || s.Accounts[index].ResourceUsage.AICreditsUsed < units.AICredits || s.Accounts[index].ResourceUsage.TrustUsed < units.TrustCredits {
			return fmt.Errorf("committed Resource pool reservation exceeds owner usage for %s", owner)
		}
	}
	return nil
}

func resourcePoolAuditHash(value BFTResourcePool) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_BFT_RESOURCE_POOL_V1", value)
}
func resourceSponsorshipAuditHash(value BFTResourceSponsorship) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_BFT_RESOURCE_SPONSORSHIP_V1", value)
}
func resourceSponsorAuditHash(value BFTResourceSponsorAudit) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_BFT_RESOURCE_SPONSOR_AUDIT_V1", value)
}

func addBFTResourceUnits(a, b chain.ResourceUnits) (chain.ResourceUnits, error) {
	if a.Bandwidth > math.MaxInt64-b.Bandwidth || a.Compute > math.MaxInt64-b.Compute || a.AICredits > math.MaxInt64-b.AICredits || a.TrustCredits > math.MaxInt64-b.TrustCredits {
		return chain.ResourceUnits{}, errors.New("Resource units overflow")
	}
	return chain.ResourceUnits{Bandwidth: a.Bandwidth + b.Bandwidth, Compute: a.Compute + b.Compute, AICredits: a.AICredits + b.AICredits, TrustCredits: a.TrustCredits + b.TrustCredits}, nil
}

func subtractBFTResourceUnits(a, b chain.ResourceUnits) (chain.ResourceUnits, error) {
	if !resourceUnitsWithin(b, a) {
		return chain.ResourceUnits{}, errors.New("Resource units underflow")
	}
	return chain.ResourceUnits{Bandwidth: a.Bandwidth - b.Bandwidth, Compute: a.Compute - b.Compute, AICredits: a.AICredits - b.AICredits, TrustCredits: a.TrustCredits - b.TrustCredits}, nil
}

func consumeBFTResourceUnit(value chain.ResourceUnits, kind string, amount int64) (chain.ResourceUnits, error) {
	addition := chain.ResourceUnits{}
	switch kind {
	case "bandwidth":
		addition.Bandwidth = amount
	case "compute":
		addition.Compute = amount
	case "ai_credits":
		addition.AICredits = amount
	case "trust_credits":
		addition.TrustCredits = amount
	default:
		return chain.ResourceUnits{}, errors.New("unsupported Resource type")
	}
	return addBFTResourceUnits(value, addition)
}

func addBFTResourceUsage(usage *chain.ResourceUsage, units chain.ResourceUnits) error {
	if usage.BandwidthUsed > math.MaxInt64-units.Bandwidth || usage.ComputeUsed > math.MaxInt64-units.Compute || usage.AICreditsUsed > math.MaxInt64-units.AICredits || usage.TrustUsed > math.MaxInt64-units.TrustCredits {
		return errors.New("Resource usage overflow")
	}
	usage.BandwidthUsed += units.Bandwidth
	usage.ComputeUsed += units.Compute
	usage.AICreditsUsed += units.AICredits
	usage.TrustUsed += units.TrustCredits
	return nil
}

func subtractBFTResourceUsage(usage *chain.ResourceUsage, units chain.ResourceUnits) error {
	if usage.BandwidthUsed < units.Bandwidth || usage.ComputeUsed < units.Compute || usage.AICreditsUsed < units.AICredits || usage.TrustUsed < units.TrustCredits {
		return errors.New("Resource reservation release underflow")
	}
	usage.BandwidthUsed -= units.Bandwidth
	usage.ComputeUsed -= units.Compute
	usage.AICreditsUsed -= units.AICredits
	usage.TrustUsed -= units.TrustCredits
	return nil
}

func insertBFTResourcePool(values []BFTResourcePool, value BFTResourcePool) []BFTResourcePool {
	i := sort.Search(len(values), func(i int) bool { return values[i].ID >= value.ID })
	if i < len(values) && values[i].ID == value.ID {
		values[i] = value
		return values
	}
	values = append(values, BFTResourcePool{})
	copy(values[i+1:], values[i:])
	values[i] = value
	return values
}

func bftResourcePoolIndex(values []BFTResourcePool, id string) (int, bool) {
	i := sort.Search(len(values), func(i int) bool { return values[i].ID >= id })
	return i, i < len(values) && values[i].ID == id
}

func strictSortedStrings(values []string) bool {
	for i, value := range values {
		if value == "" || i > 0 && value <= values[i-1] {
			return false
		}
	}
	return true
}
