import {today,dayInMonth} from './finance.mjs';
export const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const valueOf=s=>Number(s.includes(',')?s.replaceAll('.','').replace(',','.'):s);
export function interpretMessage(text,D,date=today()){
 const t=norm(text),draft={tipo:/\b(recebi|recebido|receita|salario|bolsa)\b/.test(t)?'entrada':'saida',descricao:text.trim().slice(0,200),data_prevista:date,status:'pendente'},notes=['Confira os campos antes de salvar.'];
 // Currency or an amount next to a financial verb; dates/card numbers are not amounts.
 let match=text.match(/R\$\s*(\d+(?:\.\d{3})*(?:,\d{1,2})?)/i)||text.match(/(\d+(?:[.,]\d{1,2})?)\s*reais\b/i)||text.match(/\b(?:gastei|paguei|recebi|valor(?:\s+de)?|por)\s+(\d+(?:[.,]\d{1,2})?)/i);
 const installments=t.match(/\b(\d{1,3})\s*(?:x|vezes|parcelas)\b/),per=t.match(/\b(\d{1,3})\s*(?:x|vezes|parcelas)\s+de\s*(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)/);
 if(match)draft.valor=valueOf(match[1]);
 if(installments){const n=Number(installments[1]);if(n>=2&&n<=600){draft.modalidade='parcelado';draft.quantidade=n;if(per){draft.valor=Math.round(n*valueOf(per[2])*100)/100;notes.push('O valor total foi calculado multiplicando as parcelas.');}}}
 if(/\b(mensal|todo mes|todos os meses|mensalmente)\b/.test(t)){draft.modalidade='recorrente';draft.frequencia='mensal';}
 const full=t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/),day=t.match(/\bdia\s+(\d{1,2})\b/);
 if(full){const y=full[3]||date.slice(0,4),m=String(full[2]).padStart(2,'0'),d=String(full[1]).padStart(2,'0');if(+m>=1&&+m<=12&&+d>=1&&dayInMonth(y+'-'+m,+d)===`${y}-${m}-${d}`)draft.data_prevista=`${y}-${m}-${d}`;else notes.push('Data não reconhecida: escolha no calendário.');}
 else if(/\bontem\b/.test(t)){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);draft.data_prevista=d.toISOString().slice(0,10);}
 else if(day){if(+day[1]>=1&&+day[1]<=31){draft.data_prevista=dayInMonth(date.slice(0,7),+day[1]);notes.push('Foi considerado o mês atual para o dia informado.');}}
 const people=D.pessoas.filter(p=>t.includes(norm(p.nome))),isFamily=/\bfamilia(?:r)?\b/.test(t);if(isFamily)draft.pessoa_id='';else if(people.length===1)draft.pessoa_id=people[0].id;else notes.push('Escolha de quem é o lançamento.');
 const cards=D.cartoes.filter(c=>t.includes(norm(c.nome))||(/\binter\b/.test(t)&&norm(c.nome).includes('inter'))||(/\bporto\b/.test(t)&&norm(c.nome).includes('porto'))||(/\bitau\b/.test(t)&&norm(c.nome).includes('itau')));
 const cardIntent=/\b(credito|cartao)\b/.test(t);const method=['pix','debito','dinheiro','boleto'].find(x=>new RegExp('\\b'+x+'\\b').test(t));
 if(cardIntent&&draft.tipo==='saida'&&!method){draft.forma='credito';if(cards.length===1)draft.cartao_id=cards[0].id;}else if(method)draft.forma=method;
 const accounts=D.contas.filter(c=>t.includes(norm(c.nome))||(/\bc6\b/.test(t)&&norm(c.nome).includes('c6'))||(/\binter\b/.test(t)&&norm(c.nome).includes('inter')));if(draft.forma!=='credito'&&accounts.length===1)draft.conta_id=accounts[0].id;
 if(draft.forma==='dinheiro'){const a=D.contas.filter(c=>c.tipo==='dinheiro');if(a.length===1)draft.conta_id=a[0].id;}
 if(/\b(fatura)\b/.test(t)&&/\b(paguei|pagamento|pagar)\b/.test(t)){draft.tipo='pagamento_fatura';draft.forma=method||'transferencia';if(cards.length===1)draft.cartao_id=cards[0].id;notes.push('Selecione o mês da fatura que foi paga.');}
 const mappings=draft.tipo==='entrada'?[[/bolsa|sebrae|\bali\b/,'Bolsas e auxílios','Bolsa ALI'],[/salario/,'Salário',''],[/consultoria|freelance|servico/,'Serviços e consultoria','Consultoria'],[/comissao/,'Comissões',''],[/venda/,'Vendas','']]:[[/dizimo/,'Dízimos, ofertas e doações','Dízimo'],[/oferta/,'Dízimos, ofertas e doações','Oferta'],[/doacao/,'Dízimos, ofertas e doações','Doação'],[/\bdas\b|\bmei\b/,'Impostos e taxas','DAS MEI'],[/\bipva\b/,'Impostos e taxas','IPVA'],[/\biptu\b/,'Impostos e taxas','IPTU'],[/imposto/,'Impostos e taxas',''],[/emprestimo|divida|financiamento/,'Dívidas e empréstimos',''],[/restaurante|almoco|jantar/,'Alimentação','Restaurante'],[/delivery|ifood/,'Alimentação','Delivery'],[/mercado|supermercado|padaria/,'Alimentação','Supermercado'],[/farmacia|remedio/,'Saúde','Farmácia'],[/aluguel/,'Moradia','Aluguel'],[/netflix|spotify|streaming/,'Assinaturas','Streaming'],[/internet/,'Contas da casa','Internet'],[/combustivel|gasolina/,'Transporte','Combustível'],[/roupa|calcado/,'Cuidados pessoais e vestuário','Roupas']];
 const exact=D.categorias.filter(c=>c.tipo===draft.tipo&&t.includes(norm(c.nome))),mapped=mappings.find(([re])=>re.test(t)),cat=exact[0]||D.categorias.find(c=>c.tipo===draft.tipo&&mapped&&norm(c.nome)===norm(mapped[1]));
 if(cat){draft.categoria_id=cat.id;const sub=D.fin_subcategorias.find(s=>s.categoria_id===cat.id&&mapped&&norm(s.nome)===norm(mapped[2]));if(sub)draft.subcategoria_id=sub.id;}
 if(draft.tipo==='entrada'){if(t.includes('sebrae'))draft.pagador='Sebrae';const p=text.match(/\brecebi\s+(?:r\$\s*)?\d+(?:[.,]\d+)?\s+(?:da|do|de)\s+([^,.;]+)/i);if(p)draft.pagador=p[1].trim().slice(0,100);}
 if(/\b(paguei|gastei|recebi)\b/.test(t)&&draft.forma!=='credito'&&draft.data_prevista<=date){draft.status='concluido';draft.data_realizada=draft.data_prevista;}
 if(!draft.forma)notes.push('Escolha a forma de pagamento.');if(!draft.valor)notes.push('Informe o valor no formulário.');if(!draft.categoria_id&&['entrada','saida'].includes(draft.tipo))notes.push('Escolha a categoria ou fonte.');
 return {draft,notes};
}
