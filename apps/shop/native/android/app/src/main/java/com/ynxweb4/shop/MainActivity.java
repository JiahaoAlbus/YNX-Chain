package com.ynxweb4.shop;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.net.*;
import android.os.Bundle;
import android.provider.Settings;
import android.view.*;
import android.view.accessibility.AccessibilityManager;
import android.widget.*;

import org.json.*;

import java.text.NumberFormat;
import java.time.*;
import java.time.format.*;
import java.util.*;

public final class MainActivity extends Activity {
    private static final int BLUE=Color.rgb(0,47,167),INK=Color.rgb(7,20,51),LINE=Color.rgb(220,227,242);
    private SecureStore secure; private ApiClient api; private OfflineMutationQueue queue; private WalletAuth wallet;
    private LinearLayout content; private TextView status,cartBadge; private JSONArray products=new JSONArray(),cart=new JSONArray();
    private EditText recipient,address,city,country;

    @Override protected void attachBaseContext(Context base){super.attachBaseContext(LocaleController.apply(base));}
    @Override public void onCreate(Bundle state){super.onCreate(state);secure=new SecureStore(this);api=new ApiClient(secure);queue=new OfflineMutationQueue(secure);wallet=new WalletAuth(this,secure,api);build();restoreCart();handleIntent(getIntent());showCatalog();}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);handleIntent(intent);}
    @Override protected void onDestroy(){api.close();super.onDestroy();}

    private void build(){
        LinearLayout root=column();root.setBackgroundColor(Color.WHITE);
        LinearLayout header=row();header.setPadding(dp(18),dp(16),dp(18),dp(10));
        TextView brand=text(getString(R.string.app_name),24,true);brand.setTextColor(INK);header.addView(brand,new LinearLayout.LayoutParams(0,dp(52),1));
        Button walletButton=button(getString(R.string.wallet_sign_in));walletButton.setContentDescription(getString(R.string.wallet_sign_in));walletButton.setOnClickListener(v->signIn());header.addView(walletButton);
        root.addView(header);
        status=text(getString(R.string.loading),13,false);status.setContentDescription(getString(R.string.accessibility_status));status.setPadding(dp(18),dp(8),dp(18),dp(8));status.setTextColor(Color.DKGRAY);root.addView(status);
        HorizontalScrollView navigation=new HorizontalScrollView(this);navigation.setHorizontalScrollBarEnabled(false);LinearLayout tabs=row();
        tabs.addView(nav(getString(R.string.nav_catalog),v->showCatalog()));tabs.addView(nav(getString(R.string.nav_cart),v->showCart()));
        Button orders=nav(getString(R.string.nav_orders),v->showOrders());tabs.addView(orders);tabs.addView(nav(getString(R.string.nav_account),v->showAccount()));
        cartBadge=text("0",12,true);cartBadge.setTextColor(BLUE);tabs.addView(cartBadge,new LinearLayout.LayoutParams(dp(36),dp(48)));navigation.addView(tabs);root.addView(navigation);
        ScrollView scroll=new ScrollView(this);content=column();content.setPadding(dp(18),dp(14),dp(18),dp(80));scroll.addView(content);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        setContentView(root);
    }

    private void showCatalog(){
        content.removeAllViews();TextView heading=text(getString(R.string.nav_catalog),30,true);content.addView(heading);
        TextView boundary=text(getString(R.string.payment_boundary),14,false);boundary.setTextColor(BLUE);boundary.setPadding(0,dp(8),0,dp(14));content.addView(boundary);
        LinearLayout search=row();EditText query=input(getString(R.string.search_hint));search.addView(query,new LinearLayout.LayoutParams(0,dp(52),1));Button run=primary(getString(R.string.search));search.addView(run);content.addView(search);
        Button ai=button(getString(R.string.ai_compare));ai.setOnClickListener(v->runAI("search_comparison","public_catalog","Current public catalog query: "+query.getText(),12));content.addView(ai);
        LinearLayout results=column();content.addView(results);run.setOnClickListener(v->loadCatalog(query.getText().toString(),results));loadCatalog("",results);
    }

    private void loadCatalog(String query,LinearLayout results){
        status.setText(getString(R.string.loading));results.removeAllViews();
        String path="/products"+(query.isBlank()?"":"?q="+Uri.encode(query));
        api.request("GET",path,null,(value,error)->runOnUiThread(()->{
            if(error!=null){status.setText(isOnline()?error.getMessage():getString(R.string.offline));Button retry=button(getString(R.string.retry));retry.setOnClickListener(v->loadCatalog(query,results));results.addView(retry);return;}
            products=value.optJSONArray("products");if(products==null)products=new JSONArray();status.setText(products.length()==0?getString(R.string.empty_catalog):getResources().getQuantityString(R.plurals.orders_count,products.length(),products.length()).replace(getString(R.string.nav_orders).toLowerCase(Locale.ROOT),getString(R.string.nav_catalog).toLowerCase(Locale.ROOT)));
            for(int i=0;i<products.length();i++)try{results.addView(productCard(products.getJSONObject(i)));}catch(Exception e){status.setText(getString(R.string.security_error));}
        }));
    }

    private View productCard(JSONObject product)throws Exception{
        LinearLayout card=column();card.setPadding(dp(16),dp(16),dp(16),dp(16));card.setBackground(border());
        card.addView(text(product.getString("Title"),20,true));card.addView(text(product.optString("Description"),14,false));
        JSONArray variants=product.getJSONArray("Variants");Spinner picker=new Spinner(this);List<String> labels=new ArrayList<>();List<JSONObject> available=new ArrayList<>();
        for(int j=0;j<variants.length();j++){JSONObject v=variants.getJSONObject(j);long left=v.getLong("Inventory")-v.getLong("Reserved");if(left>=0){labels.add(v.getString("Name")+" · "+formatYNXT(v.getLong("PriceYNXT"))+" · "+left+" "+getString(R.string.inventory));available.add(v);}}
        picker.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,labels));picker.setContentDescription(product.getString("Title")+" "+getString(R.string.inventory));card.addView(picker);
        Button add=primary(getString(R.string.add_cart));add.setEnabled(!available.isEmpty());add.setOnClickListener(v->{try{JSONObject variant=available.get(picker.getSelectedItemPosition());addCart(product,variant);}catch(Exception error){status.setText(error.getMessage());}});card.addView(add);
        LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,-2);params.setMargins(0,dp(10),0,dp(10));card.setLayoutParams(params);return card;
    }

    private void addCart(JSONObject product,JSONObject variant)throws Exception{
        for(int i=0;i<cart.length();i++){JSONObject item=cart.getJSONObject(i);if(item.getString("ProductID").equals(product.getString("ID"))&&item.getString("VariantID").equals(variant.getString("ID"))){item.put("Quantity",item.getInt("Quantity")+1);persistCart();return;}}
        cart.put(new JSONObject().put("ProductID",product.getString("ID")).put("VariantID",variant.getString("ID")).put("Quantity",1));persistCart();
    }
    private void persistCart()throws Exception{secure.put("cart",cart.toString());cartBadge.setText(String.valueOf(cart.length()));if(hasSession())api.request("PUT","/cart",new JSONObject().put("Items",cart),(v,e)->{});status.setText(getString(R.string.add_cart));}
    private void restoreCart(){try{String raw=secure.get("cart");cart=raw.isEmpty()?new JSONArray():new JSONArray(raw);cartBadge.setText(String.valueOf(cart.length()));}catch(Exception e){cart=new JSONArray();status.setText(getString(R.string.security_error));}}

    private void showCart(){
        content.removeAllViews();content.addView(text(getString(R.string.order_review),30,true));
        if(cart.length()==0){content.addView(text(getString(R.string.cart_empty),15,false));return;}
        long total=0;for(int i=0;i<cart.length();i++)try{JSONObject item=cart.getJSONObject(i),p=findProduct(item.getString("ProductID")),variant=findVariant(p,item.getString("VariantID"));long line=variant.getLong("PriceYNXT")*item.getLong("Quantity");total+=line;content.addView(text(p.getString("Title")+" × "+item.getLong("Quantity")+" · "+formatYNXT(line),15,false));}catch(Exception error){content.addView(text(getString(R.string.unavailable),14,false));}
        content.addView(text(formatYNXT(total),26,true));
        recipient=input(getString(R.string.recipient));address=input(getString(R.string.address));city=input(getString(R.string.city));country=input(getString(R.string.country));
        for(EditText field:List.of(recipient,address,city,country))content.addView(field);
        TextView unavailable=text(getString(R.string.tax_unavailable)+" · "+getString(R.string.logistics_unavailable),13,false);unavailable.setTextColor(Color.DKGRAY);content.addView(unavailable);
        Button checkout=primary(getString(R.string.checkout));checkout.setOnClickListener(v->checkout());content.addView(checkout);
    }

    private void checkout(){
        if(!hasSession()){signIn();return;}if(recipient.getText().toString().isBlank()||address.getText().toString().isBlank()||country.getText().toString().isBlank()){status.setText(getString(R.string.address));return;}
        try{
            JSONObject first=cart.getJSONObject(0),product=findProduct(first.getString("ProductID"));
            JSONObject body=new JSONObject().put("StoreID",product.getString("StoreID")).put("Items",cart).put("Address",new JSONObject().put("Recipient",recipient.getText()).put("Line1",address.getText()).put("City",city.getText()).put("Country",country.getText())).put("IdempotencyKey",UUID.randomUUID().toString());
            if(!isOnline()){queue.enqueue("POST","/orders",body);status.setText(getString(R.string.queued_offline));return;}
            status.setText(getString(R.string.loading));api.request("POST","/orders",body,(value,error)->runOnUiThread(()->{if(error!=null){status.setText(error.getMessage());return;}try{cart=new JSONArray();persistCart();status.setText(getString(R.string.payment_pending));showOrders();}catch(Exception e){status.setText(getString(R.string.security_error));}}));
        }catch(Exception error){status.setText(error.getMessage());}
    }

    private void showOrders(){
        content.removeAllViews();content.addView(text(getString(R.string.nav_orders),30,true));if(!hasSession()){content.addView(primaryWallet());return;}
        LinearLayout list=column();content.addView(list);status.setText(getString(R.string.loading));api.request("GET","/orders",null,(value,error)->runOnUiThread(()->{
            if(error!=null){status.setText(error.getMessage());Button retry=button(getString(R.string.retry));retry.setOnClickListener(v->showOrders());list.addView(retry);return;}
            JSONArray orders=value.optJSONArray("orders");if(orders==null||orders.length()==0){status.setText(getString(R.string.no_orders));return;}status.setText(getResources().getQuantityString(R.plurals.orders_count,orders.length(),orders.length()));
            for(int i=0;i<orders.length();i++)try{list.addView(orderCard(orders.getJSONObject(i)));}catch(Exception e){status.setText(getString(R.string.security_error));}
        }));
    }

    private View orderCard(JSONObject order)throws Exception{
        LinearLayout card=column();card.setPadding(dp(14),dp(14),dp(14),dp(14));card.setBackground(border());String state=order.getString("Status");
        card.addView(text(order.getString("ID"),14,true));card.addView(text(state+" · "+formatYNXT(order.getLong("TotalYNXT")),16,true));
        card.addView(text(getString(R.string.tax_unavailable)+" · "+order.optString("LogisticsStatus",getString(R.string.logistics_unavailable)),12,false));
        if(order.has("Settlement")&&!order.isNull("Settlement")){JSONObject proof=order.getJSONObject("Settlement");card.addView(text("Block "+proof.getLong("BlockHeight")+" · "+proof.getString("TransactionHash"),12,false));}
        if(state.equals("payment_pending")){card.addView(action(getString(R.string.pay_handoff),()->pay(order)));card.addView(action(getString(R.string.check_payment),()->postOrder(order,"confirm-payment",new JSONObject())));card.addView(action(getString(R.string.cancel_order),()->transition(order,"cancelled","")));}
        if(state.equals("shipped"))card.addView(action(getString(R.string.confirm_delivery),()->transition(order,"delivered","")));
        if(state.equals("delivered")){card.addView(action(getString(R.string.write_review),()->transition(order,"reviewed","Verified delivery review")));card.addView(action(getString(R.string.return_request),()->transition(order,"return_requested","Return requested by buyer")));}
        if(List.of("paid","shipped","delivered","reviewed","return_requested","return_approved","refund_requested").contains(state))card.addView(action(getString(R.string.dispute),()->transition(order,"disputed","Buyer dispute evidence")));
        if(List.of("paid","return_requested","return_approved").contains(state))card.addView(action(getString(R.string.refund_request),()->transition(order,"refund_requested","Refund requested; no transfer claimed")));
        card.addView(action(getString(R.string.ai_compare),()->runAI("support_draft","owned_order","Owned order "+order.optString("ID")+" status "+state,10)));
        LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,-2);params.setMargins(0,dp(8),0,dp(8));card.setLayoutParams(params);return card;
    }

    private void pay(JSONObject order){api.request("POST","/orders/"+order.optString("ID")+"/pay-handoff",json("IdempotencyKey",UUID.randomUUID().toString()),(value,error)->runOnUiThread(()->{if(error!=null){status.setText(error.getMessage());return;}try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(value.getString("deepLink"))));}catch(Exception e){status.setText(getString(R.string.unavailable));}}));}
    private void postOrder(JSONObject order,String endpoint,JSONObject body){api.request("POST","/orders/"+order.optString("ID")+"/"+endpoint,body,(v,e)->runOnUiThread(()->{status.setText(e==null?getString(R.string.loading):e.getMessage());if(e==null)showOrders();}));}
    private void transition(JSONObject order,String action,String explanation){JSONObject body=new JSONObject();try{body.put("Action",action).put("Reason",explanation).put("Explanation",explanation).put("Body",explanation).put("Rating",action.equals("reviewed")?5:0).put("IdempotencyKey",UUID.randomUUID().toString());if(!isOnline()){queue.enqueue("POST","/orders/"+order.getString("ID")+"/transition",body);status.setText(getString(R.string.queued_offline));return;}postOrder(order,"transition",body);}catch(Exception e){status.setText(e.getMessage());}}

    private void showAccount(){
        content.removeAllViews();content.addView(text(getString(R.string.nav_account),30,true));content.addView(text(getString(R.string.wallet_security),14,false));content.addView(text(getString(R.string.privacy_boundary),14,false));content.addView(primaryWallet());
        content.addView(text(getString(R.string.settings_language),15,true));Spinner language=localeSpinner(LocaleController.current(this));language.setContentDescription(getString(R.string.accessibility_language));language.setOnItemSelectedListener(selection(tag->{if(!tag.equals(LocaleController.current(this))){LocaleController.save(this,tag);recreate();}}));content.addView(language);
        content.addView(text(getString(R.string.ai_language),15,true));Spinner ai=localeSpinner(LocaleController.aiLanguage(this));ai.setContentDescription(getString(R.string.accessibility_ai_language));ai.setOnItemSelectedListener(selection(tag->LocaleController.saveAI(this,tag)));content.addView(ai);
        Button retry=button(getString(R.string.restore_pending));retry.setOnClickListener(v->new Thread(()->{try{int count=queue.flush(api);runOnUiThread(()->status.setText(count+" "+getString(R.string.restore_pending)));}catch(Exception e){runOnUiThread(()->status.setText(e.getMessage()));}}).start());content.addView(retry);
        if(hasSession()){recipient=input(getString(R.string.recipient));address=input(getString(R.string.address));city=input(getString(R.string.city));country=input(getString(R.string.country));for(EditText f:List.of(recipient,address,city,country))content.addView(f);Button save=primary(getString(R.string.save_profile));save.setOnClickListener(v->saveProfile());content.addView(save);}
    }
    private void saveProfile(){try{JSONObject body=new JSONObject().put("DisplayName","").put("Addresses",new JSONArray().put(new JSONObject().put("Recipient",recipient.getText()).put("Line1",address.getText()).put("City",city.getText()).put("Country",country.getText())));api.request("PUT","/profile",body,(v,e)->runOnUiThread(()->status.setText(e==null?getString(R.string.profile_saved):e.getMessage())));}catch(Exception e){status.setText(e.getMessage());}}

    private void runAI(String workflow,String contextClass,String summary,long units){
        if(!hasSession()){signIn();return;}new AlertDialog.Builder(this).setTitle(getString(R.string.ai_compare)).setMessage(getString(R.string.ai_privacy)+"\n\n"+summary+"\n"+units+" AI units · "+LocaleController.aiLanguage(this)).setNegativeButton(getString(R.string.cancel),null).setPositiveButton(getString(R.string.grant_permission),(d,w)->{
            try{JSONObject body=new JSONObject().put("Workflow",workflow).put("ContextClasses",new JSONArray().put(contextClass)).put("ContextSummary",summary+"; outputLanguage="+LocaleController.aiLanguage(this)).put("EstimateUnits",units).put("PermissionGranted",true).put("IdempotencyKey",UUID.randomUUID().toString());api.request("POST","/ai/jobs",body,(job,error)->{if(error!=null){runOnUiThread(()->status.setText(error.getMessage()));return;}String id=job.optString("ID");api.request("POST","/ai/jobs/"+id+"/run",new JSONObject(),(result,runError)->runOnUiThread(()->{if(runError!=null){status.setText(runError.getMessage());return;}new AlertDialog.Builder(this).setTitle(getString(R.string.ai_compare)).setMessage(result.optString("Result")).setNegativeButton(getString(R.string.reject_draft),(x,y)->aiDecision(id,"reject")).setPositiveButton(getString(R.string.apply_draft),(x,y)->aiDecision(id,"apply")).show();}));});}catch(Exception e){status.setText(e.getMessage());}
        }).show();
    }
    private void aiDecision(String id,String decision){api.request("POST","/ai/jobs/"+id+"/decision",json("Decision",decision),(v,e)->runOnUiThread(()->status.setText(e==null?decision:e.getMessage())));}

    private void signIn(){wallet.start((account,error)->runOnUiThread(()->status.setText(error==null?getString(R.string.loading):error.getMessage())));}
    private void handleIntent(Intent intent){Uri data=intent==null?null:intent.getData();if(data!=null&&"wallet-auth".equals(data.getHost()))wallet.complete(data,(account,error)->runOnUiThread(()->{status.setText(error==null?getString(R.string.wallet_active):getString(R.string.security_error)+" "+error.getMessage());if(error==null)showAccount();}));}
    private boolean hasSession(){try{return !secure.get("bearer").isEmpty();}catch(Exception e){return false;}}
    private boolean isOnline(){ConnectivityManager manager=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);Network network=manager.getActiveNetwork();NetworkCapabilities caps=network==null?null:manager.getNetworkCapabilities(network);return caps!=null&&caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);}

    private JSONObject findProduct(String id)throws Exception{for(int i=0;i<products.length();i++){JSONObject p=products.getJSONObject(i);if(p.getString("ID").equals(id))return p;}throw new JSONException("product unavailable");}
    private JSONObject findVariant(JSONObject p,String id)throws Exception{JSONArray vs=p.getJSONArray("Variants");for(int i=0;i<vs.length();i++){JSONObject v=vs.getJSONObject(i);if(v.getString("ID").equals(id))return v;}throw new JSONException("variant unavailable");}
    private String formatYNXT(long amount){return getString(R.string.ynxt_amount,NumberFormat.getNumberInstance(getResources().getConfiguration().getLocales().get(0)).format(amount));}
    private JSONObject json(String key,Object value){try{return new JSONObject().put(key,value);}catch(Exception e){return new JSONObject();}}
    private TextView text(String value,int size,boolean bold){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(INK);t.setPadding(dp(4),dp(7),dp(4),dp(7));if(bold)t.setTypeface(null,1);return t;}
    private EditText input(String hint){EditText e=new EditText(this);e.setHint(hint);e.setContentDescription(hint);e.setMinHeight(dp(52));return e;}
    private Button button(String label){Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setMinHeight(dp(48));b.setContentDescription(label);return b;}
    private Button primary(String label){Button b=button(label);b.setTextColor(Color.WHITE);b.setBackgroundColor(BLUE);return b;}
    private Button primaryWallet(){Button b=primary(hasSession()?getString(R.string.wallet_active):getString(R.string.wallet_sign_in));b.setOnClickListener(v->signIn());return b;}
    private Button nav(String label,View.OnClickListener l){Button b=button(label);b.setOnClickListener(l);return b;}
    private Button action(String label,Runnable action){Button b=button(label);b.setOnClickListener(v->action.run());return b;}
    private LinearLayout row(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.HORIZONTAL);l.setGravity(Gravity.CENTER_VERTICAL);return l;}
    private LinearLayout column(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);return l;}
    private android.graphics.drawable.GradientDrawable border(){android.graphics.drawable.GradientDrawable d=new android.graphics.drawable.GradientDrawable();d.setColor(Color.WHITE);d.setStroke(dp(1),LINE);d.setCornerRadius(dp(12));return d;}
    private int dp(int v){return Math.round(v*getResources().getDisplayMetrics().density);}
    private Spinner localeSpinner(String selected){Spinner s=new Spinner(this);List<String> tags=Arrays.asList(LocaleController.TAGS);s.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,tags));s.setSelection(Math.max(0,tags.indexOf(selected)));return s;}
    private interface TagAction{void run(String tag);}
    private AdapterView.OnItemSelectedListener selection(TagAction action){return new AdapterView.OnItemSelectedListener(){public void onItemSelected(AdapterView<?>p,View v,int position,long id){action.run(LocaleController.TAGS[position]);}public void onNothingSelected(AdapterView<?>p){}};}
}
