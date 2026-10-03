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

import java.io.OutputStream;
import java.text.NumberFormat;
import java.time.*;
import java.time.format.*;
import java.util.*;

public final class MainActivity extends Activity {
    private static final int BLUE=Color.rgb(0,47,167),INK=Color.rgb(7,20,51),LINE=Color.rgb(220,227,242);
    private SecureStore secure; private ApiClient api; private OfflineMutationQueue queue; private WalletAuth wallet; private ImageLoader images;
    private LinearLayout content; private TextView status,cartBadge; private JSONArray products=new JSONArray(),cart=new JSONArray();
    private EditText recipient,address,city,country; private String loadedCartKey="",loadedCartText="";
    private final PrivacyExport privacyExport=new PrivacyExport();
    private final android.os.Handler sessionClock=new android.os.Handler(android.os.Looper.getMainLooper());
    private final Set<AlertDialog> privateDialogs=new HashSet<>();
    private final AIPresentation aiPresentation=new AIPresentation();
    private AlertDialog aiDialog;
    private void clearAI(){aiPresentation.clear();if(aiDialog!=null){aiDialog.dismiss();aiDialog=null;}}
    private ProductSession presentationSession;
    private long presentationPrivacyGeneration=-1;
    private String presentationPrivacyPhase="";
    private void showDialog(AlertDialog dialog){showDialog(dialog,()->{});}
    private void showDialog(AlertDialog dialog,Runnable dismissed){privateDialogs.add(dialog);dialog.setOnDismissListener(d->{privateDialogs.remove(dialog);dismissed.run();});dialog.show();}
    private void clearPrivatePresentation(){clearAI();for(AlertDialog dialog:new ArrayList<>(privateDialogs))dialog.dismiss();privacyExport.clear();recipient=null;address=null;city=null;country=null;restoreCart();}
    private void reconcileSession(){
        sessionClock.removeCallbacksAndMessages(null);
        ProductSession current=null;try{current=api.session();}catch(Exception ignored){}
        boolean changed=presentationSession==null?current!=null:!presentationSession.same(current);
        long generation=-1;String phase="";
        if(current!=null)try{JSONObject state=api.privacy().snapshot(current.account);generation=state.optLong("generation");phase=state.optString("phase");}catch(Exception error){status.setText(getString(R.string.security_error));}
        boolean privacyChanged=current!=null&&(generation!=presentationPrivacyGeneration||!phase.equals(presentationPrivacyPhase));
        presentationSession=current;
        presentationPrivacyGeneration=generation;presentationPrivacyPhase=phase;
        if(changed){clearPrivatePresentation();showCatalog();}
        else if(privacyChanged){clearPrivatePresentation();showAccount();}
        if(current!=null)sessionClock.postDelayed(this::reconcileSession,Math.max(1,Math.min(1000,Duration.between(Instant.now(),current.expiresAt).toMillis()+1)));
    }
    @Override protected void onResume(){super.onResume();if(api!=null)reconcileSession();}
    @Override protected void onPause(){clearAI();sessionClock.removeCallbacksAndMessages(null);super.onPause();}

    @Override protected void attachBaseContext(Context base){super.attachBaseContext(LocaleController.apply(base));}
    @Override public void onCreate(Bundle state){super.onCreate(state);secure=SecureStore.open(this);api=new ApiClient(secure);api.onSessionRejected(this::reconcileSession);queue=new OfflineMutationQueue(secure);wallet=new WalletAuth(this,secure,api);images=new ImageLoader();build();restoreCart();try{presentationSession=api.session();if(presentationSession!=null){JSONObject privacy=api.privacy().snapshot(presentationSession.account);if(PrivacyLifecycle.ACTIVE.equals(privacy.optString("phase"))){presentationPrivacyGeneration=privacy.optLong("generation");presentationPrivacyPhase=PrivacyLifecycle.ACTIVE;}}}catch(Exception ignored){}handleIntent(getIntent());showCatalog();}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);handleIntent(intent);}
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);if(!privacyExport.matches(requestCode))return;
        if(resultCode!=RESULT_OK||data==null||data.getData()==null){privacyExport.cancel(requestCode);return;}
        try{
            String payload=privacyExport.consume(requestCode,api.session());
            if(payload.isEmpty()){status.setText(getString(R.string.privacy_export_unavailable));return;}
            try(OutputStream out=getContentResolver().openOutputStream(data.getData())){
                if(out==null)throw new IllegalStateException("export destination unavailable");
                out.write(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            status.setText(getString(R.string.privacy_export_ready));
        }catch(Exception error){privacyExport.cancel(requestCode);status.setText(getString(R.string.privacy_export_unavailable));}
    }
    @Override protected void onDestroy(){clearAI();privacyExport.clear();sessionClock.removeCallbacksAndMessages(null);for(AlertDialog dialog:new ArrayList<>(privateDialogs))dialog.dismiss();wallet.close();api.close();images.close();super.onDestroy();}

    private void build(){
        LinearLayout root=column();root.setBackgroundColor(Color.WHITE);
        root.setOnApplyWindowInsetsListener((view,insets)->{
            view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        LinearLayout header=row();header.setPadding(dp(18),dp(16),dp(18),dp(10));
        LinearLayout brand=row();
        ImageView logo=new ImageView(this);logo.setImageResource(R.drawable.ynx_logo);logo.setAdjustViewBounds(true);logo.setScaleType(ImageView.ScaleType.CENTER_INSIDE);logo.setContentDescription(getString(R.string.ynx_logo));
        brand.addView(logo,new LinearLayout.LayoutParams(dp(76),dp(44)));
        TextView brandName=text(getString(R.string.shop_name),19,true);brandName.setTextColor(INK);brandName.setPadding(dp(8),0,0,0);brand.addView(brandName);
        header.addView(brand,new LinearLayout.LayoutParams(0,dp(52),1));
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

    private void showCatalog(){clearAI();
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
            if(error!=null){status.setText(isOnline()?message(error):getString(R.string.offline));Button retry=button(getString(R.string.retry));retry.setOnClickListener(v->loadCatalog(query,results));results.addView(retry);return;}
            products=value.optJSONArray("products");if(products==null)products=new JSONArray();status.setText(products.length()==0?getString(R.string.empty_catalog):getResources().getQuantityString(R.plurals.orders_count,products.length(),products.length()).replace(getString(R.string.nav_orders).toLowerCase(Locale.ROOT),getString(R.string.nav_catalog).toLowerCase(Locale.ROOT)));
            for(int i=0;i<products.length();i++)try{results.addView(productCard(products.getJSONObject(i)));}catch(Exception e){status.setText(getString(R.string.security_error));}
        }));
    }

    private View productCard(JSONObject product)throws Exception{
        LinearLayout card=column();card.setPadding(dp(16),dp(16),dp(16),dp(16));card.setBackground(border());
        JSONArray media=product.optJSONArray("Media");
        if(media!=null&&media.length()>0){JSONObject asset=media.optJSONObject(0);if(asset!=null){ImageView image=new ImageView(this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);image.setBackgroundColor(Color.rgb(244,246,250));image.setContentDescription(asset.optString("AltText",product.getString("Title")));card.addView(image,new LinearLayout.LayoutParams(-1,dp(190)));images.load(asset.optString("URL"),image);}}
        card.addView(text(product.getString("Title"),20,true));card.addView(text(product.optString("Description"),14,false));
        JSONArray variants=product.getJSONArray("Variants");Spinner picker=new Spinner(this);List<String> labels=new ArrayList<>();List<JSONObject> available=new ArrayList<>();
        for(int j=0;j<variants.length();j++){JSONObject v=variants.getJSONObject(j);long left=v.getLong("Inventory")-v.getLong("Reserved");if(left>=0){labels.add(v.getString("Name")+" · "+formatYNXT(v.getLong("PriceYNXT"))+" · "+left+" "+getString(R.string.inventory));available.add(v);}}
        picker.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,labels));picker.setContentDescription(product.getString("Title")+" "+getString(R.string.inventory));card.addView(picker);
        Button add=primary(getString(R.string.add_cart));add.setEnabled(!available.isEmpty());add.setOnClickListener(v->{try{JSONObject variant=available.get(picker.getSelectedItemPosition());addCart(product,variant);}catch(Exception error){status.setText(message(error));}});card.addView(add);
        LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,-2);params.setMargins(0,dp(10),0,dp(10));card.setLayoutParams(params);return card;
    }

    private void addCart(JSONObject product,JSONObject variant)throws Exception{
        synchronized(secure){
            api.requireWritable();syncCartContext();
            for(int i=0;i<cart.length();i++){JSONObject item=cart.getJSONObject(i);if(item.getString("ProductID").equals(product.getString("ID"))&&item.getString("VariantID").equals(variant.getString("ID"))){item.put("Quantity",item.getInt("Quantity")+1);persistCart();return;}}
            cart.put(new JSONObject().put("ProductID",product.getString("ID")).put("VariantID",variant.getString("ID")).put("Quantity",1));persistCart();
        }
    }
    private String cartKey()throws Exception{ProductSession session=api.session();return session==null?"cart:guest":("cart:"+session.account);}
    private void syncCartContext()throws Exception{String key=cartKey();if(!key.equals(loadedCartKey)||!secure.get(key).equals(loadedCartText))restoreCart();}
    private void persistCart()throws Exception{synchronized(secure){api.requireWritable();syncCartContext();String saved=cart.toString();secure.put(loadedCartKey,saved);loadedCartText=saved;cartBadge.setText(String.valueOf(cart.length()));syncRemoteCart();status.setText(getString(R.string.add_cart));}}
    private void syncRemoteCart()throws Exception{if(hasSession())api.request("PUT","/cart",new JSONObject().put("Items",new JSONArray(cart.toString())),(v,e)->{});}
    private void restoreCart(){synchronized(secure){try{loadedCartKey=cartKey();String raw=secure.get(loadedCartKey);cart=raw.isEmpty()?new JSONArray():new JSONArray(raw);loadedCartText=raw;cartBadge.setText(String.valueOf(cart.length()));}catch(Exception e){cart=new JSONArray();loadedCartText="";status.setText(getString(R.string.security_error));}}}

    private void showCart(){clearAI();
        try{syncCartContext();}catch(Exception error){status.setText(getString(R.string.security_error));return;}
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
            final CheckoutIntent.Prepared prepared;
            synchronized(secure){
                syncCartContext();if(cart.length()==0){showCart();return;}
                JSONObject shipping=new JSONObject().put("Recipient",recipient.getText().toString()).put("Line1",address.getText().toString()).put("City",city.getText().toString()).put("Country",country.getText().toString());
                prepared=CheckoutIntent.prepareCart(secure,shipping,id->findProduct(id).getString("StoreID"));
            }
            ProductSession session=prepared.session;JSONObject body=prepared.body;
            if(!isOnline()){queue.enqueue("POST","/orders",body);status.setText(getString(R.string.queued_offline));return;}
            status.setText(getString(R.string.loading));api.request("POST","/orders",body,(value,error)->runOnUiThread(()->{if(error!=null){status.setText(message(error));return;}try{boolean cleared=CheckoutIntent.confirmed(secure,session.account,body);restoreCart();if(cleared)syncRemoteCart();status.setText(getString(R.string.payment_pending));showOrders();}catch(Exception e){status.setText(getString(R.string.security_error));}}));
        }catch(Exception error){status.setText(message(error));}
    }

    private void showOrders(){clearAI();
        content.removeAllViews();content.addView(text(getString(R.string.nav_orders),30,true));if(!hasSession()){content.addView(primaryWallet());return;}
        LinearLayout list=column();content.addView(list);status.setText(getString(R.string.loading));api.request("GET","/orders",null,(value,error)->runOnUiThread(()->{
            if(error!=null){status.setText(message(error));Button retry=button(getString(R.string.retry));retry.setOnClickListener(v->showOrders());list.addView(retry);return;}
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

    private void pay(JSONObject order){api.request("POST","/orders/"+order.optString("ID")+"/pay-handoff",json("IdempotencyKey",UUID.randomUUID().toString()),(value,error)->runOnUiThread(()->{if(error!=null){status.setText(message(error));return;}try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(value.getString("deepLink"))));}catch(Exception e){status.setText(getString(R.string.unavailable));}}));}
    private void postOrder(JSONObject order,String endpoint,JSONObject body){api.request("POST","/orders/"+order.optString("ID")+"/"+endpoint,body,(v,e)->runOnUiThread(()->{status.setText(e==null?getString(R.string.loading):message(e));if(e==null)showOrders();}));}
    private void transition(JSONObject order,String action,String explanation){JSONObject body=new JSONObject();try{body.put("Action",action).put("Reason",explanation).put("Explanation",explanation).put("Body",explanation).put("Rating",action.equals("reviewed")?5:0).put("IdempotencyKey",UUID.randomUUID().toString());if(!isOnline()){queue.enqueue("POST","/orders/"+order.getString("ID")+"/transition",body);status.setText(getString(R.string.queued_offline));return;}postOrder(order,"transition",body);}catch(Exception e){status.setText(message(e));}}

    private void showAccount(){clearAI();
        content.removeAllViews();content.addView(text(getString(R.string.nav_account),30,true));content.addView(text(getString(R.string.wallet_security),14,false));content.addView(text(getString(R.string.privacy_boundary),14,false));content.addView(primaryWallet());
        content.addView(text(getString(R.string.settings_language),15,true));Spinner language=localeSpinner(LocaleController.current(this));language.setContentDescription(getString(R.string.accessibility_language));language.setOnItemSelectedListener(selection(tag->{if(!tag.equals(LocaleController.current(this))){LocaleController.save(this,tag);recreate();}}));content.addView(language);
        content.addView(text(getString(R.string.ai_language),15,true));Spinner ai=localeSpinner(LocaleController.aiLanguage(this));ai.setContentDescription(getString(R.string.accessibility_ai_language));ai.setOnItemSelectedListener(selection(tag->LocaleController.saveAI(this,tag)));content.addView(ai);
        Button retry=button(getString(R.string.restore_pending));retry.setOnClickListener(v->restorePending(retry));content.addView(retry);
        if(hasSession()){Button logout=button(getString(R.string.sign_out));logout.setOnClickListener(v->{try{wallet.signOut();}catch(Exception error){status.setText(getString(R.string.security_error));return;}reconcileSession();status.setText(getString(R.string.wallet_sign_in));});content.addView(logout);recipient=input(getString(R.string.recipient));address=input(getString(R.string.address));city=input(getString(R.string.city));country=input(getString(R.string.country));for(EditText f:List.of(recipient,address,city,country))content.addView(f);Button save=primary(getString(R.string.save_profile));save.setOnClickListener(v->saveProfile());content.addView(save);content.addView(text(getString(R.string.privacy_data_title),18,true));content.addView(text(getString(R.string.privacy_data_description),13,false));Button export=button(getString(R.string.privacy_export_button));export.setOnClickListener(v->exportPrivacyData());content.addView(export);renderPrivacyControls();}
    }
    private void saveProfile(){try{JSONObject body=new JSONObject().put("DisplayName","").put("Addresses",new JSONArray().put(new JSONObject().put("Recipient",recipient.getText()).put("Line1",address.getText()).put("City",city.getText()).put("Country",country.getText())));api.request("PUT","/profile",body,(v,e)->runOnUiThread(()->status.setText(e==null?getString(R.string.profile_saved):message(e))));}catch(Exception e){status.setText(message(e));}}
    private void exportPrivacyData(){
        try{
            ProductSession expected=api.session();int code=privacyExport.begin(expected);
            api.request("GET","/privacy/export",null,(value,error)->{
                if(error!=null){privacyExport.cancel(code);status.setText(getString(R.string.privacy_export_unavailable));return;}
                try{
                    if(!privacyExport.ready(code,api.session(),value.toString()))return;
                    Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE,"ynx-shop-data-"+LocalDate.now()+".json");
                    startActivityForResult(intent,code);
                }catch(Exception failure){privacyExport.cancel(code);status.setText(getString(R.string.privacy_export_unavailable));}
            });
        }catch(Exception error){status.setText(getString(R.string.privacy_export_unavailable));}
    }
    private boolean isCurrent(ProductSession expected){try{return !isFinishing()&&!isDestroyed()&&expected!=null&&expected.same(api.session());}catch(Exception error){return false;}}
    private boolean isCurrent(ProductSession expected,long generation){try{return isCurrent(expected)&&api.privacy().current(expected.account,generation);}catch(Exception error){return false;}}
    private void restorePending(Button retry){
        final ProductSession expected;final String previousCart;final long generation;
        try{expected=api.session();if(expected==null){signIn();return;}previousCart=secure.get("cart:"+expected.account);generation=api.privacy().generation(expected.account);}catch(Exception error){status.setText(getString(R.string.security_error));return;}
        retry.setEnabled(false);status.setText(getString(R.string.loading));
        new Thread(()->{
            try{int count=queue.flush(api,expected,generation);runOnUiThread(()->{if(!isCurrent(expected,generation))return;retry.setEnabled(true);restoreCart();try{if(!previousCart.equals(loadedCartText))syncRemoteCart();}catch(Exception error){status.setText(getString(R.string.security_error));return;}status.setText(count+" "+getString(R.string.restore_pending));});}
            catch(Exception error){runOnUiThread(()->{if(!isCurrent(expected,generation))return;retry.setEnabled(true);status.setText(message(error));});}
        }).start();
    }
    private void renderPrivacyControls(){
        try{
            ProductSession session=api.session();if(session==null)return;
            JSONObject state=api.privacy().snapshot(session.account);String phase=state.optString("phase",PrivacyLifecycle.ACTIVE);
            if(!PrivacyLifecycle.ACTIVE.equals(phase))content.addView(text(privacyMessage(state.optString("reason",phase)),14,false));
            JSONArray archives=state.optJSONArray("archives");
            if((archives!=null&&archives.length()>0)||!PrivacyLifecycle.ACTIVE.equals(phase)){
                Button evidence=button(getString(R.string.privacy_recovery_export));evidence.setOnClickListener(v->exportRecoveryEvidence());content.addView(evidence);
            }
            if(PrivacyLifecycle.ACTIVE.equals(phase)){Button delete=button(getString(R.string.privacy_delete_button));delete.setTextColor(Color.rgb(180,35,24));delete.setOnClickListener(v->confirmPrivacyDeletion());content.addView(delete);}
            else if(PrivacyLifecycle.UNKNOWN.equals(phase)){Button retry=button(getString(R.string.privacy_retry_deletion));retry.setOnClickListener(v->performPrivacyDeletion(true));content.addView(retry);}
            else if(PrivacyLifecycle.DRAINING.equals(phase)||PrivacyLifecycle.BLOCKED.equals(phase)){Button resume=button(getString(R.string.privacy_continue_deletion));resume.setOnClickListener(v->performPrivacyDeletion(false));content.addView(resume);}
            else if(PrivacyLifecycle.CLEANUP.equals(phase)){Button resume=button(getString(R.string.privacy_finish_cleanup));resume.setOnClickListener(v->{try{api.privacy().finishCleanup(session.account);clearPrivatePresentation();showAccount();}catch(Exception error){status.setText(getString(R.string.privacy_cleanup_pending));}});content.addView(resume);}
            else if(PrivacyLifecycle.CONFIRMED.equals(phase)){Button fresh=button(getString(R.string.privacy_new_shopping));fresh.setOnClickListener(v->{try{api.privacy().startNewShopping(session.account);reconcileSession();showCatalog();}catch(Exception error){status.setText(message(error));}});content.addView(fresh);}
        }catch(Exception error){status.setText(getString(R.string.security_error));}
    }
    private String privacyMessage(String phase){
        if(PrivacyLifecycle.BLOCKED.equals(phase))return getString(R.string.privacy_blocked_unknown);
        if(PrivacyLifecycle.UNKNOWN.equals(phase))return getString(R.string.privacy_deletion_unknown);
        if(PrivacyLifecycle.CLEANUP.equals(phase))return getString(R.string.privacy_cleanup_pending);
        if(PrivacyLifecycle.CONFIRMED.equals(phase))return getString(R.string.privacy_confirmed_evidence);
        if("TOO_MANY".equals(phase))return getString(R.string.privacy_too_many_records);
        if("INVALID_RECEIPT".equals(phase))return getString(R.string.privacy_invalid_receipt);
        return getString(R.string.privacy_draining);
    }
    private String message(Exception error){return error instanceof PrivacyLifecycle.Blocked?privacyMessage(((PrivacyLifecycle.Blocked)error).phase):error.getMessage();}
    // /privacy/delete runs only through the durable ApiClient coordinator.
    private void confirmPrivacyDeletion(){
        EditText confirmation=input("DELETE_MY_SHOP_DATA");
        showDialog(new AlertDialog.Builder(this).setTitle(getString(R.string.privacy_delete_button)).setMessage(getString(R.string.privacy_delete_warning)+"\n\n"+getString(R.string.privacy_recovery_notice)).setView(confirmation).setNegativeButton(getString(R.string.cancel),null).setPositiveButton(getString(R.string.privacy_delete_action),(dialog,which)->{
            if(!"DELETE_MY_SHOP_DATA".equals(confirmation.getText().toString())){status.setText(getString(R.string.privacy_exact_required));return;}performPrivacyDeletion(false);
        }).create());
    }
    private void performPrivacyDeletion(boolean retry){
        try{
            ProductSession expected=api.session();if(expected==null){signIn();return;}
            api.deleteBuyerData(expected,retry,(value,error)->{
                clearPrivatePresentation();showAccount();
                try{JSONObject state=api.privacy().snapshot(expected.account);String phase=state.optString("phase");status.setText(PrivacyLifecycle.ACTIVE.equals(phase)&&error!=null?getString(R.string.privacy_delete_failed)+" "+message(error):privacyMessage(state.optString("reason",phase)));}
                catch(Exception unavailable){status.setText(getString(R.string.security_error));}
            });
            clearPrivatePresentation();showAccount();status.setText(getString(R.string.privacy_draining));
        }catch(Exception error){status.setText(message(error));}
    }
    private void exportRecoveryEvidence(){
        try{
            ProductSession session=api.session();if(session==null){signIn();return;}
            JSONObject payload=new JSONObject().put("account",session.account).put("exportedAt",Instant.now().toString()).put("recovery",api.privacy().snapshot(session.account));
            int code=privacyExport.begin(session);if(!privacyExport.ready(code,api.session(),payload.toString()))return;
            startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE,"ynx-shop-recovery-"+LocalDate.now()+".json"),code);
        }catch(Exception error){status.setText(getString(R.string.privacy_export_unavailable));}
    }

    private void runAI(String workflow,String contextClass,String summary,long units){
        if(!hasSession()){signIn();return;}clearAI();final long attempt=aiPresentation.begin();final boolean[] granted={false};
        aiDialog=new AlertDialog.Builder(this).setTitle(getString(R.string.ai_compare)).setMessage(getString(R.string.ai_privacy)+"\n\n"+summary+"\n"+units+" AI units · "+LocaleController.aiLanguage(this)).setNegativeButton(getString(R.string.cancel),null).setPositiveButton(getString(R.string.grant_permission),(d,w)->{
            if(!aiPresentation.current(attempt))return;granted[0]=true;
            try{
                JSONObject body=new JSONObject().put("Workflow",workflow).put("ContextClasses",new JSONArray().put(contextClass)).put("ContextSummary",summary+"; outputLanguage="+LocaleController.aiLanguage(this)).put("EstimateUnits",units).put("PermissionGranted",true).put("IdempotencyKey",UUID.randomUUID().toString());
                api.request("POST","/ai/jobs",body,()->aiPresentation.current(attempt),(job,error)->{
                    if(!aiPresentation.current(attempt))return;if(error!=null){status.setText(message(error));return;}
                    String id=job.optString("ID");
                    api.request("POST","/ai/jobs/"+id+"/run",new JSONObject(),()->aiPresentation.current(attempt),(result,runError)->{
                        if(!aiPresentation.current(attempt))return;if(runError!=null){status.setText(message(runError));return;}
                        final boolean[] decided={false};
                        aiDialog=new AlertDialog.Builder(this).setTitle(getString(R.string.ai_compare)).setMessage(result.optString("Result"))
                            .setNegativeButton(getString(R.string.reject_draft),(x,y)->{decided[0]=true;aiDecision(id,"reject",attempt);})
                            .setPositiveButton(getString(R.string.apply_draft),(x,y)->{decided[0]=true;aiDecision(id,"apply",attempt);}).create();
                        showDialog(aiDialog,()->{if(!decided[0])aiPresentation.cancel(attempt);});
                    });
                });
            }catch(Exception error){if(aiPresentation.current(attempt))status.setText(message(error));}
        }).create();
        showDialog(aiDialog,()->{if(!granted[0])aiPresentation.cancel(attempt);});
    }
    private void aiDecision(String id,String decision,long attempt){
        if(!aiPresentation.current(attempt))return;
        api.request("POST","/ai/jobs/"+id+"/decision",json("Decision",decision),()->aiPresentation.current(attempt),(v,e)->{if(aiPresentation.current(attempt))status.setText(e==null?decision:message(e));});
    }

    private void signIn(){wallet.start((account,error)->runOnUiThread(()->status.setText(error==null?getString(R.string.loading):message(error))));}
    private void handleIntent(Intent intent){Uri data=intent==null?null:intent.getData();if(data!=null&&"wallet-auth".equals(data.getHost()))wallet.complete(data,(account,error)->runOnUiThread(()->{status.setText(error==null?getString(R.string.wallet_active):getString(R.string.security_error)+" "+message(error));if(error==null){reconcileSession();showAccount();}}));}
    private boolean hasSession(){try{return api.session()!=null;}catch(Exception e){return false;}}
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
