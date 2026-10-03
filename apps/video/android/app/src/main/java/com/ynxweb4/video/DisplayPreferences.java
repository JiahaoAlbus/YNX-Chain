package com.ynxweb4.video;
import android.content.Context;
import android.app.AlertDialog;
import java.util.Locale;
final class DisplayPreferences {
 static final String STORE="ynx_media_display_v1";
 static int mode(Context c){int n=c.getSharedPreferences(STORE,0).getInt("text_size",1);return n>=0&&n<=2?n:1;}
 static float factor(Context c){return new float[]{0.9333333f,1f,1.1333333f}[mode(c)];}
 static String[] labels(Locale l){switch(l.getLanguage()){
 case "zh":return "Hant".equals(l.getScript()) || "TW".equals(l.getCountry()) ? new String[]{"顯示與字級","緊湊","標準","較大"}:new String[]{"显示与字号","紧凑","标准","较大"};
 case "ja":return new String[]{"表示と文字サイズ","小さめ","標準","大きめ"};
 case "ko":return new String[]{"화면 및 글자 크기","작게","표준","크게"};
 case "es":return new String[]{"Pantalla y texto","Compacto","Estándar","Grande"};
 case "fr":return new String[]{"Affichage et texte","Compact","Standard","Grand"};
 case "de":return new String[]{"Anzeige und Text","Kompakt","Standard","Größer"};
 case "pt":return new String[]{"Exibição e texto","Compacto","Padrão","Maior"};
 case "ru":return new String[]{"Вид и размер текста","Компактный","Обычный","Крупный"};
 case "ar":return new String[]{"العرض وحجم النص","صغير","قياسي","أكبر"};
 case "id":return new String[]{"Tampilan dan teks","Ringkas","Standar","Besar"};
 default:return new String[]{"Display and text size","Compact","Standard","Larger"};}}
 static void show(Context c,Locale l,Runnable changed){String[] text=labels(l);new AlertDialog.Builder(c).setTitle(text[0]).setSingleChoiceItems(new String[]{text[1],text[2],text[3]},mode(c),(dialog,index)->{c.getSharedPreferences(STORE,0).edit().putInt("text_size",index).apply();dialog.dismiss();changed.run();}).setNegativeButton(android.R.string.cancel,null).show();}
}
