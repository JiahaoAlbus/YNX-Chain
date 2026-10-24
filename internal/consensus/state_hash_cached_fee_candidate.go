package consensus

// Explicit timestamp-reuse experiment only. Production hashCommittedStateDocument remains on
// the measured borrowed encoder. All original history bytes are still hashed.
import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"sync"
	"time"
)

func hashCachedFeeDocument(doc committedStateHashDocument) (string, error) {
	digest := sha256.New()
	if err := encodeCachedFeeDocument(digest, doc); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}
func encodeCachedFeeDocument(destination io.Writer, doc committedStateHashDocument) error {
	if len(doc.FeeEvents) == 0 {
		raw, err := json.Marshal(doc)
		if err != nil {
			return err
		}
		return writeStateHashPiece(destination, raw)
	}
	fees := doc.FeeEvents
	doc.FeeEvents = []BFTFeeEvent{{}}
	writer := cachedFeeScaffoldWriter{destination: destination, fees: fees}
	return json.NewEncoder(&writer).Encode(doc)
}

type cachedFeeScratch struct{ data []byte }

var cachedFeeScratchPool = sync.Pool{New: func() any { return &cachedFeeScratch{data: make([]byte, 0, 64<<10)} }}

type cachedFeeScaffoldWriter struct {
	destination io.Writer
	fees        []BFTFeeEvent
	wrote       bool
}

func (w *cachedFeeScaffoldWriter) Write(raw []byte) (int, error) {
	if w.wrote || len(raw) < 3 || raw[len(raw)-1] != '\n' {
		return 0, errors.New("direct fee scaffold requires one framed JSON document")
	}
	w.wrote = true
	scaffold := raw[:len(raw)-1]
	start, end, err := feeArrayBounds(scaffold)
	if err != nil {
		return 0, err
	}
	if err = writeStateHashPiece(w.destination, scaffold[:start]); err != nil {
		return 0, err
	}
	scratch := cachedFeeScratchPool.Get().(*cachedFeeScratch)
	buffer := scratch.data[:0]
	defer func() {
		if cap(buffer) <= 128<<10 {
			scratch.data = buffer[:0]
			cachedFeeScratchPool.Put(scratch)
		}
	}()
	buffer = append(buffer, '[')
	var clock feeJSONTimeCache
	for index, event := range w.fees {
		if index > 0 {
			buffer = append(buffer, ',')
		}
		buffer, err = appendCachedFeeJSON(buffer, event, &clock)
		if err != nil {
			return 0, err
		}
		if len(buffer) >= 32<<10 {
			if err = writeStateHashPiece(w.destination, buffer); err != nil {
				return 0, err
			}
			buffer = buffer[:0]
		}
	}
	buffer = append(buffer, ']')
	if err = writeStateHashPiece(w.destination, buffer); err != nil {
		return 0, err
	}
	if err = writeStateHashPiece(w.destination, scaffold[end:]); err != nil {
		return 0, err
	}
	return len(raw), nil
}

// Generated business identifiers use JSON-safe ASCII. Any escaping, Unicode or
// invalid UTF8 delegates to the standard encoder with its original HTML rules.
func appendCachedJSONString(dst []byte, value string) []byte {
	for i := 0; i < len(value); i++ {
		c := value[i]
		if c < 0x20 || c >= 0x80 || c == '"' || c == '\\' || c == '<' || c == '>' || c == '&' {
			raw, _ := json.Marshal(value)
			return append(dst, raw...)
		}
	}
	dst = append(dst, '"')
	dst = append(dst, value...)
	return append(dst, '"')
}
func appendCachedFeeJSON(dst []byte, event BFTFeeEvent, clock *feeJSONTimeCache) ([]byte, error) {
	dst = append(dst, `{"id":`...)
	dst = appendCachedJSONString(dst, event.ID)
	dst = append(dst, `,"policyVersion":`...)
	dst = strconv.AppendInt(dst, int64(event.PolicyVersion), 10)
	dst = append(dst, `,"txHash":`...)
	dst = appendCachedJSONString(dst, event.TxHash)
	dst = append(dst, `,"transactionType":`...)
	dst = appendCachedJSONString(dst, event.TransactionType)
	dst = append(dst, `,"payer":`...)
	dst = appendCachedJSONString(dst, event.Payer)
	dst = append(dst, `,"recipient":`...)
	dst = appendCachedJSONString(dst, event.Recipient)
	dst = append(dst, `,"grossFeeYnxt":`...)
	dst = strconv.AppendInt(dst, int64(event.GrossFeeYNXT), 10)
	dst = append(dst, `,"burnYnxt":`...)
	dst = strconv.AppendInt(dst, int64(event.BurnYNXT), 10)
	dst = append(dst, `,"validatorYnxt":`...)
	dst = strconv.AppendInt(dst, int64(event.ValidatorYNXT), 10)
	dst = append(dst, `,"providerYnxt":`...)
	dst = strconv.AppendInt(dst, int64(event.ProviderYNXT), 10)
	dst = append(dst, `,"protocolYnxt":`...)
	dst = strconv.AppendInt(dst, int64(event.ProtocolYNXT), 10)
	dst = append(dst, `,"treasuryYnxt":`...)
	dst = strconv.AppendInt(dst, int64(event.TreasuryYNXT), 10)
	dst = append(dst, `,"sponsored":`...)
	dst = strconv.AppendBool(dst, event.Sponsored)
	dst = append(dst, `,"source":`...)
	dst = appendCachedJSONString(dst, event.Source)
	dst = append(dst, `,"blockHeight":`...)
	dst = strconv.AppendInt(dst, int64(event.BlockHeight), 10)
	dst = append(dst, `,"recordedAt":`...)
	raw, err := clock.encode(event.RecordedAt)
	if err != nil {
		return nil, err
	}
	dst = append(dst, raw...)
	dst = append(dst, `,"auditHash":`...)
	dst = appendCachedJSONString(dst, event.AuditHash)
	return append(dst, '}'), nil
}

// Per-write cache only. Compare the complete time value, not Equal (which ignores
// the original zone representation). No bytes, time or validation authority
// survive this encoding call; each miss uses the original MarshalJSON.
type feeJSONTimeCache struct {
	valid    bool
	previous time.Time
	encoded  []byte
}

func (c *feeJSONTimeCache) encode(value time.Time) ([]byte, error) {
	if c.valid && value == c.previous {
		return c.encoded, nil
	}
	raw, err := value.MarshalJSON()
	if err != nil {
		// Preserve encoding/json's original MarshalerError and first cause on
		// invalid times, including errors.As/Unwrap behavior. No cache on error.
		_, originalErr := json.Marshal(value)
		return nil, originalErr
	}
	c.valid = true
	c.previous = value
	c.encoded = raw
	return raw, nil
}
