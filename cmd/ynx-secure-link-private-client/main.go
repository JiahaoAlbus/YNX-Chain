//go:build cgo && (linux || darwin)

// This c-shared/c-archive composition exports only the private transport ABI.
// It registers NO client, Source, Root or endpoint. The actual normal Go owner
// must compose its own startup and RegisterNativeLocalCallerClient in the SAME
// Go runtime; an external daemon's Go pointer cannot be imported here.
package main

import _ "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"

func main() {}
