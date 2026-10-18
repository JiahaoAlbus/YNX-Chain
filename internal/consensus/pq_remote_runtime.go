//go:build unix

package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/cometbft/cometbft/crypto"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/p2p"
	p2pconn "github.com/cometbft/cometbft/p2p/conn"
	"github.com/cometbft/cometbft/privval"
	cmttypes "github.com/cometbft/cometbft/types"
)

// PQRemoteTransport is explicit operator configuration, never a peer response.
// TransportKey is an existing private NodeKey-format file, PeerPin is a file
// containing the exact lowercase hex full Ed25519 public key (optional LF).
type PQRemoteTransport struct {
	Address, TransportKey, PeerPin string
	Timeout                        time.Duration
}

func (c PQRemoteTransport) Validate() error {
	if c.TransportKey == "" || c.PeerPin == "" || c.Timeout <= 0 || c.Timeout > time.Minute {
		return errors.New("remote transport requires existing key, independent full peer pin and timeout in (0,1m]")
	}
	_, err := pqRemoteTCPAddress(c.Address)
	return err
}
func pqRemoteTCPAddress(address string) (string, error) {
	if !strings.HasPrefix(address, "tcp://") {
		return "", errors.New("remote consensus requires explicit tcp:// SecretConnection endpoint")
	}
	address = strings.TrimPrefix(address, "tcp://")
	host, port, err := net.SplitHostPort(address)
	if err != nil || host == "" {
		return "", errors.New("remote endpoint requires explicit host and port")
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 || strconv.Itoa(n) != port {
		return "", errors.New("remote endpoint requires canonical nonzero port")
	}
	return address, nil
}
func loadPQRemoteTransport(c PQRemoteTransport) (crypto.PrivKey, crypto.PubKey, error) {
	if err := c.Validate(); err != nil {
		return nil, nil, err
	}
	key, err := LoadPQExistingNodeKey(c.TransportKey)
	if err != nil {
		return nil, nil, err
	}
	private := key.PrivKey.(cmted.PrivKey)
	pin, err := readPQOperatorFile(c.PeerPin, 65, false)
	if err != nil {
		clear(private)
		return nil, nil, err
	}
	encoded := strings.TrimSuffix(string(pin), "\n")
	peer, err := hex.DecodeString(encoded)
	if err != nil || len(peer) != cmted.PubKeySize || hex.EncodeToString(peer) != encoded {
		clear(private)
		return nil, nil, errors.New("peer pin must contain one exact lowercase full Ed25519 key")
	}
	return private, cmted.PubKey(peer), nil
}

func LoadPQExistingNodeKey(path string) (*p2p.NodeKey, error) {
	raw, err := readPQOperatorFile(path, 64<<10, true)
	if err != nil {
		return nil, err
	}
	defer clear(raw)
	var key p2p.NodeKey
	if err = cmtjson.Unmarshal(raw, &key); err != nil {
		return nil, errors.New("invalid existing operator identity file")
	}
	private, ok := key.PrivKey.(cmted.PrivKey)
	if !ok || len(private) != ed25519.PrivateKeySize {
		return nil, errors.New("operator identity must be an existing full Ed25519 key")
	}
	derived := ed25519.NewKeyFromSeed(private[:ed25519.SeedSize])
	defer clear(derived)
	if !bytes.Equal(derived, private) {
		clear(private)
		return nil, errors.New("operator identity public/private mismatch")
	}
	return &key, nil
}

// AuthenticatePQRemoteConnection takes ownership of conn. It neither generates
// a key nor retries a failed handshake. Cancellation closes the original socket.
func AuthenticatePQRemoteConnection(ctx context.Context, conn net.Conn, config PQRemoteTransport) (*p2pconn.SecretConnection, crypto.PubKey, error) {
	if conn == nil {
		return nil, nil, errors.New("missing original connection or context")
	}
	key, pin, err := loadPQRemoteTransport(config)
	if err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	defer clear(key.Bytes())
	return authenticatePQRemoteConnection(ctx, conn, config.Timeout, key, pin)
}

// The original operator material is captured before Dial/Accept and is not
// reloaded after a connection arrives. Peer data cannot change either pin.
func authenticatePQRemoteConnection(ctx context.Context, conn net.Conn, timeout time.Duration, key crypto.PrivKey, pin crypto.PubKey) (*p2pconn.SecretConnection, crypto.PubKey, error) {
	success := false
	defer func() {
		if !success {
			_ = conn.Close()
		}
	}()
	if ctx == nil {
		return nil, nil, errors.New("missing original connection context")
	}
	deadline := time.Now().Add(timeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	if err := conn.SetDeadline(deadline); err != nil {
		return nil, nil, err
	}
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	secret, err := p2pconn.MakeSecretConnection(conn, key)
	if err != nil {
		return nil, nil, fmt.Errorf("remote authenticated handshake: %w", err)
	}
	if secret.RemotePubKey() == nil || !pin.Equals(secret.RemotePubKey()) {
		return nil, nil, errors.New("remote peer differs from independent full key pin")
	}
	if err = ctx.Err(); err != nil {
		return nil, nil, err
	}
	if err = secret.SetDeadline(time.Time{}); err != nil {
		return nil, nil, err
	}
	success = true
	return secret, pin, nil
}
func DialPQRemoteConnection(ctx context.Context, config PQRemoteTransport) (*p2pconn.SecretConnection, crypto.PubKey, error) {
	if ctx == nil {
		return nil, nil, errors.New("missing remote connection context")
	}
	if err := config.Validate(); err != nil {
		return nil, nil, err
	}
	// Validate existing operator material before any outbound connection.
	key, pin, err := loadPQRemoteTransport(config)
	if err != nil {
		return nil, nil, err
	}
	defer clear(key.Bytes())
	address, err := pqRemoteTCPAddress(config.Address)
	if err != nil {
		return nil, nil, err
	}
	conn, err := (&net.Dialer{Timeout: config.Timeout}).DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, nil, err
	}
	return authenticatePQRemoteConnection(ctx, conn, config.Timeout, key, pin)
}

// ServePQRemoteConnection consumes one explicitly accepted connection for its
// entire life. A lost response terminates this session; no reconnect/retry loop
// is hidden here. The source reopens its exact committed file for every request.
func ServePQRemoteConnection(ctx context.Context, conn net.Conn, config PQRemoteTransport, chainID string, source cmttypes.ConsensusSigningAuthoritySource, pv cmttypes.PrivValidator) error {
	secret, pin, err := AuthenticatePQRemoteConnection(ctx, conn, config)
	if err != nil {
		return err
	}
	return servePQRemoteConnection(ctx, secret, pin, config.Timeout, chainID, source, pv)
}

func servePQRemoteConnection(ctx context.Context, secret *p2pconn.SecretConnection, pin crypto.PubKey, timeout time.Duration, chainID string, source cmttypes.ConsensusSigningAuthoritySource, pv cmttypes.PrivValidator) error {
	defer secret.Close()
	stop := context.AfterFunc(ctx, func() { _ = secret.Close() })
	defer stop()
	server, err := privval.NewContextSignerServer(secret, pin, timeout, chainID, source, pv)
	if err != nil {
		return err
	}
	for {
		if err = server.ServeNext(); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		}
	}
}

// ListenPQRemoteSigner accepts a single bounded session. It never redials or
// resumes UNKNOWN work. A new session requires a new explicit invocation.
func ListenPQRemoteSigner(ctx context.Context, config PQRemoteTransport, chainID string, source cmttypes.ConsensusSigningAuthoritySource, pv cmttypes.PrivValidator) error {
	if ctx == nil || source == nil || pv == nil || chainID == "" {
		return errors.New("remote listener requires context and original signing authority")
	}
	if err := config.Validate(); err != nil {
		return err
	}
	key, pin, err := loadPQRemoteTransport(config)
	if err != nil {
		return err
	}
	defer clear(key.Bytes())
	address, err := pqRemoteTCPAddress(config.Address)
	if err != nil {
		return err
	}
	listener, err := (&net.ListenConfig{}).Listen(ctx, "tcp", address)
	if err != nil {
		return err
	}
	defer listener.Close()
	stop := context.AfterFunc(ctx, func() { _ = listener.Close() })
	defer stop()
	tcp, ok := listener.(*net.TCPListener)
	if !ok {
		return errors.New("unexpected remote listener type")
	}
	if err = tcp.SetDeadline(time.Now().Add(config.Timeout)); err != nil {
		return err
	}
	conn, err := listener.Accept()
	if err != nil {
		return err
	}
	_ = listener.Close()
	secret, pin, err := authenticatePQRemoteConnection(ctx, conn, config.Timeout, key, pin)
	if err != nil {
		return err
	}
	return servePQRemoteConnection(ctx, secret, pin, config.Timeout, chainID, source, pv)
}
