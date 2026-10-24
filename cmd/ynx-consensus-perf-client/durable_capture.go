package main

import (
	"context"
	"errors"
	"io"
)

// The first full hash pass already measured size while the original journal
// read lock was held. Allocate that bounded size once instead of growing an
// io.ReadAll buffer. The caller still rehashes every captured byte, compares the
// first digest/length and checks the original file identity before publication.
// A one-byte EOF probe rejects growth; no truncated prefix can become evidence.
func captureMeasuredDurableInput(ctx context.Context, reader io.Reader, size, limit int64) ([]byte, error) {
	if size < 0 || limit < 0 || limit > 512<<20 || size > limit {
		return nil, errors.New("durable capture size outside explicit bound")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	data := make([]byte, int(size))
	for offset := 0; offset < len(data); {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		end := offset + 32<<10
		if end > len(data) {
			end = len(data)
		}
		n, err := reader.Read(data[offset:end])
		if n < 0 || n > end-offset {
			return nil, errors.New("durable capture invalid read length")
		}
		offset += n
		if err != nil && err != io.EOF {
			return nil, err
		}
		if err == io.EOF && offset != len(data) {
			return nil, io.ErrUnexpectedEOF
		}
		if n == 0 && err == nil {
			return nil, io.ErrNoProgress
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var extra [1]byte
	n, err := reader.Read(extra[:])
	if n != 0 {
		return nil, errors.New("durable state changed during readback")
	}
	if err != io.EOF {
		if err == nil {
			err = io.ErrNoProgress
		}
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return data, nil
}
