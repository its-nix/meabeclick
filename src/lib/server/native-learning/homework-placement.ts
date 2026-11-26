import {DOC,FOLDER,type CentralFile,type centralDriveApi} from '../central-drive/api.ts';
import type {NativeWorkspace} from '../learning-archive.ts';

type Drive = ReturnType<typeof centralDriveApi>;
type FolderPermission = {id:string;type:string;role:string};
const FILES='https://www.googleapis.com/drive/v3/files';
const idPattern=/^[\w-]{10,200}$/;

export async function nativeStudentFolder(api:Drive,rootId:string,workspace:NativeWorkspace,student:{id:number;name:string},existingOnly=false) {
 const folder=(key:string,name:string,parent:string)=>existingOnly?api.existingFolder(key,parent):api.folder(key,name,parent);
 const site=await folder('site','02 תלמידים ומעקב',rootId);
 const students=await folder('students','02 תיקי תלמידים',site.id);
 if(students.id!==workspace.studentsId)throw Error('conflict');
 return folder(`student:${student.id}`,student.name,students.id);
}

/** Move the registered Doc in place, preserving its ID, comments and history. */
export async function placeHomeworkDoc(api:Pick<Drive,'scope'|'ownerEmail'|'json'>,docId:string,reviewFolderId:string,studentFolderId:string) {
 if(![docId,reviewFolderId,studentFolderId].every(id=>idPattern.test(id)))throw Error('conflict');
 const fields='id,mimeType,parents,owners(emailAddress),permissions(type),trashed,appProperties';
 const url=`${FILES}/${docId}`;
 const doc=await api.json(`${url}?fields=${fields}`) as CentralFile;
 if(doc.id!==docId||doc.mimeType!==DOC||doc.trashed||doc.appProperties?.meaCentralScope!==api.scope||
    !doc.owners?.some(owner=>owner.emailAddress.toLowerCase()===api.ownerEmail.toLowerCase())||
    doc.parents?.length!==1)throw Error('conflict');
 if(doc.parents[0]===studentFolderId)return;
 if(doc.parents[0]!==reviewFolderId||!Array.isArray(doc.permissions)||doc.permissions.some(p=>!['user','group'].includes(p.type)))throw Error('privacy');
 // A move changes inherited access. Require the two folders to grant the same
 // access, so the move neither exposes a draft nor drops a tutor's inherited role.
 const folderPermissions=async(folderId:string)=>{
  const folder=await api.json(`${FILES}/${folderId}?fields=id,mimeType,permissions(id,type,role),trashed`);
  if(folder.id!==folderId||folder.mimeType!==FOLDER||folder.trashed||
     !Array.isArray(folder.permissions)||folder.permissions.some((p:FolderPermission)=>!p.id||!p.role||!['user','group'].includes(p.type)))throw Error('privacy');
  return folder.permissions.map((p:FolderPermission)=>JSON.stringify([p.id,p.type,p.role])).sort().join('\n');
 };
 const [before,after]=await Promise.all([folderPermissions(reviewFolderId),folderPermissions(studentFolderId)]);
 if(before!==after)throw Error('homework_folder_access_conflict');
 const moved=await api.json(`${url}?addParents=${studentFolderId}&removeParents=${reviewFolderId}&fields=id,parents`,{method:'PATCH'});
 if(moved.id!==docId||moved.parents?.length!==1||moved.parents[0]!==studentFolderId)throw Error('conflict');
}
