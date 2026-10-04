const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://127.0.0.1').pathname;const name=pathname==='/'?'index.html':pathname==='/bundle.js'?'bundle.js':null;if(!name){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/html');res.setHeader('Cache-Control','no-store');res.end(fs.readFileSync(path.join(__dirname,name)));});
server.listen(0,'127.0.0.1',()=>console.log('QA_URL=http://127.0.0.1:'+server.address().port+'/'));
