package junit.framework;

// Compile-time surface only. Android's UiAutomator runner provides the real JUnit 3 class.
public abstract class TestCase {
    public static void assertTrue(String message, boolean condition) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }
}
