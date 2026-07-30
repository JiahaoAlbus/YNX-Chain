package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	oracleclient "github.com/JiahaoAlbus/YNX-Chain/sdk/oracle/go"
)

const (
	defaultTimeout       = 5 * time.Second
	defaultMaximumAge    = 30 * time.Second
	defaultConfidencePPM = int64(900_000)
	defaultCoveragePPM   = int64(1_000_000)
)

type priceClient interface {
	Price(context.Context, string, string) (oracleclient.Price, error)
}

type clientFactory func(string, *http.Client) (priceClient, error)

func main() {
	if err := run(os.Args[1:], os.Stdout, newOracleClient, time.Now); err != nil {
		slog.Error("oracle CLI failed", "error", err.Error())
		os.Exit(1)
	}
}

func newOracleClient(baseURL string, client *http.Client) (priceClient, error) {
	return oracleclient.New(baseURL, client)
}

func run(args []string, output io.Writer, factory clientFactory, now func() time.Time) error {
	flags := flag.NewFlagSet("ynx-oracle-cli", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	baseURL := flags.String("url", "", "Oracle HTTPS origin; loopback HTTP is allowed for local verification")
	market := flags.String("market", "", "canonical Oracle market, for example YNXT/YUSD_TEST")
	kind := flags.String("type", "spot_price", "canonical Oracle scalar type")
	version := flags.String("version", "weighted-median-mad-v1", "accepted aggregation or derivation policy version")
	maximumAge := flags.Duration("max-age", defaultMaximumAge, "maximum accepted source age")
	timeout := flags.Duration("timeout", defaultTimeout, "overall HTTP request timeout")
	minimumConfidence := flags.Int64("min-confidence-ppm", defaultConfidencePPM, "minimum accepted confidence in parts per million")
	minimumCoverage := flags.Int64("min-coverage-ppm", defaultCoveragePPM, "minimum accepted coverage in parts per million")
	pretty := flags.Bool("pretty", false, "indent the JSON response")
	if err := flags.Parse(args); err != nil {
		return fmt.Errorf("parse flags: %w", err)
	}
	if flags.NArg() != 0 {
		return errors.New("positional arguments are not supported")
	}
	if *baseURL == "" || *market == "" || *kind == "" || *version == "" {
		return errors.New("url, market, type, and version are required")
	}
	if *maximumAge <= 0 || *timeout <= 0 || *minimumConfidence < 0 || *minimumConfidence > 1_000_000 || *minimumCoverage < 0 || *minimumCoverage > 1_000_000 {
		return errors.New("consumer timeout, age, confidence, or coverage policy is invalid")
	}
	client, err := factory(*baseURL, &http.Client{Timeout: *timeout})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	price, err := client.Price(ctx, *market, *kind)
	if err != nil {
		return err
	}
	observedAt := now().UTC()
	if err := price.ValidateFor(*market, *kind, *version, observedAt, *maximumAge, *minimumConfidence, *minimumCoverage); err != nil {
		return fmt.Errorf("reject unsafe Oracle response: %w", err)
	}
	encoder := json.NewEncoder(output)
	encoder.SetEscapeHTML(false)
	if *pretty {
		encoder.SetIndent("", "  ")
	}
	if err := encoder.Encode(price); err != nil {
		return fmt.Errorf("encode validated Oracle response: %w", err)
	}
	return nil
}
