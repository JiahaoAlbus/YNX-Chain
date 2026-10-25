package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"math/rand"
	"strings"
	"testing"
	"time"
)

// Frozen original formatter is the compatibility oracle for the existing V1
// fee-audit byte contract, including separators, signed numbers and UTC time.
func legacyFeeEventAuditHash(event BFTFeeEvent) string {
	payload := fmt.Sprintf("YNX_FEE_EVENT_AUDIT_V1\x00%s\x00%d\x00%s\x00%s\x00%s\x00%s\x00%d\x00%d\x00%d\x00%d\x00%d\x00%d\x00%t\x00%s\x00%d\x00%s", event.ID, event.PolicyVersion, event.TxHash, event.TransactionType, event.Payer, event.Recipient, event.GrossFeeYNXT, event.BurnYNXT, event.ValidatorYNXT, event.ProviderYNXT, event.ProtocolYNXT, event.TreasuryYNXT, event.Sponsored, event.Source, event.BlockHeight, event.RecordedAt.UTC().Format(time.RFC3339Nano))
	sum := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(sum[:])
}

func feeAuditEncodingFixture() BFTFeeEvent {
	event := feeJournalTestEvent(strings.Repeat("a", 64))
	event.TxHash = strings.Repeat("b", 64)
	event.Payer = strings.Repeat("c", 44)
	event.Recipient = strings.Repeat("d", 44)
	return event
}

func TestFeeAuditEncodingPreservesV1Hashes(t *testing.T) {
	rng := rand.New(rand.NewSource(6423))
	texts := []string{"", "0", "a\x00b", "汉字<&>\"\n", strings.Repeat("long-field-", 512)}
	numbers := []int64{0, 1, -1, math.MinInt64, math.MaxInt64, 6423}
	times := []time.Time{time.Time{}, time.Unix(1, 123456789), time.Date(2026, 10, 17, 9, 8, 7, 120000000, time.FixedZone("offset", -5*3600))}
	for i := 0; i < 128; i++ {
		event := feeAuditEncodingFixture()
		event.ID = texts[rng.Intn(len(texts))]
		event.TxHash = texts[rng.Intn(len(texts))]
		event.TransactionType = texts[rng.Intn(len(texts))]
		event.Payer = texts[rng.Intn(len(texts))]
		event.Recipient = texts[rng.Intn(len(texts))]
		event.Source = texts[rng.Intn(len(texts))]
		event.PolicyVersion = int(numbers[rng.Intn(len(numbers))])
		event.GrossFeeYNXT = numbers[rng.Intn(len(numbers))]
		event.BurnYNXT = numbers[rng.Intn(len(numbers))]
		event.ValidatorYNXT = numbers[rng.Intn(len(numbers))]
		event.ProviderYNXT = numbers[rng.Intn(len(numbers))]
		event.ProtocolYNXT = numbers[rng.Intn(len(numbers))]
		event.TreasuryYNXT = numbers[rng.Intn(len(numbers))]
		event.BlockHeight = numbers[rng.Intn(len(numbers))]
		event.Sponsored = i%2 == 0
		event.RecordedAt = times[i%len(times)]
		if got, want := feeEventAuditHash(event), legacyFeeEventAuditHash(event); got != want {
			t.Fatalf("case %d: V1 hash changed: got %s want %s", i, got, want)
		}
	}
}

var feeAuditHashSink string

func BenchmarkFeeEventAuditHash(b *testing.B) {
	event := feeAuditEncodingFixture()
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		feeAuditHashSink = feeEventAuditHash(event)
	}
}
