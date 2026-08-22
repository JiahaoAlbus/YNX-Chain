import { expect, test } from '@playwright/test';

test('completes the incident lifecycle through the authenticated operator UI',async({page},testInfo)=>{
  await page.goto('/');
  await page.getByLabel('Username').fill('operator');
  await page.getByLabel('Password').fill(['operator','local'].join('-'));
  await page.getByRole('button',{name:'Enter Monitor'}).click();
  await page.getByRole('button',{name:'Incidents',exact:true}).click();
  await page.getByRole('button',{name:'Record incident'}).click();

  const title=`E2E lifecycle ${testInfo.project.name}`;
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Severity').selectOption('high');
  await page.getByLabel('Evidence source').fill(`evidence://ui-${testInfo.project.name}`);
  await page.getByRole('button',{name:'Record with audit'}).click();
  await expect(page.getByRole('heading',{name:title})).toBeVisible();

  const incident=page.getByRole('article').filter({has:page.getByRole('heading',{name:title})});
  await incident.getByLabel('Owner').fill(`oncall-${testInfo.project.name}`);
  await incident.getByRole('button',{name:'Assign'}).click();
  await expect(incident.getByText(`Owner: oncall-${testInfo.project.name}`)).toBeVisible();

  async function transition(button:string,summary:string,evidence=''){
    await incident.getByLabel('Transition summary').fill(summary);
    if(evidence)await incident.getByLabel('Evidence').first().fill(evidence);
    await incident.getByRole('button',{name:button}).click();
  }

  await transition('Acknowledge incident','Operator acknowledged the incident.');
  await expect(incident.getByText('acknowledged',{exact:true})).toBeVisible();
  await transition('Start investigation','Investigation started.');
  await expect(incident.getByText('investigating',{exact:true})).toBeVisible();
  await transition('Record mitigation','Bounded mitigation applied.','evidence://mitigation');
  await expect(incident.getByText('mitigated',{exact:true})).toBeVisible();
  await transition('Begin recovery verification','Recovery candidate started.','evidence://candidate');
  await expect(incident.getByText('recovery_verifying',{exact:true})).toBeVisible();
  await transition('Verify recovery','Recovery checks passed.','evidence://recovery-verification');
  await expect(incident.getByText('resolved',{exact:true})).toBeVisible();

  await incident.getByLabel('Postmortem summary').fill('Recovery was verified before closure.');
  await incident.getByLabel('Root cause').fill('A stale dependency delayed health propagation.');
  await incident.getByLabel('Corrective action').fill('Add freshness enforcement and monthly recovery drills.');
  await incident.getByLabel('Evidence').last().fill('evidence://postmortem');
  await incident.getByRole('button',{name:'Complete postmortem'}).click();
  await expect(incident.getByText('postmortem_complete',{exact:true})).toBeVisible();

  const downloadPromise=page.waitForEvent('download');
  await incident.getByRole('button',{name:'Export evidence'}).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^inc_.+\.json$/);

  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
