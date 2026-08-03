import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { Locale, supportedLocales } from './i18n';

describe('App', () => {
  it('renders the public governance shell and an honest loading state', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('YNX');
    expect(html).toContain('Governance');
    expect(html).toContain('Loading proposals…');
    expect(html).toContain('Operator guide');
    expect(html).not.toContain('Connect Wallet');
    expect(html).toContain('aria-label="Language"');
    expect(html).toContain('role="status"');
  });

  it('renders every supported locale and the Arabic RTL boundary', () => {
    const proposalLabels: Record<Locale, string> = {
      en: 'Proposals', 'zh-CN': '提案', 'zh-TW': '提案', es: 'Propuestas', fr: 'Propositions',
      de: 'Vorschläge', ja: '提案', ko: '제안', 'pt-BR': 'Propostas', ru: 'Предложения',
      ar: 'المقترحات', hi: 'प्रस्ताव',
    };
    for (const locale of supportedLocales) {
      const html = renderToStaticMarkup(<App initialLocale={locale} />);
      expect(html).toContain(`lang="${locale}"`);
      expect(html).toContain(proposalLabels[locale]);
      expect(html).toContain(`value="${locale}" selected=""`);
    }
    expect(renderToStaticMarkup(<App initialLocale="ar" />)).toContain('dir="rtl"');
  });
});
