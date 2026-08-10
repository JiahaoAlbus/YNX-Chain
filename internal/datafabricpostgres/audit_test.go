package datafabricpostgres

import (
	"strings"
	"testing"
)

func TestSequenceIntegrityAuditUsesEnvelopeV2AggregateDomain(t *testing.T) {
	for _, required := range []string{
		"GROUP BY product,service,aggregate_type,aggregate_id",
		"USING (product,service,aggregate_type,aggregate_id)",
		"event_count IS DISTINCT FROM e.last_sequence",
	} {
		if !strings.Contains(sequenceIntegrityQuery, required) {
			t.Fatalf("sequence integrity audit is missing %q", required)
		}
	}
}
