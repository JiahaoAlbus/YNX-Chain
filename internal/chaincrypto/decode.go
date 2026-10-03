package chaincrypto

import (
	"bytes"
	"encoding/binary"
	"io"
)

// No alternate encodings, trailing bytes, or unbounded allocations are accepted.
type wireReader struct {
	*bytes.Reader
	err error
}

func (r *wireReader) fixed(out []byte) {
	if r.err == nil {
		_, r.err = io.ReadFull(r.Reader, out)
	}
}
func (r *wireReader) number(out any) {
	if r.err == nil {
		r.err = binary.Read(r.Reader, binary.BigEndian, out)
	}
}
func (r *wireReader) blob(max uint32) []byte {
	var n uint32
	r.number(&n)
	if r.err != nil || n > max || uint64(n) > uint64(r.Len()) {
		r.err = ErrInvalid
		return nil
	}
	out := make([]byte, n)
	r.fixed(out)
	return out
}
func (r *wireReader) header(domain string) {
	if string(r.blob(64)) != domain {
		r.err = ErrInvalid
	}
	var version, alg uint16
	r.number(&version)
	r.number(&alg)
	if version != EnvelopeVersion || alg != AlgorithmMLDSA87 {
		r.err = ErrInvalid
	}
}
func (r *wireReader) network() Network {
	var n Network
	r.number(&n.ChainID)
	n.ConsensusID = string(r.blob(128))
	r.fixed(n.Genesis[:])
	return n
}
func DecodeTxMessage(raw []byte) (TxMessage, error) {
	var m TxMessage
	if len(raw) == 0 || len(raw) > MaxAuthMessage {
		return m, ErrInvalid
	}
	r := &wireReader{Reader: bytes.NewReader(raw)}
	r.header(AccountContext)
	m.Network = r.network()
	r.fixed(m.Account[:])
	r.number(&m.PolicyVersion)
	r.number(&m.KeyVersion)
	r.number(&m.Nonce)
	r.number(&m.ExpiryHeight)
	r.number(&m.Action)
	r.fixed(m.Recipient[:])
	r.fixed(m.Amount[:])
	r.fixed(m.Fee[:])
	r.number(&m.Gas)
	m.Payload = r.blob(MaxAuthMessage - 512)
	canonical, err := m.CanonicalBytes()
	if r.err != nil || r.Len() != 0 || err != nil || !bytes.Equal(canonical, raw) {
		return TxMessage{}, ErrInvalid
	}
	return m, nil
}
func DecodeConsensusMessage(raw []byte) (ConsensusMessage, error) {
	var m ConsensusMessage
	if len(raw) == 0 || len(raw) > MaxAuthMessage {
		return m, ErrInvalid
	}
	r := &wireReader{Reader: bytes.NewReader(raw)}
	r.header(ConsensusContext)
	m.Network = r.network()
	r.fixed(m.Validator[:])
	r.number(&m.KeyVersion)
	r.number(&m.Height)
	r.number(&m.Round)
	r.number(&m.Kind)
	m.OriginalSignBytes = r.blob(MaxAuthMessage - 512)
	canonical, err := m.CanonicalBytes()
	if r.err != nil || r.Len() != 0 || err != nil || !bytes.Equal(canonical, raw) {
		return ConsensusMessage{}, ErrInvalid
	}
	return m, nil
}
