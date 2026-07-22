package main

import (
	"errors"
	"fmt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/quantcli"
	"os"
)

func main() {
	cli := quantcli.CLI{BaseURL: os.Getenv("YNX_QUANT_API_URL"), Out: os.Stdout}
	if err := cli.Run(os.Args[1:]); err != nil {
		if errors.Is(err, quantcli.ErrUsage) {
			fmt.Fprintln(os.Stderr, "usage: ynx-quant-cli health | snapshot | kill --approve REASON | revoke-mandate --approve DIGEST ACTOR")
		} else {
			fmt.Fprintln(os.Stderr, err)
		}
		os.Exit(2)
	}
}
