package com.ynxweb4.music;

import android.content.*;
import android.os.LocaleList;
import java.util.Locale;

final class LocaleSupport {
    static final String[] TAGS={"system","en","zh-Hans","zh-Hant","ja","ko","es","fr","de","pt","ru","ar","id"};
    static Context wrap(Context base){String tag=base.getSharedPreferences("settings",0).getString("locale","system");if("system".equals(tag))return base;Locale locale=Locale.forLanguageTag(tag);LocaleList.setDefault(new LocaleList(locale));android.content.res.Configuration c=new android.content.res.Configuration(base.getResources().getConfiguration());c.setLocales(new LocaleList(locale));c.setLayoutDirection(locale);return base.createConfigurationContext(c);}
    static void set(Context c,String tag){c.getSharedPreferences("settings",0).edit().putString("locale",tag).apply();}
}
