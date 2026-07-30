import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the public governance shell and an honest loading state', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('YNX');
    expect(html).toContain('Governance');
    expect(html).toContain('Loading proposals...');
    expect(html).toContain('Operator guide');
    expect(html).not.toContain('Connect Wallet');
  });
});
