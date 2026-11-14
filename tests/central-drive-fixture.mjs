import assert from 'node:assert/strict';import{createHash}from'node:crypto';
const config={version:1,ownerEmail:'owner@example.com',projectFolderId:'project12345',learningFolderId:'learning12345',spreadsheetId:'spreadsheet12345',templatesFolderId:'templates12345',libraryFolderId:'library12345',studentsFolderId:'students12345',reviewFolderId:'review12345',studentProfileTemplateId:'profile12345',lessonBriefTemplateId:'brief12345'};
const digest=(algorithm,b)=>createHash(algorithm).update(b).digest('hex');
function artifact(bytes=Buffer.from('{"math":"x^2"}')){return{key:'sample',name:'sample.json',folders:[],mimeType:'application/json',sha256:digest('sha256',bytes),md5:digest('md5',bytes),size:bytes.length,role:'plan',lesson:null,version:1,read:async(offset=0,length=bytes.length-offset)=>bytes.subarray(offset,offset+length)};}
function provider({publicRoot=false,wrongOwner=false,loseChunk=false}={}){
 const files=new Map(),sessions=new Map(),spreadsheets=new Map(),calls=[];let counter=0,lost=false,pending=null,current=true;
 const access={config,credentials:{clientId:'personal-client',clientSecret:'private-secret',refreshToken:'private-refresh'},epoch:'one',assertCurrent(){if(!current)throw Error('paused');}};
 const root={id:config.learningFolderId,name:'Learning',mimeType:'application/vnd.google-apps.folder',parents:[config.projectFolderId],owners:[{emailAddress:wrongOwner?'wrong@example.com':config.ownerEmail}],permissions:[{type:publicRoot?'anyone':'user'}]};
 const wire=file=>{const{bytes,...metadata}=file;return metadata;};
 function complete(file,bytes){file.size=String(bytes.length);file.md5Checksum=digest('md5',bytes);file.bytes=bytes;return file;}
 const fetch=async(input,init={})=>{
  const url=new URL(input);calls.push({url:String(url),method:init.method??'GET',body:init.body,headers:init.headers});
  if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'private-access'});
  if(url.pathname.endsWith('/about'))return Response.json({user:{emailAddress:config.ownerEmail}});
  if(url.pathname.endsWith('/generateIds'))return Response.json({ids:[`generated${++counter}abcde`]});
  if(url.hostname==='sheets.googleapis.com'){
   if(url.pathname.endsWith('/values:batchGet')){
    const id=url.pathname.split('/')[3],sheet=spreadsheets.get(id);assert.ok(sheet);
    return Response.json({valueRanges:url.searchParams.getAll('ranges').map(range=>({range,values:sheet.sheets.find(s=>s.properties.title===range.split('!')[0].replaceAll("'",''))?.rows?.map(r=>r.values.map(c=>c.userEnteredValue?.stringValue??c.userEnteredValue?.numberValue??c.userEnteredValue?.boolValue??''))??[]}))});
   }
   const id=url.pathname.split('/').at(-1).split(':')[0];const sheet=spreadsheets.get(id)??{spreadsheetId:id,sheets:[{properties:{sheetId:0,title:'Sheet1'}}]};spreadsheets.set(id,sheet);
   if(!init.method)return Response.json(sheet);
   const requests=JSON.parse(init.body).requests;
   for(const r of requests){
    if(r.addSheet)sheet.sheets.push({properties:r.addSheet.properties});
    if(r.createDeveloperMetadata){const m=r.createDeveloperMetadata.developerMetadata,s=sheet.sheets.find(s=>s.properties.sheetId===m.location.sheetId);(s.developerMetadata??=[]).push(m);}
    if(r.updateCells)sheet.sheets.find(s=>s.properties.sheetId===r.updateCells.range.sheetId).rows=r.updateCells.rows;
   }
   return Response.json({spreadsheetId:id,replies:requests.map(()=>({}))});
  }
  if(url.pathname==='/drive/v3/files'&&!init.method)return Response.json({files:[...files.values()].map(wire)});
  if(url.pathname==='/drive/v3/files'&&init.method==='POST'){
   const meta=JSON.parse(init.body);const file={...meta,id:meta.id??`native${++counter}abcdef`,owners:[{emailAddress:config.ownerEmail}],permissions:[{type:'user'}]};files.set(file.id,file);return Response.json(wire(file));
  }
  if(url.pathname.startsWith('/drive/v3/files/')){
   const id=url.pathname.split('/').at(-1);return files.has(id)?Response.json(wire(files.get(id))):id===root.id?Response.json(root):new Response('',{status:404});
  }
  if(url.pathname.startsWith('/upload/drive/v3/files')&&init.method!=='PUT'){
   if(url.searchParams.get('uploadType')==='multipart'){
    const body=Buffer.from(init.body).toString(),parts=body.split('\r\n\r\n'),meta=JSON.parse(parts[1].split('\r\n--')[0]);
    const file={...meta,id:meta.id??`native${++counter}abcdef`,owners:[{emailAddress:config.ownerEmail}],permissions:[{type:'user'}],html:parts[2].split('\r\n--')[0]};files.set(file.id,file);return Response.json(wire(file));
   }
   const meta=JSON.parse(init.body),existing=url.pathname.split('/').at(-1),file={...files.get(existing),...meta,id:meta.id??existing,owners:[{emailAddress:config.ownerEmail}],permissions:[{type:'user'}]};files.set(file.id,file);
   const location=`https://www.googleapis.com/upload/drive/v3/files?upload_id=session${++counter}`;sessions.set(location,{file,bytes:Buffer.alloc(0)});return new Response('',{headers:{Location:location}});
  }
  if(init.method==='PUT'){
   const session=sessions.get(String(url));assert.ok(session,'known upload target');
   const range=new Headers(init.headers).get('Content-Range');
   if(range.startsWith('bytes */'))return new Response('',{status:308,headers:session.bytes.length?{Range:`bytes=0-${session.bytes.length-1}`}:{}});
   const match=range.match(/^bytes (\d+)-(\d+)\/(\d+)$/);assert.ok(match);assert.equal(Number(match[1]),session.bytes.length);
   session.bytes=Buffer.concat([session.bytes,Buffer.from(init.body)]);
   if(loseChunk&&!lost){lost=true;if(session.bytes.length===Number(match[3]))complete(session.file,session.bytes);throw Error('private-provider-body');}
   if(session.bytes.length<Number(match[3]))return new Response('',{status:308,headers:{Range:`bytes=0-${session.bytes.length-1}`}});
   return Response.json(wire(complete(session.file,session.bytes)));
  }
  throw Error('unexpected endpoint '+url.pathname);
 };
 return{access,fetch,files,spreadsheets,calls,pause(){current=false;},checkpoint:{read:()=>pending,write:p=>{pending=p;}}};
}
export{provider,artifact,config};
