import{PARABOLAS}from'../src/lib/learning/parabolas.ts';
export function visualFixture(){
 const e=structuredClone(PARABOLAS);
 const cases=[['fraction',[1,2,3],'אותה כמות, חלקים קטנים'],['geometry',[6,3,0,5],'רדיוס וגובה בחרוט'],['data-bars',[2,4,6,8],'סופרים תצפיות'],['normal',[70,10,60,80],'שטח מתחת לעקום'],['normal-school',[70,10,60,80],'רצועות של חצי סטיית תקן']];
 e.scenes.splice(1,0,...cases.map(([visual,values,title])=>({...structuredClone(e.scenes[0]),id:visual,title,visual,phase:'explore',check:null,prompt:'שנו את הערכים. מה נשמר ומה משתנה?',frames:[{caption:'משנים ערך אחד ועוקבים אחרי ההמחשה.',tex:'1',values}]})));
 return e;
}
