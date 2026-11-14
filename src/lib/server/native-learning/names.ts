/** Short Drive names; technical identities remain in appProperties and receipts. */
export function nativeReviewNames(title:string,animated:boolean,createdAt=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(createdAt);
 const part=(type:string)=>parts.find(p=>p.type===type)!.value;
 const stamp=`${part('year')}-${part('month')}-${part('day')} ${part('hour')}${part('minute')}${part('second')}`;
 const clean=title.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim();
 const topic=clean.split(/[:：]/).at(-1)!.trim().replace(/^(?:היכרות עם|מבוא ל)\s*/u,'')||'שיעור';
 const short=Array.from(topic).slice(0,24).join('');
 const label=animated?'אנימציות':'טיוטה';
 return {folder:`${stamp} · ${short} · ${label}`,slides:`01 מצגת · ${short} · ${label}`,homework:`02 שיעורי בית · ${short}`};
}
