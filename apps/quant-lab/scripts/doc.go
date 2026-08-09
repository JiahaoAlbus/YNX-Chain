// Package scripts marks standalone Quant capacity programs as tooling rather
// than one combined command. Each ignored main file remains runnable directly
// with `go run path/to/file.go` while repository-wide tests avoid linking two
// unrelated main functions into one binary.
package scripts
