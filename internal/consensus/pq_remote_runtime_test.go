//go:build unix

package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/p2p"
	p2pconn "github.com/cometbft/cometbft/p2p/conn"
	"github.com/cometbft/cometbft/privval"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
)

func remoteRuntimeConfigs(t *testing.T) (PQRemoteTransport, PQRemoteTransport) {
	t.Helper()
	dir := t.TempDir()
	left, right := cmted.GenPrivKey(), cmted.GenPrivKey()
	save := func(name string, key cmted.PrivKey, pin []byte) PQRemoteTransport {
		path := filepath.Join(dir, name+".json")
		if err := (&p2p.NodeKey{PrivKey: key}).SaveAs(path); err != nil {
			t.Fatal(err)
		}
		public := filepath.Join(dir, name+"-peer.pub")
		if err := os.WriteFile(public, []byte(hex.EncodeToString(pin)+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
		return PQRemoteTransport{Address: "tcp://127.0.0.1:27701", TransportKey: path, PeerPin: public, Timeout: time.Second}
	}
	return save("engine", left, right.PubKey().Bytes()), save("signer", right, left.PubKey().Bytes())
}
func TestPQRemoteRuntimeUsesOriginalPinnedSecretConnectionAndBoundedFailure(t *testing.T) {
	a, b := remoteRuntimeConfigs(t)
	original, err := os.ReadFile(a.TransportKey)
	if err != nil {
		t.Fatal(err)
	}
	left, right := net.Pipe()
	defer left.Close()
	defer right.Close()
	type result struct {
		conn *p2pconn.SecretConnection
		err  error
	}
	ready := make(chan result, 1)
	go func() {
		s, _, e := AuthenticatePQRemoteConnection(context.Background(), right, b)
		ready <- result{s, e}
	}()
	client, pin, err := AuthenticatePQRemoteConnection(context.Background(), left, a)
	server := <-ready
	if err != nil || server.err != nil {
		t.Fatal(err, server.err)
	}
	if !client.RemotePubKey().Equals(pin) {
		t.Fatal("actual authenticated peer did not match independent pin")
	}
	_ = client.Close()
	_ = server.conn.Close()
	after, err := os.ReadFile(a.TransportKey)
	if err != nil || !bytes.Equal(original, after) {
		t.Fatal("handshake changed original transport identity", err)
	}
	left, right = net.Pipe()
	defer right.Close()
	a.Timeout = 20 * time.Millisecond
	started := time.Now()
	if conn, _, err := AuthenticatePQRemoteConnection(context.Background(), left, a); err == nil || conn != nil {
		t.Fatal("silent peer bypassed bounded handshake")
	}
	if time.Since(started) > 2*time.Second {
		t.Fatal("handshake ignored configured bound")
	}
}
func TestPQRemoteRuntimeRejectsMissingKeysPinsAndLegacyHistoryMutation(t *testing.T) {
	a, b := remoteRuntimeConfigs(t)
	if err := os.WriteFile(a.PeerPin, []byte(hex.EncodeToString(cmted.GenPrivKey().PubKey().Bytes())), 0600); err != nil {
		t.Fatal(err)
	}
	left, right := net.Pipe()
	defer left.Close()
	defer right.Close()
	done := make(chan error, 1)
	go func() {
		conn, _, err := AuthenticatePQRemoteConnection(context.Background(), right, b)
		if conn != nil {
			defer conn.Close()
		}
		done <- err
	}()
	if conn, _, err := AuthenticatePQRemoteConnection(context.Background(), left, a); err == nil || conn != nil {
		t.Fatal("wrong operator peer pin accepted")
	}
	<-done
	a.TransportKey = filepath.Join(t.TempDir(), "must-remain-absent")
	if _, _, err := DialPQRemoteConnection(context.Background(), a); err == nil {
		t.Fatal("missing transport identity accepted")
	}
	if _, err := os.Stat(a.TransportKey); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("missing identity was generated")
	}
	for _, address := range []string{"http://peer:80", "tcp://:1234", "tcp://127.0.0.1:0", "tcp://127.0.0.1:0012", "unix:///tmp/signer"} {
		if _, err := pqRemoteTCPAddress(address); err == nil {
			t.Fatal("unsupported transport fallback accepted")
		}
	}
}

func TestPQRemoteOriginalLegacyLoaderPreservesAndBindsActualSavedHRS(t *testing.T) {
	dir := t.TempDir()
	keyPath, statePath := filepath.Join(dir, "original-key.json"), filepath.Join(dir, "original-state.json")
	key := cmted.GenPrivKey()
	pv := privval.NewFilePV(key, keyPath, statePath)
	pv.Save()
	vote := &cmtproto.Vote{Type: cmtproto.PrevoteType, Height: 12, Round: 3, Timestamp: time.Now().UTC(), ValidatorAddress: key.PubKey().Address(), ValidatorIndex: 0}
	if err := pv.SignVote("actual-original-chain", vote); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	lease, err := AcquireApplicationStateWriterLease(statePath)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()
	if second, err := AcquireApplicationStateWriterLease(statePath); err == nil {
		second.Close()
		t.Fatal("two owners acquired original legacy HRS lease")
	}
	loaded, err := LoadPQOriginalLegacyValidator(keyPath, statePath, "actual-original-chain")
	if err != nil || loaded.LastSignState.Height != 12 {
		t.Fatal(err)
	}
	after, err := os.ReadFile(statePath)
	if err != nil || !bytes.Equal(original, after) {
		t.Fatal("read-only legacy load rewrote HRS", err)
	}
	if _, err := LoadPQOriginalLegacyValidator(keyPath, statePath, "other-chain"); err == nil {
		t.Fatal("foreign-chain saved HRS accepted")
	}
	var changed privval.FilePVLastSignState
	if err = cmtjson.Unmarshal(original, &changed); err != nil {
		t.Fatal(err)
	}
	changed.Height--
	raw, err := cmtjson.MarshalIndent(changed, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(statePath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = LoadPQOriginalLegacyValidator(keyPath, statePath, "actual-original-chain"); err == nil {
		t.Fatal("valid signature was detached from its real stored HRS")
	}
	if err = os.Remove(statePath); err != nil {
		t.Fatal(err)
	}
	if _, err = LoadPQOriginalLegacyValidator(keyPath, statePath, "actual-original-chain"); err == nil {
		t.Fatal("missing HRS was reconstructed")
	}
	if _, err = os.Stat(statePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("missing original HRS was written")
	}
}
