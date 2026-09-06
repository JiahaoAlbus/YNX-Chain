package accountaddress

import (
	_ "embed"
	"encoding/json"
	"net/http"
)

// Formats are two reversible representations of one account, not a bridge or
// a statement about which network currently holds a balance for that account.
type Formats struct {
	YNX string `json:"ynxAddress"`
	EVM string `json:"evmAddress"`
}

func Resolve(value string) (Formats, error) {
	evm, err := Normalize(value)
	if err != nil {
		return Formats{}, err
	}
	ynx, err := Encode(evm)
	if err != nil {
		return Formats{}, err
	}
	return Formats{YNX: ynx, EVM: evm}, nil
}

//go:embed browser.js
var browserJS []byte

//go:embed converter.html
var converterHTML []byte

//go:embed favicon.ico
var faviconICO []byte

//go:embed ynx-tab-icon.png
var tabIconPNG []byte

func TabIconHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=0, must-revalidate")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(tabIconPNG)
}

func FaviconHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "image/vnd.microsoft.icon")
	w.Header().Set("Cache-Control", "public, max-age=0, must-revalidate")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(faviconICO)
}

//go:embed converter.js
var converterJS []byte

func BrowserHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=0, must-revalidate")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(browserJS)
}

func ConverterScriptHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=0, must-revalidate")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(converterJS)
}

func ConverterHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
	_, _ = w.Write(converterHTML)
}

// ResolveHandler performs no RPC, account creation, login, or transaction.
func ResolveHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	values := r.URL.Query()["address"]
	if len(values) != 1 || len(values[0]) > maxLength {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "provide one complete YNX or EVM account address"})
		return
	}
	formats, err := Resolve(values[0])
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(formats)
}
