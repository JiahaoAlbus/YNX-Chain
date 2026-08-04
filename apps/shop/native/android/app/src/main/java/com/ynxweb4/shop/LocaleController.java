package com.ynxweb4.shop;

import android.content.Context;
import android.content.res.Configuration;
import android.os.LocaleList;
import java.util.Locale;

final class LocaleController {
    static final String[] TAGS={"system","en","zh-CN","zh-TW","ja","ko","es","fr","de","pt","ru","ar","id"};
    static Context apply(Context base){
        String tag=base.getSharedPreferences("settings",Context.MODE_PRIVATE).getString("language","system");
        if(tag==null||tag.equals("system"))return base;
        Locale locale=Locale.forLanguageTag(tag); LocaleList list=new LocaleList(locale); LocaleList.setDefault(list);
        Configuration config=new Configuration(base.getResources().getConfiguration());config.setLocales(list);config.setLayoutDirection(locale);
        return base.createConfigurationContext(config);
    }
    static void save(Context context,String tag){context.getSharedPreferences("settings",Context.MODE_PRIVATE).edit().putString("language",tag).apply();}
    static String current(Context context){return context.getSharedPreferences("settings",Context.MODE_PRIVATE).getString("language","system");}
    static String aiLanguage(Context context){return context.getSharedPreferences("settings",Context.MODE_PRIVATE).getString("ai_language","en");}
    static void saveAI(Context context,String tag){context.getSharedPreferences("settings",Context.MODE_PRIVATE).edit().putString("ai_language",tag).apply();}
}
