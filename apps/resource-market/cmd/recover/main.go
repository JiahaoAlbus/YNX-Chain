package main

import (
	"flag"
	"fmt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productstore"
	"github.com/JiahaoAlbus/YNX-Chain/internal/resourcemarket"
	"os"
)

func main() {
	path := flag.String("store", "tmp/resource-market/state.json", "Resource Market store path")
	kind := flag.String("kind", "product", "Store kind: product or market")
	flag.Parse()
	var err error
	if *kind == "market" {
		err = resourcemarket.RestoreBackup(*path)
	} else if *kind == "product" {
		var snapshot map[string]any
		err = productstore.RestoreBackup(*path, &snapshot)
	} else {
		err = fmt.Errorf("kind must be product or market")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("Resource Market %s backup restored after integrity and schema validation\n", *kind)
}
