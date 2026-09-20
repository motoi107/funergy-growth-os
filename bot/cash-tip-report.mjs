const DAYS=['日','月','火','水','木','金','土'];
const clean=value=>String(value??'').replace(/[\u0000-\u001f\u007f-\u009f]+/g,' ').slice(0,100);
export function cashTipEntered(record,side){
 if(!record||typeof record!=='object')return false;
 const flag=record[side+'Entered'];
 if(!(flag===true||(flag===undefined&&record.entered===true)))return false;
 const value=record[side];
 return (typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))&&Number(value)>=0;
}
export function cashTipFindings({from,to,stores,cash={},hours={},closures={},config={}}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))throw Error('invalid_cash_tip_range');
 const start=Date.parse(from+'T00:00:00Z'),end=Date.parse(to+'T00:00:00Z');
 if(!Number.isFinite(start)||!Number.isFinite(end)||end-start>31*86400000)throw Error('invalid_cash_tip_range');
 const rows=[];
 for(const store of stores){
  const id=store.store_id||store.id;
  if(store.active===false||(config.excluded_store_ids||[]).includes(id))continue;
  for(let at=start;at<=end;at+=86400000){
   const date=new Date(at).toISOString().slice(0,10),dow=DAYS[new Date(at).getUTCDay()];
   if(date<(config.first_business_dates?.[id]||from)||date>(config.last_business_dates?.[id]||to))continue;
   const special=closures[id]?.[date]?.mode,mode=special||store.bizDays?.[dow]||store.data?.bizDays?.[dow];
   if(mode==='closed')continue;
   const window=hours[id]?.mode==='hours'?hours[id]?.dow?.[dow]:null;
   const required=['lunch','dinner'].filter(side=>side==='lunch'?mode!=='lclose'&&window?.lOn!==false:mode!=='dclose'&&window?.dOn!==false);
   const missing=required.filter(side=>!cashTipEntered(cash[id]?.[date],side));
   if(missing.length)rows.push({store_id:id,store_name:store.name||id,business_date:date,missing});
  }
 }
 return rows.sort((a,b)=>a.store_id.localeCompare(b.store_id)||a.business_date.localeCompare(b.business_date));
}
export function formatCashTipReport(rows,{from,to,resend=false}={}){
 if(!rows.length)return {category:'cash_tip',messages:[],total:0,complete:true,detail_count:0};
 const lines=['【キャッシュチップ未入力'+(resend?'｜再送':'')+'】','Cash tips: missing entries','対象：'+from+'〜'+to,'未入力：'+rows.length+'店舗日','現金チップがなかった場合も「0」を入力・保存してください。','Enter and save 0 when no cash tips were received.','Funergy＋のキャッシュチップ入力を保存・同期すると、次回の通知から外れます。'];
 let text=lines.join('\n'),messages=[],lastStore=null;
 for(const row of rows){
  const label=row.missing.map(s=>s==='lunch'?'ランチ / Lunch':'ディナー / Dinner').join('・');
  const heading=row.store_id!==lastStore?'\n\n'+clean(row.store_name)+' ('+clean(row.store_id)+')':'';
  const line='\n'+row.business_date+'：'+label;
  if(text.length+heading.length+line.length>4200){messages.push({type:'text',text});text=clean(row.store_name)+' ('+clean(row.store_id)+')';}
  else text+=heading;
  text+=line;lastStore=row.store_id;
 }
 messages.push({type:'text',text:text+'\n\n【レポート終了】未入力 '+rows.length+'店舗日を全件掲載'});
 messages=messages.map((m,i)=>({type:'text',text:'【キャッシュチップ｜経理 '+(i+1)+'/'+messages.length+'】\n'+m.text}));
 return {category:'cash_tip',messages,total:rows.length,detail_count:rows.length,complete:true};
}
export function reportRoute(config,category){
 if(!config?.routes)return null;
 const route=config.routes[category==='cash_tip'?'finance':category];
 if(!route||!/^C[a-f0-9]{32}$/i.test(route.group_id||'')||!route.label)throw Error('report_route_not_configured');
 return route;
}
export function caseCategory(kind){return kind==='labor'?'labor':['void','unpaid'].includes(kind)?'finance':null;}
