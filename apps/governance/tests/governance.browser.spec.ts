import { expect, test } from '@playwright/test';

const proposal = {
  id: 'proposal-0123456789abcdef',
  status: 'timelock_active',
  createdAt: '2026-07-20T08:00:00Z',
  votingEndsAt: '2027-07-25T08:00:00Z',
  executeAfter: '2027-07-26T08:00:00Z',
  eligiblePower: 100,
  input: {
    nonce: 'nonce-01234567',
    scope: 'bridge',
    proposer: 'ynx1proposer0123456789',
    owner: 'protocol-team',
    summary: 'Reduce the bridge exposure limit',
    technicalImpact: 'Updates the bounded bridge policy registry.',
    economicImpact: 'Reduces aggregate bridge exposure.',
    securityRisk: 'Reduces the bounded loss radius.',
    migration: 'Apply the signed policy after verification.',
    rollback: 'Restore the prior signed policy manifest.',
    conflictDisclosure: 'No related-party conflict was disclosed.',
    evidence: ['https://status.ynx.network/evidence/bridge'],
    changes: [{ path: '/bridge/exposureLimit', before: '50', after: '45', minimum: 0, maximum: 500 }],
  },
  conflicts: {
    reviewer: {
      actor: 'reviewer-1',
      description: 'Reviewer disclosed a provider relationship.',
      recused: true,
      disclosedAt: '2026-07-21T08:00:00Z',
    },
  },
  transitions: [{
    actor: 'governance-runtime',
    to: 'timelock_active',
    at: '2026-07-22T08:00:00Z',
    auditHash: 'a'.repeat(64),
  }],
  executionHash: 'b'.repeat(64),
};

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/governance/proposals') {
      await route.fulfill({ json: { proposals: [proposal] } });
    } else if (path === `/governance/proposals/${proposal.id}`) {
      await route.fulfill({ json: proposal });
    } else if (path === '/votes') {
      await route.fulfill({ json: { votes: [] } });
    } else {
      await route.continue();
    }
  });
});

test('supports keyboard navigation, 390px layout, and Arabic RTL', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Governance Proposals' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Open proposal/ })).toBeVisible();

  await page.getByLabel('Language').selectOption('ar');
  await expect(page.locator('[lang="ar"][dir="rtl"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'مقترحات الحوكمة' })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);

  await page.getByRole('button', { name: /فتح|Open proposal/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'الإفصاح عن التعارض' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'حالة التنفيذ' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'مسار التدقيق' })).toBeVisible();
});
