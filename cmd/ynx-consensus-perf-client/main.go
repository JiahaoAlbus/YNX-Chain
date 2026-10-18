// ynx-consensus-perf-client measures a bounded, local-only signed transaction run.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cometed25519 "github.com/cometbft/cometbft/crypto/ed25519"
	rpchttp "github.com/cometbft/cometbft/rpc/client/http"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

const maxTransactions = consensus.EphemeralWorkloadMaxTransactions

type options struct {
	manifest, transactions, output string
	concurrency                    int
	rounds                         int
	senderMode                     string
	inclusionMode                  string
	observers                      int
	offeredRate                    float64
	timeout, poll                  time.Duration
	terminalStream                 bool
	terminalSink                   func(transactionResult) error
	reuseResultSlots               bool
	segmentedIntents               bool
	streamingWorkload              bool
	evidenceByteBudget             int64
	evidenceBudget                 *readyEvidenceBudgetReport
	intentPersistence              func(string, []byte) error
}

type transactionInput struct {
	Transactions []string `json:"transactions"`
}

type errorObservation struct {
	Stage   string    `json:"stage"`
	Message string    `json:"message"`
	Count   int       `json:"count"`
	FirstAt time.Time `json:"firstAt"`
	LastAt  time.Time `json:"lastAt"`
}

type transactionResult struct {
	offerMonotonic               time.Time
	submitMonotonic              time.Time
	Index                        int                `json:"index"`
	Round                        int                `json:"round,omitempty"`
	SignedTransaction            string             `json:"signedTransaction,omitempty"`
	Hash                         string             `json:"hash"`
	Endpoint                     string             `json:"endpoint"`
	Bytes                        int                `json:"bytes"`
	Status                       string             `json:"status"`
	SubmittedAt                  *time.Time         `json:"submittedAt,omitempty"`
	ScheduledAt                  *time.Time         `json:"scheduledAt,omitempty"`
	OfferedAt                    *time.Time         `json:"offeredAt,omitempty"`
	QueueDelayMs                 *float64           `json:"queueDelayMs,omitempty"`
	CheckTxObservedAt            *time.Time         `json:"checkTxObservedAt,omitempty"`
	IncludedObservedAt           *time.Time         `json:"includedObservedAt,omitempty"`
	ConfirmedObservedAt          *time.Time         `json:"confirmedObservedAt,omitempty"`
	CheckTxMs                    *float64           `json:"checkTxMs,omitempty"`
	InclusionMs                  *float64           `json:"inclusionMs,omitempty"`
	ConfirmationMs               *float64           `json:"confirmationMs,omitempty"`
	CheckTxCode                  *uint32            `json:"checkTxCode,omitempty"`
	CheckTxIdentityVerified      bool               `json:"checkTxIdentityVerified"`
	ExecutionCode                *uint32            `json:"executionCode,omitempty"`
	CheckTxLog                   string             `json:"checkTxLog,omitempty"`
	ExecutionLog                 string             `json:"executionLog,omitempty"`
	Height                       int64              `json:"height,omitempty"`
	BlockTxIndex                 uint32             `json:"blockTxIndex"`
	BlockTxTotal                 int64              `json:"blockTxTotal"`
	BlockTime                    *time.Time         `json:"blockTime,omitempty"`
	BlockHash                    string             `json:"blockHash,omitempty"`
	HeaderAppHash                string             `json:"headerAppHash,omitempty"`
	QuorumVerified               bool               `json:"quorumVerified"`
	TransactionProofVerified     bool               `json:"transactionProofVerified"`
	DurableStateVerified         bool               `json:"durableStateVerified"`
	DurableStateHeight           int64              `json:"durableStateHeight,omitempty"`
	DurableStateAppHash          string             `json:"durableStateAppHash,omitempty"`
	DurableSnapshotSHA256        string             `json:"durableSnapshotSha256,omitempty"`
	DurableSnapshotCacheHit      bool               `json:"durableSnapshotCacheHit"`
	DurableStoreSHA256           string             `json:"durableStoreSha256,omitempty"`
	DurableStoreFormat           string             `json:"durableStoreFormat,omitempty"`
	DurableJournalCompleteBytes  int                `json:"durableJournalCompleteBytes,omitempty"`
	DurableJournalIncompleteTail bool               `json:"durableJournalIncompleteTail"`
	DurableInfoVerified          bool               `json:"durableInfoVerified"`
	DurableInfoHeight            int64              `json:"durableInfoHeight,omitempty"`
	DurableInfoAppHash           string             `json:"durableInfoAppHash,omitempty"`
	Errors                       []errorObservation `json:"errors"`
}

type percentiles struct {
	Samples int      `json:"samples"`
	P50     *float64 `json:"p50"`
	P95     *float64 `json:"p95"`
	P99     *float64 `json:"p99"`
}

type summary struct {
	Input                      int             `json:"input"`
	Offered                    int             `json:"offered"`
	Submitted                  int             `json:"submitted"`
	CheckTxResponses           int             `json:"checkTxResponses"`
	CheckTxAccepted            int             `json:"checkTxAccepted"`
	CheckTxRejected            int             `json:"checkTxRejected"`
	CheckTxUnverified          int             `json:"checkTxUnverifiedResponses"`
	IncludedCodeZero           int             `json:"includedCodeZero"`
	EffectiveBusinessIncluded  int             `json:"effectiveBusinessIncluded"`
	ExecutionFailed            int             `json:"executionFailed"`
	QuorumConfirmed            int             `json:"quorumConfirmed"`
	FinalSubmitted             int             `json:"finalSubmitted"`
	SubmissionUnknown          int             `json:"submissionUnknown"`
	TimedOut                   int             `json:"timedOut"`
	ObservationFailed          int             `json:"observationFailed"`
	NotSubmitted               int             `json:"notSubmitted"`
	ErrorOccurrences           int             `json:"errorOccurrences"`
	MeasurementWindowSeconds   float64         `json:"measurementWindowSeconds"`
	SubmissionRate             float64         `json:"rpcSubmissionsPerMeasurementSecond"`
	AcceptanceRate             float64         `json:"checkTxAcceptedPerMeasurementSecond"`
	InclusionRate              float64         `json:"codeZeroIncludedPerMeasurementSecond"`
	EffectiveInclusionRate     float64         `json:"effectiveBusinessIncludedPerMeasurementSecond"`
	ConfirmationRate           float64         `json:"quorumConfirmedPerMeasurementSecond"`
	FinalSubmissionRate        float64         `json:"finalSubmittedPerMeasurementSecond"`
	OfferedEventSpanSeconds    float64         `json:"offeredEventSpanSeconds"`
	OfferedEventSpanRate       *float64        `json:"offeredInterarrivalRate"`
	SubmissionEventSpanSeconds float64         `json:"submissionEventSpanSeconds"`
	SubmissionEventSpanRate    *float64        `json:"submissionInterarrivalRate"`
	SteadyStateEffectiveTPS    *float64        `json:"steadyStateEffectiveTPS"`
	InclusionBlocks            blockStatistics `json:"validInclusionBlocks"`
	QueueDelay                 percentiles     `json:"submissionQueueDelayMs"`
	CheckTxLatency             percentiles     `json:"checkTxLatencyMs"`
	InclusionLatency           percentiles     `json:"inclusionLatencyMs"`
	EffectiveInclusionLatency  percentiles     `json:"effectiveBusinessInclusionLatencyMs"`
	ConfirmationLatency        percentiles     `json:"confirmationLatencyMs"`
}

type report struct {
	SchemaVersion        int                      `json:"schemaVersion"`
	RoundsRequested      int                      `json:"roundsRequested"`
	RoundsCompleted      int                      `json:"roundsCompleted"`
	Kind                 string                   `json:"kind"`
	ChainID              string                   `json:"chainId"`
	GenesisSHA256        string                   `json:"genesisSha256"`
	Endpoints            []string                 `json:"endpoints"`
	Concurrency          int                      `json:"concurrency"`
	OfferedRate          float64                  `json:"configuredOfferedRate"`
	ObserverConcurrency  int                      `json:"observerConcurrency"`
	LoadMode             string                   `json:"loadMode"`
	LoadQueues           pacedStatistics          `json:"loadQueues"`
	DurableReadback      durableReaderStats       `json:"durableReadback"`
	GroupedObservation   groupedObservationStats  `json:"groupedObservation"`
	SenderMode           string                   `json:"senderMode"`
	InclusionMode        string                   `json:"inclusionMode"`
	ReadySenders         readySenderStats         `json:"readySenders"`
	RetentionMode        string                   `json:"retentionMode,omitempty"`
	StreamingWorkload    *streamingWorkloadReport `json:"streamingWorkload,omitempty"`
	TerminalStream       *terminalStreamReport    `json:"terminalStream,omitempty"`
	TimeoutMs            int64                    `json:"timeoutMs"`
	PollMs               int64                    `json:"pollMs"`
	StartedAt            time.Time                `json:"startedAt"`
	MeasurementStartedAt *time.Time               `json:"measurementStartedAt,omitempty"`
	FinishedAt           time.Time                `json:"finishedAt"`
	GoVersion            string                   `json:"goVersion"`
	Platform             string                   `json:"platform"`
	GOMAXPROCS           int                      `json:"gomaxprocs"`
	Summary              summary                  `json:"summary"`
	Transactions         []transactionResult      `json:"transactions"`
	SetupErrors          []errorObservation       `json:"setupErrors"`
	Interpretation       []string                 `json:"interpretation"`
}

func main() {
	var o options
	flag.StringVar(&o.manifest, "manifest", "", "local ephemeral four-node network manifest")
	flag.StringVar(&o.transactions, "transactions", "", "JSON file containing transactions: [base64 raw signed transaction]")
	flag.StringVar(&o.output, "output", "", "optional new JSON output file; existing files are never overwritten")
	flag.IntVar(&o.concurrency, "concurrency", 2, "maximum concurrent submit-and-observe workers (1..4)")
	flag.IntVar(&o.observers, "observers", 4, "confirmation workers for paced mode (1..4)")
	flag.Float64Var(&o.offeredRate, "offered-rate", 0, fmt.Sprintf("paced offers per second (0=legacy closed loop; positive at most %d)", maxTransactions))
	flag.DurationVar(&o.timeout, "timeout", 20*time.Second, "overall setup/workload timeout (default mode <=30s; explicit streaming mode <=15m)")
	flag.DurationVar(&o.poll, "poll", 100*time.Millisecond, "transaction observation interval (50ms..1s)")
	flag.IntVar(&o.rounds, "rounds", 1, "retained fixture nonce cycles (default 1..32 and <=2048 transactions; explicit streaming scope has separate limits)")
	flag.StringVar(&o.senderMode, "sender-mode", "rounds", "sender scheduling: rounds or ready-pool (one in-flight nonce per account)")
	flag.StringVar(&o.inclusionMode, "inclusion-mode", "tx-query", "inclusion discovery: tx-query or block-scan (paced, four observers)")
	flag.BoolVar(&o.terminalStream, "terminal-stream", false, "retain segmented terminal evidence beside output (ready-pool only; existing run limits unchanged)")
	flag.BoolVar(&o.segmentedIntents, "segmented-intents", false, "durable signed-input segments; requires ready-pool, terminal-stream and slot reuse; finite caps unchanged")
	flag.BoolVar(&o.reuseResultSlots, "reuse-result-slots", false, "one result slot per sender with cumulative interval statistics; requires terminal-stream; finite caps unchanged")
	flag.BoolVar(&o.streamingWorkload, "streaming-workload", false, "explicit bounded streaming workload; requires slot retention, signed/terminal streams and an evidence budget")
	flag.Int64Var(&o.evidenceByteBudget, "evidence-byte-budget", 0, "positive combined encoded signed/terminal evidence bytes, streaming workload only (at most 2GiB; allocated-disk window remains separate)")
	flag.Parse()
	if flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "unexpected positional arguments")
		os.Exit(2)
	}
	if err := execute(o); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func validateOptions(o options) error {
	limits, err := workloadLimits(o)
	if err != nil {
		return err
	}
	if o.inclusionMode != "" && o.inclusionMode != "tx-query" && o.inclusionMode != "block-scan" {
		return errors.New("unsupported inclusion mode")
	}
	if o.inclusionMode == "block-scan" && (o.offeredRate <= 0 || o.observers != 4) {
		return errors.New("block-scan requires paced submission and four node-affine observers")
	}
	if o.senderMode != "" && o.senderMode != "rounds" && o.senderMode != "ready-pool" {
		return errors.New("unsupported sender mode")
	}
	if o.senderMode == "ready-pool" && (o.rounds < 2 || o.offeredRate <= 0 || o.output == "") {
		return fmt.Errorf("ready-pool requires paced submission, 2..%d nonce cycles and a new durable output", limits.rounds)
	}
	if o.terminalStream && (o.senderMode != "ready-pool" || o.output == "") {
		return errors.New("terminal stream requires ready-pool and a new output")
	}
	if o.reuseResultSlots && (!o.terminalStream || o.senderMode != "ready-pool") {
		return errors.New("result slot reuse requires ready-pool and terminal-stream")
	}
	if o.segmentedIntents && !o.reuseResultSlots {
		return errors.New("segmented intents require ready-pool, terminal-stream and result slot reuse")
	}
	if o.rounds < 0 || o.rounds > limits.rounds || (o.rounds > 1 && o.output == "") {
		return fmt.Errorf("rounds must be 1..%d and repeated runs require a new output file", limits.rounds)
	}
	if o.manifest == "" || o.transactions == "" {
		return errors.New("-manifest and -transactions are required")
	}
	if o.concurrency < 1 || o.concurrency > 4 {
		return errors.New("concurrency must be in 1..4")
	}
	if math.IsNaN(o.offeredRate) || math.IsInf(o.offeredRate, 0) || o.offeredRate < 0 || o.offeredRate > maxTransactions {
		return fmt.Errorf("offered-rate must be finite in 0..%d", maxTransactions)
	}
	if o.offeredRate > 0 && (o.observers < 1 || o.observers > 4) {
		return errors.New("paced observer count must be in 1..4")
	}
	if o.timeout <= 0 || o.timeout > limits.timeout {
		return fmt.Errorf("overall timeout must be positive and at most %s", limits.timeout)
	}
	if o.poll < 50*time.Millisecond || o.poll > time.Second {
		return errors.New("poll must be in 50ms..1s")
	}
	return nil
}

func readBounded(path string, limit int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > limit {
		return nil, errors.New("input must be a regular file within the size limit")
	}
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("input exceeds size limit")
	}
	return data, nil
}

func strictJSON(data []byte, dst any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(dst); err != nil {
		return err
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return errors.New("input must contain exactly one JSON value")
	}
	return nil
}

func decodeTransactions(data []byte) ([]cmttypes.Tx, error) {
	var input transactionInput
	if err := strictJSON(data, &input); err != nil {
		return nil, err
	}
	if len(input.Transactions) < 1 || len(input.Transactions) > maxTransactions {
		return nil, fmt.Errorf("transactions must contain 1..%d entries", maxTransactions)
	}
	txs := make([]cmttypes.Tx, len(input.Transactions))
	seen := map[string]bool{}
	for i, encoded := range input.Transactions {
		raw, err := base64.StdEncoding.Strict().DecodeString(encoded)
		if err != nil || len(raw) == 0 || len(raw) > 64*1024 {
			return nil, fmt.Errorf("transaction %d must be canonical base64 containing 1..65536 bytes", i)
		}
		if base64.StdEncoding.EncodeToString(raw) != encoded {
			return nil, fmt.Errorf("transaction %d is not canonical base64", i)
		}
		hash := string(cmttypes.Tx(raw).Hash())
		if seen[hash] {
			return nil, fmt.Errorf("duplicate transaction at index %d", i)
		}
		seen[hash] = true
		txs[i] = raw
	}
	return txs, nil
}

func validateEndpoint(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return err
	}
	if u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.User != nil || u.Opaque != "" || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawPath != "" {
		return errors.New("RPC must be http://127.0.0.1:<port> with no credentials, query, fragment, or path")
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 || u.Host != net.JoinHostPort("127.0.0.1", strconv.Itoa(port)) {
		return errors.New("RPC must have an explicit canonical port in 1..65535")
	}
	return nil
}

func validateManifest(m consensus.EphemeralNetworkManifest) error {
	purpose := strings.ToLower(m.Purpose)
	if m.Version != consensus.EphemeralNetworkVersion || !strings.Contains(purpose, "local") || !strings.Contains(purpose, "ephemeral") || len(m.Nodes) != 4 || m.ChainID == "" {
		return errors.New("manifest must describe a local ephemeral four-validator network")
	}
	hash, err := hex.DecodeString(m.GenesisHash)
	if err != nil || len(hash) != sha256.Size {
		return errors.New("manifest requires a genesis SHA256")
	}
	endpoints, addresses := map[string]bool{}, map[string]bool{}
	for i, node := range m.Nodes {
		if err := validateEndpoint(node.RPCURL); err != nil {
			return fmt.Errorf("node %d: %w", i, err)
		}
		u, _ := url.Parse(node.RPCURL)
		if endpoints[u.Host] {
			return errors.New("manifest RPC endpoints must be distinct")
		}
		endpoints[u.Host] = true
		pub, err := base64.StdEncoding.Strict().DecodeString(node.ConsensusPubKey)
		if err != nil || len(pub) != cometed25519.PubKeySize || node.ConsensusKeyType != chain.ConsensusPubKeyTypeEd25519 {
			return errors.New("manifest requires four valid Ed25519 consensus public keys")
		}
		address := strings.ToUpper(node.ConsensusAddress)
		if address != fmt.Sprintf("%X", cometed25519.PubKey(pub).Address()) || addresses[address] {
			return errors.New("manifest consensus address/public key mismatch or duplicate")
		}
		addresses[address] = true
		if !filepath.IsAbs(node.Home) {
			return errors.New("manifest node homes must be absolute local paths")
		}
	}
	return nil
}

// Genesis is the local trust anchor. RPC cannot invent voting weights or rotate
// this tiny benchmark onto another validator set.
func loadTrustedValidators(m consensus.EphemeralNetworkManifest) (*cmttypes.ValidatorSet, error) {
	var validators []*cmttypes.Validator
	for i, node := range m.Nodes {
		data, err := readBounded(filepath.Join(node.Home, "config", "genesis.json"), 16*1024*1024)
		if err != nil {
			return nil, err
		}
		hash := sha256.Sum256(data)
		if !strings.EqualFold(hex.EncodeToString(hash[:]), m.GenesisHash) {
			return nil, errors.New("local genesis hash does not match manifest")
		}
		genesis, err := cmttypes.GenesisDocFromJSON(data)
		if err != nil {
			return nil, err
		}
		if genesis.ChainID != m.ChainID || len(genesis.Validators) != 4 {
			return nil, errors.New("local genesis chain or validator count mismatch")
		}
		if i == 0 {
			for _, v := range genesis.Validators {
				validators = append(validators, &cmttypes.Validator{Address: v.Address, PubKey: v.PubKey, VotingPower: v.Power})
			}
		}
	}
	if err := matchManifestValidators(m, validators); err != nil {
		return nil, err
	}
	set := cmttypes.NewValidatorSet(validators)
	return set, set.ValidateBasic()
}

func matchManifestValidators(m consensus.EphemeralNetworkManifest, validators []*cmttypes.Validator) error {
	if len(validators) != 4 {
		return errors.New("validator set must have exactly four entries")
	}
	expected := map[string]string{}
	for _, n := range m.Nodes {
		expected[strings.ToUpper(n.ConsensusAddress)] = n.ConsensusPubKey
	}
	seen := map[string]bool{}
	var total int64
	for _, v := range validators {
		if v == nil || v.PubKey == nil || v.VotingPower <= 0 || v.VotingPower > cmttypes.MaxTotalVotingPower-total {
			return errors.New("invalid validator public key or voting power")
		}
		address := fmt.Sprintf("%X", v.Address)
		if seen[address] || expected[address] == "" || !bytes.Equal(v.Address, v.PubKey.Address()) || v.PubKey.Type() != "ed25519" || expected[address] != base64.StdEncoding.EncodeToString(v.PubKey.Bytes()) {
			return errors.New("validator public key/address differs from manifest")
		}
		seen[address] = true
		total += v.VotingPower
	}
	return nil
}

func verifyConfirmation(m consensus.EphemeralNetworkManifest, trusted *cmttypes.ValidatorSet, validators *coretypes.ResultValidators, result *coretypes.ResultCommit, tx *coretypes.ResultTx, raw cmttypes.Tx) error {
	if tx == nil {
		return errors.New("missing transaction evidence")
	}
	if err := verifyBlockConfirmation(m, trusted, validators, result, tx.Height); err != nil {
		return err
	}
	return verifyTransactionInclusion(result, tx, raw)
}

func verifyBlockConfirmation(m consensus.EphemeralNetworkManifest, trusted *cmttypes.ValidatorSet, validators *coretypes.ResultValidators, result *coretypes.ResultCommit, height int64) error {
	if result == nil || result.Header == nil || result.Commit == nil || validators == nil || trusted == nil {
		return errors.New("missing confirmation evidence")
	}
	if height <= 0 || validators.BlockHeight != height || validators.Total != 4 || validators.Count != 4 {
		return errors.New("validator response height or pagination mismatch")
	}
	if err := matchManifestValidators(m, validators.Validators); err != nil {
		return err
	}
	set := cmttypes.NewValidatorSet(validators.Validators)
	if !bytes.Equal(set.Hash(), trusted.Hash()) {
		return errors.New("RPC validator weights differ from local genesis")
	}
	if err := result.SignedHeader.ValidateBasic(m.ChainID); err != nil {
		return err
	}
	if result.Header.Height != height || !bytes.Equal(result.Header.ValidatorsHash, trusted.Hash()) {
		return errors.New("signed header height or validator hash mismatch")
	}
	if err := trusted.VerifyCommitLight(m.ChainID, result.Commit.BlockID, height, result.Commit); err != nil {
		return fmt.Errorf("quorum signature verification: %w", err)
	}
	return nil
}

// The caller must first authenticate this exact signed header with
// verifyBlockConfirmation. Each transaction still supplies its own proof.
func verifyTransactionInclusion(result *coretypes.ResultCommit, tx *coretypes.ResultTx, raw cmttypes.Tx) error {
	if result == nil || result.Header == nil || tx == nil || tx.Height <= 0 || tx.Height != result.Header.Height || tx.TxResult.Code != 0 || !bytes.Equal(tx.Hash, raw.Hash()) || !bytes.Equal(tx.Tx, raw) {
		return errors.New("transaction result identity or execution code mismatch")
	}
	if !bytes.Equal(tx.Proof.Data, raw) || tx.Proof.Proof.Index != int64(tx.Index) {
		return errors.New("transaction proof identity/index mismatch")
	}
	if err := tx.Proof.Validate(result.Header.DataHash); err != nil {
		return fmt.Errorf("transaction inclusion proof: %w", err)
	}
	return nil
}

func newClients(m consensus.EphemeralNetworkManifest) ([]*rpchttp.HTTP, func(), error) {
	allowed := map[string]bool{}
	for _, n := range m.Nodes {
		u, _ := url.Parse(n.RPCURL)
		allowed[u.Host] = true
	}
	dialer := &net.Dialer{Timeout: time.Second}
	transport := &http.Transport{Proxy: nil, MaxConnsPerHost: 4, MaxIdleConnsPerHost: 4, ResponseHeaderTimeout: 2 * time.Second,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			if !allowed[address] {
				return nil, errors.New("connection outside manifest loopback endpoints refused")
			}
			return dialer.DialContext(ctx, network, address)
		}}
	client := &http.Client{Transport: boundedRPCTransport{base: transport}, Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("RPC redirects are forbidden") }}
	clients := make([]*rpchttp.HTTP, 4)
	for i, n := range m.Nodes {
		c, err := rpchttp.NewWithClient(n.RPCURL, "/websocket", client)
		if err != nil {
			transport.CloseIdleConnections()
			return nil, nil, err
		}
		clients[i] = c
	}
	// No WebSocket Start call: this client only uses bounded HTTP requests.
	return clients, transport.CloseIdleConnections, nil
}

func addError(list *[]errorObservation, stage string, err error) {
	now := time.Now().UTC()
	message := err.Error()
	for i := range *list {
		e := &(*list)[i]
		if e.Stage == stage && e.Message == message {
			e.Count++
			e.LastAt = now
			return
		}
	}
	*list = append(*list, errorObservation{Stage: stage, Message: message, Count: 1, FirstAt: now, LastAt: now})
}

func observeTransaction(ctx context.Context, o options, m consensus.EphemeralNetworkManifest, reader *durableReader, trusted *cmttypes.ValidatorSet, client *rpchttp.HTTP, statePath string, raw cmttypes.Tx, result *transactionResult) {
	started, accepted := submitTransaction(ctx, client, raw, result)
	if !accepted {
		return
	}
	observeAcceptedTransaction(ctx, o, m, reader, trusted, client, statePath, raw, result, started)
}

func submitTransaction(ctx context.Context, client *rpchttp.HTTP, raw cmttypes.Tx, result *transactionResult) (time.Time, bool) {
	if ctx.Err() != nil {
		result.Status = "not_submitted"
		addError(&result.Errors, "before_submission", ctx.Err())
		return time.Time{}, false
	}
	start := time.Now()
	result.submitMonotonic = start
	submitted := start.UTC()
	result.SubmittedAt = &submitted
	broadcast, err := client.BroadcastTxSync(ctx, raw)
	if err != nil {
		result.Status = "submission_unknown"
		addError(&result.Errors, "broadcast_tx_sync", err)
		return start, false
	}
	now := time.Now().UTC()
	elapsed := time.Since(start).Seconds() * 1000
	result.CheckTxObservedAt, result.CheckTxMs = &now, &elapsed
	result.CheckTxCode, result.CheckTxLog = &broadcast.Code, broadcast.Log
	if !bytes.Equal(broadcast.Hash, raw.Hash()) {
		result.Status = "submission_unknown"
		addError(&result.Errors, "broadcast_identity", errors.New("broadcast hash differs from submitted bytes"))
		return start, false
	}
	result.CheckTxIdentityVerified = true
	if broadcast.Code != 0 {
		result.Status = "checktx_rejected"
		return start, false
	}
	return start, true
}

func observeAcceptedTransaction(ctx context.Context, o options, m consensus.EphemeralNetworkManifest, reader *durableReader, trusted *cmttypes.ValidatorSet, client *rpchttp.HTTP, statePath string, raw cmttypes.Tx, result *transactionResult, start time.Time) {
	var included *coretypes.ResultTx
	ticker := time.NewTicker(o.poll)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			result.Status = "timeout"
			addError(&result.Errors, "observation_deadline", err)
			return
		}
		if included == nil {
			queried, err := client.Tx(ctx, raw.Hash(), true)
			if err != nil {
				addError(&result.Errors, "tx_query", err)
			} else if queried == nil || queried.Height <= 0 || !bytes.Equal(queried.Hash, raw.Hash()) || !bytes.Equal(queried.Tx, raw) {
				result.Status = "observation_failed"
				addError(&result.Errors, "tx_identity", errors.New("transaction query identity or height mismatch"))
				return
			} else {
				result.ExecutionCode, result.ExecutionLog, result.Height = &queried.TxResult.Code, queried.TxResult.Log, queried.Height
				result.BlockTxIndex = queried.Index
				result.BlockTxTotal = queried.Proof.Proof.Total
				if queried.TxResult.Code != 0 {
					result.Status = "execution_failed"
					return
				}
				now := time.Now().UTC()
				elapsed := time.Since(start).Seconds() * 1000
				result.IncludedObservedAt, result.InclusionMs = &now, &elapsed
				included = queried
			}
		}
		if included != nil {
			height := included.Height
			page, perPage := 1, 100
			commit, err := client.Commit(ctx, &height)
			if err != nil {
				addError(&result.Errors, "commit_query", err)
			} else {
				validators, err := client.Validators(ctx, &height, &page, &perPage)
				if err != nil {
					addError(&result.Errors, "validators_query", err)
				} else if err := verifyConfirmation(m, trusted, validators, commit, included, raw); err != nil {
					result.Status = "observation_failed"
					addError(&result.Errors, "confirmation_verification", err)
					return
				} else {
					result.QuorumVerified, result.TransactionProofVerified = true, true
					result.BlockHash = fmt.Sprintf("%X", commit.Commit.BlockID.Hash)
					result.HeaderAppHash = fmt.Sprintf("%X", commit.Header.AppHash)
					blockTime := commit.Header.Time.UTC()
					result.BlockTime = &blockTime
					state, err := reader.verify(ctx, statePath, raw, height)
					if err == nil && isJournalLayout(state.StoreFormat) {
						published, infoErr := client.ABCIInfo(ctx)
						if infoErr != nil {
							err = fmt.Errorf("%w: journal published-state query: %v", errDurableNotReady, infoErr)
						} else {
							err = verifyJournalPublishedState(state, published)
							if err == nil {
								result.DurableInfoVerified = true
								result.DurableInfoHeight = published.Response.LastBlockHeight
								result.DurableInfoAppHash = fmt.Sprintf("%X", published.Response.LastBlockAppHash)
							}
						}
					}
					if err != nil {
						if ctx.Err() != nil {
							result.Status = "timeout"
							addError(&result.Errors, "observation_deadline", ctx.Err())
							return
						}
						addError(&result.Errors, "local_durable_readback", err)
						if !errors.Is(err, errDurableNotReady) {
							result.Status = "observation_failed"
							return
						}
						select {
						case <-ctx.Done():
						case <-ticker.C:
						}
						continue
					}
					observed := time.Now()
					deadline, hasDeadline := ctx.Deadline()
					if ctx.Err() != nil || (hasDeadline && !observed.Before(deadline)) {
						result.Status = "timeout"
						err := ctx.Err()
						if err == nil {
							err = context.DeadlineExceeded
						}
						addError(&result.Errors, "observation_deadline", err)
						return
					}
					now := observed.UTC()
					elapsed := observed.Sub(start).Seconds() * 1000
					result.ConfirmedObservedAt, result.ConfirmationMs = &now, &elapsed
					result.Status, result.QuorumVerified, result.TransactionProofVerified = "confirmed", true, true
					result.DurableStateVerified, result.DurableStateHeight, result.DurableStateAppHash = true, state.Height, state.AppHash
					result.DurableSnapshotSHA256, result.DurableSnapshotCacheHit = state.SnapshotSHA256, state.SnapshotCacheHit
					result.DurableStoreSHA256, result.DurableStoreFormat = state.StoreSHA256, state.StoreFormat
					result.DurableJournalCompleteBytes, result.DurableJournalIncompleteTail = state.JournalCompleteBytes, state.JournalIncompleteTail
					return
				}
			}
		}
		select {
		case <-ctx.Done():
		case <-ticker.C:
		}
	}
}

func distribution(values []float64) percentiles {
	p := percentiles{Samples: len(values)}
	if len(values) == 0 {
		return p
	}
	copyValues := append([]float64(nil), values...)
	sort.Float64s(copyValues)
	quantile := func(q float64) *float64 { v := copyValues[int(math.Ceil(q*float64(len(copyValues))))-1]; return &v }
	p.P50, p.P95, p.P99 = quantile(.5), quantile(.95), quantile(.99)
	return p
}

func summarize(results []transactionResult, seconds float64) summary {
	s := summary{Input: len(results), MeasurementWindowSeconds: seconds}
	var check, inclusion, confirmation, effectiveInclusion []float64
	var offered, submissions []time.Time
	var queue []float64
	for _, r := range results {
		if r.OfferedAt != nil {
			s.Offered++
			if r.offerMonotonic.IsZero() {
				offered = append(offered, *r.OfferedAt)
			} else {
				offered = append(offered, r.offerMonotonic)
			}
		}
		if r.SubmittedAt != nil {
			s.Submitted++
			if r.submitMonotonic.IsZero() {
				submissions = append(submissions, *r.SubmittedAt)
			} else {
				submissions = append(submissions, r.submitMonotonic)
			}
		}
		if r.CheckTxCode != nil {
			s.CheckTxResponses++
			if !r.CheckTxIdentityVerified {
				s.CheckTxUnverified++
			} else if *r.CheckTxCode == 0 {
				s.CheckTxAccepted++
			} else {
				s.CheckTxRejected++
			}
		}
		if r.IncludedObservedAt != nil && r.ExecutionCode != nil && *r.ExecutionCode == 0 && r.TransactionProofVerified {
			s.IncludedCodeZero++
		}
		if verifiedBusinessInclusion(r) {
			s.EffectiveBusinessIncluded++
			if r.InclusionMs != nil {
				effectiveInclusion = append(effectiveInclusion, *r.InclusionMs)
			}
		}
		if r.ExecutionCode != nil && *r.ExecutionCode != 0 {
			s.ExecutionFailed++
		}
		if r.QuorumVerified && r.TransactionProofVerified {
			s.QuorumConfirmed++
		}
		switch r.Status {
		case "submission_unknown":
			s.SubmissionUnknown++
		case "timeout":
			s.TimedOut++
		case "observation_failed":
			s.ObservationFailed++
		case "not_submitted":
			s.NotSubmitted++
		}
		for _, e := range r.Errors {
			s.ErrorOccurrences += e.Count
		}
		if r.CheckTxMs != nil {
			check = append(check, *r.CheckTxMs)
		}
		if r.InclusionMs != nil && r.TransactionProofVerified {
			inclusion = append(inclusion, *r.InclusionMs)
		}
		if qualifiedBusinessFinal(r) {
			s.FinalSubmitted++
			if r.ConfirmationMs != nil {
				confirmation = append(confirmation, *r.ConfirmationMs)
			}
		}
		if r.QueueDelayMs != nil {
			queue = append(queue, *r.QueueDelayMs)
		}
	}
	if seconds > 0 {
		s.SubmissionRate = float64(s.Submitted) / seconds
		s.AcceptanceRate = float64(s.CheckTxAccepted) / seconds
		s.InclusionRate = float64(s.IncludedCodeZero) / seconds
		s.EffectiveInclusionRate = float64(s.EffectiveBusinessIncluded) / seconds
		s.ConfirmationRate = float64(s.QuorumConfirmed) / seconds
		s.FinalSubmissionRate = float64(s.FinalSubmitted) / seconds
	}
	s.CheckTxLatency, s.InclusionLatency, s.ConfirmationLatency = distribution(check), distribution(inclusion), distribution(confirmation)
	s.QueueDelay = distribution(queue)
	s.OfferedEventSpanSeconds, s.OfferedEventSpanRate = eventSpanRate(offered)
	s.SubmissionEventSpanSeconds, s.SubmissionEventSpanRate = eventSpanRate(submissions)
	s.InclusionBlocks = summarizeBlocks(results)
	s.EffectiveInclusionLatency = distribution(effectiveInclusion)
	return s
}

// RPC execution codes and inclusion proofs alone do not prove successful
// business execution. Actual fee/nonce readback and publication must corroborate
// it before it enters an effective inclusion count or block-rate calculation.
func verifiedBusinessInclusion(r transactionResult) bool {
	return r.Height > 0 && r.ExecutionCode != nil && *r.ExecutionCode == 0 && r.QuorumVerified && r.TransactionProofVerified && r.DurableStateVerified && r.DurableStateHeight >= r.Height && r.DurableSnapshotSHA256 != "" && (!isJournalLayout(r.DurableStoreFormat) || (r.DurableInfoVerified && r.DurableInfoHeight >= r.DurableStateHeight))
}

// Both retention modes use this gate for final business counts and latency.
func qualifiedBusinessFinal(r transactionResult) bool {
	return verifiedBusinessInclusion(r) && r.ConfirmedObservedAt != nil && r.Status == "confirmed" && r.CheckTxIdentityVerified && r.CheckTxCode != nil && *r.CheckTxCode == 0
}

func execute(o options) error {
	if o.inclusionMode == "" {
		o.inclusionMode = "tx-query"
	}
	if o.senderMode == "" {
		o.senderMode = "rounds"
	}
	if o.rounds == 0 {
		o.rounds = 1
	}
	if err := validateOptions(o); err != nil {
		return err
	}
	signalCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(signalCtx, o.timeout)
	defer cancel()
	var output *os.File
	if o.output != "" {
		f, err := os.OpenFile(o.output, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		output = f
		defer output.Close()
	}
	r := report{SchemaVersion: 11, RoundsRequested: o.rounds, Kind: "bounded-local-four-validator-transaction-observation", StartedAt: time.Now().UTC(), Concurrency: o.concurrency, OfferedRate: o.offeredRate, ObserverConcurrency: o.observers, LoadMode: "closed_loop", TimeoutMs: o.timeout.Milliseconds(), PollMs: o.poll.Milliseconds(), GoVersion: runtime.Version(), Platform: runtime.GOOS + "/" + runtime.GOARCH, GOMAXPROCS: runtime.GOMAXPROCS(0), SetupErrors: []errorObservation{}, Interpretation: []string{
		"A bounded probe, not sustained TPS capacity or public-network evidence. Paced mode separates submit/observation pools; closed-loop mode limits entire lifetimes.",
		"Latencies use the client monotonic clock from each submission start to first observed response; polling and RPC overhead are included. Percentiles exclude unobserved stages; all non-success counts remain explicit.",
		"Rates share the complete workload window (submission plus observation/drain), excluding setup. Empty blocks, votes, rejected and failed executions are not effective transaction inclusions.",
		"RPC code-zero inclusion/quorum fields are stage observations. Effective business inclusion counts and block rates additionally require actual signed-transaction fee/nonce readback and journal publication evidence; they do not infer execution from an unsigned RPC code. Inclusion and finality latency remain client observations, not internal node timestamps.",
		"Configured offered rate, measured offered/submission interarrival rates, queue delay and full-window final-submission throughput are separate. Interarrival rate uses (event count - 1)/(last - first); steady-state effective TPS remains null for this short bounded probe.",
		"Code-zero execution is reported by local tx RPC. Confirmation independently verifies weighted CometBFT commit signatures and transaction Merkle inclusion against the signed header; this is not a cryptographic proof of the RPC execution result.",
		"Final submission additionally reads and validates that node's persisted application state and matching native transaction fee/nonce. Header AppHash at transaction height authenticates prior application state; the local disk readback is separate evidence, not authenticated by that same-height header. Restart and all-node convergence are separate checks.",
		"Every durable observation freshly streams and hashes the current file. Only identical bytes reuse whole-snapshot validation; transaction signatures and matching fee/nonce are still checked. Snapshot size remains bounded at16MiB; this client is not yet a ten-minute high-history load driver.",
		"Journal readback takes a shared writer lock, validates complete records and reports store versus selected snapshot digests separately. Live finality additionally requires the node post-Sync committed ABCI view to reach that snapshot height. Neither local file checks nor Info RPC are a cryptographic execution proof.",
		"Submission transport errors retain unknown outcome and are never automatically retried. Repeated identical observation errors retain counts and first/last timestamps.",
		"Repeated rounds use only manifest-bound ephemeral fixture senders, wait for the entire prior round to finish, and stop on any non-final result. Barriers and signing are included in full-window throughput; the offered-rate setting applies within each round, not continuously across barriers. Public signed envelopes are retained for read-only outcome recovery. The claim is never automatically removed or resumed.",
	}}
	if o.reuseResultSlots {
		r.SchemaVersion = 13
		r.RetentionMode = "latest_per_account_slots"
		r.Interpretation = append(r.Interpretation, "Schema13 slot retention with bounded monotonic second buckets: transactions contains only the latest per-account slot. Every handed-back terminal result is in the segmented terminal stream. Summary stage counts are cumulative; exact point percentiles are withheld and bounded intervals are in readySenders.boundedSummary.latencyIntervalsNs. No lifetime block list or sustained TPS is inferred.")
	}
	if o.segmentedIntents {
		r.Interpretation = append(r.Interpretation, "Signed-input waves use private hash-chained segments persisted before dispatch. readySenders.intentSegments binds their completed inventory. Failed or missing receipt evidence is never a resubmission authorization. Workload and byte caps are unchanged.")
	}
	if o.streamingWorkload {
		r.SchemaVersion = 14
		r.StreamingWorkload = &streamingWorkloadReport{Name: "scoped_streaming_v1", Rounds: o.rounds, MaxRuntimeMs: o.timeout.Milliseconds(), EvidenceByteBudget: o.evidenceByteBudget}
		r.Interpretation = append(r.Interpretation, "Streaming issuance does not raise durable-reader store-size limits. Reaching a store, evidence, duration or resource bound fails closed. Ten-minute capacity requires separately qualified history/readback and resource coverage.")
	}
	runErr := func() error {
		data, err := readBounded(o.manifest, 1024*1024)
		if err != nil {
			return err
		}
		manifestRaw := append([]byte(nil), data...)
		var m consensus.EphemeralNetworkManifest
		if err := strictJSON(data, &m); err != nil {
			return err
		}
		if err := validateManifest(m); err != nil {
			return err
		}
		if err := validateLocalPaths(m, o.manifest); err != nil {
			return err
		}
		migration, err := readMigration(m)
		if err != nil {
			return err
		}
		paths := make([]string, 0, len(m.Nodes))
		for _, node := range m.Nodes {
			paths = append(paths, node.ABCIStatePath)
		}
		reader, err := newDurableReader(migration, paths)
		if err != nil {
			return err
		}
		defer func() { r.DurableReadback = reader.stats() }()
		r.ChainID, r.GenesisSHA256 = m.ChainID, m.GenesisHash
		for _, n := range m.Nodes {
			r.Endpoints = append(r.Endpoints, n.RPCURL)
		}
		data, err = readBounded(o.transactions, 8*1024*1024)
		if err != nil {
			return err
		}
		txs, err := decodeTransactions(data)
		if err != nil {
			return err
		}
		planned, limits, err := plannedWorkload(o, len(txs))
		if err != nil {
			return err
		}
		offerIntervals := o.rounds * (len(txs) - 1)
		if o.senderMode == "ready-pool" {
			offerIntervals = planned - 1
		}
		if o.offeredRate > 0 && float64(offerIntervals)/o.offeredRate >= o.timeout.Seconds() {
			return errors.New("planned offering span cannot fit the complete configured timeout")
		}
		if planned > limits.records {
			return errors.New("total round transactions exceed bounded input limit")
		}
		if o.streamingWorkload {
			r.SchemaVersion = 14
			r.StreamingWorkload = &streamingWorkloadReport{Name: "scoped_streaming_v1", PlannedRecords: planned, Rounds: o.rounds, MaxRuntimeMs: o.timeout.Milliseconds(), EvidenceByteBudget: o.evidenceByteBudget}
			o.evidenceBudget = &readyEvidenceBudgetReport{LimitBytes: o.evidenceByteBudget}
			r.Interpretation = append(r.Interpretation, "Explicit bounded streaming issuance, not a sustained-throughput qualification. Fixed slots and second bins; encoded evidence byte budget is shared, allocated disk requires a separately scheduled resource window. Legacy complete-array/schema12/13 recovery cannot accept schema14.")
		}
		var pool *ephemeralSenderPool
		if o.rounds > 1 {
			pool, err = loadSenderPoolWithLimits(o.manifest, manifestRaw, m, migration, txs, o.rounds, limits)
			if err != nil {
				return err
			}
			if err := claimSenderPool(o.manifest); err != nil {
				return err
			}
		}
		if o.streamingWorkload {
			path, digest, err := persistStreamingWorkloadPlan(o, manifestRaw, m, txs)
			if err != nil {
				return err
			}
			r.StreamingWorkload.PlanPath = path
			r.StreamingWorkload.PlanSHA256 = digest
		}
		storageCount := len(txs) * o.rounds
		if o.reuseResultSlots {
			storageCount = len(txs)
		}
		r.Transactions = make([]transactionResult, storageCount)
		r.Summary = summary{Input: len(txs) * o.rounds, NotSubmitted: len(txs) * o.rounds}
		for i := range r.Transactions {
			r.Transactions[i] = transactionResult{Index: i, Round: i/len(txs) + 1, Status: "not_submitted", Errors: []errorObservation{}}
		}
		trusted, err := loadTrustedValidators(m)
		if err != nil {
			return err
		}
		clients, cleanup, err := newClients(m)
		if err != nil {
			return err
		}
		defer cleanup()
		for i, client := range clients {
			status, err := client.Status(ctx)
			if err != nil {
				return fmt.Errorf("node %d preflight: %w", i, err)
			}
			if status == nil || status.NodeInfo.Network != m.ChainID {
				return fmt.Errorf("node %d chain identity mismatch", i)
			}
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		started := time.Now()
		at := started.UTC()
		r.MeasurementStartedAt = &at
		var roundErr error
		runRound := func(txs []cmttypes.Tx, results []transactionResult) {
			for i := range results {
				results[i].Endpoint = m.Nodes[i%4].RPCURL
			}
			roundStarted := time.Now()
			if o.offeredRate > 0 {
				r.LoadMode = "paced_submission_and_grouped_observation"
				workerStats := make([]groupedObservationStats, o.observers)
				roundQueues := runPacedWorkers(ctx, o, roundStarted, results,
					func(i int) (time.Time, bool) { return submitTransaction(ctx, clients[i%4], txs[i], &results[i]) },
					func(worker int, queue <-chan acceptedObservation, completed func(int)) {
						observationClients := make([]observationClient, len(clients))
						for i, client := range clients {
							observationClients[i] = client
						}
						observer := &groupedObserver{manifest: m, trusted: trusted, reader: reader, clients: observationClients, txs: txs, results: results, included: map[int]*coretypes.ResultTx{}, inclusionMode: o.inclusionMode}
						runGroupedObservationLoop(ctx, o.poll, queue, completed, func(pending []acceptedObservation) []acceptedObservation { return observer.step(ctx, pending) })
						workerStats[worker] = observer.stats
					})
				for _, stats := range workerStats {
					r.GroupedObservation.add(stats)
				}
				if roundQueues.PeakAwaitingSubmission > r.LoadQueues.PeakAwaitingSubmission {
					r.LoadQueues.PeakAwaitingSubmission = roundQueues.PeakAwaitingSubmission
				}
				if roundQueues.PeakAwaitingObservation > r.LoadQueues.PeakAwaitingObservation {
					r.LoadQueues.PeakAwaitingObservation = roundQueues.PeakAwaitingObservation
				}
			} else {
				r.ObserverConcurrency = 0 // closed-loop workers observe their own submissions
				jobs := make(chan int, len(txs))
				for i := range txs {
					jobs <- i
				}
				close(jobs)
				var wg sync.WaitGroup
				for worker := 0; worker < o.concurrency; worker++ {
					wg.Add(1)
					go func() {
						defer wg.Done()
						for i := range jobs {
							results[i].offerMonotonic = time.Now()
							offered := results[i].offerMonotonic.UTC()
							results[i].OfferedAt = &offered
							observeTransaction(ctx, o, m, reader, trusted, clients[i%4], m.Nodes[i%4].ABCIStatePath, txs[i], &results[i])
						}
					}()
				}
				wg.Wait()
			}
		}
		r.SenderMode = o.senderMode
		r.InclusionMode = o.inclusionMode
		if o.senderMode == "ready-pool" {
			r.LoadMode = "paced_ready_sender_pool_and_grouped_observation"
			var stream *terminalStream
			if o.terminalStream {
				stream, err = newTerminalStream(o.output+".terminal-stream", pool)
				if err != nil {
					return err
				}
				stream.maxBytes = limits.terminalBytes
				if o.evidenceBudget != nil {
					stream.persist = o.evidenceBudget.persist(stream.persist)
				}
				o.terminalSink = stream.append
			}
			for i, text := range r.Interpretation {
				if strings.HasPrefix(text, "Repeated rounds use") {
					r.Interpretation[i] = "Ready-pool mode waits only for each account's own verified finality. UNKNOWN/failed accounts are quarantined; signing, durable input journaling and idle sender waits are included. This bounded finite pool is not sustained capacity."
				}
			}
			allTxs := make([]cmttypes.Tx, len(r.Transactions))
			for i := range r.Transactions {
				r.Transactions[i].Endpoint = m.Nodes[i%4].RPCURL
			}
			workerStats := make([]groupedObservationStats, o.observers)
			r.ReadySenders, roundErr = runReadySenderPool(ctx, o, pool, allTxs, r.Transactions,
				func(i int) (time.Time, bool) {
					return submitTransaction(ctx, clients[i%4], allTxs[i], &r.Transactions[i])
				},
				func(worker int, queue <-chan acceptedObservation, terminal func(int)) {
					observationClients := make([]observationClient, len(clients))
					for i, client := range clients {
						observationClients[i] = client
					}
					observer := &groupedObserver{manifest: m, trusted: trusted, reader: reader, clients: observationClients, txs: allTxs, results: r.Transactions, included: map[int]*coretypes.ResultTx{}, inclusionMode: o.inclusionMode}
					runGroupedObservationLoop(ctx, o.poll, queue, func(int) {}, func(pending []acceptedObservation) []acceptedObservation {
						remaining := observer.step(ctx, pending)
						keep := make(map[int]bool, len(remaining))
						for _, job := range remaining {
							keep[job.index] = true
						}
						for _, job := range pending {
							if !keep[job.index] {
								terminal(job.index)
							}
						}
						return remaining
					})
					workerStats[worker] = observer.stats
				})
			for _, stats := range workerStats {
				r.GroupedObservation.add(stats)
			}
			if stream != nil {
				roundErr = errors.Join(roundErr, stream.close())
				r.TerminalStream = &stream.report
			}
			r.RoundsCompleted = r.ReadySenders.RoundsCompleted
			r.LoadQueues = r.ReadySenders.Queues
		} else {
			r.RoundsCompleted, roundErr = runSenderRounds(ctx, o.rounds, txs, pool, r.Transactions, runRound)
		}

		if o.reuseResultSlots {
			if r.ReadySenders.BoundedSummary == nil {
				return errors.Join(roundErr, errors.New("missing cumulative slot summary"))
			}
			r.Summary = r.ReadySenders.BoundedSummary.Counts
			readySummaryRates(&r.Summary, time.Since(started).Seconds())
			r.ReadySenders.BoundedSummary.Counts = r.Summary
		} else {
			r.Summary = summarize(r.Transactions, time.Since(started).Seconds())
		}
		if o.senderMode == "ready-pool" && !o.reuseResultSlots {
			r.Summary.InclusionBlocks.Interpretation = "Finite per-account ready pool without whole-round barriers. Full block observations retained; interior/steady TPS withheld until continuous-load coverage is qualified. Full workload rate includes signing, journal Sync, waits and drain."
		}
		if roundErr != nil {
			return roundErr
		}
		if r.Summary.FinalSubmitted != len(txs)*o.rounds {
			return errors.New("bounded run incomplete: inspect per-transaction outcomes; no submission will be retried")
		}
		if o.streamingWorkload {
			if r.ReadySenders.IntentSegments == nil || r.TerminalStream == nil || o.evidenceBudget == nil || o.evidenceBudget.Poisoned || o.evidenceBudget.AttemptedBytes != r.ReadySenders.IntentSegments.Bytes+int64(r.TerminalStream.Bytes) {
				return errors.New("streaming shared budget differs from complete evidence inventory")
			}
			plan, err := readBounded(r.StreamingWorkload.PlanPath, 1<<20)
			if err != nil || fmt.Sprintf("%x", sha256.Sum256(plan)) != r.StreamingWorkload.PlanSHA256 {
				return errors.New("streaming workload plan changed or unavailable")
			}
			began := time.Now()
			err := verifyStreamingWorkloadEvidence(ctx, manifestRaw, m, txs, o.rounds, r.ReadySenders.IntentSegments, r.TerminalStream, r.Transactions, o.output, o.evidenceByteBudget)
			r.StreamingWorkload.EvidenceReadbackMs = float64(time.Since(began).Nanoseconds()) / 1e6
			if err != nil {
				return err
			}
			r.StreamingWorkload.EvidenceVerified = true
		}
		return nil
	}()
	r.FinishedAt = time.Now().UTC()
	if runErr != nil {
		addError(&r.SetupErrors, "run", runErr)
	}
	if r.MeasurementStartedAt == nil && !o.reuseResultSlots {
		r.Summary = summarize(r.Transactions, 0)
	}
	if output != nil {
		encoder := json.NewEncoder(output)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(r); err != nil {
			return err
		}
		if err := output.Sync(); err != nil {
			return err
		}
	}
	var console any = r
	if output != nil {
		console = struct {
			Output  string  `json:"output"`
			Summary summary `json:"summary"`
		}{o.output, r.Summary}
	}
	if err := json.NewEncoder(os.Stdout).Encode(console); err != nil {
		return err
	}
	return runErr
}
