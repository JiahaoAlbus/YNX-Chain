package ynx.verify;

import android.os.Bundle;
import android.util.Base64;

import com.android.uiautomator.core.UiObject;
import com.android.uiautomator.core.UiSelector;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;

public final class SetText extends UiAutomatorTestCase {
    public void testSetText() throws Exception {
        Bundle parameters = getParams();
        String encodedDescription = parameters.getString("descriptionBase64");
        String description = encodedDescription == null ? null : new String(Base64.decode(encodedDescription, Base64.NO_WRAP), "UTF-8");
        String encodedValue = parameters.getString("valueBase64");
        String value = encodedValue == null ? null : new String(Base64.decode(encodedValue, Base64.NO_WRAP), "UTF-8");
        if (description == null || description.isEmpty() || value == null) {
            throw new IllegalArgumentException("descriptionBase64 and valueBase64 are required");
        }
        UiObject input = new UiObject(new UiSelector().description(description).className("android.widget.EditText"));
        if (!input.waitForExists(1000)) {
            input = new UiObject(new UiSelector().text(description).className("android.widget.EditText"));
        }
        assertTrue("visible input not found: " + description, input.waitForExists(5000));
        input.click();
        assertTrue("visible input rejected text: " + description, input.setText(value));
    }
}
