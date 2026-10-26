// Test-only mutation selection. Never changes on-disk build records or gates.
export function nativeRecipeTestProfile(inputs){
 const labels={
  '1.3.0-pq.3.32-auth.37':'SDK37','1.3.0-pq.3.32-auth.39':'SDK39',
  '1.3.0-pq.3.32-auth.46':'SDK46','1.3.0-pq.3.32-auth.47':'SDK47','1.3.0-pq.3.32-auth.48':'SDK48'
 };
 const label=labels[inputs.sdkVersion],paired=['SDK46','SDK47','SDK48'].includes(label);
 return Object.freeze({executed:!!label,immutableHashFirst:!!label&&label!=='SDK37',
  recipeError:label?label+' component Node command differs.':'Canonical Native compile command differs.',
  producerError:label?label+' component producer record differs.':null,
  closureError:paired?label+' component SDK'+label.slice(3)+' paired source count differs.':'Canonical Native transport source closure differs.',
  paired});
}
