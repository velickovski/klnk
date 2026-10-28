/** Content-free owner-command retry binding after its shared record is removed.
 * Used by online deletion, timed retention and offline backup reconciliation. */
export function removedOwnerIntent(value:{commandId:string;ownerId:string;digest:string;createdAt:string},at:string){
  return{kind:'owner_intent_v1',commandId:value.commandId,ownerId:value.ownerId,digest:value.digest,state:'removed' as const,claim:'shared-record-removed',sourceText:'',connections:[],policyVersion:0,createdAt:value.createdAt,updatedAt:at};
}
