package com.ynxweb4.shop;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class ImageLoaderPolicyTest {
    @Test public void acceptsOnlyOfficialHttpsCatalogAssets() {
        assertTrue(ImageLoader.isSafeMediaURL("https://shop.ynxweb4.com/shop/assets/catalog/demo.png"));
        assertFalse(ImageLoader.isSafeMediaURL("http://shop.ynxweb4.com/shop/assets/catalog/demo.png"));
        assertFalse(ImageLoader.isSafeMediaURL("https://attacker.example/shop/assets/catalog/demo.png"));
        assertFalse(ImageLoader.isSafeMediaURL("https://shop.ynxweb4.com.evil.example/shop/assets/catalog/demo.png"));
        assertFalse(ImageLoader.isSafeMediaURL("https://user@shop.ynxweb4.com/shop/assets/catalog/demo.png"));
        assertFalse(ImageLoader.isSafeMediaURL("https://shop.ynxweb4.com:444/shop/assets/catalog/demo.png"));
        assertFalse(ImageLoader.isSafeMediaURL("https://shop.ynxweb4.com/private/demo.png"));
    }
}
