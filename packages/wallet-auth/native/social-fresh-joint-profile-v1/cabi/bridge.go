// Package main is a source fragment for the sole original archive aggregate.
// No main(), c-archive build, signer or runtime producer is supplied here.
package main
/*
#cgo CFLAGS: -std=c11 -Wall -Wextra -Werror
#include "social_fresh_joint_profile_data.h"
*/
import "C"
import (
 "errors"
 "unicode/utf8"
 "unsafe"
 body "github.com/JiahaoAlbus/YNX-Chain/sdk/socialfreshjointprofile"
)
type region struct{ start,end uintptr }
type capture struct{ inputs []region; outputs []region }
var bad=errors.New("SOCIAL_CABI_INPUT")
func rangeOf(p unsafe.Pointer,n uint64)(region,error){
 if p==nil||n==0||n>uint64(^uintptr(0)){return region{},bad};a:=uintptr(p);if uint64(a)>uint64(^uintptr(0))-n{return region{},bad};return region{a,a+uintptr(n)},nil
}
func overlap(a,b region)bool{return a.start<b.end&&b.start<a.end}
func(c *capture)input(p unsafe.Pointer,n uint64)error{r,e:=rangeOf(p,n);if e!=nil{return e};for _,o:=range c.outputs{if overlap(r,o){return bad}};c.inputs=append(c.inputs,r);return nil}
func(c *capture)span(s C.YNXSocialJointSpan,min,max uint64)([]byte,error){
 n:=uint64(s.length);if n<min||n>max{return nil,bad};if n==0{if s.data!=nil{return nil,bad};return nil,nil};if e:=c.input(unsafe.Pointer(s.data),n);e!=nil{return nil,e};return append([]byte(nil),unsafe.Slice((*byte)(unsafe.Pointer(s.data)),int(n))...),nil
}
func(c *capture)text(s C.YNXSocialJointSpan)(string,error){b,e:=c.span(s,1,2048);if e!=nil||!utf8.Valid(b){return "",bad};return string(b),nil}
func(c *capture)nullable(s C.YNXSocialJointNullableText)(*string,error){if s.is_null==1{if s.value.data!=nil||s.value.length!=0{return nil,bad};return nil,nil};if s.is_null!=0{return nil,bad};v,e:=c.text(s.value);return &v,e}
func(c *capture)policy(p *C.YNXSocialJointPolicy10)(*body.Policy10DATA,error){if p==nil{return nil,nil};if uintptr(unsafe.Pointer(p))%unsafe.Alignof(*p)!=0{return nil,bad};if e:=c.input(unsafe.Pointer(p),uint64(C.sizeof_YNXSocialJointPolicy10));e!=nil{return nil,e};v:=*p;r:=body.Policy10DATA{Version:int(v.version),NotBeforeMS:int64(v.not_before_ms),ExpiresMS:int64(v.expires_ms),MaxLifetimeMS:int64(v.max_lifetime_ms)};var e error
 if r.Purpose,e=c.text(v.purpose);e!=nil{return nil,e}
 if r.Role,e=c.text(v.role);e!=nil{return nil,e}
 if r.Realm,e=c.text(v.realm);e!=nil{return nil,e}
 if r.Client,e=c.text(v.client);e!=nil{return nil,e}
 if r.Network,e=c.text(v.network);e!=nil{return nil,e}
 if r.HeaderSHA256,e=c.text(v.header_sha256);e!=nil{return nil,e}
 return &r,nil
}
func decode(c *capture,p *C.YNXSocialFreshJointProfileInputV1)(body.CapturedDATA,body.RegisteredBindingDATA,*body.Policy10DATA,*body.Policy10DATA,body.WindowDATA,error){
 var x body.CapturedDATA;var b body.RegisteredBindingDATA;var w body.WindowDATA
 if p==nil||uintptr(unsafe.Pointer(p))%unsafe.Alignof(*p)!=0{return x,b,nil,nil,w,bad}
 if e:=c.input(unsafe.Pointer(p),uint64(C.sizeof_YNXSocialFreshJointProfileInputV1));e!=nil{return x,b,nil,nil,w,e};v:=*p
 if v.abi_version!=1||v.struct_size!=C.uint32_t(C.sizeof_YNXSocialFreshJointProfileInputV1){return x,b,nil,nil,w,bad}
 var e error
 if x.HistoryEnvelopeOriginal,e=c.span(v.captured.history_original,1,65536);e!=nil{return x,b,nil,nil,w,e}
 if x.IssuerCredentialOriginal,e=c.span(v.captured.issuer_original,1,65536);e!=nil{return x,b,nil,nil,w,e}
 if x.AnchorCredentialOriginal,e=c.span(v.captured.anchor_original,1,65536);e!=nil{return x,b,nil,nil,w,e}
 if x.RegistrationOriginal,e=c.span(v.captured.registration_original,1,65536);e!=nil{return x,b,nil,nil,w,e}
 if x.Scope.Source,e=c.text(v.captured.scope.source);e!=nil{return x,b,nil,nil,w,e}
 if x.Scope.Store,e=c.text(v.captured.scope.store);e!=nil{return x,b,nil,nil,w,e}
 if x.Scope.Schema,e=c.text(v.captured.scope.schema);e!=nil{return x,b,nil,nil,w,e}
 if x.Scope.Inode,e=c.text(v.captured.scope.inode);e!=nil{return x,b,nil,nil,w,e}
 if x.Scope.Restore,e=c.text(v.captured.scope.restore);e!=nil{return x,b,nil,nil,w,e}
 x.Scope.SourceGeneration=uint64(v.captured.scope.source_generation);x.Scope.NativeRestoreIncarnation=uint64(v.captured.scope.native_restore_incarnation);x.IssuerEpoch=uint64(v.captured.issuer_epoch);x.AnchorEpoch=uint64(v.captured.anchor_epoch);x.HistoryIssuedMS=int64(v.captured.history_issued_ms);x.HistoryExpiresMS=int64(v.captured.history_expires_ms);x.CapturedDeadlineMS=int64(v.captured.captured_deadline_ms)
 if b.Realm,e=c.text(v.binding.realm);e!=nil{return x,b,nil,nil,w,e}
 if b.Client,e=c.text(v.binding.client);e!=nil{return x,b,nil,nil,w,e}
 if b.Network,e=c.text(v.binding.network);e!=nil{return x,b,nil,nil,w,e}
 if b.Identity,e=c.text(v.binding.identity);e!=nil{return x,b,nil,nil,w,e}
 if b.Device,e=c.text(v.binding.device);e!=nil{return x,b,nil,nil,w,e}
 if b.HeaderSHA256,e=c.text(v.binding.header_sha256);e!=nil{return x,b,nil,nil,w,e}
 if b.ClassicPublic,e=c.span(v.binding.classic_public,33,33);e!=nil{return x,b,nil,nil,w,e}
 if b.PQPublic,e=c.span(v.binding.pq_public,2592,2592);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.NetworkID,e=c.text(v.binding.expected.network_id);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.CanonicalOwner,e=c.text(v.binding.expected.canonical_owner);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.Account,e=c.text(v.binding.expected.account);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.SessionBinding,e=c.text(v.binding.expected.session_binding);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.ProductID,e=c.text(v.binding.expected.product_id);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.ClientID,e=c.text(v.binding.expected.client_id);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.Platform,e=c.text(v.binding.expected.platform);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.ApplicationID,e=c.text(v.binding.expected.application_id);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.BundleID,e=c.nullable(v.binding.expected.bundle_id);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.PackageID,e=c.nullable(v.binding.expected.package_id);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.Origin,e=c.text(v.binding.expected.origin);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.Callback,e=c.text(v.binding.expected.callback);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.DeviceID,e=c.text(v.binding.expected.device_id);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.Generation,e=c.text(v.binding.expected.generation);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.RegistrationID,e=c.text(v.binding.expected.registration_id);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.Revision,e=c.text(v.binding.expected.revision);e!=nil{return x,b,nil,nil,w,e}
 if b.Expected.RegistrationDigest,e=c.text(v.binding.expected.registration_digest);e!=nil{return x,b,nil,nil,w,e}
 i,e:=c.policy(v.issuer_policy);if e!=nil{return x,b,nil,nil,w,e};a,e:=c.policy(v.anchor_policy);if e!=nil{return x,b,nil,nil,w,e}
 w=body.WindowDATA{IssuedMS:int64(v.window.issued_ms),ExpiresMS:int64(v.window.expires_ms),AtMS:int64(v.window.at_ms)};return x,b,i,a,w,nil
}
func run(raw *C.YNXSocialJointSpan,in *C.YNXSocialFreshJointProfileInputV1,out *C.uint8_t,cap C.size_t,written *C.size_t,hash *C.uint8_t)(ret C.int32_t){
 ret=C.YNX_SOCIAL_JOINT_DATA_INTERNAL;defer func(){if recover()!=nil{ret=C.YNX_SOCIAL_JOINT_DATA_INTERNAL}}()
 if uint64(cap)==0||uint64(cap)>32768||written==nil||uintptr(unsafe.Pointer(written))%unsafe.Alignof(*written)!=0{return C.YNX_SOCIAL_JOINT_DATA_INVALID}
 c:=capture{};for _,x:=range []struct{p unsafe.Pointer;n uint64}{{unsafe.Pointer(out),uint64(cap)},{unsafe.Pointer(written),uint64(unsafe.Sizeof(*written))},{unsafe.Pointer(hash),64}}{r,e:=rangeOf(x.p,x.n);if e!=nil{return C.YNX_SOCIAL_JOINT_DATA_INVALID};for _,old:=range c.outputs{if overlap(r,old){return C.YNX_SOCIAL_JOINT_DATA_ALIAS}};c.outputs=append(c.outputs,r)}
 // Struct and view overlap is rejected before copying. Invalid addresses remain
 // the Native caller's memory-safety responsibility, never an untrusted JS port.
 x,b,i,a,w,e:=decode(&c,in);if e!=nil{return C.YNX_SOCIAL_JOINT_DATA_INVALID}
 var p body.PlanDATA
 if raw==nil{p,e=body.PrepareBodyDATA(x,b,i,a,w)}else{v,err:=c.span(*raw,1,32768);if err!=nil{return C.YNX_SOCIAL_JOINT_DATA_INVALID};p,e=body.InspectBodyOriginalDATA(v,x,b,i,a,w)}
 if errors.Is(e,body.ErrNotSupplied){return C.YNX_SOCIAL_JOINT_DATA_NOT_SUPPLIED};if e!=nil||p.RootAdmission||p.SourceAdmission||p.NativeAdmission||len(p.BodyOriginal)>32768||len(p.HistoryOriginalSHA256)!=64{return C.YNX_SOCIAL_JOINT_DATA_INVALID}
 if uint64(len(p.BodyOriginal))>uint64(cap){return C.YNX_SOCIAL_JOINT_DATA_CAPACITY}
 // No foreign effect or fallible computation after this commit point.
 copy(unsafe.Slice((*byte)(unsafe.Pointer(out)),len(p.BodyOriginal)),p.BodyOriginal)
 copy(unsafe.Slice((*byte)(unsafe.Pointer(hash)),64),[]byte(p.HistoryOriginalSHA256));*written=C.size_t(len(p.BodyOriginal));return C.YNX_SOCIAL_JOINT_DATA_OK
}
//export YNXSocialFreshJointProfilePrepareBodyDATA
func YNXSocialFreshJointProfilePrepareBodyDATA(in *C.YNXSocialFreshJointProfileInputV1,out *C.uint8_t,cap C.size_t,written *C.size_t,hash *C.uint8_t)C.int32_t{return run(nil,in,out,cap,written,hash)}
//export YNXSocialFreshJointProfileInspectBodyDATA
func YNXSocialFreshJointProfileInspectBodyDATA(raw C.YNXSocialJointSpan,in *C.YNXSocialFreshJointProfileInputV1,out *C.uint8_t,cap C.size_t,written *C.size_t,hash *C.uint8_t)C.int32_t{return run(&raw,in,out,cap,written,hash)}
