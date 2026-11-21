package ynxbatch

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"reflect"
	"testing"
)

func selectedFrame(t testing.TB, owners int) []byte {
	t.Helper()
	// Public synthetic bytes with the real four material-field lengths. These
	// are not private keys and do not bypass or exercise key import/authority.
	material, err := EncodeFields(make([]byte, PKCS8ASize), make([]byte, PKCS8BSize), make([]byte, PublicKeyASize), make([]byte, PublicKeyBSize))
	if err != nil {
		t.Fatal(err)
	}
	f := make([][]byte, owners+1)
	f[0] = []byte(KeyMaterialFormat)
	for i := 1; i <= owners; i++ {
		f[i] = material
	}
	wire, err := EncodeFields(f...)
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func TestDecodeSelectedFieldsMatchesOriginalAndDetaches(t *testing.T) {
	wire, err := EncodeFields([]byte("tag"), nil, []byte("owner-a"), []byte("owner-b"))
	if err != nil {
		t.Fatal(err)
	}
	for mask := 1; mask < 1<<4; mask++ {
		var indices []int
		for index := 0; index < 4; index++ {
			if mask&(1<<index) != 0 {
				indices = append(indices, index)
			}
		}
		original, err := DecodeFields(wire, 4, 1024)
		if err != nil {
			t.Fatal(err)
		}
		selected, err := DecodeSelectedFields(wire, 4, 1024, indices...)
		if err != nil || len(selected) != len(indices) {
			t.Fatal("selection changed valid frame", err)
		}
		for i, index := range indices {
			if !reflect.DeepEqual(selected[i], original[index]) {
				t.Fatal("selected bytes or empty-field shape differ")
			}
			clear(selected[i])
		}
		unchanged, err := DecodeFields(wire, 4, 1024)
		if err != nil || !reflect.DeepEqual(original, unchanged) {
			t.Fatal("clearing selected secret copies mutated input")
		}
	}
	left, _ := DecodeSelectedFields(wire, 4, 1024, 0, 2)
	right, _ := DecodeSelectedFields(wire, 4, 1024, 0, 2)
	clear(wire)
	clear(left[1])
	if string(left[0]) != "tag" || string(right[0]) != "tag" || string(right[1]) != "owner-a" {
		t.Fatal("separate calls, input, or selected fields alias")
	}
}

func TestDecodeSelectedFieldsPreservesAllFramingErrors(t *testing.T) {
	wire, err := EncodeFields([]byte("tag"), []byte("selected"), []byte("unused"))
	if err != nil {
		t.Fatal(err)
	}
	type input struct {
		wire         []byte
		count, limit int
	}
	var cases []input
	for end := 0; end < len(wire); end++ {
		cases = append(cases, input{wire[:end], 3, 1024})
	}
	cases = append(cases, input{append(bytes.Clone(wire), 0), 3, 1024})
	for _, count := range []int{-1, 0, 2, 4, MaxN + 1} {
		cases = append(cases, input{wire, count, 1024})
	}
	for _, limit := range []int{-1, 0, 3, len(wire) - 1, MaxWholeBytes + 1} {
		cases = append(cases, input{wire, 3, limit})
	}
	// An already selected owner never permits skipping malformed later framing.
	tailOffset := 4 + 4 + len("tag") + 4 + len("selected")
	for _, length := range []uint32{0, 1, 7, 1025, ^uint32(0)} {
		bad := bytes.Clone(wire)
		binary.BigEndian.PutUint32(bad[tailOffset:], length)
		cases = append(cases, input{bad, 3, 1024})
	}
	for i, c := range cases {
		_, want := DecodeFields(c.wire, c.count, c.limit)
		if want == nil {
			t.Fatalf("case %d was not malformed", i)
		}
		for _, indices := range [][]int{{0, 1}, {-1}, nil} {
			got, err := DecodeSelectedFields(c.wire, c.count, c.limit, indices...)
			if got != nil || err == nil || err.Error() != want.Error() || !errors.Is(err, ErrProtocol) {
				t.Fatalf("case %d lost complete-frame error priority: %v / %v", i, err, want)
			}
		}
	}
}

func TestDecodeSelectedFieldsRejectsInvalidSelectionWithoutCopies(t *testing.T) {
	wire, _ := EncodeFields([]byte("tag"), []byte("owner"), []byte("unused"))
	for _, indices := range [][]int{nil, {}, {-1}, {3}, {0, 0}, {2, 1}, {0, 1, 2, 3}} {
		got, err := DecodeSelectedFields(wire, 3, 1024, indices...)
		if got != nil || err == nil || err.Error() != invalid("field selection").Error() {
			t.Fatal("invalid selection returned owned fields", indices, err)
		}
	}
	empty, _ := EncodeFields()
	if got, err := DecodeSelectedFields(empty, 0, 4); got != nil || err == nil {
		t.Fatal("empty selection admitted")
	}
}

func TestDecodeSelectedFieldsKeepsFullOwnerLimitAndCopyCost(t *testing.T) {
	for _, owners := range []int{2, 500, 1000} {
		wire := selectedFrame(t, owners)
		for _, owner := range []int{0, owners / 2, owners - 1} {
			full, err := DecodeFields(wire, owners+1, 8<<20)
			if err != nil {
				t.Fatal(err)
			}
			selected, err := DecodeSelectedFields(wire, owners+1, 8<<20, 0, owner+1)
			if err != nil || !bytes.Equal(selected[0], full[0]) || !bytes.Equal(selected[1], full[owner+1]) {
				t.Fatal("owner selection differs", owners, owner, err)
			}
		}
	}
	wire := selectedFrame(t, 500)
	fullAllocs := testing.AllocsPerRun(3, func() {
		result, err := DecodeFields(wire, 501, 8<<20)
		if err != nil {
			panic(err)
		}
		for _, item := range result {
			clear(item)
		}
	})
	selectedAllocs := testing.AllocsPerRun(3, func() {
		result, err := DecodeSelectedFields(wire, 501, 8<<20, 0, 250)
		if err != nil {
			panic(err)
		}
		for _, item := range result {
			clear(item)
		}
	})
	if selectedAllocs > 4 || fullAllocs-selectedAllocs < 499 {
		t.Fatalf("unselected copies remain: original %.0f selected %.0f", fullAllocs, selectedAllocs)
	}
	t.Logf("synthetic 500-owner framing bytes=%d allocations original=%.0f selected=%.0f; excludes KDF/import/sign", len(wire), fullAllocs, selectedAllocs)
}

func BenchmarkDecodeSelectedOwnerFields(b *testing.B) {
	for _, owners := range []int{2, 500, 1000} {
		wire := selectedFrame(b, owners)
		for _, method := range []string{"all", "selected"} {
			b.Run(fmt.Sprintf("owners%d/%s", owners, method), func(b *testing.B) {
				b.ReportAllocs()
				for i := 0; i < b.N; i++ {
					var result [][]byte
					var err error
					if method == "all" {
						result, err = DecodeFields(wire, owners+1, 8<<20)
					} else {
						result, err = DecodeSelectedFields(wire, owners+1, 8<<20, 0, owners/2+1)
					}
					if err != nil {
						b.Fatal(err)
					}
					for _, item := range result {
						clear(item)
					}
				}
			})
		}
	}
}
