// Deliberately constrained commands: free text and questions never close cases.
export function parseCaseReply(input) {
 const text=String(input||'').normalize('NFKC').trim();
 const m=/^(#\d+|B-[A-F0-9]{12})\s+(.+)$/is.exec(text);
 if(!m)return null;
 const commands=[['unchanged',/^(?:内容確認済み[・\s]*変更なし|確認済み[・\s]*変更なし|confirmed[ ,;-]*no change)\s+(.+)$/is],['fixed',/^(?:修正済み?|修正しました|fixed|corrected)\s+(.+)$/is],['other',/^(?:その他[・\s]*終了|other[ -]*close)\s+(.+)$/is],['continue',/^(?:その他[・\s]*対応継続|対応中|in progress)\s+(\d{4}-\d{2}-\d{2})\s+(.+)$/is],['hq_approve',/^(?:承認して終了|本部承認|approve)\s+(.+)$/is],['hq_return',/^(?:差し戻し|return)\s+(.+)$/is]];
 for(const [action,pattern] of commands){const hit=pattern.exec(m[2]);if(hit){if(action==='continue'){const d=new Date(hit[1]+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==hit[1])return {code:m[1].toUpperCase(),invalid:true};}const note=(action==='continue'?hit[2]:hit[1]).trim();if(!note||note.length>4000||/[?？]/.test(note))return {code:m[1].toUpperCase(),invalid:true};return {code:m[1].toUpperCase(),action,note,...(action==='continue'?{due_date:hit[1]}:{})};}}
 return {code:m[1].toUpperCase(),invalid:true};
}
export const replyHelp=code=>`${code} 完了 / done\n複数は案件番号をカンマで区切る / Separate case numbers with commas\n${code} 修正済み 修正内容\n${code} 確認済み・変更なし 理由\n${code} その他・終了 理由\n${code} 対応中 YYYY-MM-DD 対応内容\nEnglish: fixed / confirmed no change / other close / in progress YYYY-MM-DD + reason`;
export function replyChoices(code){return {items:[['修正済み / Fixed',`${code} 修正済み `],['変更なし / No change',`${code} 確認済み・変更なし `],['その他 / Other',`${code} その他・終了 `],['対応中 / In progress',`${code} 対応中 `]].map(([label,fillInText])=>({type:'action',action:{type:'postback',label,data:'case_reply='+encodeURIComponent(code),inputOption:'openKeyboard',fillInText}}))};}
export function responseReceipt(c){const states={hq_review:'本部確認待ち / Awaiting HQ review',verify:'修正反映の確認待ち / Awaiting verification',correction:'対応継続 / Action required',done:'完了 / Closed'};const decision=c.payload?.closure||c.payload?.returned||c.payload?.response||{};const at=decision.at?new Date(decision.at).toLocaleString('ja-JP',{timeZone:'Pacific/Honolulu'}):'';return `${c.code}｜${c.payload?.store_name||c.store_id}｜${c.subject}\n${states[c.status]||c.status}\n${decision.note||''}\n確認者 / By: ${decision.actor||'Toast'}${at?'｜'+at+' HST':''}`;}

// Explicit reports in an enabled LINE group can close up to 20 cases at once.
export function parseCompletionReply(input) {
 const text=String(input||'').normalize('NFKC').trim();
 const m=/^(?:案件\s*)?((?:#\d+|B-[A-F0-9]{12})(?:(?:\s*[,、・]\s*|\s+)(?:#\d+|B-[A-F0-9]{12}))*)\s*(.+)$/is.exec(text);
 if(!m)return null;
 const codes=[...new Set(m[1].toUpperCase().match(/#\d+|B-[A-F0-9]{12}/g))];
 const hit=/^(完了(?:しました|です|報告)?|対応完了|終了(?:しました)?|確認済み(?:[・\s]*変更なし)?|内容確認済み(?:[・\s]*変更なし)?|修正済み?|修正しました|その他[・\s]*終了|done|completed|closed|fixed|corrected|confirmed(?:[ ,;-]*no change)?|other[ -]*close)(?:[。.!！]|\s+(.+))?$/is.exec(m[2].trim());
 if(!hit)return null;
 if(codes.length>20||text.length>4000)return {codes,invalid:true,reason:'limit'};
 if(/[?？]|ですか|でしょうか|ましたか|ません|ない|なかった|未完了|未確認|未修正|まだ|\b(?:not|yet|never|cannot)\b|\b(?:isn|aren|wasn|weren|hasn|haven|hadn|didn|don|doesn|can|couldn|wouldn|shouldn)['’]t\b/i.test(m[2]))return {codes,invalid:true,reason:'unclear'};
 return {codes,note:m[2].trim()};
}
export function completionReceipt(result){
 return '完了報告の受付 / Completion report\n'+(result.results||[]).map(c=>`${c.code}｜${c.error==='not_found'?'対象案件が見つかりません / Not found':c.error==='invalid_kind'?'完了報告の対象外 / Unsupported':c.already_closed?'完了済み / Already closed':c.status==='done'?'完了 / Closed':'受付できません / Not accepted'}${c.subject?'｜'+String(c.subject).slice(0,100):''}`).join('\n');
}
