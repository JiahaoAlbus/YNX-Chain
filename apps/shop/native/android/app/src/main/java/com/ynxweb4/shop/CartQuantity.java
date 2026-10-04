package com.ynxweb4.shop;
import org.json.*;
// Operate on the exact displayed line; never mutate the caller's snapshot.
final class CartQuantity {
 static JSONArray change(JSONArray original,String product,String variant,int displayed,int quantity)throws Exception{
  if(quantity<1||quantity>20||displayed<1||displayed>20)throw new IllegalArgumentException("Invalid quantity");
  JSONArray next=new JSONArray(original.toString());int index=-1;
  for(int i=0;i<next.length();i++){JSONObject item=next.getJSONObject(i);if(product.equals(item.getString("ProductID"))&&variant.equals(item.getString("VariantID"))){if(index>=0)throw new SecurityException("Ambiguous cart line");index=i;}}
  if(index<0||next.getJSONObject(index).getInt("Quantity")!=displayed)throw new SecurityException("Cart changed during review");
  next.getJSONObject(index).put("Quantity",quantity);return next;
 }
}
