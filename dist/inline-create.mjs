import {norm} from './assistant.mjs';
import {today} from './finance.mjs';
import {esc} from './analytics.mjs';
// Separate dialog: the parent entry form and its idempotency key stay mounted.
export function createInlineRecord({kind,type='saida',parent='',accountType='bancaria',getData,save}){
 return new Promise(resolve=>{
 const dialog=document.createElement('dialog'),isAccount=kind==='conta_id'||kind==='destino_id',sub=kind==='subcategoria_id',table=isAccount?'contas':sub?'fin_subcategorias':'categorias';
 const D=getData();if(sub&&!D.categorias.some(c=>c.id===parent)){resolve(null);return;}
 dialog.className='inline-create';dialog.innerHTML=`<form><h2>${isAccount?'Nova conta':sub?'Nova subcategoria':'Nova categoria'}</h2><p>${sub?'Categoria: '+esc(D.categorias.find(c=>c.id===parent).nome):isAccount?'A nova conta será selecionada neste lançamento.':type==='entrada'?'Categoria de receita':'Categoria de despesa'}</p><label>Nome<input name="nome" required maxlength="100" autocomplete="off"></label>${isAccount?`<label>Tipo<select name="tipo">${Object.entries({bancaria:'Conta bancária',dinheiro:'Dinheiro',poupanca:'Poupança',investimento:'Investimento'}).map(([v,l])=>`<option value="${v}" ${v===accountType?'selected':''}>${l}</option>`).join('')}</select></label><label>Saldo inicial (opcional)<input name="saldo" inputmode="decimal" placeholder="0,00"></label><label>Data do saldo inicial<input name="data" type="date" value="${today()}"></label><p class="small">Informe o saldo no início desse dia, antes dos lançamentos. Pode deixar em branco e configurar depois.</p>`:''}<p role="status" class="inline-message"></p><div class="actions"><button type="button" class="quiet" data-cancel>Cancelar</button><button class="primary" type="submit">Criar e usar</button></div></form>`;
 document.body.append(dialog);let result=null,pending=false;
 dialog.addEventListener('close',()=>{dialog.remove();resolve(result);},{once:true});dialog.addEventListener('cancel',e=>{if(pending)e.preventDefault();});dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
 const form=dialog.querySelector('form');form.onsubmit=async e=>{e.preventDefault();if(pending)return;const v=Object.fromEntries(new FormData(form)),name=v.nome.trim();const message=dialog.querySelector('.inline-message');if(!name){message.textContent='Informe um nome.';return;}
 const duplicate=getData()[table].find(x=>norm(x.nome).trim()===norm(name)&&(!sub||x.categoria_id===parent)&&(sub||x.tipo===(isAccount?v.tipo:type))&&x.ativa!==false);
 if(duplicate){result=duplicate;dialog.close();return;}
 try{const row={nome:name};if(isAccount){row.tipo=v.tipo;row.saldo_inicial=null;row.data_saldo_inicial=null;if(v.saldo.trim()){const value=v.saldo.trim();if(!/^-?\d+(?:[,.]\d{1,2})?$/.test(value)||!v.data)throw Error('Confira o saldo (ex.: 1250,50) e a data.');row.saldo_inicial=Number(value.replace(',','.'));row.data_saldo_inicial=v.data;}row.ativa=true;}else if(sub)row.categoria_id=parent;else{row.tipo=type;row.ativa=true;}
 pending=true;form.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);message.textContent='Criando…';const created=await save(table,row);result=created[0];if(!result?.id)throw Error('Não foi possível confirmar o cadastro.');getData()[table].push(result);dialog.close();
 }catch(err){message.textContent=err.message;pending=false;form.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}};
 dialog.showModal();form.elements.nome.focus();
 });
}
