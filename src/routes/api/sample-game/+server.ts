import {json} from '@sveltejs/kit';
import {sampleGameAction,SampleGameError} from '$server/native-learning/public-sample.ts';
import type {RequestHandler} from './$types';

/** Grades one sample-game action on the server; nothing is stored. */
export const POST:RequestHandler=async({cookies,request})=>{
 const headers={'Cache-Control':'private, no-store'};
 const id=cookies.get('mea_sample_game');
 if(!id)return json({error:'טענו את הדף מחדש.'},{status:409,headers});
 let body:unknown;try{const raw=await request.text();if(raw.length>4000)throw Error();body=JSON.parse(raw);}catch{return json({error:'בקשה לא תקינה'},{status:400,headers});}
 try{return json(sampleGameAction(id,body),{headers});}
 catch(e){if(e instanceof SampleGameError)return json({error:e.message},{status:e.status,headers});throw e;}
};
