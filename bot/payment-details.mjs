// Transaction identity is display-only; never use it to close or reopen a case.
const field=value=>String(value??'').replace(/[\u0000-\u001f\u007f-\u009f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,100);
export function paymentIdentity(order,check,payment={}){
 return {order_number:order.displayNumber??null,check_number:check.displayNumber??null,order_opened_date:order.openedDate??null,payment_paid_date:payment.paidDate??null};
}
export function hawaiiTransactionTime(value){
 // Require an explicit offset. A date-only or timezone-free value is not an instant.
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))return '未取得 / Unavailable';
 const n=Date.parse(value);return Number.isFinite(n)?new Date(n-10*3600000).toISOString().slice(0,19).replace('T',' ')+' HST':'未取得 / Unavailable';
}
export function paymentVoidDetails(c){
 if(c.kind!=='void')return '';
 const p=c.payload||c,number=v=>field(v)?'#'+field(v).replace(/^#/,''):'未取得 / Unavailable';
 const lines=['対象営業日 / Business date: '+(field(c.business_date)||'未取得 / Unavailable'),
  'オーダー / Order #: '+number(p.order_number),'伝票 / Check #: '+number(p.check_number)];
 // Old subjects preferred Check # but sometimes fell back to Order # or a GUID.
 // Keep that reference without falsely identifying it as either number.
 const old=/^Payment Void\s*\/\s*(.+)$/i.exec(c.subject||'');
 if(!field(p.order_number)&&!field(p.check_number)&&old)lines.push('旧参照番号 / Legacy ref: '+field(old[1])+' (種別未確認 / Type unverified)');
 if(p.order_opened_date)lines.push('注文日時 / Order time: '+hawaiiTransactionTime(p.order_opened_date));
 if(p.payment_paid_date)lines.push('支払日時 / Payment time: '+hawaiiTransactionTime(p.payment_paid_date));
 lines.push('Void日時 / Voided: '+hawaiiTransactionTime(p.void_date));
 const amount=p.amount,known=amount!==null&&amount!==undefined&&amount!==''&&Number.isFinite(Number(amount));
 lines.push('金額 / Amount: '+(known?'$'+Number(amount).toFixed(2):'金額不明 / Unavailable'));
 return lines.join('\n');
}
