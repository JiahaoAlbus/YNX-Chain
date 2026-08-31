package datafabricnats

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go/jetstream"
)

func TestJetStreamThreeReplicaLeaderLossRetainsOutboxAndRecovers(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	cluster := startJetStreamCluster(t, 3)
	defer cluster.shutdown()
	broker, err := Connect(ctx, Config{
		URL: strings.Join(cluster.clientURLs(), ","), MaxBytes: 32 << 20,
		Replicas: 3, PublishTimeout: 2 * time.Second, ConnectTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer broker.Close()

	const eventCount = 128
	const firstBatch = eventCount / 2
	store, err := datafabric.OpenStore(filepath.Join(t.TempDir(), "fabric.json"))
	if err != nil {
		t.Fatal(err)
	}
	baseTime := time.Now().UTC().Truncate(time.Millisecond)
	for index := 0; index < eventCount; index++ {
		if err := store.Append(backpressureEvent(t, index+1000, baseTime), integrationKey); err != nil {
			t.Fatalf("append clustered event %d: %v", index, err)
		}
	}
	dispatcher := datafabric.Dispatcher{
		Store: store, Publisher: broker, BatchSize: firstBatch, MaxAttempts: 8,
		Now: func() time.Time { return baseTime.Add(time.Minute) },
	}
	initialReport, err := dispatcher.DispatchOnce(ctx)
	if err != nil || initialReport.Published != firstBatch || initialReport.Failed != 0 {
		t.Fatalf("initial replicated dispatch failed: report=%+v err=%v", initialReport, err)
	}
	initialInfo := waitForReplicatedStream(t, ctx, broker, firstBatch, 3, "")
	initialLeader := initialInfo.Cluster.Leader
	leader := cluster.byName(initialLeader)
	if leader == nil {
		t.Fatalf("stream leader %q did not match a cluster member", initialLeader)
	}

	leaderOptions := restartOptions(leader, cluster.seedRouteExcluding(leader))
	leaderLossStarted := time.Now()
	leader.Shutdown()
	leader.WaitForShutdown()

	postLossInfo := waitForReplicatedStream(t, ctx, broker, firstBatch, 3, initialLeader)
	failoverRTO := time.Since(leaderLossStarted)
	if postLossInfo.Cluster.Leader == initialLeader {
		t.Fatalf("stream leader did not change after %s stopped", initialLeader)
	}

	dispatcher.Now = func() time.Time { return baseTime.Add(10 * time.Minute) }
	postLossReport, err := dispatcher.DispatchOnce(ctx)
	if err != nil || postLossReport.Published != eventCount-firstBatch || postLossReport.Failed != 0 {
		t.Fatalf("replicated dispatch after leader loss failed: report=%+v err=%v", postLossReport, err)
	}
	postPublishInfo := waitForReplicatedStream(t, ctx, broker, eventCount, 3, initialLeader)

	restartStarted := time.Now()
	restarted := startClusteredServer(t, leaderOptions)
	cluster.replace(initialLeader, restarted)
	finalInfo := waitForReplicatedStreamCurrent(t, ctx, broker, eventCount, 3)
	replicaCatchupRTO := time.Since(restartStarted)
	if pending := store.PendingOutbox(baseTime.Add(time.Hour), eventCount); len(pending) != 0 {
		t.Fatalf("Outbox remained pending after replicated leader recovery: %d", len(pending))
	}
	if finalInfo.State.Msgs != eventCount || postPublishInfo.State.Msgs != eventCount {
		t.Fatalf("replicated stream lost events: postLoss=%d final=%d", postPublishInfo.State.Msgs, finalInfo.State.Msgs)
	}

	evidence, err := json.Marshal(map[string]any{
		"sourceCommit": os.Getenv("YNX_DATA_FABRIC_TEST_SOURCE_COMMIT"),
		"broker":       "three-node file-backed JetStream cluster",
		"clusterNodes": 3, "streamReplicas": finalInfo.Config.Replicas,
		"canonicalEvents": eventCount, "publishedBeforeLeaderLoss": initialReport.Published,
		"leaderBefore": initialLeader, "leaderAfter": postLossInfo.Cluster.Leader,
		"streamLeaderChanged":           postLossInfo.Cluster.Leader != initialLeader,
		"leaderFailoverRTOMilliseconds": durationMilliseconds(failoverRTO),
		"publishedAfterLeaderLoss":      postLossReport.Published,
		"finalOutboxPending":            0, "finalStreamMessages": finalInfo.State.Msgs,
		"duplicateStreamMessages":                uint64(eventCount) - finalInfo.State.Msgs,
		"currentReplicaCount":                    currentReplicaCount(finalInfo),
		"restartedReplicaCatchupRTOMilliseconds": durationMilliseconds(replicaCatchupRTO),
		"limitations": []string{
			"three embedded NATS processes on one CI host and loopback network",
			"one bounded 128-event batch split around one stream-leader stop",
			"no network partition, simultaneous quorum loss, cross-zone latency, sustained load, shared Testnet, or public availability claim",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("jetStreamClusterLeaderLossEvidence=%s", evidence)
}

type testJetStreamCluster struct {
	servers []*server.Server
	network *routeProxyNetwork
}

func startJetStreamCluster(t *testing.T, count int) *testJetStreamCluster {
	t.Helper()
	cluster := &testJetStreamCluster{}
	clusterPorts := make([]int, count)
	for index := range clusterPorts {
		clusterPorts[index] = freeTCPPort()
	}
	for index := 0; index < count; index++ {
		name := fmt.Sprintf("DF-JS-%d", index+1)
		routes := make([]*url.URL, 0, count-1)
		for peerIndex, port := range clusterPorts {
			if peerIndex != index {
				routes = append(routes, routeURLForPort(port))
			}
		}
		cluster.servers = append(cluster.servers, startClusteredServer(t, clusteredServerOptions(t.TempDir(), name, clusterPorts[index], routes)))
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		for _, candidate := range cluster.servers {
			if candidate.JetStreamIsLeader() && len(candidate.JetStreamClusterPeers()) == count {
				return cluster
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	cluster.shutdown()
	t.Fatal("three-node JetStream cluster did not elect a metadata leader with all peers")
	return nil
}

func startClusteredServer(t *testing.T, options *server.Options) *server.Server {
	t.Helper()
	candidate, err := server.NewServer(options)
	if err != nil {
		t.Fatal(err)
	}
	if !options.NoLog {
		candidate.ConfigureLogger()
	}
	candidate.Start()
	if !candidate.ReadyForConnections(5 * time.Second) {
		candidate.Shutdown()
		t.Fatalf("embedded clustered NATS server %s did not become ready", options.ServerName)
	}
	return candidate
}

func clusteredServerOptions(storeDir, name string, clusterPort int, routes []*url.URL) *server.Options {
	return &server.Options{
		ServerName: name, Host: "127.0.0.1", Port: -1, NoLog: true, NoSigs: true,
		JetStream: true, StoreDir: storeDir, SyncAlways: true,
		Cluster: server.ClusterOpts{Name: "YNX-DATA-FABRIC-TEST", Host: "127.0.0.1", Port: clusterPort},
		Routes:  routes,
	}
}

func freeTCPPort() int {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	return port
}

func restartOptions(stopped *server.Server, routes []*url.URL) *server.Options {
	return &server.Options{
		ServerName: stopped.Name(), Host: "127.0.0.1", Port: stopped.Addr().(*net.TCPAddr).Port,
		NoLog: true, NoSigs: true, JetStream: true, StoreDir: stopped.JetStreamConfig().StoreDir, SyncAlways: true,
		Cluster: server.ClusterOpts{Name: "YNX-DATA-FABRIC-TEST", Host: "127.0.0.1", Port: stopped.ClusterAddr().Port},
		Routes:  routes,
	}
}

func routeURL(candidate *server.Server) *url.URL {
	return routeURLForPort(candidate.ClusterAddr().Port)
}

func routeURLForPort(port int) *url.URL {
	parsed, _ := url.Parse(fmt.Sprintf("nats-route://127.0.0.1:%d", port))
	return parsed
}

func (c *testJetStreamCluster) clientURLs() []string {
	urls := make([]string, 0, len(c.servers))
	for _, candidate := range c.servers {
		urls = append(urls, candidate.ClientURL())
	}
	return urls
}

func (c *testJetStreamCluster) clientURLsExcluding(excluded *server.Server) []string {
	urls := make([]string, 0, len(c.servers)-1)
	for _, candidate := range c.servers {
		if candidate != excluded {
			urls = append(urls, candidate.ClientURL())
		}
	}
	return urls
}

func (c *testJetStreamCluster) byName(name string) *server.Server {
	for _, candidate := range c.servers {
		if candidate.Name() == name {
			return candidate
		}
	}
	return nil
}

func (c *testJetStreamCluster) seedRouteExcluding(excluded *server.Server) []*url.URL {
	for _, candidate := range c.servers {
		if candidate != excluded && candidate.Running() {
			return []*url.URL{routeURL(candidate)}
		}
	}
	return nil
}

func (c *testJetStreamCluster) replace(name string, replacement *server.Server) {
	for index, candidate := range c.servers {
		if candidate.Name() == name {
			c.servers[index] = replacement
			return
		}
	}
}

func (c *testJetStreamCluster) shutdown() {
	for _, candidate := range c.servers {
		if candidate != nil {
			candidate.Shutdown()
		}
	}
	if c.network != nil {
		c.network.close()
	}
}

func waitForReplicatedStream(t *testing.T, ctx context.Context, broker *Broker, messages uint64, replicas int, previousLeader string) *jetstream.StreamInfo {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	var lastInfo *jetstream.StreamInfo
	var lastErr error
	for time.Now().Before(deadline) {
		queryCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
		info, err := broker.StreamInfo(queryCtx)
		cancel()
		lastInfo, lastErr = info, err
		if err == nil && info.Cluster != nil && info.Cluster.Leader != "" && info.Cluster.Leader != previousLeader && info.Config.Replicas == replicas && info.State.Msgs == messages {
			return info
		}
		time.Sleep(25 * time.Millisecond)
	}
	if lastInfo != nil {
		t.Fatalf("replicated stream did not reach messages=%d replicas=%d after leader=%q: last leader=%q replicas=%d messages=%d current=%d err=%v", messages, replicas, previousLeader, lastInfo.Cluster.Leader, lastInfo.Config.Replicas, lastInfo.State.Msgs, currentReplicaCount(lastInfo), lastErr)
	}
	t.Fatalf("replicated stream did not reach messages=%d replicas=%d after leader=%q: last error=%v", messages, replicas, previousLeader, lastErr)
	return nil
}

func waitForReplicatedStreamCurrent(t *testing.T, ctx context.Context, broker *Broker, messages uint64, replicas int) *jetstream.StreamInfo {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	var lastInfo *jetstream.StreamInfo
	var lastErr error
	for time.Now().Before(deadline) {
		queryCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
		info, err := broker.StreamInfo(queryCtx)
		cancel()
		lastInfo, lastErr = info, err
		if err == nil && info.Cluster != nil && info.Config.Replicas == replicas && info.State.Msgs == messages && currentReplicaCount(info) == replicas {
			return info
		}
		time.Sleep(25 * time.Millisecond)
	}
	if lastInfo != nil {
		t.Fatalf("replicated stream did not return to %d current replicas at %d messages: last leader=%q replicas=%d messages=%d current=%d err=%v", replicas, messages, lastInfo.Cluster.Leader, lastInfo.Config.Replicas, lastInfo.State.Msgs, currentReplicaCount(lastInfo), lastErr)
	}
	t.Fatalf("replicated stream did not return to %d current replicas at %d messages: last error=%v", replicas, messages, lastErr)
	return nil
}

func currentReplicaCount(info *jetstream.StreamInfo) int {
	if info == nil || info.Cluster == nil || info.Cluster.Leader == "" {
		return 0
	}
	current := 1
	for _, replica := range info.Cluster.Replicas {
		if replica != nil && replica.Current && !replica.Offline {
			current++
		}
	}
	return current
}
