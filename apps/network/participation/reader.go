package participation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

type HTTPReader struct {
	governance, chain string
	network           Network
	client            *http.Client
}

func NewHTTPReader(governanceURL, chainURL string, network Network, client *http.Client) (*HTTPReader, error) {
	for _, s := range []string{governanceURL, chainURL} {
		u, e := url.Parse(s)
		if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.TrimRight(u.Path, "/") != "" {
			return nil, ErrInvalid
		}
		if u.Scheme != "https" {
			ip := net.ParseIP(u.Hostname())
			if u.Scheme != "http" || ip == nil || !ip.IsLoopback() {
				return nil, ErrInvalid
			}
		}
	}
	if !validNetwork(network) {
		return nil, ErrInvalid
	}
	c := http.Client{Timeout: 8 * time.Second}
	if client != nil {
		c = *client
	}
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if c.Timeout == 0 || c.Timeout > 8*time.Second {
		c.Timeout = 8 * time.Second
	}
	return &HTTPReader{strings.TrimRight(governanceURL, "/"), strings.TrimRight(chainURL, "/"), network, &c}, nil
}
func (r *HTTPReader) get(ctx context.Context, base, path string, out any) ([]byte, error) {
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, base+path, nil)
	if e != nil {
		return nil, e
	}
	res, e := r.client.Do(req)
	if e != nil {
		return nil, e
	}
	defer res.Body.Close()
	raw, e := io.ReadAll(io.LimitReader(res.Body, (4<<20)+1))
	if e != nil || len(raw) > 4<<20 {
		return nil, ErrInvalid
	}
	if res.StatusCode == 404 || res.StatusCode == 405 || res.StatusCode == 501 {
		return nil, ErrUnsupported
	}
	if res.StatusCode != 200 && res.StatusCode != 202 {
		return nil, fmt.Errorf("%w: source HTTP %d", ErrUnavailable, res.StatusCode)
	}
	if uniqueJSON(raw) != nil {
		return nil, ErrInvalid
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if e := d.Decode(out); e != nil {
		return nil, ErrInvalid
	}
	return raw, nil
}
func (r *HTTPReader) Current(ctx context.Context, req Request) (Conditions, error) {
	if e := validateRequest(req); e != nil {
		return Conditions{}, e
	}
	c := Conditions{Network: r.network, Owner: req.Owner, Action: req.Action, ObservedAt: timestamp()}
	if req.Action == Vote {
		envelope, e := r.ReadGovernanceProposal(ctx, req.Proposal)
		if e != nil {
			return c, e
		}
		var proposal governanceProposal
		if json.Unmarshal(envelope.Data, &proposal) != nil || proposal.ID != req.Proposal {
			return c, ErrInvalid
		}
		c.Source = envelope.Source
		c.Proposal = req.Proposal
		c.ProposalBinding = bind(envelope.Data)
		c.VotingEndsAt = proposal.VotingEndsAt
		c.ReportedVotingPower = proposal.VotingPower[req.Owner].String()
		if c.ReportedVotingPower == "" {
			c.ReportedVotingPower = "0"
		}
		if _, err := integer(c.ReportedVotingPower); err != nil {
			return c, ErrInvalid
		}
		if len(c.VotingEndsAt) > 40 {
			return c, ErrInvalid
		}
		if c.VotingEndsAt != "" {
			if _, err := time.Parse(time.RFC3339Nano, c.VotingEndsAt); err != nil {
				return c, ErrInvalid
			}
		}
		var params struct {
			Source  string          `json:"source"`
			Version string          `json:"version"`
			Data    json.RawMessage `json:"data"`
		}
		if _, e = r.get(ctx, r.governance, "/governance/parameters", &params); e != nil {
			return c, e
		}
		if params.Source != envelope.Source || params.Version != envelope.Version {
			return c, ErrInvalid
		}
		c.Reason = "Registry report only: no native PQ vote codec/executor, genesis-bound snapshotHeight or fee quote. Ed25519 registry vote is not used."
		return c, nil
	}
	if e := r.checkIdentity(ctx); e != nil {
		return c, e
	}
	auth, e := r.authorization(ctx, req.Owner)
	if e != nil {
		return c, e
	}
	c.Source = "comet-rpc"
	c.ObservedHeight = strconv.FormatInt(auth.CommittedHeight, 10)
	if !auth.PQSigningEnabled || auth.Policy == nil {
		c.Reason = "Original committed PQ authorization is not active"
		return c, nil
	}
	registration, ok := auth.Policy.PolicyAt(req.Owner, auth.ExecutionHeight)
	if !ok || auth.LedgerNonce == math.MaxUint64 {
		return c, ErrInvalid
	}
	c.PolicyRevision = strconv.FormatUint(registration.Revision, 10)
	c.NextNonce = strconv.FormatUint(auth.LedgerNonce+1, 10)
	var summary struct {
		SchemaVersion int         `json:"schemaVersion"`
		Source        string      `json:"source"`
		Failure       bool        `json:"failure"`
		PolicyVersion json.Number `json:"policyVersion"`
		Version       string      `json:"version"`
		Unbonding     json.Number `json:"unbondingSeconds"`
		Commission    json.Number `json:"commissionBps"`
		Validators    []struct {
			Address string `json:"address"`
			Active  bool   `json:"active"`
		} `json:"validators"`
	}
	if _, e := r.get(ctx, r.chain, "/staking/summary", &summary); e != nil {
		return c, e
	}
	if summary.SchemaVersion != 1 || summary.Failure || summary.Source != "ynx-consensus-abci" || summary.Version != strconv.Itoa(consensus.StakingPolicyVersion) || summary.PolicyVersion.String() != summary.Version || len(summary.Validators) > 1000 {
		return c, ErrInvalid
	}
	seconds, e := integer(summary.Unbonding.String())
	if e != nil || seconds == 0 {
		return c, ErrInvalid
	}
	commission, e := integer(summary.Commission.String())
	if e != nil || commission > 10000 {
		return c, ErrInvalid
	}
	c.UnbondingSeconds = summary.Unbonding.String()
	c.CommissionBPS = summary.Commission.String()
	c.FeeYNXT = strconv.FormatUint(ynxauth.StakingActionFee, 10)
	c.FeeSource = "compiled-original-ynxauth.StakingActionFee"
	if req.Action == Delegate {
		found := false
		for _, v := range summary.Validators {
			if v.Address == req.Validator && v.Active {
				found = true
			}
		}
		if !found {
			c.Reason = "Validator is not active in the original staking migration set"
			return c, nil
		}
		c.Validator = req.Validator
		c.ObjectVersion = "new-or-existing-target"
		c.NativeAvailable = true
		return c, nil
	}
	var envelope struct {
		Source     string                       `json:"source"`
		Failure    bool                         `json:"failure"`
		Version    int                          `json:"version"`
		Delegation consensus.BFTStakeDelegation `json:"delegation"`
	}
	if _, e := r.get(ctx, r.chain, "/staking/delegations/"+req.DelegationID, &envelope); e != nil {
		return c, e
	}
	v := envelope.Delegation
	if envelope.Failure || envelope.Source != "ynx-consensus-abci" || envelope.Version != consensus.StakingPolicyVersion || v.ID != req.DelegationID || v.Delegator != req.Owner || v.AmountYNXT < 0 || !reference(v.Validator) || !transactionHash(v.TxHash) {
		return c, ErrInvalid
	}
	c.Validator = v.Validator
	c.ObjectVersion = v.TxHash
	c.AvailableYNXT = strconv.FormatInt(v.AmountYNXT, 10)
	if v.AuthorizationHistory == "" {
		c.Reason = "Original delegation authorization history is opaque; native PQ mutation is unavailable"
		return c, nil
	}
	amount, _ := integer(req.AmountYNXT)
	if v.Status != "active" || amount > uint64(v.AmountYNXT) {
		c.Reason = "Unbond amount exceeds original signer-owned active delegation"
		return c, nil
	}
	c.NativeAvailable = true
	return c, nil
}

type governanceProposal struct {
	ID           string                 `json:"id"`
	Status       string                 `json:"status"`
	VotingEndsAt string                 `json:"votingEndsAt"`
	VotingPower  map[string]json.Number `json:"votingPower"`
}

func (r *HTTPReader) checkIdentity(ctx context.Context) error {
	var v struct {
		Version  string                         `json:"version"`
		Source   string                         `json:"source"`
		Identity consensus.PQWalletIdentityView `json:"identity"`
	}
	if _, e := r.get(ctx, r.chain, "/node/pq-identity", &v); e != nil {
		return e
	}
	iv := v.Identity
	if v.Version != "ynx-pq-rpc-identity-v1" || v.Source != "configured-comet-rpc" || consensus.ValidatePQWalletIdentityView(iv, iv.CurrentStateHeight) != nil || iv.NativeGenesisHash != r.network.Genesis || strconv.FormatInt(iv.NativeChainID, 10) != r.network.NativeChainID || iv.CometChainID != r.network.CometChainID {
		return ErrInvalid
	}
	return nil
}
func (r *HTTPReader) authorization(ctx context.Context, owner string) (consensus.PQWalletAccountView, error) {
	var v consensus.PQWalletAccountView
	if _, e := r.get(ctx, r.chain, "/accounts/"+owner+"/authorization", &v); e != nil {
		return v, e
	}
	if consensus.ValidatePQWalletAccountView(v, owner) != nil || v.NetworkID != r.network.NetworkID32 || strconv.FormatInt(v.NativeChainID, 10) != r.network.NativeChainID {
		return v, ErrInvalid
	}
	return v, nil
}

// RegistryReport preserves the original complete public document and numbers;
// it is a read report, never a new signing payload or native voting authority.
type RegistryReport struct {
	Source  string          `json:"source"`
	Version string          `json:"version"`
	Data    json.RawMessage `json:"data"`
	AsOf    string          `json:"asOf"`
}

func (r *HTTPReader) ReadGovernanceProposal(ctx context.Context, id string) (RegistryReport, error) {
	if !reference(id) {
		return RegistryReport{}, ErrInvalid
	}
	var v RegistryReport
	if _, e := r.get(ctx, r.governance, "/governance/proposals/"+url.PathEscape(id), &v); e != nil {
		return v, e
	}
	if v.Source != "ynx-governance-authoritative-state" || v.Version != "ynx-governance-api/v1" || len(v.Data) == 0 {
		return v, ErrInvalid
	}
	var p governanceProposal
	if json.Unmarshal(v.Data, &p) != nil || p.ID != id {
		return v, ErrInvalid
	}
	return v, nil
}
func (r *HTTPReader) ReadGovernanceParameters(ctx context.Context) (RegistryReport, error) {
	var v RegistryReport
	if _, e := r.get(ctx, r.governance, "/governance/parameters", &v); e != nil {
		return v, e
	}
	if v.Source != "ynx-governance-authoritative-state" || v.Version != "ynx-governance-api/v1" || len(v.Data) == 0 {
		return v, ErrInvalid
	}
	return v, nil
}

func (r *HTTPReader) ReadUnbonding(ctx context.Context, id, owner string) (UnbondingCondition, error) {
	if !recordID(id) || !accountaddress.IsCanonical(owner) {
		return UnbondingCondition{}, ErrInvalid
	}
	if err := r.checkIdentity(ctx); err != nil {
		return UnbondingCondition{}, err
	}
	auth, err := r.authorization(ctx, owner)
	if err != nil {
		return UnbondingCondition{}, err
	}
	var e struct {
		Source  string                      `json:"source"`
		Failure bool                        `json:"failure"`
		Version int                         `json:"version"`
		Entry   consensus.BFTUnbondingEntry `json:"unbonding"`
	}
	if _, err := r.get(ctx, r.chain, "/staking/unbondings/"+id, &e); err != nil {
		return UnbondingCondition{}, err
	}
	v := e.Entry
	if e.Failure || e.Source != "ynx-consensus-abci" || e.Version != consensus.StakingPolicyVersion || v.ID != id || v.Delegator != owner || v.AmountYNXT < 0 || v.AvailableAt.IsZero() {
		return UnbondingCondition{}, ErrInvalid
	}
	var status struct {
		Time time.Time `json:"latestBlockTime"`
	}
	if _, err := r.get(ctx, r.chain, "/status", &status); err != nil {
		return UnbondingCondition{}, err
	}
	if status.Time.IsZero() {
		return UnbondingCondition{}, ErrInvalid
	}
	return UnbondingCondition{v.ID, v.Delegator, v.Validator, strconv.FormatInt(v.AmountYNXT, 10), v.Status, v.AvailableAt.UTC().Format(time.RFC3339Nano), status.Time.UTC().Format(time.RFC3339Nano), v.Status == "queued" && !status.Time.Before(v.AvailableAt) && auth.PQSigningEnabled, "configured-rpc; no independent funds-state proof"}, nil
}
func (r *HTTPReader) ReadResult(ctx context.Context, intent Intent, hash string) (Observation, error) {
	if !transactionHash(hash) {
		return Observation{}, ErrInvalid
	}
	var v struct {
		Type      string          `json:"type"`
		Status    string          `json:"status"`
		Committed bool            `json:"committed"`
		Source    string          `json:"source"`
		Hash      string          `json:"nativeTransactionHash"`
		ABCI      string          `json:"abciTransactionHash"`
		Wire      []byte          `json:"wire"`
		Height    string          `json:"executionHeight"`
		From      string          `json:"from"`
		Fee       string          `json:"fee"`
		Nonce     string          `json:"nonce"`
		Effects   json.RawMessage `json:"effects"`
	}
	if _, e := r.get(ctx, r.chain, "/transactions/pq/actions/originals/"+hash, &v); e != nil {
		return Observation{}, e
	}
	out := Observation{Status: v.Status, NativeHash: v.Hash, ABCIHash: v.ABCI, ExecutionHeight: v.Height, Source: v.Source}
	if v.Status == "unknown" {
		return out, nil
	}
	if v.Source != "comet-rpc" || v.Hash != hash || v.Type != intent.ActionKind || v.From != intent.Request.Owner || v.Fee != intent.Conditions.FeeYNXT || v.Nonce != intent.Conditions.NextNonce || len(v.Wire) == 0 || len(v.Wire) > 512<<10 {
		return out, ErrInvalid
	}
	sum := sha256.Sum256(v.Wire)
	if "0x"+hex.EncodeToString(sum[:]) != hash {
		return out, ErrInvalid
	}
	member, e := ynxbatch.DecodeMember(v.Wire)
	if e != nil || member.Certificate.Owner != intent.Request.Owner || member.Certificate.Purpose != ynxauth.TransactionPurpose || hex.EncodeToString(member.Certificate.ChainID) != intent.Network.NetworkID32 {
		return out, ErrInvalid
	}
	action, e := ynxauth.DecodeAction(member.Message)
	if e != nil || hex.EncodeToString(action.ChainID) != intent.Network.NetworkID32 || strconv.FormatUint(action.NativeChainID, 10) != intent.Network.NativeChainID || action.Owner != intent.Request.Owner || action.Kind != intent.ActionKind || strconv.FormatUint(action.Fee, 10) != intent.Conditions.FeeYNXT || strconv.FormatUint(action.Nonce, 10) != intent.Conditions.NextNonce || !bytes.Equal(action.Payload, intent.CanonicalPayload) {
		return out, ErrInvalid
	}
	if !transactionHash(v.ABCI) {
		return out, ErrInvalid
	}
	if n, e := integer(v.Height); e != nil || n == 0 {
		return out, ErrInvalid
	}
	if v.Status == "committed" && !v.Committed || v.Status == "rejected" && v.Committed || v.Status != "committed" && v.Status != "rejected" {
		return out, ErrInvalid
	}
	out.WireBinding = bind(v.Wire)
	out.EffectsBinding = bind(v.Effects)
	return out, nil
}

func uniqueJSON(raw []byte) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var visit func(int) error
	visit = func(depth int) error {
		if depth > 32 {
			return ErrInvalid
		}
		t, e := d.Token()
		if e != nil {
			return e
		}
		delim, ok := t.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				key, e := d.Token()
				if e != nil {
					return e
				}
				s, ok := key.(string)
				if !ok || seen[s] || len(seen) > 2048 {
					return ErrInvalid
				}
				seen[s] = true
				if e = visit(depth + 1); e != nil {
					return e
				}
			}
		case '[':
			count := 0
			for d.More() {
				count++
				if count > 10000 {
					return ErrInvalid
				}
				if e = visit(depth + 1); e != nil {
					return e
				}
			}
		default:
			return ErrInvalid
		}
		_, e = d.Token()
		return e
	}
	if e := visit(0); e != nil {
		return e
	}
	if _, e := d.Token(); e != io.EOF {
		return ErrInvalid
	}
	return nil
}
