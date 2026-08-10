package exchangeproduct

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

const liquidityRouterVersion = "ynx-ultraliquidity-router-v1"

type dexPoolEnvelope struct {
	Source  string `json:"source"`
	Version string `json:"version"`
	Failure bool   `json:"failure"`
	Pools   []struct {
		ID          string    `json:"id"`
		Kind        string    `json:"kind"`
		Asset0      string    `json:"asset0"`
		Asset1      string    `json:"asset1"`
		Reserve0    int64     `json:"reserve0"`
		Reserve1    int64     `json:"reserve1"`
		FeeBPS      int64     `json:"feeBps"`
		BlockHeight int64     `json:"blockHeight"`
		UpdatedAt   time.Time `json:"updatedAt"`
		AuditHash   string    `json:"auditHash"`
	} `json:"pools"`
}

type dexAssetEnvelope struct {
	Source  string `json:"source"`
	Version string `json:"version"`
	Failure bool   `json:"failure"`
	Assets  []struct {
		ID       string `json:"id"`
		Decimals int    `json:"decimals"`
	} `json:"assets"`
}

func unavailableLiquidityQuote(venue, venueType, reason string, req LiquidityQuoteRequest, at time.Time) LiquidityVenueQuote {
	return LiquidityVenueQuote{Venue: venue, VenueType: venueType, Status: "unavailable", UnavailableReason: reason, Market: req.Market, Side: req.Side, BaseAmountMicro: req.AmountMicro, SourceVersion: "unavailable", ObservedAt: at, Cost: LiquidityCostFactors{UnavailableFactors: []string{"executable price", "fee", "impact", "gas", "latency", "fill probability", "failure risk", "bridge risk", "oracle confidence", "finality"}}}
}

func normalizeLiquidityRequest(req LiquidityQuoteRequest) (LiquidityQuoteRequest, error) {
	req.Market = strings.ToUpper(strings.TrimSpace(req.Market))
	req.Side = strings.ToLower(strings.TrimSpace(req.Side))
	if req.Market == "" {
		req.Market = DefaultMarket
	}
	if req.Market != DefaultMarket || (req.Side != "buy" && req.Side != "sell") || req.AmountMicro <= 0 || req.AmountMicro > 1_000_000*AmountScale {
		return LiquidityQuoteRequest{}, ErrInvalid
	}
	return req, nil
}

func checkedQuoteProduct(amount, price int64) (int64, error) {
	if amount <= 0 || price <= 0 {
		return 0, ErrInvalid
	}
	value := new(big.Int).Mul(big.NewInt(amount), big.NewInt(price))
	value.Div(value, big.NewInt(AmountScale))
	if !value.IsInt64() || value.Sign() <= 0 {
		return 0, ErrInvalid
	}
	return value.Int64(), nil
}

func (s *Service) nativeCLOBQuote(req LiquidityQuoteRequest, at time.Time) LiquidityVenueQuote {
	s.mu.Lock()
	book := s.bookLocked()
	sequence := s.state.EventSequence
	s.mu.Unlock()
	levels := book.Asks
	if req.Side == "sell" {
		levels = book.Bids
	}
	if len(levels) == 0 {
		return unavailableLiquidityQuote("YNX Native CLOB", "native_clob", "No executable owned venue depth exists for this side", req, at)
	}
	remaining, gross := req.AmountMicro, int64(0)
	bestPrice := levels[0].PriceMicro
	for _, level := range levels {
		available := executableRemaining(level)
		if available <= 0 {
			continue
		}
		fill := min64(remaining, available)
		part, err := checkedQuoteProduct(fill, level.PriceMicro)
		if err != nil || gross > int64(^uint64(0)>>1)-part {
			return unavailableLiquidityQuote("YNX Native CLOB", "native_clob", "Executable quote exceeds the supported fixed-point range", req, at)
		}
		gross += part
		remaining -= fill
		if remaining == 0 {
			break
		}
	}
	if remaining != 0 {
		return unavailableLiquidityQuote("YNX Native CLOB", "native_clob", "Current owned order-book depth cannot fill the complete requested amount", req, at)
	}
	tradingFee := fee(gross, s.cfg.TakerFeeBPS)
	reference, err := checkedQuoteProduct(req.AmountMicro, bestPrice)
	if err != nil {
		return unavailableLiquidityQuote("YNX Native CLOB", "native_clob", "Best-price reference exceeds the supported fixed-point range", req, at)
	}
	impact := gross - reference
	if req.Side == "sell" {
		impact = reference - gross
	}
	if impact < 0 {
		impact = 0
	}
	zero, bridge := int64(0), int64(0)
	net, allIn := gross-tradingFee, gross-tradingFee
	if req.Side == "buy" {
		net, allIn = gross+tradingFee, gross+tradingFee
	}
	return LiquidityVenueQuote{Venue: "YNX Native CLOB", VenueType: "native_clob", Status: "available", Market: req.Market, Side: req.Side, BaseAmountMicro: req.AmountMicro, GrossQuoteMicro: gross, NetQuoteMicro: net, AllInQuoteMicro: allIn, AveragePriceMicro: mulDiv(gross, AmountScale, req.AmountMicro), Executable: true, ExecutionMethod: "protected market IOC against current persistent price-time book", SourceVersion: "exchange-execution-state-v9", SourceSequence: sequence, ObservedAt: at, Cost: LiquidityCostFactors{TradingFeeMicro: tradingFee, PriceImpactMicro: &impact, GasMicro: &zero, BridgeRiskBPS: &bridge, UnavailableFactors: []string{"measured latency", "measured fill probability", "measured failure risk", "external oracle confidence", "chain finality (venue-ledger execution)"}}}
}

func getBoundedJSON(client *http.Client, endpoint string, out any) error {
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("upstream status %d", resp.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 2<<20))
	return decoder.Decode(out)
}

func rawToMicro(raw int64, decimals int, roundUp bool) (int64, error) {
	if raw < 0 || decimals < 0 || decimals > 18 {
		return 0, ErrInvalid
	}
	value := big.NewInt(raw)
	if decimals < 6 {
		value.Mul(value, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(6-decimals)), nil))
	} else if decimals > 6 {
		divisor := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals-6)), nil)
		if roundUp {
			value.Add(value, new(big.Int).Sub(divisor, big.NewInt(1)))
		}
		value.Div(value, divisor)
	}
	if !value.IsInt64() {
		return 0, ErrInvalid
	}
	return value.Int64(), nil
}

func cpmmExactInput(reserveIn, reserveOut, amountIn, feeBPS int64) (int64, error) {
	if reserveIn <= 0 || reserveOut <= 0 || amountIn <= 0 || feeBPS < 0 || feeBPS >= 10_000 {
		return 0, ErrInvalid
	}
	afterFee := new(big.Int).Mul(big.NewInt(amountIn), big.NewInt(10_000-feeBPS))
	numerator := new(big.Int).Mul(big.NewInt(reserveOut), afterFee)
	denominator := new(big.Int).Add(new(big.Int).Mul(big.NewInt(reserveIn), big.NewInt(10_000)), afterFee)
	value := numerator.Div(numerator, denominator)
	if !value.IsInt64() || value.Sign() <= 0 || value.Int64() >= reserveOut {
		return 0, ErrUnavailable
	}
	return value.Int64(), nil
}

func cpmmExactOutput(reserveIn, reserveOut, amountOut, feeBPS int64) (int64, error) {
	if reserveIn <= 0 || reserveOut <= amountOut || amountOut <= 0 || feeBPS < 0 || feeBPS >= 10_000 {
		return 0, ErrUnavailable
	}
	numerator := new(big.Int).Mul(big.NewInt(reserveIn), big.NewInt(amountOut))
	numerator.Mul(numerator, big.NewInt(10_000))
	denominator := new(big.Int).Mul(new(big.Int).Sub(big.NewInt(reserveOut), big.NewInt(amountOut)), big.NewInt(10_000-feeBPS))
	quotient, remainder := new(big.Int).QuoRem(numerator, denominator, new(big.Int))
	if remainder.Sign() > 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	if !quotient.IsInt64() || quotient.Sign() <= 0 {
		return 0, ErrUnavailable
	}
	return quotient.Int64(), nil
}

func (s *Service) consensusDEXQuote(req LiquidityQuoteRequest, at time.Time) LiquidityVenueQuote {
	if s.cfg.DEXGatewayURL == "" || s.cfg.DEXQuoteAssetID == "" || s.cfg.DEXQuoteAssetAttestationDigest == "" {
		return unavailableLiquidityQuote("YNX Consensus DEX", "consensus_cpmm", "DEX Gateway, reviewed quote-asset ID and settlement-equivalence attestation are not configured", req, at)
	}
	if req.AmountMicro%AmountScale != 0 {
		return unavailableLiquidityQuote("YNX Consensus DEX", "consensus_cpmm", "The native consensus asset uses whole YNXT units; this request has a fractional YNXT amount", req, at)
	}
	client := &http.Client{Timeout: 5 * time.Second}
	var pools dexPoolEnvelope
	if err := getBoundedJSON(client, s.cfg.DEXGatewayURL+"/dex/pools", &pools); err != nil || pools.Failure || pools.Source != "ynx-consensus-abci" || pools.Version != "abci-state-v13" {
		return unavailableLiquidityQuote("YNX Consensus DEX", "consensus_cpmm", "Committed consensus DEX pool evidence is unavailable or has the wrong source version", req, at)
	}
	var assets dexAssetEnvelope
	if err := getBoundedJSON(client, s.cfg.DEXGatewayURL+"/dex/assets", &assets); err != nil || assets.Failure || assets.Source != pools.Source || assets.Version != pools.Version {
		return unavailableLiquidityQuote("YNX Consensus DEX", "consensus_cpmm", "Committed consensus DEX asset metadata is unavailable or inconsistent", req, at)
	}
	quoteDecimals := -1
	for _, asset := range assets.Assets {
		if asset.ID == s.cfg.DEXQuoteAssetID {
			quoteDecimals = asset.Decimals
			break
		}
	}
	if quoteDecimals < 0 {
		return unavailableLiquidityQuote("YNX Consensus DEX", "consensus_cpmm", "The configured quote asset is not present in committed DEX asset state", req, at)
	}
	type candidate struct {
		quote LiquidityVenueQuote
		pool  string
	}
	available := []candidate{}
	amountNative := req.AmountMicro / AmountScale
	for _, pool := range pools.Pools {
		audit, auditErr := hex.DecodeString(pool.AuditHash)
		if pool.Kind != "ynx-cpmm-v1" || pool.BlockHeight <= 0 || pool.UpdatedAt.IsZero() || auditErr != nil || len(audit) != 32 || pool.Reserve0 <= 0 || pool.Reserve1 <= 0 || pool.FeeBPS < 0 || pool.FeeBPS >= 10_000 || !((pool.Asset0 == NativeAsset && pool.Asset1 == s.cfg.DEXQuoteAssetID) || (pool.Asset1 == NativeAsset && pool.Asset0 == s.cfg.DEXQuoteAssetID)) {
			continue
		}
		nativeIs0 := pool.Asset0 == NativeAsset
		reserveNative, reserveQuote := pool.Reserve0, pool.Reserve1
		if !nativeIs0 {
			reserveNative, reserveQuote = pool.Reserve1, pool.Reserve0
		}
		var rawQuote int64
		var err error
		if req.Side == "buy" {
			rawQuote, err = cpmmExactOutput(reserveQuote, reserveNative, amountNative, pool.FeeBPS)
		} else {
			rawQuote, err = cpmmExactInput(reserveNative, reserveQuote, amountNative, pool.FeeBPS)
		}
		if err != nil {
			continue
		}
		gross, err := rawToMicro(rawQuote, quoteDecimals, req.Side == "buy")
		if err != nil || gross <= 0 {
			continue
		}
		reserveQuoteMicro, err := rawToMicro(reserveQuote, quoteDecimals, false)
		if err != nil || reserveNative <= 0 || reserveQuoteMicro/reserveNative <= 0 {
			continue
		}
		spotRaw, err := checkedQuoteProduct(req.AmountMicro, reserveQuoteMicro/reserveNative)
		if err != nil {
			continue
		}
		impact := gross - spotRaw
		if req.Side == "sell" {
			impact = spotRaw - gross
		}
		if impact < 0 {
			impact = 0
		}
		tradingFee := fee(gross, pool.FeeBPS)
		gas, bridge := s.cfg.DEXGasMicro, int64(0)
		allIn := gross - gas
		if req.Side == "buy" {
			allIn = gross + gas
		}
		cost := LiquidityCostFactors{TradingFeeMicro: tradingFee, PriceImpactMicro: &impact, BridgeRiskBPS: &bridge, UnavailableFactors: []string{"measured fill probability", "measured failure risk", "external oracle confidence"}}
		if s.cfg.DEXGasMicro > 0 {
			cost.GasMicro = &gas
		} else {
			cost.UnavailableFactors = append(cost.UnavailableFactors, "measured gas")
		}
		if s.cfg.DEXLatencyMillis > 0 {
			latency := s.cfg.DEXLatencyMillis
			cost.LatencyMillis = &latency
		} else {
			cost.UnavailableFactors = append(cost.UnavailableFactors, "measured latency")
		}
		if s.cfg.DEXFinalitySeconds > 0 {
			finality := s.cfg.DEXFinalitySeconds
			cost.FinalitySeconds = &finality
		} else {
			cost.UnavailableFactors = append(cost.UnavailableFactors, "measured finality")
		}
		method := "dex_swap_exact_input"
		if req.Side == "buy" {
			method = "dex_swap_exact_output"
		}
		available = append(available, candidate{pool: pool.ID, quote: LiquidityVenueQuote{Venue: "YNX Consensus DEX · " + pool.ID, VenueType: "consensus_cpmm", Status: "available", Market: req.Market, Side: req.Side, BaseAmountMicro: req.AmountMicro, GrossQuoteMicro: gross, NetQuoteMicro: gross, AllInQuoteMicro: allIn, AveragePriceMicro: mulDiv(gross, AmountScale, req.AmountMicro), Executable: true, ExecutionMethod: method, SourceVersion: pools.Version, SourceBlockHeight: pool.BlockHeight, SourceAuditHash: pool.AuditHash, QuoteAssetAttestationDigest: s.cfg.DEXQuoteAssetAttestationDigest, ObservedAt: at, Cost: cost}})
	}
	if len(available) == 0 {
		return unavailableLiquidityQuote("YNX Consensus DEX", "consensus_cpmm", "No committed pool can execute the requested YNXT/quote-asset amount", req, at)
	}
	sort.Slice(available, func(i, j int) bool {
		if available[i].quote.AllInQuoteMicro == available[j].quote.AllInQuoteMicro {
			return available[i].pool < available[j].pool
		}
		if req.Side == "buy" {
			return available[i].quote.AllInQuoteMicro < available[j].quote.AllInQuoteMicro
		}
		return available[i].quote.AllInQuoteMicro > available[j].quote.AllInQuoteMicro
	})
	return available[0].quote
}

func (s *Service) LiquidityQuote(input LiquidityQuoteRequest) (LiquidityRouteQuote, error) {
	req, err := normalizeLiquidityRequest(input)
	if err != nil {
		return LiquidityRouteQuote{}, err
	}
	at := s.cfg.Now().UTC()
	candidates := []LiquidityVenueQuote{s.nativeCLOBQuote(req, at), s.consensusDEXQuote(req, at)}
	available := make([]LiquidityVenueQuote, 0, len(candidates))
	for _, quote := range candidates {
		if quote.Status == "available" && quote.Executable {
			available = append(available, quote)
		}
	}
	result := LiquidityRouteQuote{Version: liquidityRouterVersion, Request: req, Candidates: candidates, Status: "unavailable", SelectionRule: "Buy selects the lowest all-in quote spend; sell selects the highest all-in quote proceeds. Only complete executable fills from authoritative venue state are eligible.", Disclosure: "The router never invents liquidity. Unmeasured latency, fill, failure, oracle or finality factors remain explicit and are not silently assigned favorable values. A quote is not a signed order or settlement.", ObservedAt: at}
	if len(available) == 0 {
		return result, nil
	}
	sort.Slice(available, func(i, j int) bool {
		if available[i].AllInQuoteMicro == available[j].AllInQuoteMicro {
			return available[i].Venue < available[j].Venue
		}
		if req.Side == "buy" {
			return available[i].AllInQuoteMicro < available[j].AllInQuoteMicro
		}
		return available[i].AllInQuoteMicro > available[j].AllInQuoteMicro
	})
	selected := available[0]
	result.SelectedVenue, result.Selected, result.Status = selected.Venue, &selected, "quoted_not_signed"
	return result, nil
}

func liquidityRequestFromQuery(values url.Values) LiquidityQuoteRequest {
	amount, _ := parsePositiveInt64(values.Get("amountMicro"))
	return LiquidityQuoteRequest{Market: values.Get("market"), Side: values.Get("side"), AmountMicro: amount}
}

func parsePositiveInt64(value string) (int64, error) {
	parsed := new(big.Int)
	if _, ok := parsed.SetString(strings.TrimSpace(value), 10); !ok || !parsed.IsInt64() || parsed.Sign() <= 0 {
		return 0, ErrInvalid
	}
	return parsed.Int64(), nil
}
