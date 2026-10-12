import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.YNX_QA_PLAYWRIGHT_MODULE||'playwright');
if(!process.env.YNX_QA_TOOLS_URL)throw Error('YNX_QA_TOOLS_URL must name the isolated native-tools fixture');
const browser=await chromium.launch({headless:true}),calls=[],errors=[];let passed=false;
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
 const address='0x'+'a'.repeat(40);
 await page.route('**/runtime/native-tools/**',async route=>{
  const path=new URL(route.request().url()).pathname;calls.push({path,body:route.request().postDataJSON()});let status=200,value;
  if(path.endsWith('/context'))value={csrf:'review',account:'account-A',projectId:'project-A',expiresAt:Date.now()+60000};
  else if(path.endsWith('/contracts/'+address))value={artifact:{address,artifactKind:'source-analyzer-artifact',runtimeMode:'local-devnet',limitations:['not full EVM'],functions:[{name:'count',signature:'count()',stateMutability:'view'},{name:'increment',signature:'increment()',stateMutability:'nonpayable'}]}};
  else if(path.endsWith('/contracts/call'))value={result:{address,function:'count',returnValue:'7',executionStatus:'source_analyzer_literal_return',artifactKind:'source-analyzer-artifact',runtimeMode:'local-devnet',limitations:['not full EVM']},signed:false,submitted:false};
  else {status=502;value={error:'contract not found'};}
  return route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
 });
 await page.goto(process.env.YNX_QA_TOOLS_URL);
 await page.getByLabel('Contract address',{exact:true}).fill(address);
 await page.getByRole('button',{name:'Inspect contract',exact:true}).click();
 assert.equal(await page.getByRole('option',{name:'increment()'}).count(),0);
 await page.getByRole('combobox',{name:/Pure\/view function/}).selectOption('count');
 await page.getByRole('button',{name:'Call read-only function',exact:true}).click();
 await page.getByRole('heading',{name:'Call result',exact:true}).waitFor();
 assert.ok(await page.getByText('Execution: source_analyzer_literal_return',{exact:false}).count());
 assert.deepEqual(calls.find(row=>row.path.endsWith('/contracts/call')).body,{csrf:'review',address,function:'count'});
 await page.getByLabel('ABI calldata (optional)',{exact:true}).fill('0x12345678');
 await page.getByRole('combobox',{name:/Pure\/view function/}).selectOption('');
 assert.equal(await page.getByLabel('ABI calldata (optional)',{exact:true}).inputValue(),'');
 assert.equal(await page.getByRole('button',{name:'Call read-only function',exact:true}).isDisabled(),true);
 await page.getByRole('combobox',{name:/Pure\/view function/}).selectOption('count');
 await page.getByRole('button',{name:'Call read-only function',exact:true}).click();
 await page.getByRole('heading',{name:'Call result',exact:true}).waitFor();
 assert.deepEqual(calls.filter(row=>row.path.endsWith('/contracts/call')).at(-1).body,{csrf:'review',address,function:'count'});
 await page.getByLabel('ABI calldata (optional)',{exact:true}).fill('0x87654321');
 await page.getByRole('button',{name:'Inspect contract',exact:true}).click();
 await page.getByRole('combobox',{name:/Pure\/view function/}).waitFor();
 assert.equal(await page.getByLabel('ABI calldata (optional)',{exact:true}).inputValue(),'');
 await page.getByLabel('Contract address',{exact:true}).fill('0x'+'b'.repeat(40));
 assert.equal(await page.getByRole('heading',{name:'Call result',exact:true}).count(),0);
 await page.getByRole('button',{name:'Inspect contract',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'contract not found'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Call read-only function',exact:true}).count(),0);
 assert.ok(calls.every(row=>!row.path.includes('deploy')&&!row.path.includes('execute')));
 assert.deepEqual(errors,[]);
 passed=true;
} finally {await browser.close();if(process.env.YNX_QA_CONTRACT_RECEIPT)await writeFile(process.env.YNX_QA_CONTRACT_RECEIPT,JSON.stringify({actualReact:true,actualChromium:true,backend:'controlled browser routes',calls,errors,passed,public:false,realContractCall:false},null,2));}
console.log(JSON.stringify({requests:calls.length,errors}));
