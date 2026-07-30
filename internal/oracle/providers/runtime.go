package providers

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/oracle"
)

type SequenceStore struct {
	mu   sync.Mutex
	path string
	last uint64
}

func OpenSequenceStore(path string) (*SequenceStore, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("provider sequence state path required")
	}
	last, err := readSequence(path)
	if err != nil {
		return nil, err
	}
	return &SequenceStore{path: path, last: last}, nil
}

func readSequence(path string) (uint64, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("stat provider sequence state: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() > 64 {
		return 0, errors.New("provider sequence state must be a small regular file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, fmt.Errorf("read provider sequence state: %w", err)
	}
	last, err := strconv.ParseUint(strings.TrimSpace(string(data)), 10, 64)
	if err != nil {
		return 0, errors.New("provider sequence state is invalid")
	}
	return last, nil
}

func (state *SequenceStore) Next(now time.Time) (uint64, error) {
	if state == nil || now.IsZero() || now.UnixNano() <= 0 {
		return 0, errors.New("provider sequence state and current time required")
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	directory := filepath.Dir(state.path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return 0, fmt.Errorf("create provider sequence directory: %w", err)
	}
	lockPath := state.path + ".lock"
	if info, err := os.Lstat(lockPath); err == nil && (!info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0) {
		return 0, errors.New("provider sequence lock must be a regular file")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return 0, fmt.Errorf("stat provider sequence lock: %w", err)
	}
	lock, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return 0, fmt.Errorf("open provider sequence lock: %w", err)
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return 0, fmt.Errorf("lock provider sequence state: %w", err)
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	persisted, err := readSequence(state.path)
	if err != nil {
		return 0, err
	}
	if persisted > state.last {
		state.last = persisted
	}
	if state.last == math.MaxUint64 {
		return 0, errors.New("provider sequence exhausted")
	}
	next := uint64(now.UnixNano())
	if next <= state.last {
		next = state.last + 1
	}
	if err := persistSequence(state.path, next); err != nil {
		return 0, err
	}
	state.last = next
	return next, nil
}

func persistSequence(path string, value uint64) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create provider sequence directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("create provider sequence temporary file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.WriteString(strconv.FormatUint(value, 10) + "\n"); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("replace provider sequence state: %w", err)
	}
	if directoryHandle, err := os.Open(directory); err == nil {
		_ = directoryHandle.Sync()
		_ = directoryHandle.Close()
	}
	return nil
}

func LoadReporterPrivateKey(path string, provider oracle.Provider) (ed25519.PrivateKey, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("reporter signer path required")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, fmt.Errorf("stat reporter signer: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o077 != 0 || info.Size() > 256 {
		return nil, errors.New("reporter signer must be a small owner-only regular file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read reporter signer: %w", err)
	}
	decoded, err := hex.DecodeString(strings.TrimSpace(string(data)))
	if err != nil || len(decoded) != ed25519.PrivateKeySize {
		return nil, errors.New("reporter signer must contain one Ed25519 private key in hex")
	}
	privateKey := ed25519.PrivateKey(decoded)
	publicKey, err := hex.DecodeString(provider.ReporterPublicKeyHex)
	if err != nil || !bytes.Equal(privateKey.Public().(ed25519.PublicKey), publicKey) {
		return nil, errors.New("reporter signer does not match provider registry")
	}
	return privateKey, nil
}

func BuildObservation(candidate Candidate, provider oracle.Provider, privateKey ed25519.PrivateKey, nonceDomain string, sequence uint64, receivedAt time.Time) (oracle.Observation, error) {
	if err := provider.Validate(); err != nil {
		return oracle.Observation{}, err
	}
	if provider.Status != "active" {
		return oracle.Observation{}, errors.New("provider registry entry is not active")
	}
	if candidate.ProviderID != provider.ID || !provider.CoversMarket(candidate.Market) ||
		candidate.Source != provider.Endpoint || candidate.SourceVersion != provider.APIVersion ||
		candidate.Value <= 0 || candidate.Scale <= 0 || candidate.Volume24H < 0 ||
		candidate.ObservedAt.IsZero() || receivedAt.IsZero() || receivedAt.Before(candidate.ObservedAt) ||
		sequence == 0 || strings.TrimSpace(nonceDomain) == "" {
		return oracle.Observation{}, errors.New("provider candidate does not match active registry authority")
	}
	publicKey, err := hex.DecodeString(provider.ReporterPublicKeyHex)
	if err != nil || len(privateKey) != ed25519.PrivateKeySize ||
		!bytes.Equal(privateKey.Public().(ed25519.PublicKey), publicKey) {
		return oracle.Observation{}, errors.New("reporter key does not match provider registry")
	}
	observation := oracle.Observation{
		Schema: oracle.SchemaVersion, ID: provider.ID + "-" + strconv.FormatUint(sequence, 10),
		ProviderID: provider.ID, ReporterID: provider.ReporterID, Sequence: sequence, NonceDomain: nonceDomain,
		Market: candidate.Market, Type: oracle.SpotPrice, Value: candidate.Value, Scale: candidate.Scale,
		Volume24H: candidate.Volume24H, ObservedAt: candidate.ObservedAt.UTC(), ReceivedAt: receivedAt.UTC(),
		Source: candidate.Source, SourceVersion: candidate.SourceVersion,
	}
	if err := observation.Sign(privateKey); err != nil {
		return oracle.Observation{}, err
	}
	if err := observation.Verify(provider, nonceDomain); err != nil {
		return oracle.Observation{}, err
	}
	return observation, nil
}

type PublishReceipt struct {
	Accepted      bool   `json:"accepted"`
	Created       bool   `json:"created"`
	ObservationID string `json:"observationId"`
	Hash          string `json:"hash"`
}

type Publisher struct {
	client   *http.Client
	endpoint string
}

func NewPublisher(baseURL string, client *http.Client) (*Publisher, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		(parsed.Path != "" && parsed.Path != "/") {
		return nil, errors.New("oracle base URL must be an origin")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && loopbackHost(parsed.Hostname())) {
		return nil, errors.New("oracle publisher requires HTTPS except on loopback")
	}
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	if client.Timeout <= 0 {
		return nil, errors.New("oracle publisher client requires an overall timeout")
	}
	clientCopy := *client
	clientCopy.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return errors.New("oracle publisher redirects are rejected")
	}
	return &Publisher{client: &clientCopy, endpoint: strings.TrimSuffix(baseURL, "/") + "/internal/v1/observations"}, nil
}

func loopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (publisher *Publisher) Publish(ctx context.Context, observation oracle.Observation) (PublishReceipt, error) {
	if publisher == nil || publisher.client == nil || publisher.endpoint == "" {
		return PublishReceipt{}, errors.New("oracle publisher is not configured")
	}
	body, err := json.Marshal(observation)
	if err != nil {
		return PublishReceipt{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, publisher.endpoint, bytes.NewReader(body))
	if err != nil {
		return PublishReceipt{}, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "YNX-Oracle-Provider/0.1-testnet")
	response, err := publisher.client.Do(request)
	if err != nil {
		return PublishReceipt{}, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	if err != nil {
		return PublishReceipt{}, err
	}
	if len(data) > 64<<10 {
		return PublishReceipt{}, errors.New("oracle ingestion response exceeds limit")
	}
	if response.StatusCode != http.StatusCreated && response.StatusCode != http.StatusOK {
		return PublishReceipt{}, fmt.Errorf("oracle ingestion rejected: HTTP %d", response.StatusCode)
	}
	var receipt PublishReceipt
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&receipt); err != nil {
		return PublishReceipt{}, errors.New("oracle ingestion receipt schema invalid")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return PublishReceipt{}, errors.New("oracle ingestion receipt framing invalid")
	}
	if !receipt.Accepted || receipt.ObservationID != observation.ID || receipt.Hash != observation.Hash {
		return PublishReceipt{}, errors.New("oracle ingestion receipt does not match observation")
	}
	return receipt, nil
}

type FetchFunc func(context.Context) (Candidate, error)

type Worker struct {
	fetch       FetchFunc
	provider    oracle.Provider
	privateKey  ed25519.PrivateKey
	nonceDomain string
	sequences   *SequenceStore
	publisher   *Publisher
	now         func() time.Time
	maximumAge  time.Duration
	futureSkew  time.Duration
}

func NewWorker(fetch FetchFunc, provider oracle.Provider, privateKey ed25519.PrivateKey, nonceDomain string, sequences *SequenceStore, publisher *Publisher, now func() time.Time) (*Worker, error) {
	if fetch == nil || sequences == nil || publisher == nil {
		return nil, errors.New("provider fetcher, sequence store, and publisher required")
	}
	if now == nil {
		now = time.Now
	}
	if err := provider.Validate(); err != nil {
		return nil, err
	}
	if provider.Status != "active" {
		return nil, errors.New("provider worker requires an approved active registry entry")
	}
	current := now().UTC()
	if _, err := BuildObservation(Candidate{
		ProviderID: provider.ID, Market: provider.AssetMarketCoverage[0], Value: 1, Scale: 1,
		ObservedAt: current, Source: provider.Endpoint, SourceVersion: provider.APIVersion,
	}, provider, privateKey, nonceDomain, 1, current); err != nil {
		return nil, err
	}
	return &Worker{
		fetch: fetch, provider: provider, privateKey: privateKey, nonceDomain: nonceDomain,
		sequences: sequences, publisher: publisher, now: now,
		maximumAge: 30 * time.Second, futureSkew: 2 * time.Second,
	}, nil
}

func (worker *Worker) RunOnce(ctx context.Context) (PublishReceipt, error) {
	candidate, err := worker.fetch(ctx)
	if err != nil {
		return PublishReceipt{}, err
	}
	now := worker.now().UTC()
	if candidate.ObservedAt.After(now.Add(worker.futureSkew)) || now.Sub(candidate.ObservedAt) > worker.maximumAge {
		return PublishReceipt{}, errors.New("official provider candidate is stale or future-dated")
	}
	sequence, err := worker.sequences.Next(now)
	if err != nil {
		return PublishReceipt{}, err
	}
	observation, err := BuildObservation(candidate, worker.provider, worker.privateKey, worker.nonceDomain, sequence, now)
	if err != nil {
		return PublishReceipt{}, err
	}
	return worker.publisher.Publish(ctx, observation)
}
