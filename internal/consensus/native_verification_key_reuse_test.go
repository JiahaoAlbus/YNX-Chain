package consensus

import (
	"crypto/sha256"
	"encoding/asn1"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

// Exact Verify body from SOURCE af06b34b1c, retained only as the local
// duplicate-parse differential/benchmark control, with NativeAddress's original
// body also retained below. No production dispatch.
func verifyNativeDuplicateParseBaseline(tx SignedTransaction, expectedChainID int64) error {
	if err := tx.ValidateBasic(); err != nil {
		return err
	}
	if tx.ChainID != expectedChainID {
		return fmt.Errorf("signed transaction chain ID %d does not match %d", tx.ChainID, expectedChainID)
	}
	publicKeyBytes, _ := hex.DecodeString(tx.PublicKey)
	derived, err := nativeAddressDuplicateParseBaseline(publicKeyBytes)
	if err != nil {
		return err
	}
	if derived != tx.From {
		return errors.New("signed transaction sender does not match its public key")
	}
	if tx.Signature == "" {
		return errors.New("signed transaction signature is required")
	}
	publicKey, err := secp256k1.ParsePubKey(publicKeyBytes)
	if err != nil {
		return fmt.Errorf("parse signed transaction public key: %w", err)
	}
	signatureBytes, _ := hex.DecodeString(tx.Signature)
	signature, err := ecdsa.ParseDERSignature(signatureBytes)
	if err != nil {
		return fmt.Errorf("parse signed transaction signature: %w", err)
	}
	sValue := signature.S()
	if sValue.IsOverHalfOrder() {
		return errors.New("signed transaction signature is not canonical low-S")
	}
	signBytes, err := tx.SignBytes()
	if err != nil {
		return err
	}
	digest := sha256.Sum256(signBytes)
	if !signature.Verify(digest[:], publicKey) {
		return errors.New("signed transaction signature verification failed")
	}
	return nil
}

func nativeAddressDuplicateParseBaseline(publicKey []byte) (string, error) {
	parsed, err := secp256k1.ParsePubKey(publicKey)
	if err != nil {
		return "", fmt.Errorf("parse secp256k1 public key: %w", err)
	}
	uncompressed := parsed.SerializeUncompressed()
	hasher := sha3.NewLegacyKeccak256()
	_, _ = hasher.Write(uncompressed[1:])
	sum := hasher.Sum(nil)
	return accountaddress.FromBytes(sum[len(sum)-20:])
}

func TestNativeVerifyParsedKeyReuseMatchesOriginal(t *testing.T) {
	key := deterministicPrivateKey(61)
	to, err := NativeAddress(deterministicPrivateKey(62).PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	valid, err := NewSignedTransfer(key, 6423, to, 3, 1)
	if err != nil {
		t.Fatal(err)
	}
	signatureBytes, err := hex.DecodeString(valid.Signature)
	if err != nil {
		t.Fatal(err)
	}
	parsedSignature, err := ecdsa.ParseDERSignature(signatureBytes)
	if err != nil {
		t.Fatal(err)
	}
	r, highS := parsedSignature.R(), parsedSignature.S()
	highS.Negate()
	rBytes, sBytes := r.Bytes(), highS.Bytes()
	highDER, err := asn1.Marshal(struct{ R, S *big.Int }{new(big.Int).SetBytes(rBytes[:]), new(big.Int).SetBytes(sBytes[:])})
	if err != nil {
		t.Fatal(err)
	}
	changes := []struct {
		name   string
		change func(*SignedTransaction)
	}{
		{"version", func(tx *SignedTransaction) { tx.Version++ }},
		{"chain", func(tx *SignedTransaction) { tx.ChainID++ }},
		{"type", func(tx *SignedTransaction) { tx.Type = "action" }},
		{"from", func(tx *SignedTransaction) { tx.From = tx.To }},
		{"to", func(tx *SignedTransaction) { tx.To = "invalid" }},
		{"amount", func(tx *SignedTransaction) { tx.Amount++ }},
		{"fee", func(tx *SignedTransaction) { tx.Fee++ }},
		{"nonce", func(tx *SignedTransaction) { tx.Nonce++ }},
		{"public-short", func(tx *SignedTransaction) { tx.PublicKey = "02" }},
		{"public-invalid-point", func(tx *SignedTransaction) { tx.PublicKey = "02" + strings.Repeat("ff", 32) }},
		{"public-other-owner", func(tx *SignedTransaction) {
			tx.PublicKey = hex.EncodeToString(deterministicPrivateKey(63).PubKey().SerializeCompressed())
		}},
		{"signature-empty", func(tx *SignedTransaction) { tx.Signature = "" }},
		{"signature-hex", func(tx *SignedTransaction) { tx.Signature = "not-hex" }},
		{"signature-DER", func(tx *SignedTransaction) { tx.Signature = "00" }},
		{"signature-high-S", func(tx *SignedTransaction) { tx.Signature = hex.EncodeToString(highDER) }},
	}
	check := func(t *testing.T, tx SignedTransaction, chain int64) {
		t.Helper()
		want := verifyNativeDuplicateParseBaseline(tx, chain)
		got := tx.Verify(chain)
		if (want == nil) != (got == nil) || want != nil && want.Error() != got.Error() {
			t.Fatalf("verification/refusal changed: original=%v candidate=%v", want, got)
		}
	}
	for _, chain := range []int64{6423, 6424} {
		check(t, valid, chain)
	}
	upperSignature := valid
	upperSignature.Signature = strings.ToUpper(valid.Signature)
	check(t, upperSignature, 6423)
	if err := upperSignature.Verify(6423); err != nil {
		t.Fatal("original accepted hex signature spelling changed", err)
	}
	for _, change := range changes {
		t.Run(change.name, func(t *testing.T) {
			tx := valid
			change.change(&tx)
			check(t, tx, 6423)
			if tx.Verify(6423) == nil {
				t.Fatal("modified signed envelope accepted")
			}
		})
	}
	// Public NativeAddress retains both supported key encodings and exact owner.
	for i := byte(1); i <= 16; i++ {
		p := deterministicPrivateKey(i).PubKey()
		a, e1 := NativeAddress(p.SerializeCompressed())
		b, e2 := NativeAddress(p.SerializeUncompressed())
		if e1 != nil || e2 != nil || a != b {
			t.Fatal("public address encodings changed", e1, e2)
		}
		original, err := nativeAddressDuplicateParseBaseline(p.SerializeCompressed())
		if err != nil || original != a {
			t.Fatal("original public address bytes changed", err)
		}
	}
}

// Same signed inputs, process and CPU setting; never a network/TPS benchmark.
func BenchmarkNativeVerifyParsedKeyReuse(b *testing.B) {
	to, err := NativeAddress(deterministicPrivateKey(62).PubKey().SerializeCompressed())
	if err != nil {
		b.Fatal(err)
	}
	txs := make([]SignedTransaction, 16)
	for i := range txs {
		txs[i], err = NewSignedTransfer(deterministicPrivateKey(byte(65+i)), 6423, to, 3, uint64(i+1))
		if err != nil {
			b.Fatal(err)
		}
	}
	for _, mode := range []string{"original_duplicate_parse", "current"} {
		b.Run(mode, func(b *testing.B) {
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				tx := txs[i%len(txs)]
				var err error
				if mode == "original_duplicate_parse" {
					err = verifyNativeDuplicateParseBaseline(tx, 6423)
				} else {
					err = tx.Verify(6423)
				}
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
