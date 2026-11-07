package ynxbatch

// Additive receiver DATA decoder using the ORIGINAL Core19 unsigned21/E5 parser.
// It verifies no signature/Root/Source/nonce/current and consumes no operation.
import (
 "bytes"
 "encoding/base64"
 "encoding/json"
 "io"
 "sort"
 "strings"
 "unicode/utf8"
)
const ProductSessionHTTPHeaderV4Name = "x-ynx-product-session-proof-v4"
const MaxProductSessionHTTPHeaderV4Bytes = 196608
const MaxProductSessionHTTPTotalHeaderBytes = 262144

type ProductSessionHTTPHeaderV4DATA struct {
 UnsignedOriginal []byte
 MemberOriginal []byte
 MessageOriginal []byte
}
// expected is independent registered/Source-owned DATA, NEVER derived from claims.
// headers is the complete original received header multimap; no Header.Get collapse.
func DecodeProductSessionHTTPHeaderV4DATA(headers map[string][]string, expected ProductSessionHTTPBinding) (ProductSessionHTTPHeaderV4DATA,error) {
 var zero ProductSessionHTTPHeaderV4DATA
 total:=0;var values []string
 for name, rows:=range headers {
  lower:=strings.ToLower(name)
  if strings.HasPrefix(lower,"x-ynx-product-session-proof") && lower!=ProductSessionHTTPHeaderV4Name{return zero,invalid("V4 header version mixing")}
  for _,value:=range rows {
   if len(name)>MaxProductSessionHTTPTotalHeaderBytes||len(value)>MaxProductSessionHTTPTotalHeaderBytes||total>MaxProductSessionHTTPTotalHeaderBytes-len(name)-len(value)-4{return zero,invalid("V4 total header bound")}
   total+=len(name)+len(value)+4
   if lower==ProductSessionHTTPHeaderV4Name{values=append(values,value)}
  }
 }
 if len(values)!=1{return zero,invalid("V4 exactly one original proof header")}
 header:=values[0]
 if len(header)==0||len(header)>MaxProductSessionHTTPHeaderV4Bytes{return zero,invalid("V4 raw header bound")}
 raw,err:=base64.RawURLEncoding.Strict().DecodeString(header)
 if err!=nil||len(raw)==0||len(raw)>MaxProductSessionHTTPHeaderV4Bytes*3/4||base64.RawURLEncoding.EncodeToString(raw)!=header||!utf8.Valid(raw)||bytes.HasPrefix(raw,[]byte{239,187,191}){return zero,invalid("V4 original base64url/UTF8/BOM")}
 var fields map[string]json.RawMessage
 decoder:=json.NewDecoder(bytes.NewReader(raw))
 if decoder.Decode(&fields)!=nil||len(fields)!=22{return zero,invalid("V4 exact unsigned21 plus member")}
 var trailing any;if decoder.Decode(&trailing)!=io.EOF{return zero,invalid("V4 trailing original")}
 memberRaw,ok:=fields["member"];if !ok{return zero,invalid("V4 member missing")}
 var memberText string;if json.Unmarshal(memberRaw,&memberText)!=nil{return zero,invalid("V4 member type")}
 member,err:=base64.RawURLEncoding.Strict().DecodeString(memberText)
 if err!=nil||len(member)==0||len(member)>MaxProductSessionHTTPMemberBytes||base64.RawURLEncoding.EncodeToString(member)!=memberText{return zero,invalid("V4 canonical member bytes")}
 keys:=make([]string,0,len(fields));for key:=range fields{keys=append(keys,key)};sort.Strings(keys)
 var full,unsigned []byte
 appendField:=func(out []byte,key string,value []byte)[]byte{if len(out)==0{out=append(out,'{')}else{out=append(out,',')};out=artifactJSONString(out,key);out=append(out,':');return append(out,value...)}
 for _,key:=range keys {
  value:=fields[key]
  if key=="member"{value=artifactJSONString(nil,memberText)}else{unsigned=appendField(unsigned,key,value)}
  full=appendField(full,key,value)
 }
 full=append(full,'}');unsigned=append(unsigned,'}')
 if !bytes.Equal(full,raw){return zero,invalid("V4 duplicate/noncanonical original header")}
 // Original Core19 grammar, account checksum/owner, URLs, u64, ISO/window,
 // exact canonicalJSON order and E5 frame. Full pair remains independent.
 message,err:=BuildProductSessionHTTPMessage(unsigned,expected);if err!=nil{return zero,err}
 return ProductSessionHTTPHeaderV4DATA{UnsignedOriginal:clone(unsigned),MemberOriginal:clone(member),MessageOriginal:clone(message)},nil
}
