//go:build social_joint_data_test

package main
import "testing"
func TestCToGoSoleBodyDATA(t *testing.T){names:=[]string{"prepare-golden-u64-lossless","short-buffer-no-output-change","nil-with-length","capture-over-cap","size-max","outputs-overlap","input-output-overlap","missing-policy","nullable-tag","invalid-utf8","inspect-noncanonical","inspect-body-over-cap","output-cap-over-bound","time-overflow","wrong-role","zero-capacity","nil-written","input-pointer-range-overflow","output-pointer-range-overflow","four-independent-65536-originals","inspect-golden","unknown-ABI","wrong-struct-size","negative-time","inspect-other-epoch"};for i,n:=range names{t.Run(n,func(t *testing.T){if line:=publicScenario(i);line!=0{t.Fatalf("PUBLIC C caller scenario %d failed at line %d",i,line)}})}}
