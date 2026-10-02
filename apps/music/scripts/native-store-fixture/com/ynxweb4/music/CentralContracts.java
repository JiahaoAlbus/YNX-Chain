package com.ynxweb4.music;
import org.json.*;
// Only the private API's transport boundary is exercised here, never Wallet approval.
final class CentralContracts{
 static String productDeviceKey(){return "owned-host-fixture-public-device";}
 static JSONObject aiRequest(String kind,String intent,JSONArray ids,String language){return new JSONObject();}
}
