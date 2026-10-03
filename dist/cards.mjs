import {cents,dayInMonth,today,invoices} from './finance.mjs';
import {recurringDate} from './analytics.mjs';
export function purchaseDate(m,D){
 if(m.data_compra)return m.data_compra;
 const p=D.fin_planos?.find(p=>p.id===m.plano_id);
 if(p)return p.modalidade==='parcelado'?p.inicio:recurringDate(p.inicio,(m.ordem||1)-1,p.frequencia);
 const legacy=D.lancamentos?.find(l=>l.id===m.origem_legacy);if(legacy)return legacy.data_ocorrencia;
 return m.forma==='credito'?null:m.data_realizada||m.data_prevista;
}
export function creditPosted(m,D,date=today()){
 if(m.cobranca_efetivada!==undefined)return !!m.cobranca_efetivada;
 const p=D.fin_planos?.find(p=>p.id===m.plano_id),dt=purchaseDate(m,D);
 return !!dt&&dt<=date&&(p?.modalidade!=='recorrente'||m.ordem===1);
}
export function cardSummary(D,month,date=today()){
 const rows=D.fin_movimentos.filter(m=>m.status!=='cancelado'),groups=invoices(rows);
 return D.cartoes.map(c=>{
 const g=groups.find(g=>g.cartao_id===c.id&&g.month===month)||{gross:0,paid:0,planned:0,remaining:0,excess:0,items:[]};
 const actual=g.items.filter(m=>creditPosted(m,D,date)).reduce((s,m)=>s+cents(m.valor),0)/100;
 const projected=Math.max(0,Math.round((g.gross-actual)*100)/100);
 const committed=groups.filter(g=>g.cartao_id===c.id).reduce((sum,g)=>sum+Math.max(0,g.items.filter(m=>creditPosted(m,D,date)).reduce((s,m)=>s+cents(m.valor),0)-cents(g.paid)),0)/100;
 return {...g,cartao_id:c.id,nome:c.nome,month,due:dayInMonth(month,c.dia_vencimento||10),dueKnown:!!c.dia_vencimento,actual,projected,committed,available:c.limite==null?null:Number(c.limite)-committed,limite:c.limite,items:g.items};
 });
}
