package com.ynxweb4.shop;
import org.json.*;
import java.util.Iterator;
final class BuyerTransitionRecovery {
    static JSONObject receipt(JSONObject value,ProductSession session,String path,JSONObject body)throws Exception{
        if(!path.matches("/orders/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}/transition"))throw new SecurityException("Exact original order path required");
        String target=path.substring("/orders/".length(),path.length()-"/transition".length());
        if(!session.account.equals(value.getString("Actor"))||!target.equals(value.getString("OrderID"))||!body.getString("Action").equals(value.getString("Action"))||!body.getString("IdempotencyKey").equals(value.getString("IdempotencyKey")))throw new SecurityException("Original order transition readback changed");
        JSONObject order=value.getJSONObject("Order");BuyerOrderReadback.validate(order,session);if(!target.equals(order.getString("ID")))throw new SecurityException("Original order target changed");return order;
    }
    static int recoverTracked(PrivacyLifecycle privacy,OfflineMutationQueue.Sender api,ProductSession expected,long generation)throws Exception{
        if(!expected.nativeV2||!expected.same(api.session()))throw new SecurityException("Original Native session required");
        JSONObject requests=privacy.snapshot(expected.account).getJSONObject("requests");int completed=0;Iterator<String> ids=requests.keys();
        while(ids.hasNext()){
            String id=ids.next();JSONObject original=requests.getJSONObject(id);String path=original.optString("path");
            if(!"POST".equals(original.optString("method"))||!"UNKNOWN".equals(original.optString("status"))||!path.matches("/orders/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}/transition"))continue;
            if(!api.current()||!expected.same(api.session())||!privacy.current(expected.account,generation))throw new SecurityException("Original Native recovery context changed");
            JSONObject body=original.getJSONObject("body"),value=api.requestForSession("POST",path+"-intent-lookup",body,expected,generation);receipt(value,expected,path,body);
            if(!api.current()||!expected.same(api.session()))throw new SecurityException("Original Native recovery account changed");
            privacy.confirmOriginalTransition(expected.account,generation,id,original);completed++;
        }
        return completed;
    }
}
