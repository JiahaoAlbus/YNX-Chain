// Package ynxpq implements the full YNX consensus key and the frozen v0.2
// signature domain. Decoding a key never grants consensus authority.
package ynxpq

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math"
	"unicode/utf8"

	"github.com/cometbft/cometbft/crypto"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

const (
	KeyType                     = "ynx_dual_pq_v2"
	PubKeyName                  = "ynx/PubKeyDualPQV2"
	MLDSA87PublicKeySize        = 2592
	SLHDSASHA2256fPublicKeySize = 64
	MLDSA87SignatureSize        = 4627
	SLHDSASHA2256fSignatureSize = 49856
	logicalPublicKeyDomain      = "YNX-CONSENSUS-LOGICAL-PUBKEY/v1\x00"
	maxPublicKeyBytes           = 8 << 10
)

// Authorizer must authenticate the entire binding against an immutable,
// height-specific committed key history and validator membership. It must also
// enforce the genesis-pinned activation schedule, revocation, epoch and step
// policy. It is deliberately NOT serialized or supplied by peers. Implementors
// must be safe for concurrent reads and must not acquire a caller-held lock.
// Successful cryptographic verification alone cannot authorize a validator.
type Authorizer interface {
	AuthorizeConsensusKey(binding []byte, height int64, round int32, kind Kind) error
}

type AuthorizerFunc func([]byte, int64, int32, Kind) error

func (f AuthorizerFunc) AuthorizeConsensusKey(b []byte, h int64, r int32, k Kind) error {
	if f == nil {
		return errors.New("nil YNX consensus authorizer")
	}
	return f(b, h, r, k)
}

// PubKey is immutable after construction. Its address is the original validator
// address authenticated by the registration, not a hash of either PQ branch.
// Bytes includes this address, genesis, chain, epoch and registration hash, so
// SimpleValidator/ValidatorSet hashing commits to the complete binding.
type PubKey struct {
	wire       []byte
	genesis    []byte
	chainID    string
	address    []byte
	epoch      uint64
	validFrom  int64
	pka, pkb   []byte
	authorizer Authorizer
}

var _ crypto.PubKey = PubKey{}

func init() { cmtjson.RegisterType(PubKey{}, PubKeyName) }

// DecodePubKey accepts exactly LogicalPublicKey/v1 from ynxconsensusauth.
// The returned key has no authorizer and cannot verify any consensus signature.
func DecodePubKey(wire []byte) (PubKey, error) {
	var k PubKey
	if len(wire) == 0 || len(wire) > maxPublicKeyBytes {
		return k, errors.New("invalid YNX full public key size")
	}
	fields := make([][]byte, 0, 12)
	rest := wire
	for len(rest) > 0 {
		if len(fields) == 12 || len(rest) < 4 {
			return k, errors.New("invalid YNX public key fields")
		}
		n := binary.BigEndian.Uint32(rest[:4])
		rest = rest[4:]
		if uint64(n) > uint64(len(rest)) {
			return k, errors.New("truncated YNX public key field")
		}
		fields = append(fields, rest[:int(n)])
		rest = rest[int(n):]
	}
	if len(fields) != 12 || string(fields[0]) != logicalPublicKeyDomain || !bytes.Equal(fields[1], []byte{0, 0, 0, 1}) {
		return k, errors.New("invalid YNX public key domain/version")
	}
	if len(fields[2]) != 32 || zero(fields[2]) || len(fields[3]) == 0 || len(fields[3]) > 50 || !utf8.Valid(fields[3]) || len(fields[4]) != crypto.AddressSize || len(fields[9]) != 32 || zero(fields[9]) || len(fields[10]) != MLDSA87PublicKeySize || len(fields[11]) != SLHDSASHA2256fPublicKeySize {
		return k, errors.New("invalid YNX public key binding")
	}
	for _, i := range []int{5, 6, 7, 8} {
		if len(fields[i]) != 4 {
			return k, errors.New("invalid YNX public key integer")
		}
	}
	epoch := uint64(binary.BigEndian.Uint32(fields[5]))<<32 | uint64(binary.BigEndian.Uint32(fields[6]))
	h := uint64(binary.BigEndian.Uint32(fields[7]))<<32 | uint64(binary.BigEndian.Uint32(fields[8]))
	if epoch == 0 || h == 0 || h > math.MaxInt64 {
		return k, errors.New("invalid YNX public key epoch/height")
	}
	k = PubKey{wire: bytes.Clone(wire), genesis: bytes.Clone(fields[2]), chainID: string(fields[3]), address: bytes.Clone(fields[4]), epoch: epoch, validFrom: int64(h), pka: bytes.Clone(fields[10]), pkb: bytes.Clone(fields[11])}
	return k, nil
}

// WithAuthorizer returns a new instance. Neither the original nor serialized
// copies acquire authority. The caller must use its own trusted history.
func (k PubKey) WithAuthorizer(a Authorizer) PubKey { k.authorizer = a; return k }
func (k PubKey) Address() crypto.Address            { return bytes.Clone(k.address) }
func (k PubKey) Bytes() []byte                      { return bytes.Clone(k.wire) }
func (k PubKey) Type() string                       { return KeyType }
func (k PubKey) Equals(other crypto.PubKey) bool {
	p, ok := other.(PubKey)
	return ok && bytes.Equal(k.wire, p.wire)
}
func (k PubKey) MarshalJSON() ([]byte, error) {
	if _, err := DecodePubKey(k.wire); err != nil {
		return nil, err
	}
	return json.Marshal(k.wire)
}
func (k *PubKey) UnmarshalJSON(b []byte) error {
	var wire []byte
	if err := json.Unmarshal(b, &wire); err != nil {
		return err
	}
	decoded, err := DecodePubKey(wire)
	if err != nil {
		return err
	}
	*k = decoded
	return nil
}
func zero(b []byte) bool {
	for _, v := range b {
		if v != 0 {
			return false
		}
	}
	return true
}
func field(dst, b []byte) []byte {
	dst = binary.BigEndian.AppendUint32(dst, uint32(len(b)))
	return append(dst, b...)
}
