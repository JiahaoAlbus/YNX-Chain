package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

func TestExchangeSignedVectorsArePublicCanonicalAndVerifiable(t *testing.T) {
	body, err := os.ReadFile("../../testdata/exchange-signed-transactions.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Accounts []struct {
			EVMAddress string `json:"evmAddress"`
			Role       string `json:"role"`
			YNXAddress string `json:"ynxAddress"`
		} `json:"accounts"`
		PrivateKeyMaterialIncluded bool   `json:"privateKeyMaterialIncluded"`
		Schema                     string `json:"schema"`
		TestOnly                   bool   `json:"testOnly"`
		Transactions               []struct {
			CanonicalPayloadHex string          `json:"canonicalPayloadHex"`
			Envelope            json.RawMessage `json:"envelope"`
			Purpose             string          `json:"purpose"`
			TransactionHash     string          `json:"transactionHash"`
		} `json:"transactions"`
		UnsafeForProductionCustody bool `json:"unsafeForProductionCustody"`
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Schema != "ynx-exchange-signed-vectors/v1" || !fixture.TestOnly || !fixture.UnsafeForProductionCustody || fixture.PrivateKeyMaterialIncluded {
		t.Fatalf("exchange vector safety boundary mismatch: %+v", fixture)
	}
	if len(fixture.Accounts) != 3 || len(fixture.Transactions) != 2 {
		t.Fatalf("exchange vector cardinality mismatch: %+v", fixture)
	}
	accounts := map[string]string{}
	for _, account := range fixture.Accounts {
		normalized, err := accountaddress.Normalize(account.YNXAddress)
		if err != nil || normalized != account.EVMAddress || !accountaddress.IsCanonical(account.EVMAddress) {
			t.Fatalf("exchange account aliases differ: %+v err=%v", account, err)
		}
		accounts[account.Role] = account.EVMAddress
	}
	wantPurposes := []string{"deposit-recognition", "withdrawal-broadcast"}
	decoded := make([]SignedTransaction, 0, len(fixture.Transactions))
	for index, vector := range fixture.Transactions {
		if vector.Purpose != wantPurposes[index] || len(vector.CanonicalPayloadHex) < 3 || vector.CanonicalPayloadHex[:2] != "0x" {
			t.Fatalf("exchange vector purpose/encoding mismatch: %+v", vector)
		}
		payload, err := hex.DecodeString(vector.CanonicalPayloadHex[2:])
		if err != nil {
			t.Fatal(err)
		}
		tx, err := DecodeSignedTransaction(payload)
		if err != nil || tx.Verify(6423) != nil || SignedTransactionHash(payload) != vector.TransactionHash {
			t.Fatalf("exchange signed vector failed verification: tx=%+v err=%v", tx, err)
		}
		encoded, err := json.Marshal(tx)
		if err != nil {
			t.Fatal(err)
		}
		var envelope, canonicalEnvelope any
		if err := json.Unmarshal(vector.Envelope, &envelope); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(encoded, &canonicalEnvelope); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(envelope, canonicalEnvelope) {
			t.Fatalf("exchange envelope differs from canonical payload: %s", encoded)
		}
		decoded = append(decoded, tx)
	}
	if decoded[0].From != accounts["depositor"] || decoded[0].To != accounts["exchange-deposit-and-test-hot-wallet"] || decoded[0].Amount != 1_000 || decoded[0].Nonce != 1 {
		t.Fatalf("deposit vector mismatch: %+v", decoded[0])
	}
	if decoded[1].From != accounts["exchange-deposit-and-test-hot-wallet"] || decoded[1].To != accounts["withdrawal-recipient"] || decoded[1].Amount != 125 || decoded[1].Nonce != 1 {
		t.Fatalf("withdrawal vector mismatch: %+v", decoded[1])
	}
}
