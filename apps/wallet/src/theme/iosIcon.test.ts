import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {inflateSync} from "node:zlib";

test("iOS universal icon preserves the verified original square logo, not a blank placeholder",async()=>{
  const root=new URL("../../ios/YNXWallet/Images.xcassets/AppIcon.appiconset/",import.meta.url);
  const catalog=JSON.parse(await readFile(new URL("Contents.json",root),"utf8"));
  const entry=catalog.images.find((image:any)=>image.platform==="ios"&&image.size==="1024x1024");
  assert.equal(entry.filename,"App-Icon-1024x1024@1x.png");
  const png=await readFile(new URL(entry.filename,root));
  assert.equal(createHash("sha256").update(png).digest("hex"),"ef1b974fdd2148d72e5391f457044d45dbbe85b81a3c8452c9c71fcc99f031ab");
  assert.equal(png.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16),1024);assert.equal(png.readUInt32BE(20),1024);
  assert.equal(png[24],8);assert.equal(png[28],0);
  const channels=png[25]===6?4:png[25]===2?3:0;assert.ok(channels,"RGB/RGBA icon required");
  const parts:Buffer[]=[];
  for(let offset=8;offset<png.length;){const length=png.readUInt32BE(offset);if(png.toString("ascii",offset+4,offset+8)==="IDAT")parts.push(png.subarray(offset+8,offset+8+length));offset+=length+12}
  const raw=inflateSync(Buffer.concat(parts)),stride=1024*channels;
  assert.equal(raw.length,(stride+1)*1024);
  let prior=Buffer.alloc(stride),blue=0,white=0;
  const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c};
  for(let y=0;y<1024;y++){
    const filter=raw.readUInt8(y*(stride+1)),row=Buffer.alloc(stride);assert.ok(filter<=4);
    for(let x=0;x<stride;x++){const left=x>=channels?row.readUInt8(x-channels):0,up=prior.readUInt8(x),corner=x>=channels?prior.readUInt8(x-channels):0;row[x]=(raw.readUInt8(y*(stride+1)+1+x)+(filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,corner)))&255}
    for(let x=0;x<stride;x+=channels){const r=row.readUInt8(x),g=row.readUInt8(x+1),b=row.readUInt8(x+2);if(channels===4)assert.equal(row.readUInt8(x+3),255,"iOS icon must be opaque");if(b>140&&r<80&&g<100)blue++;if(r>240&&g>240&&b>240)white++}
    prior=row;
  }
  assert.ok(blue>50000,`visible original blue mark required (blue pixels: ${blue})`);assert.ok(white>500000,`original white square background required (white pixels: ${white})`);
});
