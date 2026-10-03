package com.ynxweb4.shop;

import java.nio.charset.StandardCharsets;
import java.util.List;
import org.json.JSONObject;

/** User input only; admission and actor authority remain in the original API. */
final class BuyerOrderActionInput {
    static boolean allowed(String status,String action){
        switch(action){
            case "cancelled": return status.equals("payment_pending");
            case "delivered": return status.equals("shipped");
            case "reviewed": return status.equals("delivered");
            case "return_requested": return List.of("delivered","reviewed").contains(status);
            case "refund_requested": return List.of("paid","return_requested","return_approved").contains(status);
            case "disputed": return List.of("paid","shipped","delivered","reviewed","return_requested","return_approved","refund_requested").contains(status);
            default: return false;
        }
    }
    static JSONObject build(String status,String action,int rating,String reason,String detail)throws Exception{
        if(!allowed(status,action))throw new IllegalArgumentException("Invalid buyer order action");
        reason=reason.strip();detail=detail.strip();
        boolean review=action.equals("reviewed"),resolution=List.of("return_requested","refund_requested","disputed").contains(action);
        if((review&&(rating<1||rating>5))||(!review&&rating!=0)||reason.getBytes(StandardCharsets.UTF_8).length>1000||detail.getBytes(StandardCharsets.UTF_8).length>5000||(resolution&&reason.isEmpty()))throw new IllegalArgumentException("Invalid order action input");
        if((review&&!reason.isEmpty())||(!review&&!resolution&&(!reason.isEmpty()||!detail.isEmpty())))throw new IllegalArgumentException("Unexpected order action input");
        return new JSONObject().put("Action",action).put("Rating",rating).put("Reason",reason).put("Explanation",resolution?detail:"").put("Body",review?detail:"");
    }
}
