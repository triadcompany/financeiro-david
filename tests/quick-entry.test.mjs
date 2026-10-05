import assert from 'node:assert/strict';
import {defaultCategories} from '../dist/catalog.mjs';
import {extractFields,simplifyDraft,missingField,normalizedDraft} from '../dist/conversation.mjs';
const D={pessoas:[{id:'me',nome:'Teste'}],contas:[{id:'bank',nome:'Conta',ativa:true,tipo:'bancaria'}],cartoes:[{id:'card',nome:'Inter',ativo:true,dia_fechamento:4,dia_vencimento:10}],categorias:[],fin_subcategorias:[]};
for(const [tipo,nome,names]of defaultCategories){const id=String(D.categorias.length);D.categorias.push({id,nome,tipo,ativa:true});for(const nome of names)D.fin_subcategorias.push({id:String(D.fin_subcategorias.length),categoria_id:id,nome});}
const parse=text=>simplifyDraft(extractFields(text,D,'2026-10-05'),D,'me','2026-10-05',text);
let r=parse('Mercado 85 no pix');assert.equal(r.valor,85);assert.equal(r.data_prevista,'2026-10-05');assert.equal(r.pessoa_id,'me');assert.equal(r.conta_id,'bank');assert.equal(missingField(r,D,'2026-10-05'),'status');
r=parse('Gastei 85 no mercado no pix');assert.equal(missingField(r,D,'2026-10-05'),null);assert.equal(D.categorias.find(c=>c.id===r.categoria_id).nome,'Alimentação');
r=parse('Mercado 85 no cartão Inter ontem');assert.equal(r.data_prevista,'2026-10-04');assert.equal(r.cartao_id,'card');assert.equal(normalizedDraft(r,D,'2026-10-05').fatura_mes,'2026-11');
r=parse('Comprei roupa 120 em 3x no cartão Inter');assert.equal(r.valor,120);assert.equal(missingField(r,D,'2026-10-05'),'valor_base');
r=parse('Comprei roupa em 3x de 80 reais no cartão Inter');assert.equal(r.valor,240);assert.equal(r.__needsAmountBasis,undefined);
r=parse('Paguei a fatura do Inter de 03/10');assert.equal(r.valor,undefined,'date cannot become amount');
r=parse('Mercado 85 no pix 31/02');assert.equal(r.data_prevista,undefined,'invalid date requires correction');
D.contas.push({id:'second',nome:'Outra conta',ativa:true,tipo:'bancaria'});r=parse('Gastei 85 no mercado no pix');assert.equal(r.conta_id,undefined,'multiple accounts require choosing');
assert.equal(defaultCategories.length,23);assert.equal(new Set(defaultCategories.map(([t,n])=>t+'|'+n)).size,23);
console.log('PASS quick entry: common phrases, safe amount/date parsing, default user/date, one compatible account, ambiguity and installment basis.');
