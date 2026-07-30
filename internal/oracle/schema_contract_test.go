package oracle

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestOracleSchemasFreezeProviderAndDerivedPriceBoundaries(t *testing.T) {
	paths := []string{
		"../../integration/oracle/v1/observation.schema.json",
		"../../integration/oracle/v1/price.schema.json",
	}
	contents := make([]string, 0, len(paths))
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var parsed map[string]any
		if err := json.Unmarshal(data, &parsed); err != nil {
			t.Fatalf("invalid JSON schema %s: %v", path, err)
		}
		contents = append(contents, string(data))
	}

	observationSchema := contents[0]
	for _, providerInput := range []string{"premium_reference", "basis_reference", "stablecoin_depeg", "stablecoin_reserve_evidence", "dex_pool_state"} {
		if !strings.Contains(observationSchema, `"`+providerInput+`"`) {
			t.Fatalf("provider input %s missing from observation schema", providerInput)
		}
	}
	for _, oracleOwned := range []string{"index_price", "mark_price", "funding_reference", "stablecoin_reserve_ratio", "dex_twap"} {
		if strings.Contains(observationSchema, `"`+oracleOwned+`"`) {
			t.Fatalf("Oracle-derived type %s leaked into provider observation schema", oracleOwned)
		}
	}

	priceSchema := contents[1]
	for _, required := range []string{
		`"index-funding-mark-v1"`,
		`"liquidity_weighted_median_spot_index"`,
		`"premium_plus_basis_with_governance_clamp"`,
		`"index_times_one_plus_funding_reference"`,
		`"dex-twap-v1"`,
		`"confirmed_multi_block_guarded_twap"`,
		`"confirmationDepth"`,
		`"rejectedBlockNumbers"`,
		`"stablecoin-reserve-v1"`,
		`"reserve_assets_divided_by_outstanding_claims"`,
		`"documentHash"`,
		`"attestationSignatureHex"`,
		`"reserve-attestation-ed25519-v1"`,
		`"componentLineageHashes"`,
	} {
		if !strings.Contains(priceSchema, required) {
			t.Fatalf("derived price contract missing %s", required)
		}
	}
}
