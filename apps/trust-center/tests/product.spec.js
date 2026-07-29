import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const evidence = '../../docs/handoffs/evidence';
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
];

async function unnamedInteractiveControls(page) {
  return page
    .locator('a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])')
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          if (element.closest('[hidden]') || element.getAttribute('aria-hidden') === 'true') return false;

          const labelledBy = (element.getAttribute('aria-labelledby') || '')
            .split(/\s+/)
            .filter(Boolean)
            .map((id) => document.getElementById(id)?.textContent?.trim() || '')
            .join(' ')
            .trim();
          const explicitLabel = element.id
            ? [...document.querySelectorAll('label')]
                .filter((label) => label.htmlFor === element.id)
                .map((label) => label.textContent?.trim() || '')
                .join(' ')
                .trim()
            : '';
          const wrappingLabel = element.closest('label')?.textContent?.trim() || '';
          const text = element.textContent?.trim() || '';
          const value =
            element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(element.type)
              ? element.value.trim()
              : '';

          return ![
            element.getAttribute('aria-label')?.trim() || '',
            labelledBy,
            explicitLabel,
            wrappingLabel,
            text,
            value,
            element.getAttribute('title')?.trim() || '',
          ].some(Boolean);
        })
        .map((element) => `${element.tagName.toLowerCase()}#${element.id || '(no-id)'}`),
    );
}

test.beforeAll(async () => mkdir(evidence, { recursive: true }));

for (const viewport of viewports) {
  test(`Trust Center ${viewport.name} responsive and accessible`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

    await expect(page).toHaveTitle('YNX Trust Center');
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Trust Center sections' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Every conclusion needs evidence/ })).toBeVisible();
    await expect(page.getByRole('note')).toContainText('never asset controls');
    await expect(page.getByRole('status').first()).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(page.locator('.skip')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('.locale-select')).toBeFocused();
    await expect(page.locator('.locale-select')).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Tab');
    await expect(page.locator('#ai-language')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#wallet-open')).toBeFocused();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    expect(await unnamedInteractiveControls(page)).toEqual([]);

    await page.evaluate(() => document.activeElement?.blur());
    await page.screenshot({ path: `${evidence}/trust-center-${viewport.name}.png`, fullPage: true });
  });
}

test('Trust Center honors reduced-motion preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  expect(
    await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  ).toBe(true);

  const reducedMotionContract = await page.evaluate(() => {
    const hasRule = [...document.styleSheets].some((sheet) =>
      [...sheet.cssRules].some(
        (rule) =>
          rule instanceof CSSMediaRule &&
          rule.conditionText.replaceAll(' ', '') === '(prefers-reduced-motion:reduce)',
      ),
    );
    const style = getComputedStyle(document.querySelector('.nav'));
    return {
      hasRule,
      transitionDuration: style.transitionDuration,
      animationDuration: style.animationDuration,
    };
  });

  expect(reducedMotionContract).toEqual({
    hasRule: true,
    transitionDuration: '0s',
    animationDuration: '0s',
  });
});

test('Trust Center preserves empty, failure, retry and bounded submission states', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No accessible cases')).toBeVisible();

  await page.getByRole('button', { name: 'Submit evidence' }).click();
  await page.getByLabel('Subject account').fill('ynx1subject');
  await page.getByLabel('Purpose').fill('Request a bounded review');
  await page.getByLabel('Request scope').fill('one account and one event');
  await page.getByLabel('Requested outcome').fill('review and explain');
  await page.getByLabel('Evidence source').fill('signed record');
  await page.getByLabel('Evidence digest').fill('sha256:ui');
  await page
    .getByRole('textbox', { name: 'Evidence summary' })
    .fill('Evidence summary visible to subject');
  await page.getByRole('button', { name: 'Submit for independent review' }).click();
  await expect(page.getByText('submitted', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Use for AI' }).click();
  await page.getByRole('button', { name: 'Preview data and cost' }).click();
  await expect(page.locator('#ai-result')).toContainText('Privacy preview');
  await expect(page.locator('#ai-result')).toHaveAttribute('role', 'status');
  await expect(page.locator('#ai-result')).toHaveAccessibleName('AI explanation result');
  await page.getByRole('button', { name: 'Allow explanation' }).click();
  await expect(page.locator('#ai-result')).toContainText('AI provider unavailable');
});

test('all locales persist, Arabic uses RTL, and due-process boundary never blanks', async ({ page }) => {
  await page.goto('/');

  for (const code of ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'id']) {
    await page.locator('.locale-select').selectOption(code);
    await expect(page.locator('[data-i18n="boundaryBody"]')).not.toBeEmpty();
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    await expect(page.locator('html')).toHaveAttribute('dir', code === 'ar' ? 'rtl' : 'ltr');
  }

  await page.reload();
  await expect(page.locator('.locale-select')).toHaveValue('id');
  await expect(page.locator('html')).toHaveAttribute('lang', 'id');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});
