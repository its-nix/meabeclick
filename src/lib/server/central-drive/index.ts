import {CentralDriveError} from './api.ts';

export type IndexCell=string|number|boolean|null|{text:string;url:string};
export interface IndexViews {students:IndexCell[][];materials:IndexCell[][];progress:IndexCell[][]}
interface Sheet {properties:{sheetId:number;title:string;gridProperties?:{rowCount?:number;columnCount?:number}};developerMetadata?:Array<{metadataKey:string;metadataValue:string}>}
interface IndexApi {scope:string;json:(url:string,init?:RequestInit)=>Promise<any>}
export const indexHeadings={
 students:['מזהה תלמיד/ה','שם','מקצוע ורמה','מטרות','התקדמות באתר (%)','הערת התקדמות','פרופיל לעריכה','תיקייה'],
 materials:['מקור באתר','סוג','שיעור','גרסה','שם קובץ','נתיב מקורי','SHA-256','גודל (בתים)','קובץ ב־Drive','MIME type','Drive file ID'],
 progress:['מקור','מזהה אירוע','מזהה תלמיד/ה','שיעור / מיומנות','מצב / ניקוד','ראיה / סה״כ / ניסיונות','הערה','מועד'],
};
const titles={students:'Site Students',materials:'Site Materials',progress:'Site Progress'};
function cell(value:IndexCell){
 if(value===null)return{};
 if(typeof value==='object'){
  const url=new URL(value.url);if(url.protocol!=='https:'||!['docs.google.com','drive.google.com'].includes(url.hostname))throw new CentralDriveError('google_response');
  return{userEnteredValue:{stringValue:value.text},userEnteredFormat:{textFormat:{link:{uri:value.url}}}};
 }
 if(typeof value==='number'){if(!Number.isFinite(value))throw new CentralDriveError('source_changed');return{userEnteredValue:{numberValue:value}};}
 if(typeof value==='boolean')return{userEnteredValue:{boolValue:value}};
 if(value.length>49000)throw new CentralDriveError('source_limit');
 return{userEnteredValue:{stringValue:value}};
}

/** One atomic batch; only app-claimed tabs of the app-created index are changed. */
export async function writeCentralIndex(api:IndexApi,id:string,views:IndexViews){
 if(!/^[\w-]{10,}$/.test(id))throw new CentralDriveError('google_response');
 const base=`https://sheets.googleapis.com/v4/spreadsheets/${id}`;
 const metadata=await api.json(`${base}?fields=spreadsheetId,sheets(properties,developerMetadata)`);
 if(!Array.isArray(metadata.sheets))throw new CentralDriveError('google_response');
 const sheets:Sheet[]=metadata.sheets,used=new Set(sheets.map(s=>s.properties.sheetId)),requests:object[]=[];
 let next=1;
 for(const[ordinal,role]of (Object.keys(titles) as Array<keyof IndexViews>).entries()){
  const value=`${api.scope}:${role}`,owned=sheets.filter(s=>s.developerMetadata?.some(m=>m.metadataKey==='meaCentralView'&&m.metadataValue===value));
  if(owned.length>1)throw new CentralDriveError('conflict');
  let sheet=owned[0];const rows=[indexHeadings[role],...views[role]],columns=indexHeadings[role].length;
  if(views[role].some(r=>r.length>columns)||rows.length>100001)throw new CentralDriveError('source_limit');
  if(!sheet){
   if(sheets.some(s=>s.properties.title===titles[role]))throw new CentralDriveError('conflict');
   while(used.has(next))next++;used.add(next);
   sheet={properties:{sheetId:next,title:titles[role],gridProperties:{rowCount:Math.max(100,rows.length),columnCount:columns}}};
   requests.push({addSheet:{properties:{...sheet.properties,index:ordinal,rightToLeft:true,gridProperties:{...sheet.properties.gridProperties,frozenRowCount:1}}}},
    {createDeveloperMetadata:{developerMetadata:{metadataKey:'meaCentralView',metadataValue:value,visibility:'DOCUMENT',location:{sheetId:next}}}},
    {addProtectedRange:{protectedRange:{range:{sheetId:next},description:'Managed by MeaBeclick. Add human notes in another tab; these views refresh automatically.',warningOnly:true}}});
  }
  const sheetId=sheet.properties.sheetId,rowCount=Math.max(sheet.properties.gridProperties?.rowCount??100,rows.length),columnCount=Math.max(sheet.properties.gridProperties?.columnCount??columns,columns);
  requests.push({updateSheetProperties:{properties:{sheetId,rightToLeft:true,gridProperties:{rowCount,columnCount,frozenRowCount:1}},fields:'rightToLeft,gridProperties'}},
   {updateCells:{range:{sheetId,startRowIndex:0,endRowIndex:rowCount,startColumnIndex:0,endColumnIndex:columns},rows:rows.map(r=>({values:r.map(cell)})),fields:'userEnteredValue,userEnteredFormat.textFormat.link'}},
   {repeatCell:{range:{sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:columns},cell:{userEnteredFormat:{backgroundColor:{red:.04,green:.18,blue:.32},textFormat:{bold:true,foregroundColor:{red:1,green:1,blue:1}},wrapStrategy:'WRAP'}},fields:'userEnteredFormat'}},
   {updateDimensionProperties:{range:{sheetId,dimension:'COLUMNS',startIndex:0,endIndex:columns},properties:{pixelSize:200},fields:'pixelSize'}});
 }
 const body=JSON.stringify({requests});if(Buffer.byteLength(body)>2*1024*1024)throw new CentralDriveError('source_limit');
 await api.json(`${base}:batchUpdate`,{method:'POST',headers:{'Content-Type':'application/json'},body});
}
