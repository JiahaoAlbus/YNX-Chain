package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/JiahaoAlbus/YNX-Chain/internal/economics"
)

func main() {
	input := flag.String("input", "", "path to a fee-market scenario JSON file")
	flag.Parse()
	if *input == "" {
		fmt.Fprintln(os.Stderr, "-input is required")
		os.Exit(2)
	}
	raw, err := os.ReadFile(*input)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var scenario economics.FeeMarketInputs
	if err := json.Unmarshal(raw, &scenario); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	result, err := economics.SimulateFeeMarket(economics.DefaultFeeMarketPolicy(), scenario)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
