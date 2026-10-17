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

const maxTransactions = 256

type options struct {
	manifest, transactions, output string
	concurrency                    int
	observers                      int
	offeredRate                    float64
	timeout, poll                  time.Duration
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
	offerMonotonic           time.Time
	submitMonotonic          time.Time
	Index                    int                `json:"index"`
	Hash                     string             `json:"hash"`
	Endpoint                 string             `json:"endpoint"`
	Bytes                    int                `json:"bytes"`
	Status                   string             `json:"status"`
	SubmittedAt              *time.Time         `json:"submittedAt,omitempty"`
	ScheduledAt              *time.Time         `json:"scheduledAt,omitempty"`
	OfferedAt                *time.Time         `json:"offeredAt,omitempty"`
	QueueDelayMs             *float64           `json:"queueDelayMs,omitempty"`
	CheckTxObservedAt        *time.Time         `json:"checkTxObservedAt,omitempty"`
	IncludedObservedAt       *time.Time         `json:"includedObservedAt,omitempty"`
	ConfirmedObservedAt      *time.Time         `json:"confirmedObservedAt,omitempty"`
	CheckTxMs                *float64           `json:"checkTxMs,omitempty"`
	InclusionMs              *float64           `json:"inclusionMs,omitempty"`
	ConfirmationMs           *float64           `json:"confirmationMs,omitempty"`
	CheckTxCode              *uint32            `json:"checkTxCode,omitempty"`
	CheckTxIdentityVerified  bool               `json:"checkTxIdentityVerified"`
	ExecutionCode            *uint32            `json:"executionCode,omitempty"`
	CheckTxLog               string             `json:"checkTxLog,omitempty"`
	ExecutionLog             string             `json:"executionLog,omitempty"`
	Height                   int64              `json:"height,omitempty"`
	BlockTxIndex             uint32             `json:"blockTxIndex"`
	BlockTime                *time.Time         `json:"blockTime,omitempty"`
	BlockHash                string             `json:"blockHash,omitempty"`
	HeaderAppHash            string             `json:"headerAppHash,omitempty"`
	QuorumVerified           bool               `json:"quorumVerified"`
	TransactionProofVerified bool               `json:"transactionProofVerified"`
	DurableStateVerified     bool               `json:"durableStateVerified"`
	DurableStateHeight       int64              `json:"durableStateHeight,omitempty"`
	DurableStateAppHash      string             `json:"durableStateAppHash,omitempty"`
	Errors                   []errorObservation `json:"errors"`
}

type percentiles struct {
	Samples int      `json:"samples"`
	P50     *float64 `json:"p50"`
	P95     *float64 `json:"p95"`
	P99     *float64 `json:"p99"`
}

type summary struct {
	Input                      int         `json:"input"`
	Offered                    int         `json:"offered"`
	Submitted                  int         `json:"submitted"`
	CheckTxResponses           int         `json:"checkTxResponses"`
	CheckTxAccepted            int         `json:"checkTxAccepted"`
	CheckTxRejected            int         `json:"checkTxRejected"`
	CheckTxUnverified          int         `json:"checkTxUnverifiedResponses"`
	IncludedCodeZero           int         `json:"includedCodeZero"`
	ExecutionFailed            int         `json:"executionFailed"`
	QuorumConfirmed            int         `json:"quorumConfirmed"`
	FinalSubmitted             int         `json:"finalSubmitted"`
	SubmissionUnknown          int         `json:"submissionUnknown"`
	TimedOut                   int         `json:"timedOut"`
	ObservationFailed          int         `json:"observationFailed"`
	NotSubmitted               int         `json:"notSubmitted"`
	ErrorOccurrences           int         `json:"errorOccurrences"`
	MeasurementWindowSeconds   float64     `json:"measurementWindowSeconds"`
	SubmissionRate             float64     `json:"rpcSubmissionsPerMeasurementSecond"`
	AcceptanceRate             float64     `json:"checkTxAcceptedPerMeasurementSecond"`
	InclusionRate              float64     `json:"codeZeroIncludedPerMeasurementSecond"`
	ConfirmationRate           float64     `json:"quorumConfirmedPerMeasurementSecond"`
	FinalSubmissionRate        float64     `json:"finalSubmittedPerMeasurementSecond"`
	OfferedEventSpanSeconds    float64     `json:"offeredEventSpanSeconds"`
	OfferedEventSpanRate       *float64    `json:"offeredInterarrivalRate"`
	SubmissionEventSpanSeconds float64     `json:"submissionEventSpanSeconds"`
	SubmissionEventSpanRate    *float64    `json:"submissionInterarrivalRate"`
	SteadyStateEffectiveTPS    *float64    `json:"steadyStateEffectiveTPS"`
	QueueDelay                 percentiles `json:"submissionQueueDelayMs"`
	CheckTxLatency             percentiles `json:"checkTxLatencyMs"`
	InclusionLatency           percentiles `json:"inclusionLatencyMs"`
	ConfirmationLatency        percentiles `json:"confirmationLatencyMs"`
}

type report struct {
	SchemaVersion        int                 `json:"schemaVersion"`
	Kind                 string              `json:"kind"`
	ChainID              string              `json:"chainId"`
	GenesisSHA256        string              `json:"genesisSha256"`
	Endpoints            []string            `json:"endpoints"`
	Concurrency          int                 `json:"concurrency"`
	OfferedRate          float64             `json:"configuredOfferedRate"`
	ObserverConcurrency  int                 `json:"observerConcurrency"`
	LoadMode             string              `json:"loadMode"`
	LoadQueues           pacedStatistics     `json:"loadQueues"`
	TimeoutMs            int64               `json:"timeoutMs"`
	PollMs               int64               `json:"pollMs"`
	StartedAt            time.Time           `json:"startedAt"`
	MeasurementStartedAt *time.Time          `json:"measurementStartedAt,omitempty"`
	FinishedAt           time.Time           `json:"finishedAt"`
	GoVersion            string              `json:"goVersion"`
	Platform             string              `json:"platform"`
	GOMAXPROCS           int                 `json:"gomaxprocs"`
	Summary              summary             `json:"summary"`
	Transactions         []transactionResult `json:"transactions"`
	SetupErrors          []errorObservation  `json:"setupErrors"`
	Interpretation       []string            `json:"interpretation"`
}

func main() {
	var o options
	flag.StringVar(&o.manifest, "manifest", "", "local ephemeral four-node network manifest")
	flag.StringVar(&o.transactions, "transactions", "", "JSON file containing transactions: [base64 raw signed transaction]")
	flag.StringVar(&o.output, "output", "", "optional new JSON output file; existing files are never overwritten")
	flag.IntVar(&o.concurrency, "concurrency", 2, "maximum concurrent submit-and-observe workers (1..4)")
	flag.IntVar(&o.observers, "observers", 4, "confirmation workers for paced mode (1..4)")
	flag.Float64Var(&o.offeredRate, "offered-rate", 0, "paced offers per second (0=legacy closed loop; positive at most 256)")
	flag.DurationVar(&o.timeout, "timeout", 20*time.Second, "overall setup and workload timeout (positive, at most 30s)")
	flag.DurationVar(&o.poll, "poll", 100*time.Millisecond, "transaction observation interval (50ms..1s)")
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
	if o.manifest == "" || o.transactions == "" {
		return errors.New("-manifest and -transactions are required")
	}
	if o.concurrency < 1 || o.concurrency > 4 {
		return errors.New("concurrency must be in 1..4")
	}
	if math.IsNaN(o.offeredRate) || math.IsInf(o.offeredRate, 0) || o.offeredRate < 0 || o.offeredRate > 256 {
		return errors.New("offered-rate must be finite in 0..256")
	}
	if o.offeredRate > 0 && (o.observers < 1 || o.observers > 4) {
		return errors.New("paced observer count must be in 1..4")
	}
	if o.timeout <= 0 || o.timeout > 30*time.Second {
		return errors.New("overall timeout must be positive and at most 30s")
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
		return nil, errors.New("transactions must contain 1..256 entries")
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
	if result == nil || result.Header == nil || result.Commit == nil || tx == nil || validators == nil || trusted == nil {
		return errors.New("missing confirmation evidence")
	}
	if tx.Height <= 0 || tx.TxResult.Code != 0 || !bytes.Equal(tx.Hash, raw.Hash()) || !bytes.Equal(tx.Tx, raw) {
		return errors.New("transaction result identity or execution code mismatch")
	}
	if validators.BlockHeight != tx.Height || validators.Total != 4 || validators.Count != 4 {
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
	if result.Header.Height != tx.Height || !bytes.Equal(result.Header.ValidatorsHash, trusted.Hash()) {
		return errors.New("signed header height or validator hash mismatch")
	}
	if err := trusted.VerifyCommitLight(m.ChainID, result.Commit.BlockID, tx.Height, result.Commit); err != nil {
		return fmt.Errorf("quorum signature verification: %w", err)
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
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("RPC redirects are forbidden") }}
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

func observeTransaction(ctx context.Context, o options, m consensus.EphemeralNetworkManifest, migration chain.ConsensusMigrationState, trusted *cmttypes.ValidatorSet, client *rpchttp.HTTP, statePath string, raw cmttypes.Tx, result *transactionResult) {
	started, accepted := submitTransaction(ctx, client, raw, result)
	if !accepted {
		return
	}
	observeAcceptedTransaction(ctx, o, m, migration, trusted, client, statePath, raw, result, started)
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

func observeAcceptedTransaction(ctx context.Context, o options, m consensus.EphemeralNetworkManifest, migration chain.ConsensusMigrationState, trusted *cmttypes.ValidatorSet, client *rpchttp.HTTP, statePath string, raw cmttypes.Tx, result *transactionResult, start time.Time) {
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
					state, err := verifyDurableExecution(statePath, migration, raw, height)
					if err != nil {
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
					now := time.Now().UTC()
					elapsed := time.Since(start).Seconds() * 1000
					result.ConfirmedObservedAt, result.ConfirmationMs = &now, &elapsed
					result.Status, result.QuorumVerified, result.TransactionProofVerified = "confirmed", true, true
					result.DurableStateVerified, result.DurableStateHeight, result.DurableStateAppHash = true, state.Height, state.AppHash
					result.BlockHash = fmt.Sprintf("%X", commit.Commit.BlockID.Hash)
					result.HeaderAppHash = fmt.Sprintf("%X", commit.Header.AppHash)
					blockTime := commit.Header.Time.UTC()
					result.BlockTime = &blockTime
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
	var check, inclusion, confirmation []float64
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
		if r.ExecutionCode != nil && *r.ExecutionCode != 0 {
			s.ExecutionFailed++
		}
		if r.QuorumVerified && r.TransactionProofVerified {
			s.QuorumConfirmed++
			if r.ConfirmedObservedAt != nil && r.DurableStateVerified {
				s.FinalSubmitted++
			}
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
		if r.ConfirmationMs != nil {
			confirmation = append(confirmation, *r.ConfirmationMs)
		}
		if r.QueueDelayMs != nil {
			queue = append(queue, *r.QueueDelayMs)
		}
	}
	if seconds > 0 {
		s.SubmissionRate = float64(s.Submitted) / seconds
		s.AcceptanceRate = float64(s.CheckTxAccepted) / seconds
		s.InclusionRate = float64(s.IncludedCodeZero) / seconds
		s.ConfirmationRate = float64(s.QuorumConfirmed) / seconds
		s.FinalSubmissionRate = float64(s.FinalSubmitted) / seconds
	}
	s.CheckTxLatency, s.InclusionLatency, s.ConfirmationLatency = distribution(check), distribution(inclusion), distribution(confirmation)
	s.QueueDelay = distribution(queue)
	s.OfferedEventSpanSeconds, s.OfferedEventSpanRate = eventSpanRate(offered)
	s.SubmissionEventSpanSeconds, s.SubmissionEventSpanRate = eventSpanRate(submissions)
	return s
}

func execute(o options) error {
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
	r := report{SchemaVersion: 3, Kind: "bounded-local-four-validator-transaction-observation", StartedAt: time.Now().UTC(), Concurrency: o.concurrency, OfferedRate: o.offeredRate, ObserverConcurrency: o.observers, LoadMode: "closed_loop", TimeoutMs: o.timeout.Milliseconds(), PollMs: o.poll.Milliseconds(), GoVersion: runtime.Version(), Platform: runtime.GOOS + "/" + runtime.GOARCH, GOMAXPROCS: runtime.GOMAXPROCS(0), SetupErrors: []errorObservation{}, Interpretation: []string{
		"A bounded probe, not sustained TPS capacity or public-network evidence. Paced mode separates submit/observation pools; closed-loop mode limits entire lifetimes.",
		"Latencies use the client monotonic clock from each submission start to first observed response; polling and RPC overhead are included. Percentiles exclude unobserved stages; all non-success counts remain explicit.",
		"Rates share the complete workload window (submission plus observation/drain), excluding setup. Empty blocks, votes, rejected and failed executions are not effective transaction inclusions.",
		"Configured offered rate, measured offered/submission interarrival rates, queue delay and full-window final-submission throughput are separate. Interarrival rate uses (event count - 1)/(last - first); steady-state effective TPS remains null for this short bounded probe.",
		"Code-zero execution is reported by local tx RPC. Confirmation independently verifies weighted CometBFT commit signatures and transaction Merkle inclusion against the signed header; this is not a cryptographic proof of the RPC execution result.",
		"Final submission additionally reads and validates that node's persisted application state and matching native transaction fee/nonce. Header AppHash at transaction height authenticates prior application state; the local disk readback is separate evidence, not authenticated by that same-height header. Restart and all-node convergence are separate checks.",
		"Submission transport errors retain unknown outcome and are never automatically retried. Repeated identical observation errors retain counts and first/last timestamps.",
	}}
	runErr := func() error {
		data, err := readBounded(o.manifest, 1024*1024)
		if err != nil {
			return err
		}
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
		if o.offeredRate > 0 && float64(len(txs)-1)/o.offeredRate >= o.timeout.Seconds() {
			return errors.New("planned offering span cannot fit the complete configured timeout")
		}
		r.Transactions = make([]transactionResult, len(txs))
		for i, tx := range txs {
			r.Transactions[i] = transactionResult{Index: i, Hash: fmt.Sprintf("%X", tx.Hash()), Endpoint: m.Nodes[i%4].RPCURL, Bytes: len(tx), Status: "not_submitted", Errors: []errorObservation{}}
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
		if o.offeredRate > 0 {
			r.LoadMode = "paced_submission_and_observation"
			r.LoadQueues = runPacedTransactions(ctx, o, started, r.Transactions,
				func(i int) (time.Time, bool) { return submitTransaction(ctx, clients[i%4], txs[i], &r.Transactions[i]) },
				func(i int, start time.Time) {
					observeAcceptedTransaction(ctx, o, m, migration, trusted, clients[i%4], m.Nodes[i%4].ABCIStatePath, txs[i], &r.Transactions[i], start)
				})
		} else {
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
						r.Transactions[i].offerMonotonic = time.Now()
						offered := r.Transactions[i].offerMonotonic.UTC()
						r.Transactions[i].OfferedAt = &offered
						observeTransaction(ctx, o, m, migration, trusted, clients[i%4], m.Nodes[i%4].ABCIStatePath, txs[i], &r.Transactions[i])
					}
				}()
			}
			wg.Wait()
		}
		r.Summary = summarize(r.Transactions, time.Since(started).Seconds())
		if r.Summary.FinalSubmitted != len(txs) {
			return errors.New("bounded run incomplete: inspect per-transaction outcomes; no submission will be retried")
		}
		return nil
	}()
	r.FinishedAt = time.Now().UTC()
	if runErr != nil {
		addError(&r.SetupErrors, "run", runErr)
	}
	if r.MeasurementStartedAt == nil {
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
