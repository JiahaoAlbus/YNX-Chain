package datafabricnats

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/nats-io/nats-server/v2/server"
)

func TestJetStreamThreeReplicaRoutePartitionRetainsOutboxAndRecovers(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	cluster := startPartitionableJetStreamCluster(t, 3)
	defer cluster.shutdown()
	brokerConfig := Config{
		URL: strings.Join(cluster.clientURLs(), ","), MaxBytes: 32 << 20,
		Replicas: 3, PublishTimeout: 2 * time.Second, ConnectTimeout: 2 * time.Second,
	}
	broker, err := Connect(ctx, brokerConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer broker.Close()

	const (
		eventCount = 192
		batchSize  = 64
	)
	store, err := datafabric.OpenStore(filepath.Join(t.TempDir(), "fabric.json"))
	if err != nil {
		t.Fatal(err)
	}
	baseTime := time.Now().UTC().Truncate(time.Millisecond)
	for index := 0; index < eventCount; index++ {
		if err := store.Append(backpressureEvent(t, index+2000, baseTime), integrationKey); err != nil {
			t.Fatalf("append partition event %d: %v", index, err)
		}
	}
	dispatcher := datafabric.Dispatcher{
		Store: store, Publisher: broker, BatchSize: batchSize, MaxAttempts: 8,
		Now: func() time.Time { return baseTime.Add(time.Minute) },
	}
	initialReport, err := dispatcher.DispatchOnce(ctx)
	if err != nil || initialReport.Published != batchSize || initialReport.Failed != 0 {
		t.Fatalf("initial replicated dispatch failed: report=%+v err=%v", initialReport, err)
	}
	initialInfo := waitForReplicatedStreamCurrent(t, ctx, broker, batchSize, 3)
	initialLeader := initialInfo.Cluster.Leader
	leader := cluster.byName(initialLeader)
	if leader == nil {
		t.Fatalf("stream leader %q did not match a cluster member", initialLeader)
	}
	survivorURLs := cluster.clientURLsExcluding(leader)
	survivorBroker, err := Connect(ctx, Config{
		URL: survivorURLs[0], MaxBytes: 32 << 20,
		Replicas: 3, PublishTimeout: 2 * time.Second, ConnectTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer survivorBroker.Close()
	isolatedBroker, err := Connect(ctx, Config{
		URL: leader.ClientURL(), MaxBytes: 32 << 20, Replicas: 3,
		PublishTimeout: 750 * time.Millisecond, ConnectTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer isolatedBroker.Close()

	partitionStarted := time.Now()
	cluster.network.isolate(leader.ID())
	waitForRoutePartition(t, cluster, leader)
	isolatedServerRouteCount := leader.NumRoutes()
	if !leader.Running() {
		t.Fatalf("isolated NATS process %q stopped during route partition", initialLeader)
	}

	dispatcher.Publisher = isolatedBroker
	dispatcher.BatchSize = 1
	dispatcher.Now = func() time.Time { return baseTime.Add(10 * time.Minute) }
	rejectedReport, err := dispatcher.DispatchOnce(ctx)
	if err != nil {
		t.Fatalf("isolated dispatch returned a store error: %v", err)
	}
	if rejectedReport.Published != 0 || rejectedReport.Failed != 1 || rejectedReport.DeadLetter != 0 {
		t.Fatalf("isolated leader did not fail closed: report=%+v", rejectedReport)
	}
	pendingDuringPartition := len(store.PendingOutbox(baseTime.Add(time.Hour), eventCount))
	if pendingDuringPartition != eventCount-batchSize {
		t.Fatalf("failed publication did not remain in Outbox: pending=%d", pendingDuringPartition)
	}

	postPartitionInfo := waitForReplicatedStream(t, ctx, survivorBroker, batchSize, 3, initialLeader)
	partitionFailoverRTO := time.Since(partitionStarted)

	dispatcher.Publisher = survivorBroker
	dispatcher.BatchSize = batchSize
	dispatcher.Now = func() time.Time { return baseTime.Add(20 * time.Minute) }
	partitionReport, err := dispatcher.DispatchOnce(ctx)
	if err != nil || partitionReport.Published != batchSize || partitionReport.Failed != 0 {
		t.Fatalf("survivor dispatch during partition failed: report=%+v err=%v", partitionReport, err)
	}
	duringPartitionInfo := waitForReplicatedStream(t, ctx, survivorBroker, 2*batchSize, 3, initialLeader)
	duringPartitionCurrentReplicas := currentReplicaCount(duringPartitionInfo)
	if duringPartitionCurrentReplicas != 2 {
		t.Fatalf("partitioned stream unexpectedly had %d current replicas", duringPartitionCurrentReplicas)
	}

	healStarted := time.Now()
	cluster.network.heal(leader.ID())
	waitForFullRouteMesh(t, cluster)
	waitForReplicatedStreamCurrent(t, ctx, survivorBroker, 2*batchSize, 3)
	partitionHealRTO := time.Since(healStarted)

	dispatcher.Publisher = broker
	dispatcher.BatchSize = batchSize
	dispatcher.Now = func() time.Time { return baseTime.Add(30 * time.Minute) }
	finalReport, err := dispatcher.DispatchOnce(ctx)
	if err != nil || finalReport.Published != batchSize || finalReport.Failed != 0 {
		t.Fatalf("dispatch after partition recovery failed: report=%+v err=%v", finalReport, err)
	}
	finalInfo := waitForReplicatedStreamCurrent(t, ctx, broker, eventCount, 3)
	if pending := store.PendingOutbox(baseTime.Add(time.Hour), eventCount); len(pending) != 0 {
		t.Fatalf("Outbox remained pending after partition recovery: %d", len(pending))
	}
	for _, candidate := range cluster.servers {
		if !candidate.Running() {
			t.Fatalf("NATS process %q was not running after partition recovery", candidate.Name())
		}
	}

	evidence, err := json.Marshal(map[string]any{
		"sourceCommit":   os.Getenv("YNX_DATA_FABRIC_TEST_SOURCE_COMMIT"),
		"broker":         "three-node file-backed JetStream cluster",
		"faultMechanism": "bidirectional TCP route isolation at advertised per-node proxies",
		"clusterNodes":   3, "streamReplicas": finalInfo.Config.Replicas,
		"canonicalEvents": eventCount, "publishedBeforePartition": initialReport.Published,
		"partitionedLeader": initialLeader, "leaderAfterPartition": postPartitionInfo.Cluster.Leader,
		"streamLeaderChanged":       postPartitionInfo.Cluster.Leader != initialLeader,
		"allServerProcessesRunning": true, "isolatedServerRouteCount": isolatedServerRouteCount,
		"rejectedOnIsolatedServer":           rejectedReport.Failed,
		"outboxPendingDuringPartition":       pendingDuringPartition,
		"partitionFailoverRTOMilliseconds":   durationMilliseconds(partitionFailoverRTO),
		"publishedDuringPartition":           partitionReport.Published,
		"streamMessagesDuringPartition":      duringPartitionInfo.State.Msgs,
		"currentReplicaCountDuringPartition": duringPartitionCurrentReplicas,
		"partitionHealRTOMilliseconds":       durationMilliseconds(partitionHealRTO),
		"publishedAfterHeal":                 finalReport.Published,
		"finalOutboxPending":                 0, "finalStreamMessages": finalInfo.State.Msgs,
		"duplicateStreamMessages": uint64(eventCount) - finalInfo.State.Msgs,
		"currentReplicaCount":     currentReplicaCount(finalInfo),
		"limitations": []string{
			"three embedded NATS processes and user-space TCP proxies on one CI host and loopback network",
			"one bounded 192-event batch split before, during, and after one stream-leader route partition",
			"no packet loss matrix, simultaneous quorum loss, cross-zone latency, sustained load, shared Testnet, or public availability claim",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("jetStreamClusterPartitionEvidence=%s", evidence)
}

type routeProxyNetwork struct {
	mu       sync.Mutex
	proxies  []*routeProxy
	nodeIDs  []string
	isolated map[string]bool
	conns    map[*routeProxyConn]struct{}
}

type routeProxy struct {
	network     *routeProxyNetwork
	targetIndex int
	backend     string
	listener    net.Listener
}

type routeProxyConn struct {
	proxy    *routeProxy
	client   net.Conn
	backend  net.Conn
	sourceID string
}

func startPartitionableJetStreamCluster(t *testing.T, count int) *testJetStreamCluster {
	t.Helper()
	clusterPorts := make([]int, count)
	for index := range clusterPorts {
		clusterPorts[index] = freeTCPPort()
	}
	network := newRouteProxyNetwork(t, clusterPorts)
	cluster := &testJetStreamCluster{network: network}
	for index := 0; index < count; index++ {
		name := fmt.Sprintf("DF-JS-PARTITION-%d", index+1)
		routes := make([]*url.URL, 0, count-1)
		for peerIndex := range clusterPorts {
			if peerIndex != index {
				routes = append(routes, routeURLForAddress(network.proxies[peerIndex].listener.Addr().String()))
			}
		}
		options := clusteredServerOptions(t.TempDir(), name, clusterPorts[index], routes)
		options.Cluster.Advertise = network.proxies[index].listener.Addr().String()
		options.Cluster.PoolSize = -1
		candidate := startClusteredServer(t, options)
		cluster.servers = append(cluster.servers, candidate)
		network.setNodeID(index, candidate.ID())
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		for _, candidate := range cluster.servers {
			if candidate.JetStreamIsLeader() && len(candidate.JetStreamClusterPeers()) == count {
				waitForFullRouteMesh(t, cluster)
				return cluster
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	cluster.shutdown()
	t.Fatal("partitionable JetStream cluster did not elect a metadata leader with all peers")
	return nil
}

func newRouteProxyNetwork(t *testing.T, backendPorts []int) *routeProxyNetwork {
	t.Helper()
	network := &routeProxyNetwork{
		nodeIDs: make([]string, len(backendPorts)), isolated: make(map[string]bool),
		conns: make(map[*routeProxyConn]struct{}),
	}
	for index, port := range backendPorts {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			network.close()
			t.Fatal(err)
		}
		proxy := &routeProxy{
			network: network, targetIndex: index,
			backend: net.JoinHostPort("127.0.0.1", fmt.Sprintf("%d", port)), listener: listener,
		}
		network.proxies = append(network.proxies, proxy)
		go proxy.accept()
	}
	return network
}

func (p *routeProxy) accept() {
	for {
		client, err := p.listener.Accept()
		if err != nil {
			return
		}
		go p.forward(client)
	}
}

func (p *routeProxy) forward(client net.Conn) {
	backend, err := net.DialTimeout("tcp", p.backend, time.Second)
	if err != nil {
		_ = client.Close()
		return
	}
	connection := &routeProxyConn{proxy: p, client: client, backend: backend}
	p.network.add(connection)
	defer func() {
		p.network.remove(connection)
		_ = client.Close()
		_ = backend.Close()
	}()

	done := make(chan struct{})
	go func() {
		_, _ = io.Copy(client, backend)
		close(done)
	}()
	reader := bufio.NewReader(client)
	for {
		line, readErr := reader.ReadBytes('\n')
		if len(line) > 0 {
			if _, err = backend.Write(line); err != nil {
				return
			}
			if strings.HasPrefix(string(line), "CONNECT ") {
				var handshake struct {
					Name string `json:"name"`
				}
				payload := strings.TrimSpace(strings.TrimPrefix(string(line), "CONNECT "))
				if json.Unmarshal([]byte(payload), &handshake) == nil {
					p.network.setSource(connection, handshake.Name)
				}
				break
			}
		}
		if readErr != nil {
			return
		}
	}
	go func() {
		_, _ = io.Copy(backend, reader)
		_ = backend.Close()
	}()
	<-done
}

func (n *routeProxyNetwork) setNodeID(index int, id string) {
	n.mu.Lock()
	n.nodeIDs[index] = id
	n.mu.Unlock()
}

func (n *routeProxyNetwork) add(connection *routeProxyConn) {
	n.mu.Lock()
	n.conns[connection] = struct{}{}
	targetID := n.nodeIDs[connection.proxy.targetIndex]
	blocked := n.isolated[targetID]
	n.mu.Unlock()
	if blocked {
		_ = connection.client.Close()
		_ = connection.backend.Close()
	}
}

func (n *routeProxyNetwork) setSource(connection *routeProxyConn, sourceID string) {
	n.mu.Lock()
	connection.sourceID = sourceID
	targetID := n.nodeIDs[connection.proxy.targetIndex]
	blocked := n.isolated[sourceID] || n.isolated[targetID]
	n.mu.Unlock()
	if blocked {
		_ = connection.client.Close()
		_ = connection.backend.Close()
	}
}

func (n *routeProxyNetwork) remove(connection *routeProxyConn) {
	n.mu.Lock()
	delete(n.conns, connection)
	n.mu.Unlock()
}

func (n *routeProxyNetwork) isolate(nodeID string) {
	n.mu.Lock()
	n.isolated[nodeID] = true
	connections := make([]*routeProxyConn, 0, len(n.conns))
	for connection := range n.conns {
		targetID := n.nodeIDs[connection.proxy.targetIndex]
		if connection.sourceID == nodeID || targetID == nodeID {
			connections = append(connections, connection)
		}
	}
	n.mu.Unlock()
	for _, connection := range connections {
		_ = connection.client.Close()
		_ = connection.backend.Close()
	}
}

func (n *routeProxyNetwork) heal(nodeID string) {
	n.mu.Lock()
	delete(n.isolated, nodeID)
	n.mu.Unlock()
}

func (n *routeProxyNetwork) close() {
	if n == nil {
		return
	}
	n.mu.Lock()
	proxies := append([]*routeProxy(nil), n.proxies...)
	connections := make([]*routeProxyConn, 0, len(n.conns))
	for connection := range n.conns {
		connections = append(connections, connection)
	}
	n.mu.Unlock()
	for _, proxy := range proxies {
		_ = proxy.listener.Close()
	}
	for _, connection := range connections {
		_ = connection.client.Close()
		_ = connection.backend.Close()
	}
}

func routeURLForAddress(address string) *url.URL {
	parsed, _ := url.Parse("nats-route://" + address)
	return parsed
}

func waitForRoutePartition(t *testing.T, cluster *testJetStreamCluster, isolated *server.Server) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		survivorsConnected := true
		for _, candidate := range cluster.servers {
			if candidate != isolated && candidate.NumRoutes() == 0 {
				survivorsConnected = false
			}
		}
		if isolated.NumRoutes() == 0 && survivorsConnected {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("route partition did not isolate %s: isolatedRoutes=%d", isolated.Name(), isolated.NumRoutes())
}

func waitForFullRouteMesh(t *testing.T, cluster *testJetStreamCluster) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		full := true
		for _, candidate := range cluster.servers {
			if candidate.NumRoutes() < len(cluster.servers)-1 {
				full = false
				break
			}
		}
		if full {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	routes := make(map[string]int, len(cluster.servers))
	for _, candidate := range cluster.servers {
		routes[candidate.Name()] = candidate.NumRoutes()
	}
	t.Fatalf("route mesh did not converge: %v", routes)
}
