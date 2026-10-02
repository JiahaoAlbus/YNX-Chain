package com.ynxweb4.shop;

// File-picker results can arrive before onResume has noticed session expiry.
// Each picker owns one payload and one exact product session, consumed once.
final class PrivacyExport {
    private int sequence=6423,requestCode=-1;
    private ProductSession owner;
    private String payload="";
    int begin(ProductSession session) {
        if(session==null)throw new SecurityException("An active Shop session is required");
        sequence=(sequence+1)&0xffff;requestCode=sequence;owner=session;payload="";
        return requestCode;
    }
    boolean ready(int code,ProductSession current,String value) {
        if(code!=requestCode||owner==null||!owner.same(current))return false;
        payload=value;return true;
    }
    String consume(int code,ProductSession current) {
        if(code!=requestCode)return "";
        String value=owner!=null&&owner.same(current)?payload:"";clear();return value;
    }
    boolean matches(int code) { return code==requestCode; }
    void cancel(int code) { if(matches(code))clear(); }
    void clear() { requestCode=-1;owner=null;payload=""; }
}
