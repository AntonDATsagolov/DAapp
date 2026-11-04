// One mode switcher in account/settings area of every customer-facing module.
// A mode is shown as selectable only if its DB-reviewed permission is active.
// Unauthorized users can open an APPLICATION form, not the working mode.
import {supabase} from './supabase.js';
import {getModeState,saveLastMode,modeUrl,MODE_LABELS,MODE_NAMES} from './modes.js';

const pathname=window.location.pathname;
const moduleMode=pathname.includes('/business-app/')?'business':
  pathname.includes('/driver-app/')?'driver':'resident';
const target=document.querySelector(moduleMode==='resident'
  ?'#account': '#appPanel');
if(target){
  const css=document.createElement('style');
  css.textContent=`
  .daapp-mode-settings{margin:16px 0;padding:16px;background:#eff6f1;
    border:1px solid #cfe2d4;border-radius:15px;color:#1d4730;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
  .daapp-mode-settings h3{font-size:1rem;margin:0 0 7px;color:#174e35}
  .daapp-mode-settings p{font-size:.83rem;line-height:1.45;margin:5px 0;color:#53705d}
  .daapp-mode-switch-btn{width:100%;border:0;background:#17634a;color:white;
    padding:12px 14px;border-radius:11px;font:700 .86rem system-ui;cursor:pointer}
  .daapp-mode-switch-btn:disabled{opacity:.65;cursor:default}
  .daapp-mode-options{display:grid;gap:8px;margin-top:12px}
  .daapp-mode-option{border:1px solid #c6dacd;border-radius:10px;
    background:white;color:#1e5e42;padding:12px;font:700 .84rem system-ui;
    text-align:left;cursor:pointer;min-height:43px;text-decoration:none;display:block}
  .daapp-mode-option:disabled{opacity:.7;cursor:default}
  .daapp-mode-pending{background:#fffaf0;border-color:#eadab3;font-weight:600}
  .daapp-mode-status{font-size:.78rem!important}
  [hidden]{display:none!important}
  `;
  document.head.append(css);
  const panel=document.createElement('section');
  panel.className='daapp-mode-settings';
  panel.id='daappModeSettings';
  panel.hidden=true;
  panel.setAttribute('aria-label','Настройки — сменить режим');
  const heading=document.createElement('h3');
  heading.textContent='Настройки · Режим DAapp';
  const description=document.createElement('p');
  const open=document.createElement('button');
  open.id='daappChangeMode';
  open.type='button';
  open.className='daapp-mode-switch-btn';
  open.textContent='Сменить режим';
  const options=document.createElement('div');
  options.className='daapp-mode-options';
  options.id='daappModeOptions';
  options.hidden=true;
  const status=document.createElement('p');
  status.className='daapp-mode-status';
  status.setAttribute('role','status');
  status.setAttribute('aria-live','polite');
  panel.append(heading,description,open,options,status);
  target.insertBefore(panel,target.firstChild);

  let loggedId=null,revision=0,current=null;
  function addOption(text,fn,config={}){
    const el=document.createElement(config.href?'a':'button');
    el.className='daapp-mode-option'+(config.pending?' daapp-mode-pending':'');
    el.textContent=text;
    if(config.href)el.href=config.href;
    else{
      el.type='button';el.disabled=Boolean(config.disabled);
      if(fn)el.addEventListener('click',fn);
    }
    options.append(el);
  }
  function showModeChoices(info){
    options.replaceChildren();
    const active=info.availableModes.includes(moduleMode)
      ?moduleMode:'resident';
    for(const mode of MODE_NAMES){
      if(info.availableModes.includes(mode)){
        const label=MODE_LABELS[mode]+(mode===active?' · текущий':'');
        addOption(label,async()=>{
          if(mode===moduleMode)return;
          status.textContent='Проверяем доступ и открываем режим…';
          const saved=await saveLastMode(supabase,mode);
          if(saved.error){status.textContent=saved.error;return;}
          window.location.assign(modeUrl(mode,window.location.href));
        },{disabled:mode===moduleMode});
      }else if(mode!=='resident'){
        const progress=mode==='driver'?info.driverApplication:info.businessApplication;
        const label=mode==='driver'?'водителя':'предпринимателя';
        if(progress==='pending'){
          addOption('Заявка '+label+' на проверке',null,{disabled:true,pending:true});
        }else{
          addOption('Подключить режим '+label+' · подать заявку',null,
            {href:new URL(mode==='driver'?'../driver-app/?apply=1':
              '../business-app/?apply=1',window.location.href).href,pending:true});
        }
      }
    }
  }
  open.addEventListener('click',()=>{
    options.hidden=!options.hidden;
    open.setAttribute('aria-expanded',String(!options.hidden));
  });
  async function refresh(user){
    const id=user?.id||null,stamp=++revision;
    loggedId=id;
    panel.hidden=true;options.hidden=true;status.textContent='';
    if(!id)return;
    const result=await getModeState(supabase);
    if(stamp!==revision||loggedId!==id)return;
    if(result.error){
      // Never guess the role from localStorage or browser-visible metadata.
      panel.hidden=false;open.disabled=true;
      description.textContent='Режимы временно недоступны.';
      status.textContent=result.error;
      return;
    }
    current=result.state;
    if(!current.approved)return;
    panel.hidden=false;open.disabled=false;
    if(current.availableModes.includes(moduleMode)){
      description.textContent='Сейчас: '+MODE_LABELS[moduleMode]+'. Можно сменить режим без повторного входа.';
      // Visiting a reviewed module is an intentional selection, and the
      // preference is saved in Supabase (survives a device reboot).
      const stored=await saveLastMode(supabase,moduleMode);
      if(stamp!==revision||loggedId!==id)return;
      if(stored.error)status.textContent=stored.error;
    }else{
      description.textContent='Для этого рабочего режима ещё нет подтверждённого допуска. Здесь можно только подать или проверить заявку.';
    }
    showModeChoices(current);
  }
  const {data}=await supabase.auth.getSession();
  void refresh(data?.session?.user||null);
  supabase.auth.onAuthStateChange((_event,session)=>{
    setTimeout(()=>{void refresh(session?.user||null);},0);
  });
}
