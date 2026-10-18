package main

import (
	"bytes"
	"compress/gzip"
	"errors"
	"io"
)

const terminalDecodedSegmentLimit = terminalSegmentRecords*(terminalRowLimit+1) + 8192

// Compression changes storage bytes only. The original header/rows/seal and
// hash-chain input remain byte-identical. Both encoded and decoded segments
// retain the original bound; incompressible overflow fails rather than widening it.
func encodeTerminalSegment(raw []byte, encoding string) ([]byte, error) {
	if len(raw) == 0 || len(raw) > terminalDecodedSegmentLimit {
		return nil, errors.New("terminal encoding input byte bound")
	}
	if encoding == "" {
		return raw, nil
	}
	if encoding != "gzip" {
		return nil, errors.New("unsupported terminal encoding")
	}
	var out bytes.Buffer
	writer, err := gzip.NewWriterLevel(&out, gzip.BestSpeed)
	if err != nil {
		return nil, err
	}
	if _, err = writer.Write(raw); err != nil {
		return nil, errors.Join(err, writer.Close())
	}
	if err = writer.Close(); err != nil {
		return nil, err
	}
	if out.Len() > terminalDecodedSegmentLimit {
		return nil, errors.New("encoded terminal segment byte bound")
	}
	return out.Bytes(), nil
}

func decodeTerminalSegment(raw []byte, encoding string) ([]byte, error) {
	if len(raw) == 0 || len(raw) > terminalDecodedSegmentLimit {
		return nil, errors.New("encoded terminal segment byte bound")
	}
	if encoding == "" {
		return raw, nil
	}
	if encoding != "gzip" {
		return nil, errors.New("unsupported terminal encoding")
	}
	input := bytes.NewReader(raw)
	reader, err := gzip.NewReader(input)
	if err != nil {
		return nil, err
	}
	reader.Multistream(false)
	decoded, readErr := io.ReadAll(io.LimitReader(reader, terminalDecodedSegmentLimit+1))
	closeErr := reader.Close()
	if err = errors.Join(readErr, closeErr); err != nil {
		return nil, err
	}
	if len(decoded) > terminalDecodedSegmentLimit || input.Len() != 0 {
		return nil, errors.New("terminal expansion bound or trailing gzip member/bytes")
	}
	return decoded, nil
}

func (d *terminalStreamDecoder) decodeStored(raw []byte, encoding string) ([]transactionResult, error) {
	decoded, err := decodeTerminalSegment(raw, encoding)
	if err != nil {
		return nil, err
	}
	return d.decode(decoded)
}
