package com.ynxweb4.video;
import org.json.JSONObject;
// Host transport fixture only. Actual SDK crypto/authority is exercised by the
// separate actual packaged-engine + Node/Go tests; these strings are NOT grants.
final class NativeSessionBridge {
 NativeSessionIdentity active;long revision;int proofs;boolean missing;
 NativeSessionBridge(NativeSessionIdentity identity){active=identity;}
 NativeSessionIdentity session(){return missing?null:active;}
 long epoch(){return revision;}
 JSONObject proof(String method,String path,String digest,long bytes,NativeSessionIdentity expected)throws Exception{
  if(!expected.same(session()))throw new java.io.IOException("retired native fixture");
  return new JSONObject().put("identityHeader","fixture-introspection-no-auth").put("actionHeader",digest+":"+bytes+":"+ ++proofs);
 }
 void rejected(NativeSessionIdentity expected){if(expected.same(active)){missing=true;revision++;}}
}
