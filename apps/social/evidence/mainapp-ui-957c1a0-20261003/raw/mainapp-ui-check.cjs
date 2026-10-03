const cp=require('node:child_process'),fs=require('node:fs');
const adb=process.env.HOME+'/Library/Android/sdk/platform-tools/adb';
function run(...args){return cp.execFileSync(adb,['-s','emulator-5584',...args],{encoding:'utf8'});}
function delay(){cp.execFileSync("sleep",["1"]);}
function awaitReady(){for(let attempt=0;attempt<12;attempt++){const xml=dump("mainapp-cold-wait-"+attempt);if(xml.includes('text="Settings"'))return;delay();}throw Error("cold startup did not reach product navigation within bounded wait");}
function dump(name){run('shell','rm','-f','/sdcard/social-mainapp-check.xml');run('shell','uiautomator','dump','/sdcard/social-mainapp-check.xml');let xml;try{xml=run('exec-out','cat','/sdcard/social-mainapp-check.xml');}catch{xml='<hierarchy unavailable="true" />';}fs.writeFileSync(name+'.xml',xml);return xml;}
function tap(text,xml){const nodes=[...xml.matchAll(/<node\s+[^>]+>/g)].map(m=>m[0]);const node=nodes.find(s=>s.includes('text="'+text+'"'));if(!node)throw Error('missing '+text);const m=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);if(!m)throw Error('bounds '+text);run('shell','input','tap',String((+m[1]+ +m[3])/2|0),String((+m[2]+ +m[4])/2|0));delay();}
function shot(name){const bytes=cp.execFileSync(adb,['-s','emulator-5584','exec-out','screencap','-p']);fs.writeFileSync(name+'.png',bytes);}
let xml=dump('mainapp-phone-chats');shot('mainapp-phone-chats');
for(const banned of ['SYNTHETIC MEDIA VIEWER','undefined /','Fail next read'])if(xml.includes(banned))throw Error('fixture visible');
tap('Moments',xml);xml=dump('mainapp-phone-moments');if(!xml.includes('Private audiences stay protected'))throw Error('moments audience missing');shot('mainapp-phone-moments');
tap('Contacts',xml);xml=dump('mainapp-phone-contacts');if(!xml.includes('Requests and following stay separate'))throw Error('contact boundary missing');shot('mainapp-phone-contacts');
tap('Settings',xml);xml=dump('mainapp-phone-settings');tap('130%',xml);xml=dump('mainapp-phone-settings-130');shot('mainapp-phone-settings-130');
run('shell','am','force-stop','com.ynx.social');run('shell','am','start','-n','com.ynx.social/.MainActivity');awaitReady();xml=dump('mainapp-phone-cold');tap('Settings',xml);xml=dump('mainapp-phone-settings-restored');if(!/<node[^>]*content-desc="Text size 130%"[^>]*checked="true"/.test(xml))throw Error('scale not restored');
// Restore normal product preference explicitly, not any identity or message data.
tap('100%',xml);tap('Chats',dump('mainapp-phone-settings-reset'));xml=dump('mainapp-phone-return');
tap('Sign in',xml);xml=dump('mainapp-phone-signin');shot('mainapp-phone-signin');if(!xml.includes('Sign in to YNX Social'))throw Error('signin sheet absent');
run('shell','input','keyevent','4');delay();xml=dump('mainapp-phone-signin-cancel');if(xml.includes('Sign in to YNX Social'))throw Error('sheet failed cancel');
run('shell','input','keyevent','3');run('shell','am','start','-n','com.ynx.social/.MainActivity');delay();xml=dump('mainapp-phone-resume');if(!xml.includes('Your conversations'))throw Error('resume blank');
console.log('PASS actual MainApp: guest tabs, protected moments/contacts copy, text scaling/cold persistence/reset, sign-in drawer/cancel, background/resume. No grant/sign/send invoked.');
