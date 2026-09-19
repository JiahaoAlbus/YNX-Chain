package finance

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	secpECDSA "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

var (
	financeAccountPattern      = regexp.MustCompile(`^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$`)
	financeProviderUUIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	financeUUIDv4Pattern       = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	financeHashPattern         = regexp.MustCompile(`^[0-9a-f]{64}$`)
	financePublicKeyPattern    = regexp.MustCompile(`^(02|03)[0-9a-f]{64}$`)
	financeSignaturePattern    = regexp.MustCompile(`^[0-9a-f]{128}$`)
	financeSymbolPattern       = regexp.MustCompile(`^[A-Z][A-Z0-9.]{0,11}$`)
	financeQtyPattern          = regexp.MustCompile(`^(?:[1-9][0-9]{0,5}|1000000)$`)
	financePricePattern        = regexp.MustCompile(`^(?:0\.[0-9]{0,3}[1-9]|[1-9][0-9]{0,8}(?:\.[0-9]{0,3}[1-9])?)$`)
	financeMoneyPattern        = regexp.MustCompile(`^(?:0|0\.[0-9]{0,5}[1-9]|[1-9][0-9]{0,12}(?:\.[0-9]{0,5}[1-9])?)$`)
	financeFeeEvidencePattern  = regexp.MustCompile(`^[A-Za-z0-9._:/-]{1,256}$`)
)

type exactUSD struct{ micro *big.Int }

func ValidateBrokerFeePolicy(maxFee, feeBoundSource, feeEvidenceRef string) error {
	if _, err := parseExactUSD(maxFee, 6, financeMoneyPattern); err != nil {
		return err
	}
	if feeBoundSource != "provider_quote" && feeBoundSource != "provider_current_schedule" && feeBoundSource != "operator_policy" {
		return errors.New("Broker fee source is invalid")
	}
	if !financeFeeEvidencePattern.MatchString(feeEvidenceRef) {
		return errors.New("Broker fee evidence reference is invalid")
	}
	return nil
}

func parseExactUSD(value string, scale int, pattern *regexp.Regexp) (exactUSD, error) {
	if !pattern.MatchString(value) {
		return exactUSD{}, fmt.Errorf("USD decimal %q is not canonical", value)
	}
	parts := strings.SplitN(value, ".", 2)
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
	}
	whole := new(big.Int)
	if _, ok := whole.SetString(parts[0], 10); !ok {
		return exactUSD{}, errors.New("USD decimal integer is invalid")
	}
	whole.Mul(whole, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(scale)), nil))
	if len(fraction) > scale {
		return exactUSD{}, errors.New("USD decimal has too many fractional digits")
	}
	if fraction != "" {
		padded := fraction + strings.Repeat("0", scale-len(fraction))
		fractionUnits, ok := new(big.Int).SetString(padded, 10)
		if !ok {
			return exactUSD{}, errors.New("USD decimal fraction is invalid")
		}
		whole.Add(whole, fractionUnits)
	}
	return exactUSD{micro: whole}, nil
}

// BuildBrokerOrderDraft applies the same deterministic exact-money rules to a
// manual form or an AI-produced draft. AI text never becomes authority: the
// server supplies fee evidence, generates the logical order ID and validates
// the normalized result before a Wallet challenge can exist.
func BuildBrokerOrderDraft(input BrokerOrderDraftInput, maxFee, feeBoundSource string) (FinanceOrderV1, error) {
	if !financeProviderUUIDPattern.MatchString(input.AssetID) || !financeSymbolPattern.MatchString(input.Symbol) || (input.Side != "buy" && input.Side != "sell") || !financeQtyPattern.MatchString(input.Qty) {
		return FinanceOrderV1{}, errors.New("Broker order draft fields are invalid")
	}
	price, err := parseExactUSD(input.LimitPrice, 6, financePricePattern)
	if err != nil {
		return FinanceOrderV1{}, err
	}
	fee, err := parseExactUSD(maxFee, 6, financeMoneyPattern)
	if err != nil {
		return FinanceOrderV1{}, err
	}
	if feeBoundSource != "provider_quote" && feeBoundSource != "provider_current_schedule" && feeBoundSource != "operator_policy" {
		return FinanceOrderV1{}, errors.New("Broker order draft fee source is invalid")
	}
	qty, _ := new(big.Int).SetString(input.Qty, 10)
	maximum := new(big.Int).Set(fee.micro)
	if input.Side == "buy" {
		maximum.Add(maximum, new(big.Int).Mul(price.micro, qty))
	}
	orderID, err := newFinanceUUIDv4()
	if err != nil {
		return FinanceOrderV1{}, err
	}
	order := FinanceOrderV1{AssetClass: "us_equity", AssetID: input.AssetID, Currency: "USD", ExtendedHours: false, FeeBoundSource: feeBoundSource, LimitPrice: input.LimitPrice, MaxCost: formatExactMicroUSD(maximum), MaxFee: maxFee, OrderID: orderID, OrderType: "limit", Qty: input.Qty, Side: input.Side, Symbol: input.Symbol, TimeInForce: "day"}
	if err := validateFinanceOrder(order); err != nil {
		return FinanceOrderV1{}, err
	}
	return order, nil
}

func formatExactMicroUSD(value *big.Int) string {
	base := big.NewInt(1_000_000)
	whole := new(big.Int)
	fraction := new(big.Int)
	whole.QuoRem(new(big.Int).Set(value), base, fraction)
	if fraction.Sign() == 0 {
		return whole.String()
	}
	f := fraction.String()
	f = strings.Repeat("0", 6-len(f)) + f
	f = strings.TrimRight(f, "0")
	return whole.String() + "." + f
}

func DeriveFinanceSubjectID(account string) (string, error) {
	if !financeAccountPattern.MatchString(account) {
		return "", errors.New("Finance subject account is not canonical")
	}
	if _, err := accountaddress.Decode(account); err != nil {
		return "", errors.New("Finance subject account checksum is invalid")
	}
	value := map[string]any{
		"account": account, "applicationId": FinanceOrderApplicationID,
		"platform": FinanceOrderPlatform, "productClientId": FinanceProductClientID,
	}
	digest := digestFinanceCanonical(FinanceSubjectDomain, value)
	return "subject_" + digest, nil
}

func validateFinanceOrder(order FinanceOrderV1) error {
	if order.AssetClass != "us_equity" || order.Currency != "USD" || order.OrderType != "limit" || order.TimeInForce != "day" || order.ExtendedHours {
		return errors.New("Finance order market contract is invalid")
	}
	if !financeProviderUUIDPattern.MatchString(order.AssetID) || !financeUUIDv4Pattern.MatchString(order.OrderID) || !financeSymbolPattern.MatchString(order.Symbol) || !financeQtyPattern.MatchString(order.Qty) {
		return errors.New("Finance order identity, symbol, or quantity is invalid")
	}
	if order.Side != "buy" && order.Side != "sell" {
		return errors.New("Finance order side is invalid")
	}
	if order.FeeBoundSource != "provider_quote" && order.FeeBoundSource != "provider_current_schedule" && order.FeeBoundSource != "operator_policy" {
		return errors.New("Finance order fee source is invalid")
	}
	price, err := parseExactUSD(order.LimitPrice, 6, financePricePattern)
	if err != nil {
		return err
	}
	maxCost, err := parseExactUSD(order.MaxCost, 6, financeMoneyPattern)
	if err != nil {
		return err
	}
	maxFee, err := parseExactUSD(order.MaxFee, 6, financeMoneyPattern)
	if err != nil {
		return err
	}
	quantity, _ := new(big.Int).SetString(order.Qty, 10)
	expected := new(big.Int).Set(maxFee.micro)
	if order.Side == "buy" {
		expected.Add(expected, new(big.Int).Mul(price.micro, quantity))
	}
	if expected.Cmp(maxCost.micro) != 0 {
		return errors.New("Finance order maxCost does not equal the exact signed bound")
	}
	return nil
}

func FinanceOrderHash(order FinanceOrderV1) (string, error) {
	if err := validateFinanceOrder(order); err != nil {
		return "", err
	}
	return digestFinanceCanonical(FinanceOrderDomain, order), nil
}

func validateFinanceUnsigned(unsigned FinanceOrderApprovalUnsignedV1, now time.Time) error {
	if unsigned.Version != FinanceOrderApprovalVersion || unsigned.ProductID != FinanceOrderProductID || unsigned.ApplicationID != FinanceOrderApplicationID || unsigned.Origin != FinanceOrderOrigin || unsigned.Platform != FinanceOrderPlatform || unsigned.ChainID != FinanceOrderChainID || unsigned.ChainEnvironment != FinanceOrderChainEnv || unsigned.TradingEnvironment != FinanceOrderTradingEnv || unsigned.Provider != FinanceOrderProvider {
		return errors.New("Finance approval environment binding is invalid")
	}
	if !financeAccountPattern.MatchString(unsigned.Account) || !financePublicKeyPattern.MatchString(unsigned.AccountPublicKey) || !financeProviderUUIDPattern.MatchString(unsigned.BrokerAccountID) || !strings.HasPrefix(unsigned.RequestID, "request_") || !financeUUIDv4Pattern.MatchString(strings.TrimPrefix(unsigned.RequestID, "request_")) || !strings.HasPrefix(unsigned.ChallengeID, "challenge_") || !financeUUIDv4Pattern.MatchString(strings.TrimPrefix(unsigned.ChallengeID, "challenge_")) || !financeUUIDv4Pattern.MatchString(unsigned.Nonce) || !financeHashPattern.MatchString(unsigned.CallbackStateHash) || !financeHashPattern.MatchString(unsigned.OrderHash) {
		return errors.New("Finance approval identity or correlation binding is invalid")
	}
	subject, err := DeriveFinanceSubjectID(unsigned.Account)
	if err != nil || subject != unsigned.SubjectID {
		return errors.New("Finance approval subject binding is invalid")
	}
	issuedAt, err := parseFinanceMilliseconds(unsigned.IssuedAt)
	if err != nil {
		return errors.New("Finance approval issue time is invalid")
	}
	expiresAt, err := parseFinanceMilliseconds(unsigned.ExpiresAt)
	if err != nil || !expiresAt.After(issuedAt) || expiresAt.Sub(issuedAt) > 5*time.Minute || !expiresAt.After(now.UTC()) || issuedAt.After(now.UTC()) {
		return errors.New("Finance approval is expired or exceeds five minutes")
	}
	orderHash, err := FinanceOrderHash(unsigned.Order)
	if err != nil || orderHash != unsigned.OrderHash {
		return errors.New("Finance approval order hash is invalid")
	}
	return nil
}

func VerifyFinanceOrderApprovalV1(approval FinanceOrderApprovalV1, now time.Time) (string, error) {
	if err := validateFinanceUnsigned(approval.FinanceOrderApprovalUnsignedV1, now); err != nil {
		return "", err
	}
	if !financeSignaturePattern.MatchString(approval.Signature) {
		return "", errors.New("Finance approval signature encoding is invalid")
	}
	digest := digestFinanceCanonical(FinanceOrderApprovalDomain, approval.FinanceOrderApprovalUnsignedV1)
	if err := verifyFinanceCompactSignature(approval.Account, approval.AccountPublicKey, approval.Signature, digest); err != nil {
		return "", err
	}
	return digest, nil
}

func ParseFinanceOrderApprovalCallbackV1(raw []byte) (FinanceOrderApprovalCallbackV1, error) {
	if len(raw) == 0 || len(raw) > 32<<10 {
		return FinanceOrderApprovalCallbackV1{}, errors.New("Finance approval callback size is invalid")
	}
	if err := rejectDuplicateFinanceJSONKeys(raw); err != nil {
		return FinanceOrderApprovalCallbackV1{}, err
	}
	var probe struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return FinanceOrderApprovalCallbackV1{}, errors.New("Finance approval callback JSON is invalid")
	}
	switch probe.Status {
	case "approved":
		var value struct {
			Approval          FinanceOrderApprovalV1 `json:"approval"`
			CallbackStateHash string                 `json:"callbackStateHash"`
			Kind              string                 `json:"kind"`
			RequestID         string                 `json:"requestId"`
			Status            string                 `json:"status"`
			Version           string                 `json:"version"`
		}
		if err := decodeStrictJSON(raw, &value); err != nil || value.Kind != "finance_order_approval_result" || value.Version != "1" || value.Status != "approved" || value.RequestID != value.Approval.RequestID || value.CallbackStateHash != value.Approval.CallbackStateHash || !financeHashPattern.MatchString(value.CallbackStateHash) {
			return FinanceOrderApprovalCallbackV1{}, errors.New("approved Finance callback contract is invalid")
		}
		if !bytes.Equal(raw, mustFinanceCanonical(value)) {
			return FinanceOrderApprovalCallbackV1{}, errors.New("Finance approval callback JSON is not canonical")
		}
		return FinanceOrderApprovalCallbackV1{Status: value.Status, RequestID: value.RequestID, CallbackStateHash: value.CallbackStateHash, Approval: &value.Approval}, nil
	case "rejected":
		var value struct {
			CallbackStateHash string `json:"callbackStateHash"`
			Kind              string `json:"kind"`
			Reason            string `json:"reason"`
			RequestID         string `json:"requestId"`
			Status            string `json:"status"`
			Version           string `json:"version"`
		}
		if err := decodeStrictJSON(raw, &value); err != nil || value.Kind != "finance_order_approval_result" || value.Version != "1" || value.Status != "rejected" || value.Reason != "USER_REJECTED" || !strings.HasPrefix(value.RequestID, "request_") || !financeUUIDv4Pattern.MatchString(strings.TrimPrefix(value.RequestID, "request_")) || !financeHashPattern.MatchString(value.CallbackStateHash) {
			return FinanceOrderApprovalCallbackV1{}, errors.New("rejected Finance callback contract is invalid")
		}
		if !bytes.Equal(raw, mustFinanceCanonical(value)) {
			return FinanceOrderApprovalCallbackV1{}, errors.New("Finance approval callback JSON is not canonical")
		}
		return FinanceOrderApprovalCallbackV1{Status: value.Status, RequestID: value.RequestID, CallbackStateHash: value.CallbackStateHash}, nil
	case "revoked":
		var value struct {
			CallbackStateHash string                   `json:"callbackStateHash"`
			Kind              string                   `json:"kind"`
			RequestID         string                   `json:"requestId"`
			Revocation        FinanceOrderRevocationV1 `json:"revocation"`
			Status            string                   `json:"status"`
			Version           string                   `json:"version"`
		}
		if err := decodeStrictJSON(raw, &value); err != nil || value.Kind != "finance_order_approval_result" || value.Version != "1" || value.Status != "revoked" || value.RequestID != value.Revocation.RequestID || !financeHashPattern.MatchString(value.CallbackStateHash) {
			return FinanceOrderApprovalCallbackV1{}, errors.New("revoked Finance callback contract is invalid")
		}
		if !bytes.Equal(raw, mustFinanceCanonical(value)) {
			return FinanceOrderApprovalCallbackV1{}, errors.New("Finance approval callback JSON is not canonical")
		}
		return FinanceOrderApprovalCallbackV1{Status: value.Status, RequestID: value.RequestID, CallbackStateHash: value.CallbackStateHash, Revocation: &value.Revocation}, nil
	default:
		return FinanceOrderApprovalCallbackV1{}, errors.New("Finance approval callback status is unsupported")
	}
}

func rejectDuplicateFinanceJSONKeys(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var scan func() error
	scan = func() error {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delimiter, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delimiter {
		case '{':
			seen := map[string]bool{}
			for decoder.More() {
				keyToken, err := decoder.Token()
				if err != nil {
					return err
				}
				key, ok := keyToken.(string)
				if !ok {
					return errors.New("Finance JSON object key is invalid")
				}
				if seen[key] {
					return errors.New("Finance JSON contains a duplicate object key")
				}
				seen[key] = true
				if err := scan(); err != nil {
					return err
				}
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim('}') {
				return errors.New("Finance JSON object is not closed")
			}
		case '[':
			for decoder.More() {
				if err := scan(); err != nil {
					return err
				}
			}
			end, err := decoder.Token()
			if err != nil || end != json.Delim(']') {
				return errors.New("Finance JSON array is not closed")
			}
		default:
			return errors.New("Finance JSON delimiter is invalid")
		}
		return nil
	}
	if err := scan(); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return errors.New("Finance JSON contains trailing data")
	}
	return nil
}

func VerifyFinanceOrderRevocationV1(revocation FinanceOrderRevocationV1, account, requestID, approvalDigest string, issuedAt, expiresAt, now time.Time) error {
	if revocation.Version != FinanceOrderApprovalVersion || revocation.Reason != "USER_REVOKED" || revocation.Account != account || revocation.RequestID != requestID || revocation.ApprovalDigest != approvalDigest || !financePublicKeyPattern.MatchString(revocation.AccountPublicKey) || !financeSignaturePattern.MatchString(revocation.Signature) {
		return errors.New("Finance approval revocation binding is invalid")
	}
	revokedAt, err := parseFinanceMilliseconds(revocation.RevokedAt)
	if err != nil || revokedAt.Before(issuedAt) || !revokedAt.Before(expiresAt) || revokedAt.After(now.UTC()) {
		return errors.New("Finance approval revocation time is invalid")
	}
	unsigned := struct {
		Account          string `json:"account"`
		AccountPublicKey string `json:"accountPublicKey"`
		ApprovalDigest   string `json:"approvalDigest"`
		Reason           string `json:"reason"`
		RequestID        string `json:"requestId"`
		RevokedAt        string `json:"revokedAt"`
		Version          string `json:"version"`
	}{revocation.Account, revocation.AccountPublicKey, revocation.ApprovalDigest, revocation.Reason, revocation.RequestID, revocation.RevokedAt, revocation.Version}
	digest := digestFinanceCanonical(FinanceOrderRevokeDomain, unsigned)
	return verifyFinanceCompactSignature(account, revocation.AccountPublicKey, revocation.Signature, digest)
}

func verifyFinanceCompactSignature(account, publicKeyHex, signatureHex, digestHex string) error {
	publicKeyBytes, err := hex.DecodeString(publicKeyHex)
	if err != nil || len(publicKeyBytes) != 33 {
		return errors.New("Finance approval public key is invalid")
	}
	publicKey, err := secp256k1.ParsePubKey(publicKeyBytes)
	if err != nil {
		return errors.New("Finance approval public key is invalid")
	}
	derivedHex, err := consensus.NativeAddress(publicKey.SerializeCompressed())
	if err == nil {
		derivedHex, err = accountaddress.Encode(derivedHex)
	}
	if err != nil || derivedHex != account {
		return errors.New("Finance approval public key does not match the session account")
	}
	signatureBytes, err := hex.DecodeString(signatureHex)
	if err != nil || len(signatureBytes) != 64 {
		return errors.New("Finance approval compact signature is invalid")
	}
	var r, s secp256k1.ModNScalar
	if r.SetByteSlice(signatureBytes[:32]) || s.SetByteSlice(signatureBytes[32:]) || r.IsZero() || s.IsZero() || s.IsOverHalfOrder() {
		return errors.New("Finance approval compact signature is invalid or not low-S")
	}
	digest, err := hex.DecodeString(digestHex)
	if err != nil || len(digest) != sha256.Size || !secpECDSA.NewSignature(&r, &s).Verify(digest, publicKey) {
		return errors.New("Finance approval signature verification failed")
	}
	return nil
}

func parseFinanceMilliseconds(value string) (time.Time, error) {
	parsed, err := time.Parse("2006-01-02T15:04:05.000Z", value)
	if err != nil || parsed.UTC().Format("2006-01-02T15:04:05.000Z") != value {
		return time.Time{}, errors.New("timestamp must use exact UTC milliseconds")
	}
	return parsed.UTC(), nil
}

func newFinanceUUIDv4() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80
	encoded := hex.EncodeToString(value)
	return encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:], nil
}

func digestFinanceCanonical(domain string, value any) string {
	digest := sha256.Sum256([]byte(domain + "\n" + string(mustFinanceCanonical(value))))
	return hex.EncodeToString(digest[:])
}

func mustFinanceCanonical(value any) []byte {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var decoded any
	if err := decoder.Decode(&decoded); err != nil {
		panic(err)
	}
	var output bytes.Buffer
	if err := writeFinanceCanonicalJSON(&output, decoded); err != nil {
		panic(err)
	}
	return output.Bytes()
}

func writeFinanceCanonicalJSON(output *bytes.Buffer, value any) error {
	switch typed := value.(type) {
	case nil:
		return errors.New("null is forbidden in Finance signed values")
	case bool:
		output.WriteString(strconv.FormatBool(typed))
	case string:
		raw, _ := json.Marshal(typed)
		output.Write(raw)
	case json.Number:
		return errors.New("numbers are forbidden in Finance signed values")
	case []any:
		output.WriteByte('[')
		for index, item := range typed {
			if index > 0 {
				output.WriteByte(',')
			}
			if err := writeFinanceCanonicalJSON(output, item); err != nil {
				return err
			}
		}
		output.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		output.WriteByte('{')
		for index, key := range keys {
			if index > 0 {
				output.WriteByte(',')
			}
			raw, _ := json.Marshal(key)
			output.Write(raw)
			output.WriteByte(':')
			if err := writeFinanceCanonicalJSON(output, typed[key]); err != nil {
				return err
			}
		}
		output.WriteByte('}')
	default:
		return fmt.Errorf("unsupported Finance canonical JSON type %T", value)
	}
	return nil
}
