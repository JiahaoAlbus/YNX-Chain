import assert from 'node:assert/strict';
import test from 'node:test';
import {createFormState,localDateTime} from '../src/form-state.js';

test('form drafts survive replacement while acknowledgement resets only its form',()=>{
  const forms=createFormState();
  const form=(id,name,value)=>{const field={name,value};const elements=[field];elements.namedItem=key=>key===name?field:null;return{id,elements,reset(){field.value=''}}};
  const invoice=form('invoice-form','description','Invoice draft'),catalog=form('catalog-form','name','Catalog draft');
  const root={querySelectorAll:()=>[invoice,catalog]};
  forms.capture(root);invoice.elements[0].value='';catalog.elements[0].value='';forms.restore(root);
  assert.equal(invoice.elements[0].value,'Invoice draft');assert.equal(catalog.elements[0].value,'Catalog draft');
  forms.acknowledged('invoice-form',root);forms.capture(root);forms.restore(root);
  assert.equal(invoice.elements[0].value,'');assert.equal(catalog.elements[0].value,'Catalog draft');
  forms.clear();invoice.elements[0].value='';catalog.elements[0].value='';forms.restore(root);assert.equal(catalog.elements[0].value,'');
});

test('datetime-local displays the chosen local time without a UTC shift',()=>{
  assert.equal(localDateTime(new Date(2026,9,3,9,7)),'2026-10-03T09:07');
});
