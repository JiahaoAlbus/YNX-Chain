package privval

import (
	"bytes"
	"errors"
	"sync"
	"time"

	"github.com/cometbft/cometbft/crypto"
	"github.com/cometbft/cometbft/crypto/ed25519"
	p2pconn "github.com/cometbft/cometbft/p2p/conn"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/types"
)

// ContextSignerServer consumes only an already authenticated, independently
// pinned engine connection. It does not listen, reconnect, generate identities,
// or create H/R/S storage. pv must be the existing durable transition signer.
// The pinned engine is responsible for actual round priorities/proposer; the
// local source independently authenticates checkpoint, membership and policy.
type ContextSignerServer struct {
	mu        sync.Mutex
	transport *contextConnection
	chain     string
	source    types.ConsensusSigningAuthoritySource
	pv        types.PrivValidator
	heightPV  types.HeightPrivValidator
	setter    types.ConsensusSigningContextSetter
	current   *remoteConsensusContext
}

func NewContextSignerServer(conn *p2pconn.SecretConnection, enginePin crypto.PubKey, timeout time.Duration, chain string, source types.ConsensusSigningAuthoritySource, pv types.PrivValidator) (*ContextSignerServer, error) {
	transport, err := pinnedContextConnection(conn, enginePin, timeout)
	if err != nil {
		return nil, err
	}
	hp, ok := pv.(types.HeightPrivValidator)
	if !ok {
		return nil, errors.New("remote signer requires height-aware durable validator")
	}
	setter, ok := pv.(types.ConsensusSigningContextSetter)
	if !ok || chain == "" || source == nil {
		return nil, errors.New("remote signer requires fresh local authority and actual context setter")
	}
	return &ContextSignerServer{transport: transport, chain: chain, source: source, pv: pv, heightPV: hp, setter: setter}, nil
}
func (s *ContextSignerServer) Close() error { return s.transport.conn.Close() }

// ServeNext processes exactly one bounded request. The caller owns service
// lifecycle. Write failure never re-executes a signing request.
func (s *ContextSignerServer) ServeNext() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	request, err := s.transport.read()
	if err != nil {
		s.current = nil
		return err
	}
	payload, code, operationErr := s.handle(request)
	description := ""
	if operationErr != nil {
		description = operationErr.Error()
	}
	if err = s.transport.write(encodeContextResponse(request, payload, code, description)); err != nil {
		s.current = nil
		return err
	}
	return nil
}
func (s *ContextSignerServer) bind(ctx *remoteConsensusContext) (crypto.PubKey, types.ConsensusParams, error) {
	var params types.ConsensusParams
	if ctx == nil || ctx.chain != s.chain {
		return nil, params, errors.New("remote context chain mismatch or missing context")
	}
	authority, err := s.source.ConsensusAuthorityForSigning(ctx.chain, ctx.committed, bytes.Clone(ctx.appHash))
	if err != nil {
		return nil, params, err
	}
	if authority == nil {
		return nil, params, errors.New("fresh source returned no authority")
	}
	actual, err := authority.BindValidatorSet(ctx.height, ctx.set)
	if err != nil {
		return nil, params, err
	}
	params, err = authority.ParamsAt(ctx.height)
	if err != nil {
		return nil, params, err
	}
	if err = params.ValidateBasic(); err != nil {
		return nil, params, err
	}
	if err = s.setter.SetConsensusSigningContext(ctx.chain, ctx.height, ctx.round, actual); err != nil {
		return nil, params, err
	}
	key, err := s.heightPV.GetPubKeyForHeight(ctx.chain, ctx.height)
	if err != nil {
		return nil, params, err
	}
	if key == nil {
		return nil, params, errors.New("durable signer returned no full key")
	}
	_, member := actual.GetByAddress(key.Address())
	if member == nil || !member.PubKey.Equals(key) {
		return nil, params, errors.New("durable signer not in authenticated actual full-key set")
	}
	return member.PubKey, params, nil
}
func (s *ContextSignerServer) handle(request []byte) ([]byte, uint32, error) {
	kind, payload, err := decodeContextRequest(request)
	if err != nil {
		s.current = nil
		return nil, contextRejected, err
	}
	if kind == contextSet {
		s.current = nil
		next, err := decodeRemoteContext(payload)
		if err != nil {
			return nil, contextRejected, err
		}
		if _, _, err = s.bind(next); err != nil {
			return nil, contextRejected, err
		}
		s.current = next
		return bytes.Clone(next.id[:]), 0, nil
	}
	fields, err := readContextFields(payload, 2, maxRemoteSignerMsgSize)
	if err != nil || s.current == nil || !bytes.Equal(fields[0], s.current.id[:]) {
		s.current = nil
		return nil, contextRejected, errors.New("unknown or stale remote signing context")
	}
	ctx := s.current
	key, params, err := s.bind(ctx)
	if err != nil {
		s.current = nil
		return nil, contextRejected, err
	}
	if kind == contextPubKey {
		if len(fields[1]) != 0 {
			return nil, contextRejected, errors.New("public key request must not carry an object")
		}
		wire, err := encodeContextKey(key)
		if err != nil {
			return nil, contextRejected, err
		}
		return wire, 0, nil
	}
	switch kind {
	case contextVote:
		v, err := canonicalUnsignedVote(fields[1])
		if err != nil {
			return nil, contextRejected, err
		}
		index, member := ctx.set.GetByAddress(key.Address())
		if member == nil || v.Height != ctx.height || v.Round != ctx.round || v.ValidatorIndex != index || !bytes.Equal(v.ValidatorAddress, key.Address()) {
			return nil, contextRejected, errors.New("vote does not match authenticated local membership and H/R")
		}
		extended := params.ABCI.VoteExtensionsEnabled(v.Height) && v.Type == cmtproto.PrecommitType && !types.ProtoBlockIDIsNil(&v.BlockID)
		if !extended && len(v.Extension) != 0 {
			return nil, contextRejected, errors.New("extension not enabled by trusted parameters")
		}
		if err = s.pv.SignVote(ctx.chain, v); err != nil {
			return nil, contextUnknown, err
		}
		if !extended && len(v.ExtensionSignature) != 0 {
			// Stock FilePV signs even empty extensions on all non-nil
			// precommits; the engine discards them before the enable height.
			// Mirror that historical path only for the authenticated Ed key,
			// after verifying the actual returned signature. A PQ
			// signer must follow its trusted parameter policy exactly.
			if key.Type() != ed25519.KeyType || v.Type != cmtproto.PrecommitType || types.ProtoBlockIDIsNil(&v.BlockID) {
				return nil, contextUnknown, errors.New("durable signer added unauthorized extension")
			}
			if err = verifyRemoteVote(fields[1], v, ctx.chain, key, true); err != nil {
				return nil, contextUnknown, err
			}
			v.ExtensionSignature = nil
		}
		if err = verifyRemoteVote(fields[1], v, ctx.chain, key, params.ABCI.VoteExtensionsEnabled(v.Height)); err != nil {
			return nil, contextUnknown, err
		}
		wire, err := v.Marshal()
		if err != nil {
			return nil, contextUnknown, err
		}
		return wire, 0, nil
	case contextProposal:
		p, err := canonicalUnsignedProposal(fields[1])
		if err != nil {
			return nil, contextRejected, err
		}
		if p.Height != ctx.height || p.Round != ctx.round || ctx.set.Proposer == nil || !bytes.Equal(ctx.set.Proposer.Address, key.Address()) {
			return nil, contextRejected, errors.New("proposal signer is not authenticated actual round proposer")
		}
		if err = s.pv.SignProposal(ctx.chain, p); err != nil {
			return nil, contextUnknown, err
		}
		if err = verifyRemoteProposal(fields[1], p, ctx.chain, key); err != nil {
			return nil, contextUnknown, err
		}
		wire, err := p.Marshal()
		if err != nil {
			return nil, contextUnknown, err
		}
		return wire, 0, nil
	}
	return nil, contextRejected, errors.New("unsupported remote operation")
}
