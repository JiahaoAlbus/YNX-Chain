package com.ynxweb4.shop;
import android.content.Context;
import android.net.Uri;
import org.json.JSONObject;

// Canonical adopted Native SDK only. Original V1 records/keys remain retired
// in their original storage; no legacy token establishes this private session.
final class WalletAuth {
 interface Result {void done(String account,Exception error);}
 private final NativeSessionBridge bridge;
 WalletAuth(Context context,SecureStore secure,ApiClient api){bridge=new NativeSessionBridge(context,secure);api.attachNative(bridge);bridge.restore((value,error)->{});}
 void start(Result result){bridge.restore((value,error)->{if(error!=null){result.done(null,error);return;}ProductSession current=bridge.session();if(current!=null){result.done(current.account,null);return;}bridge.connect((launch,failure)->{if(failure!=null)result.done(null,failure);else if(!launch.optBoolean("opened"))result.done(null,new IllegalStateException("Registered Wallet handler unavailable"));else result.done("",null);});});}
 void complete(Uri callback,Result result){bridge.handleReturn(callback==null?null:callback.toString(),(value,error)->{ProductSession current=bridge.session();if(error!=null)result.done(null,error);else if(current==null)result.done(null,new SecurityException("Wallet return did not establish a private session"));else result.done(current.account,null);});}
 void reviewInvoice(ProductSession original,String link,java.util.function.BooleanSupplier presentation,Result result){bridge.openInvoiceReference(original,link,presentation,(value,error)->result.done(error==null&&value.optBoolean("opened")?"opened":"",error));}
 void signOut()throws Exception{bridge.disconnect();}
 void close(){bridge.close();}
 static String canonical(Object value)throws Exception{return NativeProductState.canonical(value);}
}
