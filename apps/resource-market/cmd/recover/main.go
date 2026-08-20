package main

import (
	"flag"
	"fmt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productstore"
	"os"
)

func main() {
	path := flag.String("store", "tmp/resource-market/state.json", "Resource Market store path")
	flag.Parse()
	var snapshot map[string]any
	if err := productstore.RestoreBackup(*path, &snapshot); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("Resource Market backup restored after integrity validation")
}
