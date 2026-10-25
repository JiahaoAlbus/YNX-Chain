package privval

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"time"
	"unicode/utf8"

	"github.com/cometbft/cometbft/crypto"
	p2pconn "github.com/cometbft/cometbft/p2p/conn"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/types"
)

// This is a private transport ABI on the original authenticated connection,
// not a consensus signature domain. Vote/proposal bytes and v0.2 signatures
// are unchanged. Context and sign objects use separate bounded frames.
const (
	contextRequestDomain         = "YNX-REMOTE-CONSENSUS-REQUEST/v1\x00"
	contextResponseDomain        = "YNX-REMOTE-CONSENSUS-RESPONSE/v1\x00"
	contextDomain                = "YNX-REMOTE-CONSENSUS-CONTEXT/v1\x00"
	contextSet            uint32 = 1
	contextPubKey         uint32 = 2
	contextVote           uint32 = 3
	contextProposal       uint32 = 4
	contextRejected       uint32 = 1
	contextUnknown        uint32 = 2
	maxContextBytes              = 1 << 20
)

type remoteConsensusContext struct {
	chain     string
	committed int64
	appHash   []byte
	height    int64
	round     int32
	set       *types.ValidatorSet
	wire      []byte
	id        [32]byte
	// Populated only by the client's independent local authority. It is not
	// encoded in this private transport and is never supplied by the peer.
	params *types.ConsensusParams
}

func contextFields(fields ...[]byte) []byte {
	var out []byte
	for _, field := range fields {
		out = binary.BigEndian.AppendUint32(out, uint32(len(field)))
		out = append(out, field...)
	}
	return out
}
func contextU32(n uint32) []byte { return binary.BigEndian.AppendUint32(nil, n) }
func contextU64(n uint64) []byte { return binary.BigEndian.AppendUint64(nil, n) }
func readContextFields(wire []byte, count int, limit int) ([][]byte, error) {
	if len(wire) > limit {
		return nil, errors.New("remote consensus frame exceeds limit")
	}
	fields := make([][]byte, 0, count)
	for len(wire) > 0 {
		if len(fields) == count || len(wire) < 4 {
			return nil, errors.New("invalid remote context framing")
		}
		n := binary.BigEndian.Uint32(wire[:4])
		wire = wire[4:]
		if uint64(n) > uint64(len(wire)) {
			return nil, errors.New("truncated remote context field")
		}
		fields = append(fields, wire[:int(n)])
		wire = wire[int(n):]
	}
	if len(fields) != count {
		return nil, errors.New("wrong remote context field count")
	}
	return fields, nil
}
func encodeRemoteContext(chain string, committed int64, hash []byte, height int64, round int32, set *types.ValidatorSet) (*remoteConsensusContext, error) {
	if chain == "" || len(chain) > 50 || !utf8.ValidString(chain) || committed < 0 || committed >= math.MaxInt64-2 || height != committed+1 || round < 0 || len(hash) != 32 || bytes.Equal(hash, make([]byte, 32)) || set == nil {
		return nil, errors.New("invalid exact remote signing checkpoint")
	}
	if err := set.ValidateBasic(); err != nil {
		return nil, err
	}
	pb, err := set.ToProto()
	if err != nil {
		return nil, err
	}
	data, err := pb.Marshal()
	if err != nil {
		return nil, err
	}
	wire := contextFields([]byte(contextDomain), contextU32(1), []byte(chain), contextU64(uint64(committed)), hash, contextU64(uint64(height)), contextU32(uint32(round)), data)
	if len(wire) > maxContextBytes {
		return nil, errors.New("actual validator context exceeds private transport bound")
	}
	return &remoteConsensusContext{chain: chain, committed: committed, appHash: bytes.Clone(hash), height: height, round: round, set: set, wire: wire, id: sha256.Sum256(wire)}, nil
}
func decodeRemoteContext(wire []byte) (*remoteConsensusContext, error) {
	fields, err := readContextFields(wire, 8, maxContextBytes)
	if err != nil {
		return nil, err
	}
	if string(fields[0]) != contextDomain || !bytes.Equal(fields[1], contextU32(1)) || len(fields[3]) != 8 || len(fields[5]) != 8 || len(fields[6]) != 4 {
		return nil, errors.New("invalid remote context domain/version/coordinates")
	}
	h, r, c := binary.BigEndian.Uint64(fields[5]), binary.BigEndian.Uint32(fields[6]), binary.BigEndian.Uint64(fields[3])
	if h > math.MaxInt64 || c > math.MaxInt64 || r > math.MaxInt32 {
		return nil, errors.New("remote context integer overflow")
	}
	var pb cmtproto.ValidatorSet
	if err := pb.Unmarshal(fields[7]); err != nil {
		return nil, err
	}
	set, err := types.ValidatorSetFromProto(&pb)
	if err != nil {
		return nil, err
	}
	ctx, err := encodeRemoteContext(string(fields[2]), int64(c), fields[4], int64(h), int32(r), set)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(ctx.wire, wire) {
		return nil, errors.New("noncanonical remote context/protobuf")
	}
	return ctx, nil
}

type contextConnection struct {
	conn    *p2pconn.SecretConnection
	timeout time.Duration
}

func pinnedContextConnection(conn *p2pconn.SecretConnection, expectedPeer crypto.PubKey, timeout time.Duration) (*contextConnection, error) {
	if conn == nil || expectedPeer == nil || conn.RemotePubKey() == nil || !expectedPeer.Equals(conn.RemotePubKey()) || timeout <= 0 {
		return nil, errors.New("remote consensus requires an established SecretConnection and independent full peer-key pin")
	}
	return &contextConnection{conn: conn, timeout: timeout}, nil
}
func (c *contextConnection) write(wire []byte) error {
	if len(wire) == 0 || len(wire) > maxRemoteSignerMsgSize {
		return errors.New("remote consensus frame exceeds transport bound")
	}
	if err := c.conn.SetWriteDeadline(time.Now().Add(c.timeout)); err != nil {
		return err
	}
	frame := binary.BigEndian.AppendUint32(nil, uint32(len(wire)))
	frame = append(frame, wire...)
	for len(frame) > 0 {
		n, err := c.conn.Write(frame)
		if err != nil {
			return err
		}
		if n <= 0 {
			return io.ErrShortWrite
		}
		frame = frame[n:]
	}
	return nil
}
func (c *contextConnection) read() ([]byte, error) {
	if err := c.conn.SetReadDeadline(time.Now().Add(c.timeout)); err != nil {
		return nil, err
	}
	var prefix [4]byte
	if _, err := io.ReadFull(c.conn, prefix[:]); err != nil {
		return nil, err
	}
	n := binary.BigEndian.Uint32(prefix[:])
	if n == 0 || uint64(n) > uint64(maxRemoteSignerMsgSize) {
		return nil, errors.New("remote consensus declared frame exceeds bound")
	}
	wire := make([]byte, int(n))
	_, err := io.ReadFull(c.conn, wire)
	return wire, err
}
func encodeContextRequest(kind uint32, payload []byte) []byte {
	return contextFields([]byte(contextRequestDomain), contextU32(1), contextU32(kind), payload)
}
func decodeContextRequest(wire []byte) (uint32, []byte, error) {
	f, err := readContextFields(wire, 4, maxRemoteSignerMsgSize)
	if err != nil {
		return 0, nil, err
	}
	if string(f[0]) != contextRequestDomain || !bytes.Equal(f[1], contextU32(1)) || len(f[2]) != 4 {
		return 0, nil, errors.New("invalid private request domain/version")
	}
	kind := binary.BigEndian.Uint32(f[2])
	if kind < contextSet || kind > contextProposal {
		return 0, nil, errors.New("unsupported private request kind")
	}
	return kind, f[3], nil
}
func encodeContextResponse(request []byte, payload []byte, code uint32, description string) []byte {
	hash := sha256.Sum256(request)
	if len(description) > 1024 {
		description = description[:1024]
	}
	return contextFields([]byte(contextResponseDomain), contextU32(1), hash[:], contextU32(code), payload, []byte(description))
}
func decodeContextResponse(request, wire []byte) ([]byte, uint32, error) {
	f, err := readContextFields(wire, 6, maxRemoteSignerMsgSize)
	if err != nil {
		return nil, 0, err
	}
	hash := sha256.Sum256(request)
	if string(f[0]) != contextResponseDomain || !bytes.Equal(f[1], contextU32(1)) || !bytes.Equal(f[2], hash[:]) || len(f[3]) != 4 || len(f[5]) > 1024 {
		return nil, 0, errors.New("remote response does not bind original request")
	}
	code := binary.BigEndian.Uint32(f[3])
	if code > contextUnknown || (code == 0 && len(f[5]) != 0) || (code != 0 && len(f[4]) != 0) {
		return nil, 0, errors.New("invalid remote outcome shape")
	}
	if code != 0 {
		return nil, code, fmt.Errorf("remote consensus: %s", f[5])
	}
	return f[4], 0, nil
}

// RemoteConsensusUnknown preserves the exact original request after a broken
// transport or signer error. Neither client nor server automatically retries a
// signing operation or replaces its context/body to make it look successful.
type RemoteConsensusUnknown struct {
	RequestHash [32]byte
	Request     []byte
	Cause       error
}

func (e *RemoteConsensusUnknown) Error() string {
	return fmt.Sprintf("remote consensus outcome unknown for %x: %v", e.RequestHash, e.Cause)
}
func (e *RemoteConsensusUnknown) Unwrap() error { return e.Cause }
