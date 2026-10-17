package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const terminalSegmentRecords = 64
const terminalRowLimit = 64 << 10
const terminalStreamRecordLimit = 1_000_000

type terminalStreamReport struct {
	Directory      string `json:"directory"`
	Records        int    `json:"records"`
	DurableRecords int    `json:"durableRecords"`
	Segments       int    `json:"segments"`
	Bytes          int    `json:"bytes"`
	ChainSHA256    string `json:"chainSha256"`
	Poisoned       bool   `json:"poisoned"`
}

type terminalStreamRow struct {
	Sequence       int             `json:"sequence"`
	PreviousSHA256 string          `json:"previousSha256"`
	Result         json.RawMessage `json:"result"`
}

type terminalStreamHeader struct {
	Kind           string                   `json:"kind"`
	Segment        int                      `json:"segment"`
	FirstSequence  int                      `json:"firstSequence"`
	PreviousSHA256 string                   `json:"previousSha256"`
	Fixture        readySenderJournalHeader `json:"fixture"`
}

// Owned by the sender controller, never its concurrent submit/observe workers.
// Memory is bounded by one 64-row segment plus one nonce per sender. This is a
// terminal evidence sink, not a signed-intent queue or an automatic resume log.
type terminalStream struct {
	report          terminalStreamReport
	binding         readySenderJournalHeader
	senders         int
	lastRound       []int
	chain           [32]byte
	segmentPrevious string
	pending         [][]byte
	closed          bool
	// The seam allows genuine write/Sync errors to be tested without fake success.
	persist func(string, []byte) error
}

func persistTerminalSegment(name string, raw []byte) error {
	file, err := os.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	n, err := file.Write(raw)
	if err == nil && n != len(raw) {
		err = io.ErrShortWrite
	}
	if err == nil {
		err = file.Sync()
	}
	err = errors.Join(err, file.Close())
	if err != nil {
		return err
	}
	return syncTerminalDirectory(filepath.Dir(name))
}

func syncTerminalDirectory(name string) error {
	dir, err := os.Open(name)
	if err != nil {
		return err
	}
	return errors.Join(dir.Sync(), dir.Close())
}

func newTerminalStream(directory string, p *ephemeralSenderPool) (*terminalStream, error) {
	if p == nil || len(p.pending) < 1 || len(p.pending) > maxTransactions || p.manifestSHA256 == "" || p.migrationHash == "" || p.genesisHash == "" {
		return nil, errors.New("invalid terminal stream fixture")
	}
	if err := os.Mkdir(directory, 0700); err != nil {
		return nil, err
	}
	// Preserve the newly created evidence directory on any failure, never retry.
	if err := syncTerminalDirectory(filepath.Dir(directory)); err != nil {
		return nil, err
	}
	return &terminalStream{report: terminalStreamReport{Directory: directory}, binding: readySenderJournalHeader{"YNX_LOCAL_READY_SENDER_V1", p.manifestSHA256, p.migrationHash, p.genesisHash}, senders: len(p.pending), lastRound: make([]int, len(p.pending)), segmentPrevious: hex.EncodeToString(make([]byte, 32)), persist: persistTerminalSegment}, nil
}

func (s *terminalStream) poison(err error) error { s.report.Poisoned = true; return err }

func (s *terminalStream) append(result transactionResult) error {
	if s.closed || s.report.Poisoned {
		return errors.New("terminal stream closed or poisoned; reconcile only")
	}
	if s.report.Records >= terminalStreamRecordLimit || result.Index < 0 || result.Index >= terminalStreamRecordLimit || result.Round != result.Index/s.senders+1 || result.Round != s.lastRound[result.Index%s.senders]+1 {
		return s.poison(errors.New("terminal stream identity/order bound"))
	}
	payload, err := json.Marshal(result)
	if err != nil {
		return s.poison(err)
	}
	row, err := json.Marshal(terminalStreamRow{s.report.Records, hex.EncodeToString(s.chain[:]), payload})
	if err != nil {
		return s.poison(err)
	}
	if len(row) > terminalRowLimit {
		return s.poison(errors.New("terminal stream row exceeds 64KiB"))
	}
	s.chain = sha256.Sum256(row)
	s.pending = append(s.pending, append(row, '\n'))
	s.lastRound[result.Index%s.senders] = result.Round
	s.report.Records++
	s.report.ChainSHA256 = hex.EncodeToString(s.chain[:])
	if len(s.pending) == terminalSegmentRecords {
		return s.flush()
	}
	return nil
}

func (s *terminalStream) flush() error {
	if s.report.Poisoned {
		return errors.New("terminal stream poisoned; reconcile only")
	}
	if len(s.pending) == 0 {
		return nil
	}
	header, err := json.Marshal(terminalStreamHeader{"YNX_LOCAL_TERMINAL_SEGMENT_V1", s.report.Segments, s.report.DurableRecords, s.segmentPrevious, s.binding})
	if err != nil {
		return s.poison(err)
	}
	var raw bytes.Buffer
	raw.Write(header)
	raw.WriteByte('\n')
	for _, row := range s.pending {
		raw.Write(row)
	}
	// A sealed segment has a footer binding its count and final row hash. A partial
	// write lacks that seal; no reader should silently count it as a durable segment.
	footer, err := json.Marshal(struct {
		Kind        string `json:"kind"`
		Records     int    `json:"records"`
		ChainSHA256 string `json:"chainSha256"`
	}{"YNX_LOCAL_TERMINAL_SEAL_V1", len(s.pending), s.report.ChainSHA256})
	if err != nil {
		return s.poison(err)
	}
	raw.Write(footer)
	raw.WriteByte('\n')
	name := filepath.Join(s.report.Directory, fmt.Sprintf("terminal-%06d.jsonl", s.report.Segments))
	if err = s.persist(name, raw.Bytes()); err != nil {
		return s.poison(err)
	}
	s.report.Segments++
	s.report.DurableRecords += len(s.pending)
	s.report.Bytes += raw.Len()
	s.segmentPrevious = s.report.ChainSHA256
	s.pending = nil
	return nil
}

func (s *terminalStream) close() error {
	if s.closed {
		return errors.New("terminal stream already closed")
	}
	s.closed = true
	return s.flush()
}

// A decoder retains only its authenticated prefix counters and one round per
// sender. Validation is transactional: any corrupt/truncated segment leaves
// those counters unchanged. A sealed file alone does not prove an observed Sync.
type terminalStreamDecoder struct {
	binding           readySenderJournalHeader
	senders           int
	lastRound         []int
	sequence, segment int
	chain             [32]byte
}

func newTerminalStreamDecoder(binding readySenderJournalHeader, senders int) (*terminalStreamDecoder, error) {
	if senders < 1 || senders > maxTransactions || binding.Kind != "YNX_LOCAL_READY_SENDER_V1" || binding.ManifestSHA256 == "" || binding.MigrationHash == "" || binding.GenesisHash == "" {
		return nil, errors.New("invalid terminal decoder binding")
	}
	return &terminalStreamDecoder{binding: binding, senders: senders, lastRound: make([]int, senders)}, nil
}

func (d *terminalStreamDecoder) decode(raw []byte) ([]transactionResult, error) {
	if len(raw) > terminalSegmentRecords*(terminalRowLimit+1)+8192 || len(raw) == 0 || raw[len(raw)-1] != '\n' {
		return nil, errors.New("terminal segment byte bound or incomplete tail")
	}
	lines := bytes.Split(raw[:len(raw)-1], []byte{'\n'})
	if len(lines) < 3 || len(lines) > terminalSegmentRecords+2 {
		return nil, errors.New("terminal segment line bound")
	}
	var header terminalStreamHeader
	if err := strictJSON(lines[0], &header); err != nil {
		return nil, err
	}
	if header.Kind != "YNX_LOCAL_TERMINAL_SEGMENT_V1" || header.Fixture != d.binding || header.Segment != d.segment || header.FirstSequence != d.sequence || header.PreviousSHA256 != hex.EncodeToString(d.chain[:]) {
		return nil, errors.New("terminal segment fixture/prefix mismatch")
	}
	chain := d.chain
	lastRound := append([]int(nil), d.lastRound...)
	results := make([]transactionResult, 0, len(lines)-2)
	for i, line := range lines[1 : len(lines)-1] {
		if len(line) > terminalRowLimit || d.sequence+i >= terminalStreamRecordLimit {
			return nil, errors.New("terminal segment row bound")
		}
		var row terminalStreamRow
		if err := strictJSON(line, &row); err != nil {
			return nil, err
		}
		if row.Sequence != d.sequence+i || row.PreviousSHA256 != hex.EncodeToString(chain[:]) {
			return nil, errors.New("terminal row sequence/hash mismatch")
		}
		var r transactionResult
		if err := strictJSON(row.Result, &r); err != nil {
			return nil, err
		}
		if r.Index < 0 || r.Index >= terminalStreamRecordLimit || r.Round != r.Index/d.senders+1 || r.Round != lastRound[r.Index%d.senders]+1 {
			return nil, errors.New("terminal result identity/order mismatch")
		}
		lastRound[r.Index%d.senders] = r.Round
		chain = sha256.Sum256(line)
		results = append(results, r)
	}
	var seal struct {
		Kind        string `json:"kind"`
		Records     int    `json:"records"`
		ChainSHA256 string `json:"chainSha256"`
	}
	if err := strictJSON(lines[len(lines)-1], &seal); err != nil {
		return nil, err
	}
	if seal.Kind != "YNX_LOCAL_TERMINAL_SEAL_V1" || seal.Records != len(results) || seal.ChainSHA256 != hex.EncodeToString(chain[:]) {
		return nil, errors.New("terminal segment seal mismatch")
	}
	d.sequence += len(results)
	d.segment++
	d.chain = chain
	d.lastRound = lastRound
	return results, nil
}
