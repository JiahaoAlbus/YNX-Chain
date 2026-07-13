package chain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

const (
	ResourceAuthorizationVersion = 1
	ResourcePoolCreateAction     = "resource_pool_create"
	ResourcePoolFundAction       = "resource_pool_fund"
	ResourcePoolPolicyAction     = "resource_pool_policy_update"
	ResourcePoolStatusAction     = "resource_pool_status_update"
	ResourceSponsorAction        = "resource_sponsorship_consume"
)

var resourceScopes = map[string]struct{}{
	"ai_service": {}, "contract_call": {}, "dapp_action": {}, "pay_api": {}, "trust_service": {}, "wallet_action": {},
}

var resourceTypes = map[string]struct{}{
	"ai_credits": {}, "bandwidth": {}, "compute": {}, "trust_credits": {},
}

type resourceAuthorizationSignDoc struct {
	Domain      string `json:"domain"`
	Version     int    `json:"version"`
	ChainID     int64  `json:"chainId"`
	Action      string `json:"action"`
	Signer      string `json:"signer"`
	Nonce       uint64 `json:"nonce"`
	PayloadHash string `json:"payloadHash"`
	PublicKey   string `json:"publicKey"`
}

type resourceSponsorIntegrityState struct {
	Pools      map[string]ResourcePool               `json:"pools"`
	Sponsors   map[string]ResourceSponsorship        `json:"sponsors"`
	IDs        map[string]ResourceSponsorIdempotency `json:"idempotency"`
	ActionRefs map[string]string                     `json:"actionRefs"`
	Audit      []ResourceSponsorAuditEvent           `json:"audit"`
}

// SignResourceAuthorization creates a domain-separated owner/user signature.
// Payload must be the canonical request value with Authorization left empty.
func SignResourceAuthorization(privateKey *secp256k1.PrivateKey, chainID int64, action string, payload any, nonce uint64) (ResourceAuthorization, error) {
	if privateKey == nil || chainID <= 0 || nonce == 0 {
		return ResourceAuthorization{}, errors.New("resource authorization requires a private key, positive chain ID, and positive nonce")
	}
	publicKey := privateKey.PubKey().SerializeCompressed()
	signer, err := nativeResourceAddress(publicKey)
	if err != nil {
		return ResourceAuthorization{}, err
	}
	auth := ResourceAuthorization{Version: ResourceAuthorizationVersion, ChainID: chainID, Action: action, Signer: signer, Nonce: nonce, PayloadHash: resourceSponsorRequestHash(action, payload), PublicKey: hex.EncodeToString(publicKey)}
	digest, err := resourceAuthorizationDigest(auth)
	if err != nil {
		return ResourceAuthorization{}, err
	}
	auth.Signature = hex.EncodeToString(ecdsa.Sign(privateKey, digest).Serialize())
	return auth, nil
}

func verifyResourceAuthorization(auth ResourceAuthorization, chainID int64, action string, payload any) error {
	if auth.Version != ResourceAuthorizationVersion || auth.ChainID != chainID || auth.Action != action || auth.Nonce == 0 {
		return errors.New("resource authorization envelope does not match version, chain, action, or nonce")
	}
	if !accountaddress.IsCanonical(auth.Signer) || auth.PayloadHash != resourceSponsorRequestHash(action, payload) {
		return errors.New("resource authorization signer or payload hash is invalid")
	}
	publicKeyBytes, err := hex.DecodeString(auth.PublicKey)
	if err != nil || len(publicKeyBytes) != secp256k1.PubKeyBytesLenCompressed {
		return errors.New("resource authorization public key must be compressed secp256k1 hex")
	}
	derived, err := nativeResourceAddress(publicKeyBytes)
	if err != nil || derived != auth.Signer {
		return errors.New("resource authorization signer does not match public key")
	}
	publicKey, err := secp256k1.ParsePubKey(publicKeyBytes)
	if err != nil {
		return fmt.Errorf("parse resource authorization public key: %w", err)
	}
	signatureBytes, err := hex.DecodeString(auth.Signature)
	if err != nil || len(signatureBytes) == 0 {
		return errors.New("resource authorization signature must be DER hex")
	}
	signature, err := ecdsa.ParseDERSignature(signatureBytes)
	if err != nil {
		return errors.New("resource authorization signature is invalid or non-canonical")
	}
	sValue := signature.S()
	if sValue.IsOverHalfOrder() {
		return errors.New("resource authorization signature is invalid or non-canonical")
	}
	digest, err := resourceAuthorizationDigest(auth)
	if err != nil || !signature.Verify(digest, publicKey) {
		return errors.New("resource authorization signature verification failed")
	}
	return nil
}

func resourceAuthorizationDigest(auth ResourceAuthorization) ([]byte, error) {
	payload, err := json.Marshal(resourceAuthorizationSignDoc{Domain: "YNX_RESOURCE_AUTHORIZATION_V1", Version: auth.Version, ChainID: auth.ChainID, Action: auth.Action, Signer: auth.Signer, Nonce: auth.Nonce, PayloadHash: auth.PayloadHash, PublicKey: auth.PublicKey})
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(payload)
	return digest[:], nil
}

func nativeResourceAddress(publicKey []byte) (string, error) {
	parsed, err := secp256k1.ParsePubKey(publicKey)
	if err != nil {
		return "", err
	}
	hasher := sha3.NewLegacyKeccak256()
	_, _ = hasher.Write(parsed.SerializeUncompressed()[1:])
	sum := hasher.Sum(nil)
	return accountaddress.FromBytes(sum[len(sum)-accountaddress.PayloadLength:])
}

func (d *Devnet) CreateResourcePool(input ResourcePoolCreateInput) (ResourcePool, Transaction, error) {
	normalized, err := normalizeResourcePoolCreate(input)
	if err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	auth := normalized.Authorization
	normalized.Authorization = ResourceAuthorization{}
	if err := verifyResourceAuthorization(auth, d.cfg.ChainID, ResourcePoolCreateAction, normalized); err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	requestHash := resourceSponsorRequestHash(ResourcePoolCreateAction, normalized)

	d.mu.Lock()
	defer d.mu.Unlock()
	if pool, tx, replay, err := d.resourcePoolReplayLocked(auth.Signer, normalized.IdempotencyKey, ResourcePoolCreateAction, requestHash); replay || err != nil {
		return pool, tx, err
	}
	owner, ok := d.accounts[auth.Signer]
	if !ok {
		return ResourcePool{}, Transaction{}, errors.New("resource pool owner account does not exist")
	}
	if err := requireNextResourceNonce(owner, auth.Nonce); err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	if err := canReserveResourceUnits(resourceBalance(owner, d.resourcePolicy), normalized.CumulativeAllowance); err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	rollback, err := cloneDevnetSnapshot(d.snapshotLocked())
	if err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	now := time.Now().UTC()
	pool := ResourcePool{ID: "rsp_" + requestHash[:24], PoolType: normalized.PoolType, Name: normalized.Name, Owner: auth.Signer, Public: normalized.Public, AllowedBeneficiaries: normalized.AllowedBeneficiaries, AllowedScopes: normalized.AllowedScopes, AllowedResourceTypes: normalized.AllowedResourceTypes, PerActionLimit: normalized.PerActionLimit, CumulativeAllowance: normalized.CumulativeAllowance, ExpiresAt: normalized.ExpiresAt, Status: "active", CreatedAt: now, UpdatedAt: now}
	pool.PolicyHash = resourcePoolPolicyHash(pool)
	addResourceUsage(&owner.ResourceUsage, normalized.CumulativeAllowance)
	owner.Nonce++
	tx := d.newTxLocked("resource_pool_create", owner.Address, "", 0, 0, nil, "authorized resource pool reservation")
	tx.Sponsor, tx.SponsorPoolID, tx.ResourceSource = owner.Address, pool.ID, pool.PoolType+"-resource-pool"
	d.pending = append(d.pending, tx)
	d.resourcePools[pool.ID] = pool
	d.recordResourceSponsorIdempotencyLocked(auth.Signer, normalized.IdempotencyKey, ResourcePoolCreateAction, requestHash, "pool", pool.ID, tx.Hash, &pool)
	d.appendResourceSponsorAuditLocked(ResourcePoolCreateAction, auth.Signer, pool.ID, pool.ID, requestHash, now)
	if err := d.commitResourceSponsorMutationLocked(rollback); err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	return pool, tx, nil
}

func (d *Devnet) FundResourcePool(input ResourcePoolFundInput) (ResourcePool, Transaction, error) {
	input.PoolID, input.IdempotencyKey = strings.TrimSpace(input.PoolID), strings.TrimSpace(input.IdempotencyKey)
	input.ExpectedPolicyHash = strings.ToLower(strings.TrimSpace(input.ExpectedPolicyHash))
	if input.PoolID == "" || !validResourceUnits(input.Additional, true) || !validResourceHash(input.ExpectedPolicyHash) || !validResourceIdempotency(input.IdempotencyKey) {
		return ResourcePool{}, Transaction{}, errors.New("resource pool funding requires poolId, positive bounded units, expected policy hash, and idempotencyKey")
	}
	auth := input.Authorization
	input.Authorization = ResourceAuthorization{}
	if err := verifyResourceAuthorization(auth, d.cfg.ChainID, ResourcePoolFundAction, input); err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	requestHash := resourceSponsorRequestHash(ResourcePoolFundAction, input)
	d.mu.Lock()
	defer d.mu.Unlock()
	if pool, tx, replay, err := d.resourcePoolReplayLocked(auth.Signer, input.IdempotencyKey, ResourcePoolFundAction, requestHash); replay || err != nil {
		return pool, tx, err
	}
	pool, ok := d.resourcePools[input.PoolID]
	if !ok || pool.Owner != auth.Signer || pool.Status == "revoked" || pool.PolicyHash != input.ExpectedPolicyHash {
		return ResourcePool{}, Transaction{}, errors.New("resource pool is missing, revoked, not owned by signer, or policy hash is stale")
	}
	owner := d.accounts[pool.Owner]
	if owner == nil {
		return ResourcePool{}, Transaction{}, errors.New("resource pool owner account does not exist")
	}
	if err := requireNextResourceNonce(owner, auth.Nonce); err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	if err := canReserveResourceUnits(resourceBalance(owner, d.resourcePolicy), input.Additional); err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	next, err := addResourceUnits(pool.CumulativeAllowance, input.Additional)
	if err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	rollback, err := cloneDevnetSnapshot(d.snapshotLocked())
	if err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	now := time.Now().UTC()
	pool.CumulativeAllowance, pool.UpdatedAt = next, now
	pool.PolicyHash = resourcePoolPolicyHash(pool)
	addResourceUsage(&owner.ResourceUsage, input.Additional)
	owner.Nonce++
	tx := d.newTxLocked("resource_pool_fund", owner.Address, "", 0, 0, nil, "authorized resource pool funding")
	tx.Sponsor, tx.SponsorPoolID, tx.ResourceSource = owner.Address, pool.ID, pool.PoolType+"-resource-pool"
	d.pending = append(d.pending, tx)
	d.resourcePools[pool.ID] = pool
	d.recordResourceSponsorIdempotencyLocked(auth.Signer, input.IdempotencyKey, ResourcePoolFundAction, requestHash, "pool", pool.ID, tx.Hash, &pool)
	d.appendResourceSponsorAuditLocked(ResourcePoolFundAction, auth.Signer, pool.ID, pool.ID, requestHash, now)
	if err := d.commitResourceSponsorMutationLocked(rollback); err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	return pool, tx, nil
}

func (d *Devnet) UpdateResourcePoolPolicy(input ResourcePoolPolicyInput) (ResourcePool, Transaction, error) {
	normalized, err := normalizeResourcePoolPolicy(input)
	if err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	auth := normalized.Authorization
	normalized.Authorization = ResourceAuthorization{}
	if err := verifyResourceAuthorization(auth, d.cfg.ChainID, ResourcePoolPolicyAction, normalized); err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	requestHash := resourceSponsorRequestHash(ResourcePoolPolicyAction, normalized)
	d.mu.Lock()
	defer d.mu.Unlock()
	if pool, tx, replay, err := d.resourcePoolReplayLocked(auth.Signer, normalized.IdempotencyKey, ResourcePoolPolicyAction, requestHash); replay || err != nil {
		return pool, tx, err
	}
	pool, ok := d.resourcePools[normalized.PoolID]
	if !ok || pool.Owner != auth.Signer || pool.Status == "revoked" || pool.PolicyHash != normalized.ExpectedPolicyHash {
		return ResourcePool{}, Transaction{}, errors.New("resource pool is missing, revoked, not owned by signer, or policy hash is stale")
	}
	if !unitsWithin(normalized.PerActionLimit, pool.CumulativeAllowance) {
		return ResourcePool{}, Transaction{}, errors.New("resource pool per-action limits exceed funded allowance")
	}
	if !consumedTypesAllowed(pool.Consumed, normalized.AllowedResourceTypes) {
		return ResourcePool{}, Transaction{}, errors.New("resource pool policy cannot remove a resource type already consumed")
	}
	owner := d.accounts[pool.Owner]
	if owner == nil {
		return ResourcePool{}, Transaction{}, errors.New("resource pool owner account does not exist")
	}
	if err := requireNextResourceNonce(owner, auth.Nonce); err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	rollback, err := cloneDevnetSnapshot(d.snapshotLocked())
	if err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	now := time.Now().UTC()
	pool.Public, pool.AllowedBeneficiaries = normalized.Public, normalized.AllowedBeneficiaries
	pool.AllowedScopes, pool.AllowedResourceTypes = normalized.AllowedScopes, normalized.AllowedResourceTypes
	pool.PerActionLimit, pool.ExpiresAt, pool.UpdatedAt = normalized.PerActionLimit, normalized.ExpiresAt, now
	pool.PolicyHash = resourcePoolPolicyHash(pool)
	owner.Nonce++
	tx := d.newTxLocked("resource_pool_policy", owner.Address, "", 0, 0, nil, "authorized resource pool policy update")
	tx.Sponsor, tx.SponsorPoolID, tx.ResourceSource = owner.Address, pool.ID, pool.PoolType+"-resource-pool"
	d.pending = append(d.pending, tx)
	d.resourcePools[pool.ID] = pool
	d.recordResourceSponsorIdempotencyLocked(auth.Signer, normalized.IdempotencyKey, ResourcePoolPolicyAction, requestHash, "pool", pool.ID, tx.Hash, &pool)
	d.appendResourceSponsorAuditLocked(ResourcePoolPolicyAction, auth.Signer, pool.ID, pool.ID, requestHash, now)
	if err := d.commitResourceSponsorMutationLocked(rollback); err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	return pool, tx, nil
}

func (d *Devnet) UpdateResourcePoolStatus(input ResourcePoolStatusInput) (ResourcePool, Transaction, error) {
	input.PoolID, input.Status = strings.TrimSpace(input.PoolID), strings.ToLower(strings.TrimSpace(input.Status))
	input.ExpectedPolicyHash, input.IdempotencyKey = strings.ToLower(strings.TrimSpace(input.ExpectedPolicyHash)), strings.TrimSpace(input.IdempotencyKey)
	if input.PoolID == "" || (input.Status != "active" && input.Status != "paused" && input.Status != "revoked") || !validResourceHash(input.ExpectedPolicyHash) || !validResourceIdempotency(input.IdempotencyKey) {
		return ResourcePool{}, Transaction{}, errors.New("resource pool status requires poolId, active/paused/revoked status, policy hash, and idempotencyKey")
	}
	auth := input.Authorization
	input.Authorization = ResourceAuthorization{}
	if err := verifyResourceAuthorization(auth, d.cfg.ChainID, ResourcePoolStatusAction, input); err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	requestHash := resourceSponsorRequestHash(ResourcePoolStatusAction, input)
	d.mu.Lock()
	defer d.mu.Unlock()
	if pool, tx, replay, err := d.resourcePoolReplayLocked(auth.Signer, input.IdempotencyKey, ResourcePoolStatusAction, requestHash); replay || err != nil {
		return pool, tx, err
	}
	pool, ok := d.resourcePools[input.PoolID]
	if !ok || pool.Owner != auth.Signer || pool.Status == "revoked" || pool.PolicyHash != input.ExpectedPolicyHash || pool.Status == input.Status {
		return ResourcePool{}, Transaction{}, errors.New("resource pool status transition is stale, unauthorized, missing, revoked, or unchanged")
	}
	owner := d.accounts[pool.Owner]
	if owner == nil {
		return ResourcePool{}, Transaction{}, errors.New("resource pool owner account does not exist")
	}
	if err := requireNextResourceNonce(owner, auth.Nonce); err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	rollback, err := cloneDevnetSnapshot(d.snapshotLocked())
	if err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	now := time.Now().UTC()
	if input.Status == "revoked" {
		remaining, _ := subtractResourceUnits(pool.CumulativeAllowance, pool.Consumed)
		subtractResourceUsage(&owner.ResourceUsage, remaining)
	}
	pool.Status, pool.UpdatedAt = input.Status, now
	owner.Nonce++
	tx := d.newTxLocked("resource_pool_status", owner.Address, "", 0, 0, nil, "authorized resource pool "+input.Status)
	tx.Sponsor, tx.SponsorPoolID, tx.ResourceSource = owner.Address, pool.ID, pool.PoolType+"-resource-pool"
	d.pending = append(d.pending, tx)
	d.resourcePools[pool.ID] = pool
	d.recordResourceSponsorIdempotencyLocked(auth.Signer, input.IdempotencyKey, ResourcePoolStatusAction, requestHash, "pool", pool.ID, tx.Hash, &pool)
	d.appendResourceSponsorAuditLocked(ResourcePoolStatusAction+":"+input.Status, auth.Signer, pool.ID, pool.ID, requestHash, now)
	if err := d.commitResourceSponsorMutationLocked(rollback); err != nil {
		return ResourcePool{}, Transaction{}, err
	}
	return pool, tx, nil
}

func (d *Devnet) SponsorResource(input ResourceSponsorshipInput) (ResourceSponsorship, Transaction, error) {
	normalized, err := normalizeResourceSponsorship(input)
	if err != nil {
		return ResourceSponsorship{}, Transaction{}, err
	}
	auth := normalized.Authorization
	normalized.Authorization = ResourceAuthorization{}
	if err := verifyResourceAuthorization(auth, d.cfg.ChainID, ResourceSponsorAction, normalized); err != nil {
		return ResourceSponsorship{}, Transaction{}, err
	}
	if auth.Signer != normalized.Beneficiary {
		return ResourceSponsorship{}, Transaction{}, errors.New("resource sponsorship beneficiary must sign its own action")
	}
	requestHash := resourceSponsorRequestHash(ResourceSponsorAction, normalized)
	d.mu.Lock()
	defer d.mu.Unlock()
	if sponsorship, tx, replay, err := d.resourceSponsorshipReplayLocked(auth.Signer, normalized.IdempotencyKey, requestHash); replay || err != nil {
		return sponsorship, tx, err
	}
	if _, exists := d.resourceActionRefs[normalized.ActionReference]; exists {
		return ResourceSponsorship{}, Transaction{}, errors.New("resource sponsorship actionReference is already consumed")
	}
	beneficiary := d.accounts[auth.Signer]
	if beneficiary == nil {
		return ResourceSponsorship{}, Transaction{}, errors.New("resource sponsorship beneficiary account does not exist")
	}
	if err := requireNextResourceNonce(beneficiary, auth.Nonce); err != nil {
		return ResourceSponsorship{}, Transaction{}, err
	}
	pool, err := d.selectResourcePoolLocked(normalized, time.Now().UTC())
	if err != nil {
		return ResourceSponsorship{}, Transaction{}, err
	}
	rollback, err := cloneDevnetSnapshot(d.snapshotLocked())
	if err != nil {
		return ResourceSponsorship{}, Transaction{}, err
	}
	now := time.Now().UTC()
	pool.Consumed, err = consumeResourceType(pool.Consumed, normalized.ResourceType, normalized.Amount)
	if err != nil {
		d.applySnapshotLocked(rollback)
		return ResourceSponsorship{}, Transaction{}, err
	}
	pool.UpdatedAt = now
	beneficiary.Nonce++
	tx := d.newTxLocked("resource_sponsored_action", beneficiary.Address, "", 0, 0, nil, "signed resource-only sponsored action")
	tx.Sponsor, tx.SponsorPoolID, tx.ResourceSource = pool.Owner, pool.ID, pool.PoolType+"-resource-pool"
	tx.ResourceType, tx.ResourceConsumed, tx.ActionReference = normalized.ResourceType, normalized.Amount, normalized.ActionReference
	sponsorship := ResourceSponsorship{ID: "rss_" + requestHash[:24], PoolID: pool.ID, PoolType: pool.PoolType, Payer: beneficiary.Address, Sponsor: pool.Owner, Beneficiary: beneficiary.Address, Scope: normalized.Scope, ResourceType: normalized.ResourceType, ResourceSource: tx.ResourceSource, Amount: normalized.Amount, PolicyHash: pool.PolicyHash, ActionReference: normalized.ActionReference, IdempotencyKey: normalized.IdempotencyKey, TransactionHash: tx.Hash, CreatedAt: now}
	d.pending = append(d.pending, tx)
	d.resourcePools[pool.ID], d.resourceSponsorships[sponsorship.ID] = pool, sponsorship
	d.resourceActionRefs[normalized.ActionReference] = sponsorship.ID
	d.recordResourceSponsorIdempotencyLocked(auth.Signer, normalized.IdempotencyKey, ResourceSponsorAction, requestHash, "sponsorship", sponsorship.ID, tx.Hash, nil)
	d.appendResourceSponsorAuditLocked(ResourceSponsorAction, auth.Signer, pool.ID, sponsorship.ID, requestHash, now)
	if err := d.commitResourceSponsorMutationLocked(rollback); err != nil {
		return ResourceSponsorship{}, Transaction{}, err
	}
	return sponsorship, tx, nil
}

func (d *Devnet) ResourcePool(id string) (ResourcePool, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	pool, ok := d.resourcePools[strings.TrimSpace(id)]
	return cloneResourcePool(pool), ok
}

func (d *Devnet) ResourcePools(owner, poolType, status string) []ResourcePool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	values := make([]ResourcePool, 0, len(d.resourcePools))
	for _, pool := range d.resourcePools {
		if owner != "" && pool.Owner != owner || poolType != "" && pool.PoolType != poolType || status != "" && pool.Status != status {
			continue
		}
		values = append(values, cloneResourcePool(pool))
	}
	sort.Slice(values, func(i, j int) bool { return values[i].ID < values[j].ID })
	return values
}

func (d *Devnet) ResourceSponsorship(id string) (ResourceSponsorship, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	value, ok := d.resourceSponsorships[strings.TrimSpace(id)]
	return value, ok
}

func (d *Devnet) ResourceSponsorships(poolID, beneficiary string) []ResourceSponsorship {
	d.mu.RLock()
	defer d.mu.RUnlock()
	values := make([]ResourceSponsorship, 0, len(d.resourceSponsorships))
	for _, value := range d.resourceSponsorships {
		if poolID != "" && value.PoolID != poolID || beneficiary != "" && value.Beneficiary != beneficiary {
			continue
		}
		values = append(values, value)
	}
	sort.Slice(values, func(i, j int) bool { return values[i].ID < values[j].ID })
	return values
}

func (d *Devnet) ResourceSponsorAudit() []ResourceSponsorAuditEvent {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return append([]ResourceSponsorAuditEvent(nil), d.resourceSponsorAudit...)
}

func (d *Devnet) selectResourcePoolLocked(input ResourceSponsorshipInput, now time.Time) (ResourcePool, error) {
	ids := make([]string, 0, len(d.resourcePools))
	if input.PoolID != "" {
		ids = append(ids, input.PoolID)
	} else {
		for id := range d.resourcePools {
			ids = append(ids, id)
		}
		sort.Strings(ids)
	}
	var lastErr error
	for _, id := range ids {
		pool, ok := d.resourcePools[id]
		if !ok {
			lastErr = errors.New("resource sponsor pool not found")
			continue
		}
		if err := validateResourcePoolConsumption(pool, input, now); err != nil {
			lastErr = err
			continue
		}
		return pool, nil
	}
	if lastErr == nil {
		lastErr = errors.New("no eligible resource sponsor pool")
	}
	return ResourcePool{}, lastErr
}

func validateResourcePoolConsumption(pool ResourcePool, input ResourceSponsorshipInput, now time.Time) error {
	if pool.Status != "active" || !now.Before(pool.ExpiresAt) {
		return errors.New("resource sponsor pool is paused, revoked, or expired")
	}
	if !pool.Public && !containsStringValue(pool.AllowedBeneficiaries, input.Beneficiary) {
		return errors.New("resource sponsor beneficiary is not allowed")
	}
	if !containsStringValue(pool.AllowedScopes, input.Scope) || !containsStringValue(pool.AllowedResourceTypes, input.ResourceType) {
		return errors.New("resource sponsor scope or resource type is not allowed")
	}
	if input.Amount > resourceTypeAmount(pool.PerActionLimit, input.ResourceType) {
		return errors.New("resource sponsor amount exceeds per-action limit")
	}
	remaining, err := subtractResourceUnits(pool.CumulativeAllowance, pool.Consumed)
	if err != nil || input.Amount > resourceTypeAmount(remaining, input.ResourceType) {
		return errors.New("resource sponsor cumulative allowance is exhausted")
	}
	return nil
}

func normalizeResourcePoolCreate(input ResourcePoolCreateInput) (ResourcePoolCreateInput, error) {
	input.PoolType, input.Name = strings.ToLower(strings.TrimSpace(input.PoolType)), strings.TrimSpace(input.Name)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.ExpiresAt = input.ExpiresAt.UTC()
	var err error
	input.AllowedBeneficiaries, err = normalizeResourceBeneficiaries(input.AllowedBeneficiaries)
	if err != nil {
		return input, err
	}
	input.AllowedScopes, err = normalizeResourceStringSet(input.AllowedScopes, resourceScopes, "scope")
	if err != nil {
		return input, err
	}
	input.AllowedResourceTypes, err = normalizeResourceStringSet(input.AllowedResourceTypes, resourceTypes, "resource type")
	if err != nil {
		return input, err
	}
	if input.PoolType != "merchant" && input.PoolType != "dapp" || input.Name == "" || len(input.Name) > 100 {
		return input, errors.New("resource pool requires merchant/dapp type and bounded name")
	}
	if !input.Public && len(input.AllowedBeneficiaries) == 0 {
		return input, errors.New("non-public resource pool requires allowed beneficiaries")
	}
	if input.Public && len(input.AllowedBeneficiaries) != 0 {
		return input, errors.New("public resource pool must not carry a hidden beneficiary allowlist")
	}
	if !validResourceUnits(input.CumulativeAllowance, true) || !validResourceUnits(input.PerActionLimit, true) || !unitsWithin(input.PerActionLimit, input.CumulativeAllowance) {
		return input, errors.New("resource pool requires positive bounded allowance and per-action limits within allowance")
	}
	if !limitsMatchResourceTypes(input.PerActionLimit, input.AllowedResourceTypes) || !allowanceMatchesResourceTypes(input.CumulativeAllowance, input.AllowedResourceTypes) {
		return input, errors.New("resource pool limits and allowance must match allowed resource types")
	}
	if !input.ExpiresAt.After(time.Now().UTC()) || !validResourceIdempotency(input.IdempotencyKey) {
		return input, errors.New("resource pool requires future expiry and bounded idempotencyKey")
	}
	return input, nil
}

func normalizeResourcePoolPolicy(input ResourcePoolPolicyInput) (ResourcePoolPolicyInput, error) {
	input.PoolID, input.ExpectedPolicyHash, input.IdempotencyKey = strings.TrimSpace(input.PoolID), strings.ToLower(strings.TrimSpace(input.ExpectedPolicyHash)), strings.TrimSpace(input.IdempotencyKey)
	input.ExpiresAt = input.ExpiresAt.UTC()
	var err error
	input.AllowedBeneficiaries, err = normalizeResourceBeneficiaries(input.AllowedBeneficiaries)
	if err != nil {
		return input, err
	}
	input.AllowedScopes, err = normalizeResourceStringSet(input.AllowedScopes, resourceScopes, "scope")
	if err != nil {
		return input, err
	}
	input.AllowedResourceTypes, err = normalizeResourceStringSet(input.AllowedResourceTypes, resourceTypes, "resource type")
	if err != nil {
		return input, err
	}
	if input.PoolID == "" || !validResourceHash(input.ExpectedPolicyHash) || !validResourceIdempotency(input.IdempotencyKey) || !input.ExpiresAt.After(time.Now().UTC()) {
		return input, errors.New("resource pool policy requires poolId, expected policy hash, idempotencyKey, and future expiry")
	}
	if !input.Public && len(input.AllowedBeneficiaries) == 0 || input.Public && len(input.AllowedBeneficiaries) != 0 {
		return input, errors.New("resource pool public/beneficiary policy is inconsistent")
	}
	if !validResourceUnits(input.PerActionLimit, true) || !limitsMatchResourceTypes(input.PerActionLimit, input.AllowedResourceTypes) {
		return input, errors.New("resource pool policy requires positive per-action limits matching resource types")
	}
	return input, nil
}

func normalizeResourceSponsorship(input ResourceSponsorshipInput) (ResourceSponsorshipInput, error) {
	input.PoolID, input.Scope = strings.TrimSpace(input.PoolID), strings.ToLower(strings.TrimSpace(input.Scope))
	input.ResourceType, input.ActionReference, input.IdempotencyKey = strings.ToLower(strings.TrimSpace(input.ResourceType)), strings.TrimSpace(input.ActionReference), strings.TrimSpace(input.IdempotencyKey)
	beneficiary, err := accountaddress.Normalize(input.Beneficiary)
	if err != nil {
		return input, errors.New("resource sponsorship beneficiary must be a canonical or ynx1 account")
	}
	input.Beneficiary = beneficiary
	if _, ok := resourceScopes[input.Scope]; !ok {
		return input, errors.New("resource sponsorship scope is unsupported")
	}
	if _, ok := resourceTypes[input.ResourceType]; !ok || input.Amount <= 0 || input.Amount > math.MaxInt32 {
		return input, errors.New("resource sponsorship type or amount is invalid")
	}
	if len(input.ActionReference) < 3 || len(input.ActionReference) > 160 || !validResourceIdempotency(input.IdempotencyKey) {
		return input, errors.New("resource sponsorship requires bounded actionReference and idempotencyKey")
	}
	return input, nil
}

func normalizeResourceBeneficiaries(values []string) ([]string, error) {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		normalized, err := accountaddress.Normalize(value)
		if err != nil {
			return nil, errors.New("resource pool beneficiary must be a canonical or ynx1 account")
		}
		if _, ok := seen[normalized]; !ok {
			seen[normalized], out = struct{}{}, append(out, normalized)
		}
	}
	sort.Strings(out)
	if len(out) > 256 {
		return nil, errors.New("resource pool beneficiary list exceeds 256")
	}
	return out, nil
}

func normalizeResourceStringSet(values []string, allowed map[string]struct{}, label string) ([]string, error) {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if _, ok := allowed[value]; !ok {
			return nil, fmt.Errorf("unsupported resource pool %s %q", label, value)
		}
		if _, ok := seen[value]; !ok {
			seen[value], out = struct{}{}, append(out, value)
		}
	}
	sort.Strings(out)
	if len(out) == 0 {
		return nil, fmt.Errorf("resource pool requires at least one %s", label)
	}
	return out, nil
}

func resourcePoolPolicyHash(pool ResourcePool) string {
	doc := struct {
		PoolType             string        `json:"poolType"`
		Owner                string        `json:"owner"`
		Public               bool          `json:"public"`
		AllowedBeneficiaries []string      `json:"allowedBeneficiaries,omitempty"`
		AllowedScopes        []string      `json:"allowedScopes"`
		AllowedResourceTypes []string      `json:"allowedResourceTypes"`
		PerActionLimit       ResourceUnits `json:"perActionLimit"`
		CumulativeAllowance  ResourceUnits `json:"cumulativeAllowance"`
		ExpiresAt            time.Time     `json:"expiresAt"`
	}{pool.PoolType, pool.Owner, pool.Public, pool.AllowedBeneficiaries, pool.AllowedScopes, pool.AllowedResourceTypes, pool.PerActionLimit, pool.CumulativeAllowance, pool.ExpiresAt.UTC()}
	return resourceSponsorRequestHash("resource_pool_policy_v1", doc)
}

// ResourcePoolPolicyHash returns the canonical policy commitment shared by
// authoritative and CometBFT runtimes.
func ResourcePoolPolicyHash(pool ResourcePool) string { return resourcePoolPolicyHash(pool) }

func resourceSponsorRequestHash(action string, payload any) string {
	raw, _ := json.Marshal(struct {
		Domain  string `json:"domain"`
		Action  string `json:"action"`
		Payload any    `json:"payload"`
	}{"YNX_RESOURCE_SPONSOR_REQUEST_V1", action, payload})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func resourceSponsorIdempotencyID(signer, key string) string {
	return resourceSponsorRequestHash("resource_sponsor_idempotency", signer+"|"+key)[:32]
}

func (d *Devnet) resourcePoolReplayLocked(signer, key, action, requestHash string) (ResourcePool, Transaction, bool, error) {
	record, ok := d.resourceSponsorIdem[resourceSponsorIdempotencyID(signer, key)]
	if !ok {
		return ResourcePool{}, Transaction{}, false, nil
	}
	if record.Action != action || record.RequestHash != requestHash {
		return ResourcePool{}, Transaction{}, true, errors.New("resource sponsor idempotency key was reused with changed input")
	}
	pool, ok := d.resourcePools[record.ObjectID]
	if !ok {
		return ResourcePool{}, Transaction{}, true, errors.New("resource sponsor idempotency record references a missing pool")
	}
	if record.PoolSnapshot != nil {
		pool = *record.PoolSnapshot
	}
	tx, _ := d.transactionLocked(record.TransactionHash)
	return cloneResourcePool(pool), tx, true, nil
}

func (d *Devnet) resourceSponsorshipReplayLocked(signer, key, requestHash string) (ResourceSponsorship, Transaction, bool, error) {
	record, ok := d.resourceSponsorIdem[resourceSponsorIdempotencyID(signer, key)]
	if !ok {
		return ResourceSponsorship{}, Transaction{}, false, nil
	}
	if record.Action != ResourceSponsorAction || record.RequestHash != requestHash {
		return ResourceSponsorship{}, Transaction{}, true, errors.New("resource sponsor idempotency key was reused with changed input")
	}
	value, ok := d.resourceSponsorships[record.ObjectID]
	if !ok {
		return ResourceSponsorship{}, Transaction{}, true, errors.New("resource sponsor idempotency record references a missing sponsorship")
	}
	tx, _ := d.transactionLocked(record.TransactionHash)
	return value, tx, true, nil
}

func (d *Devnet) transactionLocked(hash string) (Transaction, bool) {
	for _, tx := range d.pending {
		if tx.Hash == hash {
			return tx, true
		}
	}
	for _, block := range d.blocks {
		for _, tx := range block.Transactions {
			if tx.Hash == hash {
				return tx, true
			}
		}
	}
	return Transaction{}, false
}

func (d *Devnet) recordResourceSponsorIdempotencyLocked(signer, key, action, requestHash, objectType, objectID, txHash string, poolSnapshot *ResourcePool) {
	id := resourceSponsorIdempotencyID(signer, key)
	record := ResourceSponsorIdempotency{ID: id, Signer: signer, Key: key, Action: action, RequestHash: requestHash, ObjectType: objectType, ObjectID: objectID, TransactionHash: txHash}
	if poolSnapshot != nil {
		cloned := cloneResourcePool(*poolSnapshot)
		record.PoolSnapshot = &cloned
	}
	d.resourceSponsorIdem[id] = record
}

func (d *Devnet) appendResourceSponsorAuditLocked(action, signer, poolID, objectID, requestHash string, now time.Time) {
	event := ResourceSponsorAuditEvent{ID: "rsa_" + resourceSponsorRequestHash(action, fmt.Sprintf("%d|%s|%s", len(d.resourceSponsorAudit)+1, objectID, requestHash))[:24], Sequence: uint64(len(d.resourceSponsorAudit) + 1), Action: action, Signer: signer, PoolID: poolID, ObjectID: objectID, RequestHash: requestHash, CreatedAt: now}
	if len(d.resourceSponsorAudit) > 0 {
		event.PreviousHash = d.resourceSponsorAudit[len(d.resourceSponsorAudit)-1].AuditHash
	}
	event.AuditHash = resourceSponsorAuditHash(event)
	d.resourceSponsorAudit = append(d.resourceSponsorAudit, event)
}

func resourceSponsorAuditHash(event ResourceSponsorAuditEvent) string {
	event.AuditHash = ""
	return resourceSponsorRequestHash("resource_sponsor_audit_v1", event)
}

func (d *Devnet) commitResourceSponsorMutationLocked(rollback devnetSnapshot) error {
	if err := d.persistSnapshotLocked(); err != nil {
		d.applySnapshotLocked(rollback)
		d.recordPersistenceErrorLocked(err)
		return err
	}
	d.recordPersistenceErrorLocked(nil)
	return nil
}

func cloneDevnetSnapshot(snapshot devnetSnapshot) (devnetSnapshot, error) {
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return devnetSnapshot{}, err
	}
	var clone devnetSnapshot
	if err := json.Unmarshal(payload, &clone); err != nil {
		return devnetSnapshot{}, err
	}
	return clone, nil
}

func resourceSponsorSnapshotIntegrity(snapshot devnetSnapshot) string {
	state := resourceSponsorIntegrityState{Pools: snapshot.Pools, Sponsors: snapshot.Sponsors, IDs: snapshot.SponsorIDs, ActionRefs: snapshot.ActionRefs, Audit: snapshot.SponsorLog}
	if state.Pools == nil {
		state.Pools = map[string]ResourcePool{}
	}
	if state.Sponsors == nil {
		state.Sponsors = map[string]ResourceSponsorship{}
	}
	if state.IDs == nil {
		state.IDs = map[string]ResourceSponsorIdempotency{}
	}
	if state.ActionRefs == nil {
		state.ActionRefs = map[string]string{}
	}
	if state.Audit == nil {
		state.Audit = []ResourceSponsorAuditEvent{}
	}
	return resourceSponsorRequestHash("resource_sponsor_snapshot_v1", state)
}

func validateResourceSponsorSnapshot(snapshot devnetSnapshot) error {
	legacyEmpty := len(snapshot.Pools) == 0 && len(snapshot.Sponsors) == 0 && len(snapshot.SponsorIDs) == 0 && len(snapshot.ActionRefs) == 0 && len(snapshot.SponsorLog) == 0 && snapshot.SponsorIntegrity == ""
	if legacyEmpty {
		return nil
	}
	if snapshot.SponsorIntegrity != resourceSponsorSnapshotIntegrity(snapshot) {
		return errors.New("resource sponsor snapshot integrity mismatch")
	}
	previous := ""
	for i, event := range snapshot.SponsorLog {
		if event.Sequence != uint64(i+1) || event.PreviousHash != previous || event.AuditHash != resourceSponsorAuditHash(event) {
			return errors.New("resource sponsor audit chain is invalid")
		}
		previous = event.AuditHash
	}
	for id, pool := range snapshot.Pools {
		if id != pool.ID || !accountaddress.IsCanonical(pool.Owner) || (pool.PoolType != "merchant" && pool.PoolType != "dapp") || (pool.Status != "active" && pool.Status != "paused" && pool.Status != "revoked") || pool.PolicyHash != resourcePoolPolicyHash(pool) || !validResourceUnits(pool.CumulativeAllowance, true) || !validResourceUnits(pool.Consumed, false) || !unitsWithin(pool.Consumed, pool.CumulativeAllowance) {
			return fmt.Errorf("resource sponsor pool %s is invalid", id)
		}
	}
	for id, value := range snapshot.Sponsors {
		pool, ok := snapshot.Pools[value.PoolID]
		if id != value.ID || !ok || value.Sponsor != pool.Owner || value.PolicyHash == "" || value.Amount <= 0 || snapshot.ActionRefs[value.ActionReference] != id {
			return fmt.Errorf("resource sponsorship %s is invalid", id)
		}
	}
	for id, record := range snapshot.SponsorIDs {
		if id != record.ID || id != resourceSponsorIdempotencyID(record.Signer, record.Key) || record.PoolSnapshot != nil && record.PoolSnapshot.ID != record.ObjectID {
			return fmt.Errorf("resource sponsor idempotency %s is invalid", id)
		}
	}
	return nil
}

func requireNextResourceNonce(account *Account, nonce uint64) error {
	if account.Nonce == math.MaxUint64 || nonce != account.Nonce+1 {
		return fmt.Errorf("resource authorization nonce %d must equal next account nonce %d", nonce, account.Nonce+1)
	}
	return nil
}

func canReserveResourceUnits(balance ResourceBalance, units ResourceUnits) error {
	if units.Bandwidth > balance.BandwidthLeft || units.Compute > balance.ComputeLeft || units.AICredits > balance.AICreditsLeft || units.TrustCredits > balance.TrustLeft {
		return errors.New("resource pool owner has insufficient unreserved resources")
	}
	return nil
}

func validResourceUnits(value ResourceUnits, requirePositive bool) bool {
	values := []int64{value.Bandwidth, value.Compute, value.AICredits, value.TrustCredits}
	positive := false
	for _, amount := range values {
		if amount < 0 || amount > math.MaxInt32 {
			return false
		}
		positive = positive || amount > 0
	}
	return !requirePositive || positive
}

func validResourceIdempotency(value string) bool {
	return len(value) >= 3 && len(value) <= 128 && strings.TrimSpace(value) == value && !strings.ContainsAny(value, "\r\n\t")
}

func validResourceHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil && value == strings.ToLower(value)
}

func addResourceUnits(a, b ResourceUnits) (ResourceUnits, error) {
	if a.Bandwidth > math.MaxInt64-b.Bandwidth || a.Compute > math.MaxInt64-b.Compute || a.AICredits > math.MaxInt64-b.AICredits || a.TrustCredits > math.MaxInt64-b.TrustCredits {
		return ResourceUnits{}, errors.New("resource units overflow")
	}
	return ResourceUnits{a.Bandwidth + b.Bandwidth, a.Compute + b.Compute, a.AICredits + b.AICredits, a.TrustCredits + b.TrustCredits}, nil
}

func subtractResourceUnits(a, b ResourceUnits) (ResourceUnits, error) {
	if !unitsWithin(b, a) {
		return ResourceUnits{}, errors.New("resource units underflow")
	}
	return ResourceUnits{a.Bandwidth - b.Bandwidth, a.Compute - b.Compute, a.AICredits - b.AICredits, a.TrustCredits - b.TrustCredits}, nil
}

func unitsWithin(value, limit ResourceUnits) bool {
	return value.Bandwidth <= limit.Bandwidth && value.Compute <= limit.Compute && value.AICredits <= limit.AICredits && value.TrustCredits <= limit.TrustCredits
}

func addResourceUsage(usage *ResourceUsage, units ResourceUnits) {
	usage.BandwidthUsed += units.Bandwidth
	usage.ComputeUsed += units.Compute
	usage.AICreditsUsed += units.AICredits
	usage.TrustUsed += units.TrustCredits
}

func subtractResourceUsage(usage *ResourceUsage, units ResourceUnits) {
	usage.BandwidthUsed = maxInt64(0, usage.BandwidthUsed-units.Bandwidth)
	usage.ComputeUsed = maxInt64(0, usage.ComputeUsed-units.Compute)
	usage.AICreditsUsed = maxInt64(0, usage.AICreditsUsed-units.AICredits)
	usage.TrustUsed = maxInt64(0, usage.TrustUsed-units.TrustCredits)
}

func resourceTypeAmount(units ResourceUnits, resourceType string) int64 {
	switch resourceType {
	case "bandwidth":
		return units.Bandwidth
	case "compute":
		return units.Compute
	case "ai_credits":
		return units.AICredits
	case "trust_credits":
		return units.TrustCredits
	default:
		return 0
	}
}

func consumeResourceType(units ResourceUnits, resourceType string, amount int64) (ResourceUnits, error) {
	addition := ResourceUnits{}
	switch resourceType {
	case "bandwidth":
		addition.Bandwidth = amount
	case "compute":
		addition.Compute = amount
	case "ai_credits":
		addition.AICredits = amount
	case "trust_credits":
		addition.TrustCredits = amount
	default:
		return ResourceUnits{}, errors.New("unsupported resource type")
	}
	return addResourceUnits(units, addition)
}

func limitsMatchResourceTypes(units ResourceUnits, types []string) bool {
	for resourceType := range resourceTypes {
		allowed := containsStringValue(types, resourceType)
		if allowed != (resourceTypeAmount(units, resourceType) > 0) {
			return false
		}
	}
	return true
}

func allowanceMatchesResourceTypes(units ResourceUnits, types []string) bool {
	for _, resourceType := range types {
		if resourceTypeAmount(units, resourceType) <= 0 {
			return false
		}
	}
	for resourceType := range resourceTypes {
		if !containsStringValue(types, resourceType) && resourceTypeAmount(units, resourceType) != 0 {
			return false
		}
	}
	return true
}

func consumedTypesAllowed(consumed ResourceUnits, types []string) bool {
	for resourceType := range resourceTypes {
		if resourceTypeAmount(consumed, resourceType) > 0 && !containsStringValue(types, resourceType) {
			return false
		}
	}
	return true
}

func cloneResourcePool(pool ResourcePool) ResourcePool {
	pool.AllowedBeneficiaries = append([]string(nil), pool.AllowedBeneficiaries...)
	pool.AllowedScopes = append([]string(nil), pool.AllowedScopes...)
	pool.AllowedResourceTypes = append([]string(nil), pool.AllowedResourceTypes...)
	return pool
}
