package chaincrypto

import (
	"bytes"
	"encoding/binary"
	"errors"
)

// Values are fixed candidate wire IDs, not registered Ethereum transaction types.
const EnvelopeVersion uint16 = 2
const AlgorithmMLDSA87 uint16 = 1

type Network struct {
	ChainID     uint64
	ConsensusID string
	Genesis     [32]byte
}
type TxMessage struct {
	Network                                        Network
	Account                                        [20]byte
	PolicyVersion, KeyVersion, Nonce, ExpiryHeight uint64
	Action                                         uint16
	Recipient                                      [20]byte
	Amount, Fee                                    [32]byte // fixed unsigned 256-bit big-endian values
	Gas                                            uint64
	Payload                                        []byte // full calldata or complete canonical batch/action bytes
}

func nonzero(v []byte) bool {
	for _, b := range v {
		if b != 0 {
			return true
		}
	}
	return false
}
func networkValid(n Network) bool {
	return n.ChainID > 0 && len(n.ConsensusID) > 0 && len(n.ConsensusID) <= 128 && nonzero(n.Genesis[:])
}
func put16(b *bytes.Buffer, v uint16) { _ = binary.Write(b, binary.BigEndian, v) }
func put64(b *bytes.Buffer, v uint64) { _ = binary.Write(b, binary.BigEndian, v) }
func blob(b *bytes.Buffer, v []byte) {
	_ = binary.Write(b, binary.BigEndian, uint32(len(v)))
	b.Write(v)
}
func networkBytes(b *bytes.Buffer, n Network) {
	put64(b, n.ChainID)
	blob(b, []byte(n.ConsensusID))
	b.Write(n.Genesis[:])
}

func (m TxMessage) CanonicalBytes() ([]byte, error) {
	if !networkValid(m.Network) || !nonzero(m.Account[:]) || m.PolicyVersion == 0 || m.KeyVersion == 0 || m.Nonce == 0 || m.ExpiryHeight == 0 || m.Action == 0 || len(m.Payload) > MaxAuthMessage-512 {
		return nil, ErrInvalid
	}
	var b bytes.Buffer
	blob(&b, []byte(AccountContext))
	put16(&b, EnvelopeVersion)
	put16(&b, AlgorithmMLDSA87)
	networkBytes(&b, m.Network)
	b.Write(m.Account[:])
	put64(&b, m.PolicyVersion)
	put64(&b, m.KeyVersion)
	put64(&b, m.Nonce)
	put64(&b, m.ExpiryHeight)
	put16(&b, m.Action)
	b.Write(m.Recipient[:])
	b.Write(m.Amount[:])
	b.Write(m.Fee[:])
	put64(&b, m.Gas)
	blob(&b, m.Payload)
	return b.Bytes(), nil
}

type ConsensusKind uint8

const (
	Proposal  ConsensusKind = 1
	Prevote   ConsensusKind = 2
	Precommit ConsensusKind = 3
)

type ConsensusMessage struct {
	Network            Network
	Validator          [20]byte
	KeyVersion, Height uint64
	Round              uint32
	Kind               ConsensusKind
	// Full original canonical proposal/vote sign bytes, including block ID,
	// parts, POL-round/timestamp and all original fields. Not a hash substitute.
	OriginalSignBytes []byte
}

func (m ConsensusMessage) CanonicalBytes() ([]byte, error) {
	if !networkValid(m.Network) || !nonzero(m.Validator[:]) || m.KeyVersion == 0 || m.Height == 0 || m.Kind < Proposal || m.Kind > Precommit || len(m.OriginalSignBytes) == 0 || len(m.OriginalSignBytes) > MaxAuthMessage-512 {
		return nil, errors.New("invalid consensus candidate message")
	}
	var b bytes.Buffer
	blob(&b, []byte(ConsensusContext))
	put16(&b, EnvelopeVersion)
	put16(&b, AlgorithmMLDSA87)
	networkBytes(&b, m.Network)
	b.Write(m.Validator[:])
	put64(&b, m.KeyVersion)
	put64(&b, m.Height)
	_ = binary.Write(&b, binary.BigEndian, m.Round)
	b.WriteByte(byte(m.Kind))
	blob(&b, m.OriginalSignBytes)
	return b.Bytes(), nil
}
