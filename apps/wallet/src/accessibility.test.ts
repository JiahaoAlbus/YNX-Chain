import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("critical Wallet controls expose accessibility roles, names and state",async()=>{
  const source=await readFile(new URL("../App.tsx",import.meta.url),"utf8");
  for(const label of ["Lock YNX Wallet","Switch Wallet account","YNX Wallet recovery key","Approve","Reject","AI security explanation","Remove local account"])assert.ok(source.includes(label),`missing accessibility contract for ${label}`);
  assert.ok(source.includes('accessibilityState={{expanded:accountsOpen}}'));
  assert.ok(source.includes('accessibilityState={{disabled}}'));
  assert.ok(source.includes('accessibilityRole="radio"'));
});
