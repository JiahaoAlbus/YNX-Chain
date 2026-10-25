package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmttypes "github.com/cometbft/cometbft/types"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const readyIntentSegmentsName = "sender-ready-intents"

func (s *readyIntentSegments) durableBytes() int64 { return s.report.Bytes }

// One segment is one already-ready wave. Persist uses the existing exclusive
// write/file-Sync/close/directory-Sync primitive used by terminal evidence.
// This is signed-intent evidence, never a business-state store or retry queue.
type readyIntentSegmentReport struct {
	Directory   string `json:"directory"`
	Records     int    `json:"records"`
	Segments    int    `json:"segments"`
	Bytes       int64  `json:"bytes"`
	ChainSHA256 string `json:"chainSha256"`
	Poisoned    bool   `json:"poisoned"`
}

type readyIntentSegmentHeader struct {
	Kind           string                   `json:"kind"`
	Fixture        readySenderJournalHeader `json:"fixture"`
	Segment        int                      `json:"segment"`
	FirstRecord    int                      `json:"firstRecord"`
	Records        int                      `json:"records"`
	PreviousSHA256 string                   `json:"previousSha256"`
	PayloadSHA256  string                   `json:"payloadSha256"`
}

type readyIntentSegments struct {
	report     readyIntentSegmentReport
	binding    readySenderJournalHeader
	lastRound  []int
	maxRecords int
	maxBytes   int64
	closed     bool
	persist    func(string, []byte) error
}

func newReadyIntentSegments(directory string, p *ephemeralSenderPool, maxRecords int, maxBytes int64) (*readyIntentSegments, error) {
	if p == nil || len(p.pending) < 1 || len(p.pending) > maxTransactions || maxRecords < len(p.pending) || maxRecords > terminalStreamRecordLimit || maxBytes < 1 || maxBytes > 1<<30 || p.manifestSHA256 == "" || p.migrationHash == "" || p.genesisHash == "" {
		return nil, errors.New("ready intent segment bounds or binding")
	}
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return nil, err
	}
	if err := os.Mkdir(absolute, 0700); err != nil {
		return nil, err
	}
	if err := syncTerminalDirectory(filepath.Dir(absolute)); err != nil {
		return nil, err // Preserve the directory; never retry uncertain creation.
	}
	return &readyIntentSegments{report: readyIntentSegmentReport{Directory: absolute, ChainSHA256: fmt.Sprintf("%064x", 0)}, binding: readySenderJournalHeader{"YNX_LOCAL_READY_SENDER_V1", p.manifestSHA256, p.migrationHash, p.genesisHash}, lastRound: make([]int, len(p.pending)), maxRecords: maxRecords, maxBytes: maxBytes, persist: persistTerminalSegment}, nil
}

func (s *readyIntentSegments) append(wave []readySenderEnvelope) error {
	if s.closed || s.report.Poisoned {
		return errors.New("ready intent segments closed or poisoned; reconcile only")
	}
	poison := func(err error) error { s.report.Poisoned = true; return err }
	if len(wave) < 1 || len(wave) > terminalSegmentRecords || s.report.Records+len(wave) > s.maxRecords {
		return poison(errors.New("ready intent segment record bound"))
	}
	lastRound := append([]int(nil), s.lastRound...)
	var payload []byte
	for _, e := range wave {
		if e.Index < 0 || e.Index >= s.maxRecords || e.Sender != e.Index%len(lastRound) || e.Round != e.Index/len(lastRound)+1 || e.Round != lastRound[e.Sender]+1 || e.Hash != fmt.Sprintf("%X", e.Transaction.Hash()) {
			return poison(errors.New("ready intent segment identity/order mismatch"))
		}
		line, err := json.Marshal(e)
		if err != nil {
			return poison(err)
		}
		if len(line) >= terminalRowLimit {
			return poison(errors.New("ready intent row byte bound"))
		}
		payload = append(payload, line...)
		payload = append(payload, '\n')
		lastRound[e.Sender] = e.Round
	}
	payloadHash := sha256.Sum256(payload)
	header, err := json.Marshal(readyIntentSegmentHeader{"YNX_LOCAL_READY_INTENT_SEGMENT_V1", s.binding, s.report.Segments, s.report.Records, len(wave), s.report.ChainSHA256, hex.EncodeToString(payloadHash[:])})
	if err != nil {
		return poison(err)
	}
	raw := append(append(header, '\n'), payload...)
	if s.report.Bytes+int64(len(raw)) > s.maxBytes {
		return poison(errors.New("ready intent stream byte bound"))
	}
	name := filepath.Join(s.report.Directory, fmt.Sprintf("intent-%06d.jsonl", s.report.Segments))
	if err := s.persist(name, raw); err != nil {
		return poison(err) // Partial/complete uncertain files survive, no counters advance.
	}
	digest := sha256.Sum256(raw)
	s.report.Records += len(wave)
	s.report.Segments++
	s.report.Bytes += int64(len(raw))
	s.report.ChainSHA256 = hex.EncodeToString(digest[:])
	s.lastRound = lastRound
	return nil
}

func (s *readyIntentSegments) close() error {
	if s.closed || s.report.Poisoned {
		return errors.New("ready intent segments closed or poisoned; reconcile only")
	}
	s.closed = true
	return nil // No buffered identities or deferred Sync.
}

// Adapts one captured/hash-checked segment at a time to the existing V1 identity
// scanner. Its normal signature/nonce checks remain authoritative for records.
type readyIntentSegmentReader struct {
	report  readyIntentSegmentReport
	binding readySenderJournalHeader
	current *bytes.Reader
	next    int
	records int
	bytes   int64
	chain   string
}

func (r *readyIntentSegmentReader) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	for {
		if r.current != nil && r.current.Len() > 0 {
			return r.current.Read(p)
		}
		if r.next == r.report.Segments {
			if r.records != r.report.Records || r.bytes != r.report.Bytes || r.chain != r.report.ChainSHA256 {
				return 0, errors.New("ready intent final inventory/hash mismatch")
			}
			return 0, io.EOF
		}
		name := filepath.Join(r.report.Directory, fmt.Sprintf("intent-%06d.jsonl", r.next))
		raw, err := captureTerminalSegment(name, r.report.Bytes-r.bytes)
		if err != nil {
			return 0, err
		}
		header, payload, chain, err := decodeReadyIntentSegment(raw, r.binding, r.next, r.records, r.chain)
		if err != nil {
			return 0, err
		}
		r.records += header.Records
		r.bytes += int64(len(raw))
		r.chain = chain
		r.next++
		r.current = bytes.NewReader(payload)
	}
}

// Full-inventory read-only validation. Any missing/extra/partial/uncertain file
// fails; it never treats a missing intent as unsubmitted or resumes a sender.
func scanReadyIntentSegments(ctx context.Context, report readyIntentSegmentReport, manifestRaw []byte, m consensus.EphemeralNetworkManifest, initial []cmttypes.Tx, rounds int, maxBytes int64, consume func(readySenderEnvelope) error) (readySenderStreamReadback, error) {
	var empty readySenderStreamReadback
	if maxBytes < 1 || maxBytes > 1<<30 || report.Poisoned || report.Records < 0 || report.Records > terminalStreamRecordLimit || report.Segments < 0 || report.Segments > report.Records || report.Bytes < 0 || report.Bytes > maxBytes || !filepath.IsAbs(report.Directory) {
		return empty, errors.New("ready intent readback report bounds")
	}
	info, err := os.Lstat(report.Directory)
	if err != nil {
		return empty, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return empty, errors.New("ready intent directory identity")
	}
	dir, err := os.Open(report.Directory)
	if err != nil {
		return empty, err
	}
	count := 0
	for {
		if err := ctx.Err(); err != nil {
			_ = dir.Close()
			return empty, err
		}
		entries, readErr := dir.ReadDir(64)
		for _, entry := range entries {
			count++
			number := strings.TrimSuffix(strings.TrimPrefix(entry.Name(), "intent-"), ".jsonl")
			i, e := strconv.Atoi(number)
			if count > report.Segments || e != nil || i < 0 || i >= report.Segments || entry.Name() != fmt.Sprintf("intent-%06d.jsonl", i) || !entry.Type().IsRegular() {
				_ = dir.Close()
				return empty, errors.New("ready intent inventory mismatch")
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			_ = dir.Close()
			return empty, readErr
		}
	}
	if err := dir.Close(); err != nil {
		return empty, err
	}
	if count != report.Segments {
		return empty, errors.New("ready intent missing segment")
	}
	binding := readySenderJournalHeader{"YNX_LOCAL_READY_SENDER_V1", "", m.MigrationStateHash, m.GenesisHash}
	sum := sha256.Sum256(manifestRaw)
	binding.ManifestSHA256 = hex.EncodeToString(sum[:])
	header, err := json.Marshal(binding)
	if err != nil {
		return empty, err
	}
	header = append(header, '\n')
	if report.Bytes+int64(len(header)) > 1<<30 {
		return empty, errors.New("ready intent logical byte bound")
	}
	reader := &readyIntentSegmentReader{report: report, binding: binding, current: bytes.NewReader(header), chain: fmt.Sprintf("%064x", 0)}
	out, err := scanReadySenderJournal(ctx, reader, manifestRaw, m, initial, rounds, report.Bytes+int64(len(header)), consume)
	if err != nil {
		return empty, err
	}
	if out.IncompleteTail || out.Records != report.Records {
		return empty, errors.New("ready intent incomplete decoded inventory")
	}
	out.BytesRead = reader.bytes
	return out, nil
}

func decodeReadyIntentSegment(raw []byte, binding readySenderJournalHeader, segment, firstRecord int, previous string) (readyIntentSegmentHeader, []byte, string, error) {
	first := bytes.IndexByte(raw, '\n')
	if first < 0 || len(raw) == 0 || raw[len(raw)-1] != '\n' {
		return readyIntentSegmentHeader{}, nil, "", errors.New("ready intent segment incomplete")
	}
	var header readyIntentSegmentHeader
	if err := strictJSON(raw[:first], &header); err != nil {
		return readyIntentSegmentHeader{}, nil, "", err
	}
	payload := raw[first+1:]
	digest := sha256.Sum256(payload)
	if header.Kind != "YNX_LOCAL_READY_INTENT_SEGMENT_V1" || header.Fixture != binding || header.Segment != segment || header.FirstRecord != firstRecord || header.PreviousSHA256 != previous || header.Records < 1 || header.Records > terminalSegmentRecords || bytes.Count(payload, []byte{'\n'}) != header.Records || header.PayloadSHA256 != hex.EncodeToString(digest[:]) {
		return readyIntentSegmentHeader{}, nil, "", errors.New("ready intent segment fixture/prefix/payload mismatch")
	}
	digest = sha256.Sum256(raw)
	return header, payload, hex.EncodeToString(digest[:]), nil
}
