package privval

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"sync"
	"time"

	"github.com/cometbft/cometbft/crypto"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	p2pconn "github.com/cometbft/cometbft/p2p/conn"
	cryptoproto "github.com/cometbft/cometbft/proto/tendermint/crypto"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/types"
)

// ContextSignerClient is the opt-in private context ABI. Stock remote signer
// defaults are untouched. The caller supplies an already connected SecretConn,
// an independent peer pin and original bootstrap identity, never peer metadata.
// It does not implement automatic reconnect or RetrySignerClient semantics.
type ContextSignerClient struct {
	mu        sync.Mutex
	transport *contextConnection
	chain     string
	original  ed25519.PubKey
	startup   bool
	current   *remoteConsensusContext
	authority types.ConsensusAuthoritySource
}

var _ types.PrivValidator = (*ContextSignerClient)(nil)
var _ types.HeightPrivValidator = (*ContextSignerClient)(nil)
var _ types.ConsensusSigningContextSetter = (*ContextSignerClient)(nil)
var _ types.ConsensusCheckpointSigningContextSetter = (*ContextSignerClient)(nil)

func NewContextSignerClient(conn *p2pconn.SecretConnection, signerPin crypto.PubKey, timeout time.Duration, chain string, original ed25519.PubKey, authority types.ConsensusAuthoritySource) (*ContextSignerClient, error) {
	transport, err := pinnedContextConnection(conn, signerPin, timeout)
	if err != nil {
		return nil, err
	}
	if chain == "" || len(original) != ed25519.PubKeySize || authority == nil {
		return nil, errors.New("remote client requires independently pinned chain, original validator identity and local checkpoint authority")
	}
	return &ContextSignerClient{transport: transport, chain: chain, original: ed25519.PubKey(bytes.Clone(original)), startup: true, authority: authority}, nil
}
func (c *ContextSignerClient) Close() error { return c.transport.conn.Close() }
func (c *ContextSignerClient) exchange(kind uint32, payload []byte, signing bool) ([]byte, error) {
	request := encodeContextRequest(kind, payload)
	unknown := func(err error) ([]byte, error) {
		c.current = nil
		_ = c.transport.conn.Close() // No continued reads/retries after an ambiguous frame.
		if signing {
			return nil, &RemoteConsensusUnknown{RequestHash: sha256.Sum256(request), Request: bytes.Clone(request), Cause: err}
		}
		return nil, err
	}
	if err := c.transport.write(request); err != nil {
		return unknown(err)
	}
	response, err := c.transport.read()
	if err != nil {
		return unknown(err)
	}
	out, code, err := decodeContextResponse(request, response)
	if err != nil {
		if code == contextRejected {
			c.current = nil
			return nil, err
		}
		return unknown(err)
	}
	return out, nil
}
func (c *ContextSignerClient) SetConsensusCheckpointSigningContext(chain string, committed int64, hash []byte, height int64, round int32, actual *types.ValidatorSet) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.startup = false
	c.current = nil
	if chain != c.chain {
		return errors.New("remote checkpoint uses another chain")
	}
	detached, err := detachedContextSet(actual)
	if err != nil {
		return err
	}
	next, err := encodeRemoteContext(chain, committed, hash, height, round, detached)
	if err != nil {
		return err
	}
	// The peer cannot decide whether an empty precommit extension is required.
	// Resolve the policy from the node's own authenticated exact checkpoint.
	authority, err := c.authority.ConsensusAuthorityForState(chain, committed, bytes.Clone(hash))
	if err != nil {
		return err
	}
	if authority == nil {
		return errors.New("local checkpoint source returned no authority")
	}
	next.set, err = authority.BindValidatorSet(height, detached)
	if err != nil {
		return err
	}
	params, err := authority.ParamsAt(height)
	if err != nil {
		return err
	}
	if err = params.ValidateBasic(); err != nil {
		return err
	}
	params.Validator.PubKeyTypes = append([]string(nil), params.Validator.PubKeyTypes...)
	params.YNXProfile = bytes.Clone(params.YNXProfile)
	next.params = &params
	_, member := next.set.GetByAddress(c.original.Address())
	if member == nil {
		return errors.New("remote original validator absent from actual set")
	}
	ack, err := c.exchange(contextSet, next.wire, false)
	if err != nil {
		return err
	}
	if !bytes.Equal(ack, next.id[:]) {
		_ = c.transport.conn.Close()
		return errors.New("remote signer acknowledged another context")
	}
	c.current = next
	return nil
}

// The old setter has no checkpoint. It cannot authorize this remote ABI.
func (c *ContextSignerClient) SetConsensusSigningContext(string, int64, int32, *types.ValidatorSet) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.startup = false
	c.current = nil
	return errors.New("remote signer requires the actual committed checkpoint context")
}
func (c *ContextSignerClient) GetPubKey() (crypto.PubKey, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.startup {
		return ed25519.PubKey(bytes.Clone(c.original)), nil
	}
	return c.key()
}
func (c *ContextSignerClient) GetPubKeyForHeight(chain string, height int64) (crypto.PubKey, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.startup = false
	if chain != c.chain || c.current == nil || height != c.current.height {
		return nil, errors.New("height key requires current checkpoint context")
	}
	return c.key()
}
func (c *ContextSignerClient) key() (crypto.PubKey, error) {
	if c.current == nil {
		return nil, errors.New("remote full key requires actual context")
	}
	ctx := c.current
	wire, err := c.exchange(contextPubKey, contextFields(ctx.id[:], nil), false)
	if err != nil {
		return nil, err
	}
	var pb cryptoproto.PublicKey
	if err = pb.Unmarshal(wire); err != nil {
		return nil, err
	}
	canonical, err := pb.Marshal()
	if err != nil || !bytes.Equal(wire, canonical) {
		return nil, errors.New("noncanonical remote public key")
	}
	key, err := cryptoenc.PubKeyFromProto(pb)
	if err != nil {
		return nil, err
	}
	_, member := ctx.set.GetByAddress(c.original.Address())
	if member == nil || !member.PubKey.Equals(key) {
		return nil, errors.New("remote full key differs from actual authenticated local validator")
	}
	return member.PubKey, nil // retain engine's local immutable authorizer
}
func (c *ContextSignerClient) signingContext(chain string, height int64, round int32) (*remoteConsensusContext, crypto.PubKey, error) {
	c.startup = false
	ctx := c.current
	if chain != c.chain || ctx == nil || ctx.params == nil || height != ctx.height || round != ctx.round {
		return nil, nil, errors.New("missing exact remote signing context")
	}
	_, member := ctx.set.GetByAddress(c.original.Address())
	if member == nil {
		return nil, nil, errors.New("local validator absent")
	}
	return ctx, member.PubKey, nil
}
func (c *ContextSignerClient) SignVote(chain string, vote *cmtproto.Vote) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if vote == nil {
		return errors.New("missing vote")
	}
	ctx, key, err := c.signingContext(chain, vote.Height, vote.Round)
	if err != nil {
		return err
	}
	wire, err := vote.Marshal()
	if err != nil {
		return err
	}
	if _, err = canonicalUnsignedVote(wire); err != nil {
		return err
	}
	payload := contextFields(ctx.id[:], wire)
	signed, err := c.exchange(contextVote, payload, true)
	if err != nil {
		return err
	}
	var out cmtproto.Vote
	if err = out.Unmarshal(signed); err == nil {
		canonical, e := out.Marshal()
		if e != nil || !bytes.Equal(canonical, signed) {
			err = errors.New("noncanonical signed vote response")
		} else {
			err = verifyRemoteVote(wire, &out, chain, key, ctx.params.ABCI.VoteExtensionsEnabled(vote.Height))
		}
	}
	if err != nil {
		return c.invalidSignedResponse(contextVote, payload, err)
	}
	vote.Signature, vote.ExtensionSignature = bytes.Clone(out.Signature), bytes.Clone(out.ExtensionSignature)
	return nil
}
func (c *ContextSignerClient) SignProposal(chain string, proposal *cmtproto.Proposal) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if proposal == nil {
		return errors.New("missing proposal")
	}
	ctx, key, err := c.signingContext(chain, proposal.Height, proposal.Round)
	if err != nil {
		return err
	}
	wire, err := proposal.Marshal()
	if err != nil {
		return err
	}
	if _, err = canonicalUnsignedProposal(wire); err != nil {
		return err
	}
	payload := contextFields(ctx.id[:], wire)
	signed, err := c.exchange(contextProposal, payload, true)
	if err != nil {
		return err
	}
	var out cmtproto.Proposal
	if err = out.Unmarshal(signed); err == nil {
		canonical, e := out.Marshal()
		if e != nil || !bytes.Equal(canonical, signed) {
			err = errors.New("noncanonical signed proposal response")
		} else {
			err = verifyRemoteProposal(wire, &out, chain, key)
		}
	}
	if err != nil {
		return c.invalidSignedResponse(contextProposal, payload, err)
	}
	proposal.Signature = bytes.Clone(out.Signature)
	return nil
}
func (c *ContextSignerClient) invalidSignedResponse(kind uint32, payload []byte, cause error) error {
	c.current = nil
	_ = c.transport.conn.Close()
	request := encodeContextRequest(kind, payload)
	return &RemoteConsensusUnknown{RequestHash: sha256.Sum256(request), Request: bytes.Clone(request), Cause: cause}
}
