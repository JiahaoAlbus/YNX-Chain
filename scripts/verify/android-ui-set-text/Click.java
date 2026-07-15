package ynx.verify;

import android.os.Bundle;
import android.util.Base64;

import com.android.uiautomator.core.UiObject;
import com.android.uiautomator.core.UiSelector;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;

public final class Click extends UiAutomatorTestCase {
    public void testClick() throws Exception {
        Bundle parameters = getParams();
        String type = parameters.getString("selectorType");
        String encodedValue = parameters.getString("selectorBase64");
        String value = encodedValue == null ? null : new String(Base64.decode(encodedValue, Base64.NO_WRAP), "UTF-8");
        if (value == null || value.isEmpty() || !("text".equals(type) || "description".equals(type))) {
            throw new IllegalArgumentException("selectorType and selectorBase64 are required");
        }
        UiSelector selector = "text".equals(type) ? new UiSelector().text(value) : new UiSelector().description(value);
        UiObject control = new UiObject(selector);
        assertTrue("visible control not found: " + value, control.waitForExists(5000));
        assertTrue("visible control rejected click: " + value, control.click());
    }
}
