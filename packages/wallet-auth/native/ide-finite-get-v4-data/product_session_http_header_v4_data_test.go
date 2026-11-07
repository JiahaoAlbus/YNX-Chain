package ynxbatch
import("bytes";"encoding/base64";"encoding/hex";"encoding/json";"os";"strings";"testing")
type sdkV4Fixture struct{UnsignedOriginal string `json:"unsignedOriginal"`;Message string `json:"messageBase64url"`;Member string `json:"memberBase64url"`;Header string `json:"headerValue"`;Expected struct{NetworkID string `json:"networkId"`;Owner string `json:"owner"`;PKA string `json:"pkA"`;PKB string `json:"pkB"`} `json:"independentExpected"`}
func sdkV4(t *testing.T)(sdkV4Fixture,ProductSessionHTTPBinding){t.Helper();raw,e:=os.ReadFile("testdata/sdk-v4-header-public.json");if e!=nil{t.Fatal(e)};var f sdkV4Fixture;if json.Unmarshal(raw,&f)!=nil{t.Fatal("fixture")};decode:=func(s string)[]byte{b,e:=hex.DecodeString(s);if e!=nil{t.Fatal(e)};return b};return f,ProductSessionHTTPBinding{NetworkID:decode(f.Expected.NetworkID),Owner:f.Expected.Owner,PKA:decode(f.Expected.PKA),PKB:decode(f.Expected.PKB)}}
func TestSDKV4HeaderCrossLanguageOriginalBytes(t *testing.T){f,b:=sdkV4(t);got,e:=DecodeProductSessionHTTPHeaderV4DATA(map[string][]string{ProductSessionHTTPHeaderV4Name:{f.Header}},b);if e!=nil{t.Fatal(e)};member,_:=base64.RawURLEncoding.DecodeString(f.Member);message,_:=base64.RawURLEncoding.DecodeString(f.Message);if !bytes.Equal(got.UnsignedOriginal,[]byte(f.UnsignedOriginal))||!bytes.Equal(got.MemberOriginal,member)||!bytes.Equal(got.MessageOriginal,message){t.Fatal("JS/Core originals differ")};got.MemberOriginal[0]^=1;again,e:=DecodeProductSessionHTTPHeaderV4DATA(map[string][]string{ProductSessionHTTPHeaderV4Name:{f.Header}},b);if e!=nil||!bytes.Equal(again.MemberOriginal,member){t.Fatal("not detached copies")}}
func TestSDKV4HeaderRejectClosedOriginals(t *testing.T){f,b:=sdkV4(t);raw,_:=base64.RawURLEncoding.DecodeString(f.Header);enc:=base64.RawURLEncoding.EncodeToString;changeVersion:=func(v string)string{var m map[string]any;json.Unmarshal(raw,&m);m["version"]=v;x,_:=json.Marshal(m);return enc(x)};cases:=map[string]map[string][]string{
 "duplicate-header":{ProductSessionHTTPHeaderV4Name:{f.Header,f.Header}},
 "casealias-duplicate":{ProductSessionHTTPHeaderV4Name:{f.Header},"X-YNX-PRODUCT-SESSION-PROOF-V4":{f.Header}},
 "duplicate-json":{ProductSessionHTTPHeaderV4Name:{enc(append([]byte(`{"version":"4",`),raw[1:]...))}},
 "noncanonical-space":{ProductSessionHTTPHeaderV4Name:{enc(append(raw,' '))}},
 "BOM":{ProductSessionHTTPHeaderV4Name:{enc(append([]byte{239,187,191},raw...))}},
 "invalid-utf8":{ProductSessionHTTPHeaderV4Name:{enc(append([]byte{255},raw...))}},
 "padded-base64url":{ProductSessionHTTPHeaderV4Name:{f.Header+"="}},
 "header-budget":{ProductSessionHTTPHeaderV4Name:{strings.Repeat("A",196609)}},
 "total-budget":{ProductSessionHTTPHeaderV4Name:{f.Header},"X-Noise":{strings.Repeat("x",262144)}},
 "version2":{ProductSessionHTTPHeaderV4Name:{changeVersion("2")}},
 "version5":{ProductSessionHTTPHeaderV4Name:{changeVersion("5")}},
 "mixed-proof5":{ProductSessionHTTPHeaderV4Name:{f.Header},"x-ynx-product-session-proof-v5":{"AQ"}},
 "missing":{},}
 for name,h:=range cases{t.Run(name,func(t *testing.T){if _,e:=DecodeProductSessionHTTPHeaderV4DATA(h,b);e==nil{t.Fatal("accepted malformed original")}})}
}
func TestSDKV4HeaderIndependentBindingRequired(t *testing.T){f,b:=sdkV4(t);b.Owner="0x"+strings.Repeat("22",20);if _,e:=DecodeProductSessionHTTPHeaderV4DATA(map[string][]string{ProductSessionHTTPHeaderV4Name:{f.Header}},b);e==nil{t.Fatal("claims became expected owner")};_,b=sdkV4(t);b.PKA=nil;if _,e:=DecodeProductSessionHTTPHeaderV4DATA(map[string][]string{ProductSessionHTTPHeaderV4Name:{f.Header}},b);e==nil{t.Fatal("missing independent full pair")}}
