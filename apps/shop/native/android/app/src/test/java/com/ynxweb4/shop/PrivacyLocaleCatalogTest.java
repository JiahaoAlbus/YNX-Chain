package com.ynxweb4.shop;

import org.junit.Test;
import org.w3c.dom.*;
import javax.xml.parsers.DocumentBuilderFactory;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;
import static org.junit.Assert.*;

public final class PrivacyLocaleCatalogTest {
    @Test public void everyShippedLocaleDefinesThePrivacyControlsUsedByTheActivity()throws Exception{
        Path source=Paths.get(System.getProperty("user.dir"));
        while(source!=null&&!Files.exists(source.resolve("src/main/res"))&&!Files.exists(source.resolve("app/src/main/res")))source=source.getParent();
        assertNotNull("Android project root",source);if(!Files.exists(source.resolve("src/main/res")))source=source.resolve("app");
        Path resources=source.resolve("src/main/res");String activity=new String(Files.readAllBytes(source.resolve("src/main/java/com/ynxweb4/shop/MainActivity.java")),java.nio.charset.StandardCharsets.UTF_8);Set<String> referenced=new HashSet<>();Matcher refs=Pattern.compile("R\\.string\\.((?:privacy_|cart_)[a-z0-9_]+)").matcher(activity);while(refs.find())referenced.add(refs.group(1));
        Map<String,String> english=catalog(resources.resolve("values"));int count=0;
        try(var dirs=Files.list(resources)){for(Path dir:dirs.filter(path->path.getFileName().toString().equals("values")||path.getFileName().toString().startsWith("values-")).toList()){
            count++;Map<String,String> localized=catalog(dir);for(String key:referenced){assertTrue(dir+":"+key,localized.containsKey(key)&&!localized.get(key).isBlank());assertEquals(key+" format placeholders",placeholders(english.get(key)),placeholders(localized.get(key)));if(!dir.getFileName().toString().equals("values"))assertNotEquals(dir+":"+key+" English fallback",english.get(key),localized.get(key));}
        }}assertEquals("audited locale count",12,count);
    }
    private Map<String,String> catalog(Path dir)throws Exception{Map<String,String> result=new HashMap<>();DocumentBuilderFactory factory=DocumentBuilderFactory.newInstance();factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);try(var files=Files.list(dir)){for(Path file:files.filter(path->path.toString().endsWith(".xml")).toList()){NodeList values=factory.newDocumentBuilder().parse(file.toFile()).getElementsByTagName("string");for(int i=0;i<values.getLength();i++){Element value=(Element)values.item(i);result.put(value.getAttribute("name"),value.getTextContent());}}}return result;}
    private Set<String> placeholders(String text){Set<String> values=new HashSet<>();Matcher matcher=Pattern.compile("%[0-9$]*[sdf]").matcher(text);while(matcher.find())values.add(matcher.group());return values;}
}
