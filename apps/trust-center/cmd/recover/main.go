package main

import (
	"flag"
	"fmt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productstore"
	"os"
)

func main() {
	path := flag.String("store", "tmp/trust-center/state.json", "Trust Center store path")
	flag.Parse()
	var snapshot map[string]any
	if err := productstore.RestoreBackup(*path, &snapshot); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("Trust Center backup restored after integrity validation")
}
