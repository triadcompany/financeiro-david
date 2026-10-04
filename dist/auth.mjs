export function mountAuth({request,getInvite,onSession}){
 const $=id=>document.getElementById(id);
 let mode='login',pending=false,resetToken=new URLSearchParams(location.hash.slice(1)).get('redefinir')||'';
 if(resetToken)history.replaceState({},'',location.pathname+location.search);
 const controls=['enter','signup','forgot','back-login'];
 function show(next){
  mode=next;$('login-message').textContent='';$('password').value='';$('confirm-password').value='';
  const signup=mode==='signup',reset=mode==='reset',recover=mode==='recover',newPassword=signup||reset;
  $('login-title').textContent={login:getInvite()?'Acesse o painel da família':'Entre no seu painel',signup:getInvite()?'Crie seu acesso à família':'Crie sua conta',recover:'Esqueci minha senha',reset:'Defina sua nova senha'}[mode];
  $('auth-description').textContent=signup?(getInvite()?'Você terá acesso aos dados da família que enviou o convite.':'Seu painel será criado do zero, com seus dados separados das outras contas.'):recover?'Enviaremos um link de recuperação para seu e-mail.':reset?'Escolha uma senha com pelo menos 8 caracteres.':'';
  for(const [id,visible]of [['name',signup&&!getInvite()],['email',!reset],['password',!recover],['confirm',newPassword]]){
   $(id+'-label').hidden=!visible;const field=$(id==='name'?'auth-name':id==='confirm'?'confirm-password':id);field.disabled=!visible;field.required=visible;
  }
  $('password').autocomplete=newPassword?'new-password':'current-password';
  $('enter').textContent={login:getInvite()?'Entrar e aceitar convite':'Entrar',signup:'Criar conta',recover:'Enviar link de recuperação',reset:'Salvar nova senha'}[mode];
  $('signup').hidden=mode!=='login';$('forgot').hidden=mode!=='login';$('back-login').hidden=mode==='login';
 }
 $('signup').onclick=()=>show('signup');$('forgot').onclick=()=>show('recover');$('back-login').onclick=()=>{resetToken='';show('login');};
 $('loginform').onsubmit=async e=>{
  e.preventDefault();if(pending)return;
  if((mode==='signup'||mode==='reset')&&$('password').value!==$('confirm-password').value){$('login-message').textContent='As senhas não conferem.';return;}
  pending=true;controls.forEach(id=>$(id).disabled=true);$('login-message').textContent='Aguarde…';
  try{
   const payload={email:$('email').value.trim(),password:$('password').value};
   if(mode==='recover'){const r=await request('/auth/v1/recover',{method:'POST',body:JSON.stringify({email:payload.email})},false);$('login-message').textContent=r.message;}
   else if(mode==='reset'){const r=await request('/auth/v1/reset',{method:'POST',body:JSON.stringify({token:resetToken,password:payload.password})},false);resetToken='';show('login');$('login-message').textContent=r.message;}
   else{const signup=mode==='signup';if(signup){payload.name=$('auth-name').value.trim();if(getInvite())payload.invite=getInvite();}const r=await request(signup?'/auth/v1/signup':'/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify(payload)},false);$('password').value='';$('confirm-password').value='';await onSession(r);show('login');}
  }catch(e){$('login-message').textContent=e.message||'Não foi possível concluir.';}finally{pending=false;controls.forEach(id=>$(id).disabled=false);}
 };
 show(resetToken?'reset':'login');
}
