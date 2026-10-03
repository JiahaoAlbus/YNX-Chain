package quantlab

import (
	"bytes"
	"context"
	"errors"
	"math"
	"math/big"
	"os"
	"path/filepath"
	"testing"
)

func TestResearchPricePrefixEqualsDirectWideWindowSum(t *testing.T) {
	data := bars()
	data[3].Close = math.MaxInt64
	data[5].Close = math.MaxInt64
	prefix, err := buildResearchPricePrefix(context.Background(), data)
	if err != nil {
		t.Fatal(err)
	}
	for start := range data {
		for end := start + 1; end <= len(data); end++ {
			var direct big.Int
			for _, bar := range data[start:end] {
				direct.Add(&direct, big.NewInt(bar.Close))
			}
			direct.Quo(&direct, big.NewInt(int64(end-start)))
			numbers := researchArithmetic{}
			got := prefix.average(&numbers, start, end)
			if numbers.invalid || got != direct.Int64() {
				t.Fatalf("window[%d:%d] differs: %d vs %s", start, end, got, direct.String())
			}
		}
	}
}

func BenchmarkResearchPrefixWindowAverage(b *testing.B) {
	data := make([]Bar, 10000)
	for i := range data {
		data[i].Close = int64(100_000_000 + i)
	}
	prefix, err := buildResearchPricePrefix(context.Background(), data)
	if err != nil {
		b.Fatal(err)
	}
	numbers := researchArithmetic{}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = prefix.average(&numbers, 0, len(data))
	}
	if numbers.invalid {
		b.Fatal("unexpected numeric range error")
	}
}

func TestResearchFlatPriceBenchmarkDoesNotOverflowIntermediateProduct(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json")})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	r := request()
	for i := range r.Bars {
		r.Bars[i].Open, r.Bars[i].High, r.Bars[i].Low, r.Bars[i].Close = 100_000_000, 100_000_000, 100_000_000, 100_000_000
	}
	x, err := s.RunBacktest(r)
	if err != nil {
		t.Fatal(err)
	}
	for _, point := range x.EquityCurve {
		if point.BenchmarkEquity != 100_000_000_000 || point.Equity != 100_000_000_000 {
			t.Fatalf("flat-price calculation corrupted: %+v", point)
		}
	}
}

func TestResearchArithmeticKeepsWideIntermediateAndSignedTruncation(t *testing.T) {
	for _, c := range []struct{ left, right, divisor, want int64 }{
		{math.MaxInt64, 2, 2, math.MaxInt64},
		{math.MinInt64, 2, 2, math.MinInt64},
		{-5, 3, 2, -7}, {5, -3, 2, -7}, {-5, -3, 2, 7},
		{100_000_000_000, 100_000_000, 100_000_000, 100_000_000_000},
	} {
		numbers := researchArithmetic{}
		if got := numbers.mulDiv(c.left, c.right, c.divisor); got != c.want || numbers.invalid {
			t.Fatalf("mulDiv(%d,%d,%d)=%d invalid=%v", c.left, c.right, c.divisor, got, numbers.invalid)
		}
	}
	for _, c := range [][3]int64{{math.MaxInt64, 2, 1}, {1, 1, 0}} {
		numbers := researchArithmetic{}
		_ = numbers.mulDiv(c[0], c[1], c[2])
		if !numbers.invalid {
			t.Fatal("unrepresentable/divide-zero result accepted")
		}
	}
	numbers := researchArithmetic{}
	_ = numbers.absolute(math.MinInt64)
	if !numbers.invalid {
		t.Fatal("unrepresentable absolute accepted")
	}
	for _, value := range []float64{math.NaN(), math.Inf(1), math.Inf(-1), 0x1p63, -0x1p63 - 2048} {
		if _, err := checkedResearchFloat(value); !errors.Is(err, ErrInvalid) {
			t.Fatal("invalid floating metric accepted")
		}
	}
}

func TestResearchUnrepresentableBenchmarkCannotPersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.RunBacktest(request()); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	r := request()
	for i := range r.Bars {
		r.Bars[i].Open, r.Bars[i].High, r.Bars[i].Low, r.Bars[i].Close = 1, 1, 1, 1
	}
	r.Bars[len(r.Bars)-1].Open = math.MaxInt64
	r.Bars[len(r.Bars)-1].High = math.MaxInt64
	r.Bars[len(r.Bars)-1].Close = math.MaxInt64
	if _, err := s.RunBacktest(r); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unrepresentable benchmark accepted: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("numeric rejection changed durable state")
	}
}
