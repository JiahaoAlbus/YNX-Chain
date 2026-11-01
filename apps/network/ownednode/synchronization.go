package ownednode

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// This fixed name belongs only to Network's isolated lifecycle fixture. No
// original ordinary-node launch descriptor has supplied a production endpoint.
const fixtureSyncSocket = "comet-sync.sock"
const synchronizationTTL = 3 * time.Second

var ErrSynchronization = errors.New("owned runtime synchronization observation unavailable")

// SyncNetworkIdentity contains only fields actually returned by the original
// PQWalletIdentityView. In particular it does not invent a networkId32 field.
type SyncNetworkIdentity struct {
	NativeChainID       string `json:"nativeChainId"`
	NativeGenesisSHA256 string `json:"nativeGenesisSHA256"`
	CometChainID        string `json:"cometChainId"`
	CometGenesisSHA256  string `json:"cometGenesisSHA256"`
}

func validSynchronizationNetwork(n RuntimeNetwork) bool {
	id, err := strconv.ParseInt(n.NativeChainID, 10, 64)
	return err == nil && id > 0 && strconv.FormatInt(id, 10) == n.NativeChainID && lowerHex(n.NetworkID32, 32) && lowerHex(n.NativeGenesisSHA256, 32) && lowerHex(n.CometGenesisSHA256, 32) && runtimeText(n.CometChainID, 128)
}

func cloneSynchronization(s Synchronization) Synchronization {
	copyString := func(p *string) *string {
		if p == nil {
			return nil
		}
		value := *p
		return &value
	}
	s.LocalHeight, s.TargetHeight = copyString(s.LocalHeight), copyString(s.TargetHeight)
	s.Source, s.UpdatedAt, s.ExpiresAt = copyString(s.Source), copyString(s.UpdatedAt), copyString(s.ExpiresAt)
	s.RunID, s.Generation = copyString(s.RunID), copyString(s.Generation)
	if s.CatchingUp != nil {
		value := *s.CatchingUp
		s.CatchingUp = &value
	}
	if s.NetworkIdentity != nil {
		value := *s.NetworkIdentity
		s.NetworkIdentity = &value
	}
	return s
}

func (m *Manager) synchronization() Synchronization {
	if m.syncNetwork == nil {
		return Synchronization{Code: "NOT_SUPPLIED"}
	}
	running := m.process
	if running == nil || running.stopRequested || m.closed || m.state.Stage != "running" {
		return Synchronization{Code: "NOT_RUNNING"}
	}
	select {
	case <-running.exited:
		return Synchronization{Code: "NOT_RUNNING"}
	default:
	}
	sample := running.syncReadback
	if sample.Code == "" {
		return Synchronization{Code: "NOT_SUPPLIED"}
	}
	if sample.ExpiresAt == nil {
		return Synchronization{Code: "UNAVAILABLE"}
	}
	if running.syncExpires.IsZero() || !time.Now().Before(running.syncExpires) {
		return Synchronization{Code: "EXPIRED"}
	}
	if running.syncSocket == nil || !m.syncSocketUnchanged(running.syncSocket) || m.runtimeUnchanged(running.capture) != nil {
		return Synchronization{Code: "UNAVAILABLE"}
	}
	return cloneSynchronization(sample)
}

// The capacity walk may account for this one non-storage endpoint only while
// holding its actual child. Presence grants no identity or sync capability:
// every connection must independently pass the kernel PID check below. Other
// special files and stale endpoints after process loss remain unsafe/preserved.
func (m *Manager) fixtureSynchronizationSocket(path string, info os.FileInfo) bool {
	return m.fixture && m.syncNetwork != nil && m.process != nil && path == filepath.Join(m.directory, "data", fixtureSyncSocket) && info.Mode()&os.ModeSocket != 0 && info.Mode().Perm() == 0600
}

func (m *Manager) syncSocketUnchanged(expected os.FileInfo) bool {
	info, err := os.Lstat(filepath.Join(m.directory, "data", fixtureSyncSocket))
	if err != nil || expected == nil || !os.SameFile(expected, info) || info.Mode() != expected.Mode() || info.Mode()&os.ModeSocket == 0 || info.Mode().Perm() != 0600 {
		return false
	}
	uid, err := ownerUID(info)
	return err == nil && uid == m.uid && m.rootUnchanged() == nil
}

func (m *Manager) syncRunUnchanged(running *child, generation uint64) bool {
	if m.closed || m.process != running || running.stopRequested || m.state.Stage != "running" || m.state.Generation != generation || m.state.RunID != running.runID {
		return false
	}
	select {
	case <-running.exited:
		return false
	default:
	}
	return m.runtimeUnchanged(running.capture) == nil
}

// RefreshSynchronization performs only bounded read-only requests to the fixed
// isolated Unix endpoint. Production has no injectable URL, PID or provider and
// remains NOT_SUPPLIED until the original ordinary-runtime contract is supplied.
// A successful result is a local child report, never consensus/finality or role
// authority. Status reads the short-lived result without doing network I/O.
func (m *Manager) RefreshSynchronization(ctx context.Context, peer localipc.Peer) (Synchronization, error) {
	if ctx == nil {
		return Synchronization{}, ErrSynchronization
	}
	if err := ctx.Err(); err != nil {
		return Synchronization{}, err
	}
	m.mu.Lock()
	if err := m.peerAllowed(peer); err != nil {
		m.mu.Unlock()
		return Synchronization{}, err
	}
	if m.closed {
		m.mu.Unlock()
		return Synchronization{}, ErrClosed
	}
	if m.syncNetwork == nil {
		m.mu.Unlock()
		return Synchronization{Code: "NOT_SUPPLIED"}, nil
	}
	running, generation := m.process, m.state.Generation
	if running == nil || !m.syncRunUnchanged(running, generation) {
		m.mu.Unlock()
		return Synchronization{Code: "NOT_RUNNING"}, ErrSynchronization
	}
	if running.syncBusy {
		m.mu.Unlock()
		return Synchronization{Code: "UNAVAILABLE"}, ErrSynchronization
	}
	if m.runtime != nil && m.runtime.manifest.Network != *m.syncNetwork {
		m.mu.Unlock()
		return Synchronization{Code: "UNAVAILABLE"}, ErrSynchronization
	}
	path := filepath.Join(m.directory, "data", fixtureSyncSocket)
	info, err := os.Lstat(path)
	if err != nil || !m.syncSocketUnchanged(info) {
		running.syncReadback = Synchronization{}
		m.mu.Unlock()
		return Synchronization{Code: "UNAVAILABLE"}, ErrSynchronization
	}
	running.syncBusy = true
	// Clear the previous sample before starting a new attempt. An unavailable or
	// cancelled refresh must not leave an older green observation behind.
	running.syncReadback = Synchronization{}
	network, uid, pid := *m.syncNetwork, m.uid, running.cmd.Process.Pid
	readContext, cancel := context.WithTimeout(ctx, 2*time.Second)
	stopRun := context.AfterFunc(running.readContext, cancel)
	m.mu.Unlock()
	defer cancel()
	defer stopRun()
	transport := &http.Transport{
		DisableKeepAlives: true, DisableCompression: true, MaxResponseHeaderBytes: 8192,
		MaxConnsPerHost: 1,
		DialContext: func(callCtx context.Context, _, _ string) (net.Conn, error) {
			m.mu.Lock()
			valid := m.syncRunUnchanged(running, generation) && m.syncSocketUnchanged(info)
			m.mu.Unlock()
			if !valid {
				return nil, ErrSynchronization
			}
			connection, err := (&net.Dialer{}).DialContext(callCtx, "unix", path)
			if err != nil {
				return nil, err
			}
			unixConn, ok := connection.(*net.UnixConn)
			if !ok || verifySynchronizationPeer(unixConn, uid, pid) != nil {
				_ = connection.Close()
				return nil, ErrSynchronization
			}
			m.mu.Lock()
			valid = m.syncRunUnchanged(running, generation) && m.syncSocketUnchanged(info)
			m.mu.Unlock()
			if !valid {
				_ = connection.Close()
				return nil, ErrSynchronization
			}
			return connection, nil
		},
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	sample, readErr := readCometSynchronization(readContext, client, network)
	m.mu.Lock()
	defer m.mu.Unlock()
	running.syncBusy = false
	if readErr != nil || !m.syncRunUnchanged(running, generation) || !m.syncSocketUnchanged(info) || readContext.Err() != nil {
		running.syncReadback = Synchronization{}
		if readErr != nil {
			return Synchronization{Code: "UNAVAILABLE"}, errors.Join(ErrSynchronization, readErr)
		}
		if readContext.Err() != nil {
			return Synchronization{Code: "UNAVAILABLE"}, readContext.Err()
		}
		return Synchronization{Code: "UNAVAILABLE"}, ErrSynchronization
	}
	now := time.Now()
	updated, expires := now.UTC(), now.Add(synchronizationTTL).UTC()
	updatedText, expiresText, runID, gen := updated.Format(time.RFC3339Nano), expires.Format(time.RFC3339Nano), running.runID, strconv.FormatUint(generation, 10)
	source := "owned-process-unix-comet"
	sample.Code, sample.Source, sample.UpdatedAt, sample.ExpiresAt, sample.RunID, sample.Generation = "ISOLATED_PROCESS_REPORTED", &source, &updatedText, &expiresText, &runID, &gen
	sample.IsolatedFixture = true
	running.syncReadback, running.syncSocket = cloneSynchronization(sample), info
	running.syncExpires = now.Add(synchronizationTTL)
	return cloneSynchronization(sample), nil
}

func syncRPC(ctx context.Context, client *http.Client, path string) (json.RawMessage, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://owned-node"+path, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Content-Encoding") != "" {
		return nil, ErrSynchronization
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, (32<<10)+1))
	if err != nil || len(raw) == 0 || len(raw) > 32<<10 || uniqueSynchronizationJSON(raw) != nil {
		return nil, ErrSynchronization
	}
	var envelope struct {
		Version string          `json:"jsonrpc"`
		Result  json.RawMessage `json:"result"`
		Error   json.RawMessage `json:"error"`
	}
	if json.Unmarshal(raw, &envelope) != nil || envelope.Version != "2.0" || len(envelope.Result) == 0 || bytes.Equal(envelope.Result, []byte("null")) || len(envelope.Error) != 0 && !bytes.Equal(envelope.Error, []byte("null")) {
		return nil, ErrSynchronization
	}
	return envelope.Result, nil
}

func readCometSynchronization(ctx context.Context, client *http.Client, expected RuntimeNetwork) (Synchronization, error) {
	var sample Synchronization
	statusRaw, err := syncRPC(ctx, client, "/status")
	if err != nil {
		return sample, err
	}
	var status struct {
		NodeInfo struct {
			Network string `json:"network"`
		} `json:"node_info"`
		SyncInfo struct {
			Height     string `json:"latest_block_height"`
			CatchingUp *bool  `json:"catching_up"`
		} `json:"sync_info"`
	}
	if json.Unmarshal(statusRaw, &status) != nil || status.NodeInfo.Network != expected.CometChainID || status.SyncInfo.CatchingUp == nil {
		return sample, ErrSynchronization
	}
	height, err := strconv.ParseInt(status.SyncInfo.Height, 10, 64)
	if err != nil || height <= 0 || strconv.FormatInt(height, 10) != status.SyncInfo.Height {
		return sample, ErrSynchronization
	}
	identityRaw, err := syncRPC(ctx, client, "/abci_query?"+url.Values{"path": {strconv.Quote(consensus.PQWalletIdentityPath)}}.Encode())
	if err != nil {
		return sample, err
	}
	var result struct {
		Response struct {
			Code   uint32 `json:"code"`
			Height string `json:"height"`
			Value  string `json:"value"`
		} `json:"response"`
	}
	if json.Unmarshal(identityRaw, &result) != nil || result.Response.Code != 0 {
		return sample, ErrSynchronization
	}
	queryHeight, err := strconv.ParseInt(result.Response.Height, 10, 64)
	if err != nil || strconv.FormatInt(queryHeight, 10) != result.Response.Height {
		return sample, ErrSynchronization
	}
	payload, err := base64.StdEncoding.DecodeString(result.Response.Value)
	if err != nil || len(payload) == 0 || len(payload) > consensus.MaxPQWalletIdentityBytes || base64.StdEncoding.EncodeToString(payload) != result.Response.Value || uniqueSynchronizationJSON(payload) != nil {
		return sample, ErrSynchronization
	}
	var identity consensus.PQWalletIdentityView
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&identity) != nil || consensus.ValidatePQWalletIdentityView(identity, queryHeight) != nil || strconv.FormatInt(identity.NativeChainID, 10) != expected.NativeChainID || identity.NativeGenesisHash != expected.NativeGenesisSHA256 || identity.CometChainID != expected.CometChainID || identity.CometGenesisSHA256 != expected.CometGenesisSHA256 {
		return sample, ErrSynchronization
	}
	sample.LocalHeight, sample.CatchingUp = &status.SyncInfo.Height, status.SyncInfo.CatchingUp
	sample.NetworkIdentity = &SyncNetworkIdentity{expected.NativeChainID, identity.NativeGenesisHash, identity.CometChainID, identity.CometGenesisSHA256}
	// Original Status has no target height; original PQ identity has no
	// networkId32. Neither is derived, invented or promoted to authority here.
	return sample, nil
}

func uniqueSynchronizationJSON(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value func(int) error
	value = func(depth int) error {
		if depth > 32 {
			return ErrSynchronization
		}
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delim, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := make(map[string]bool)
			for decoder.More() {
				key, err := decoder.Token()
				if err != nil {
					return err
				}
				name, ok := key.(string)
				if !ok || seen[name] {
					return ErrSynchronization
				}
				seen[name] = true
				if err = value(depth + 1); err != nil {
					return err
				}
			}
		case '[':
			for decoder.More() {
				if err := value(depth + 1); err != nil {
					return err
				}
			}
		default:
			return ErrSynchronization
		}
		_, err = decoder.Token()
		return err
	}
	if err := value(0); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return ErrSynchronization
	}
	return nil
}
