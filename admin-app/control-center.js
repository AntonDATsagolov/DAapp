// DAapp Control Center: readonly overview for moderators; audited, server-side
// settings and account controls for explicitly bootstrapped architects only.
export function createControlCenter(client, ui) {
  let adminId=null, generation=0, memberRequest=0, architect=false, page=0, busy=false;
  const $=id=>ui[id];
  const money=(n)=>typeof n==='number'?n.toLocaleString('ru-RU'):String(n??'—');
  const message=(id,s)=>{$(id).textContent=s};
  const node=(tag,className,value)=>{
    const el=document.createElement(tag);
    if(className)el.className=className;
    if(value!==undefined)el.textContent=String(value);
    return el;
  };
  const statLabels=[
    ['all_auth_users','Всего аккаунтов','users'],
    ['member_approved','Активных пользователей','user-check'],
    ['member_pending','Ожидают проверки','clock'],
    ['member_rejected','Ограничено','user-x'],
    ['new_7d','Регистраций за 7 дней','user-plus'],
    ['driver_pending','Анкеты водителей','car-front'],
    ['driver_approved','Допущено водителей','check-circle'],
    ['driver_online','Водителей на линии','radio'],
    ['business_pending','Заявки организаций','store'],
    ['business_approved','Подтверждённые организации','badge-check'],
    ['map_published','Опубликовано на карте','map-pin'],
    ['pending_email','Не подтвердили e-mail','mail']
  ];
  const flag=(v)=>v?'Включено':'Выключено';
  function reset(id) {
    adminId=id||null;
    generation++;memberRequest++;
    architect=false;page=0;busy=false;
    $('controlMetrics').replaceChildren();
    $('memberRegistry').replaceChildren();
    $('controlAudit').replaceChildren();
    $('architectControls').hidden=true;
    $('memberRegisterStatus').textContent='';
    $('controlDashboardStatus').textContent=adminId
      ?'Сводка не загружена':'Авторизуйтесь как администратор.';
  }
  async function loadOverview() {
    if(!adminId)return;
    const stamp=generation,uid=adminId;
    message('controlDashboardStatus','Запрашиваем статистику сервера…');
    const {data,error}=await client.rpc('daapp_admin_dashboard');
    if(stamp!==generation||uid!==adminId)return;
    $('controlMetrics').replaceChildren();
    if(error){
      message('controlDashboardStatus','Статистика недоступна. Установите SQL 010 в Supabase.');
      return;
    }
    architect=data?.is_architect===true;
    for(const [field,label] of statLabels){
      const item=node('div','control-tile');
      item.append(node('span','control-tile-label',label),
        node('strong','control-tile-value',money(data?.[field])));
      $('controlMetrics').append(item);
    }
    message('controlDashboardStatus','Показатели получены напрямую из Supabase. Для обновления нажмите кнопку.');
    $('architectControls').hidden=!architect;
    if(architect){
      $('controlAutoApprove').checked=data?.settings?.auto_activate_after_email===true;
      $('controlDirectoryEnabled').checked=data?.settings?.public_directory_enabled===true;
      void loadAudit();
    }
    $('adminRights').textContent=architect
      ?'Уровень: архитектор · аудит включён'
      :'Уровень: администратор · управление пользователями только через подтверждённые очереди';
  }
  async function loadMembers() {
    if(!adminId||busy)return;
    const stamp=generation,requestId=++memberRequest,uid=adminId;
    $('memberSearchButton').disabled=true;
    message('memberRegisterStatus','Загружаем пользователей…');
    const {data,error}=await client.rpc('daapp_admin_member_register',{
      p_search:$('memberSearch').value.trim(),
      p_filter:$('memberFilter').value,
      p_limit:40,p_offset:page*40
    });
    if(stamp!==generation||requestId!==memberRequest||uid!==adminId)return;
    $('memberRegistry').replaceChildren();
    $('memberSearchButton').disabled=false;
    if(error){
      message('memberRegisterStatus','Реестр пользователей недоступен. Требуется SQL 010.');
      return;
    }
    const members=Array.isArray(data)?data:[];
    message('memberRegisterStatus',members.length
      ?'Страница '+(page+1)+' · показано '+members.length+' аккаунтов'
      :'По вашему запросу пользователей нет.');
    $('membersPrev').disabled=page<=0;
    $('membersNext').disabled=members.length<40;
    const statuses={approved:'Активен',pending:'Ожидает',rejected:'Заблокирован',legacy:'Старый аккаунт'};
    const goals={resident:'Покупатель',driver:'Водитель',business:'Предприниматель'};
    const residences={resident:'Житель',guest:'Гость'};
    for(const u of members){
      const card=node('article','member-card');
      const top=node('div','member-card-top');
      top.append(node('strong',null,u.username||'Без логина'));
      const pill=node('span','member-pill',statuses[u.account_status]||u.account_status||'—');
      pill.dataset.state=u.account_status||'legacy';
      top.append(pill);
      card.append(top);
      const details=node('div','member-meta');
      details.append(node('span',null,'E-mail: '+(u.email||'—')+
        (u.email_verified?' · подтверждён':' · не подтверждён')));
      details.append(node('span',null,'Телефон: '+(u.phone_number||'не указан')+
        (u.public_phone?' · разрешил звонки':' · скрыт')));
      details.append(node('span',null,'Тип: '+(residences[u.residency]||'—')+
        ' · Сценарий: '+(goals[u.onboarding_goal]||'обычный')));
      details.append(node('span',null,'Водитель: '+(u.driver_status||'нет заявки')+
        ' · Бизнес-заявки: '+money(u.business_count)));
      card.append(details);
      if(architect && (u.account_status==='approved'||u.account_status==='rejected')){
        const actions=node('div','control-actions');
        const desired=u.account_status==='approved'?'rejected':'approved';
        const btn=node('button',desired==='approved'?'btn':'btn danger',
          desired==='approved'?'Восстановить доступ':'Заблокировать');
        btn.type='button';
        btn.addEventListener('click',async()=>{
          if(busy||!adminId)return;
          const reason=window.prompt('Причина изменения статуса (от 5 символов):');
          if(reason===null||reason.trim().length<5){
            message('memberRegisterStatus','Укажи понятную причину длиной от 5 символов.');
            return;
          }
          if(!window.confirm((desired==='approved'?'Восстановить':'Ограничить')+
             ' аккаунт '+(u.username||u.email)+'?'))return;
          busy=true;btn.disabled=true;
          try{
            const {error:changeError}=await client.rpc('daapp_architect_set_member_state',{
              p_user_id:u.user_id,p_state:desired,p_reason:reason.trim()
            });
            if(changeError)throw changeError;
            if(uid!==adminId)return;
            message('memberRegisterStatus','Статус сохранён; действие записано в аудит.');
          }catch{
            message('memberRegisterStatus','Не удалось изменить доступ. Проверь уровень архитектора и SQL 010.');
          }finally{busy=false;btn.disabled=false;}
          if(uid===adminId){
            void loadOverview();
            void loadMembers();
          }
        });
        actions.append(btn);card.append(actions);
      }
      $('memberRegistry').append(card);
    }
  }
  async function loadAudit(){
    if(!adminId||!architect)return;
    const stamp=generation;
    const {data,error}=await client.rpc('daapp_architect_recent_audit',{p_limit:25});
    if(stamp!==generation)return;
    $('controlAudit').replaceChildren();
    if(error){message('controlAuditStatus','Журнал недоступен.');return;}
    const entries=Array.isArray(data)?data:[];
    message('controlAuditStatus',entries.length?'Последние действия: '+entries.length:'Изменений ещё не было.');
    for(const e of entries){
      const row=node('div','audit-row');
      row.append(node('strong',null,(e.operation==='settings_update'?'Настройки':'Статус аккаунта')+
        ' · '+new Date(e.created_at).toLocaleString('ru-RU')));
      const description=e.operation==='settings_update'
        ?'Изменены настройки приложения'
        :'Новое состояние: '+(e.after_state?.status||'—')+
          ' · причина: '+(e.after_state?.reason||'—');
      row.append(node('span',null,description));
      $('controlAudit').append(row);
    }
  }
  async function saveSettings(){
    if(!architect||busy||!adminId)return;
    const yes=window.confirm('Сохранить параметры? Выключение автоматического доступа потребует ручного одобрения новых пользователей.');
    if(!yes)return;
    busy=true;$('controlSaveSettings').disabled=true;
    message('controlSettingsStatus','Сохраняем настройки…');
    const {error}=await client.rpc('daapp_architect_update_settings',{
      p_auto_activate:$('controlAutoApprove').checked,
      p_public_directory:$('controlDirectoryEnabled').checked
    });
    busy=false;$('controlSaveSettings').disabled=false;
    message('controlSettingsStatus',error
      ?'Не удалось сохранить параметры. Проверьте SQL 010 и права архитектора.'
      :'Настройки сохранены; изменение записано в аудит.');
    if(!error){
      void loadOverview();
      void loadAudit();
    }
  }
  $('refreshDashboard').addEventListener('click',()=>{void loadOverview();});
  $('memberSearchButton').addEventListener('click',()=>{page=0;void loadMembers();});
  $('memberSearch').addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();page=0;void loadMembers();}
  });
  $('memberFilter').addEventListener('change',()=>{page=0;void loadMembers();});
  $('membersPrev').addEventListener('click',()=>{if(page>0){page--;void loadMembers();}});
  $('membersNext').addEventListener('click',()=>{page++;void loadMembers();});
  $('controlSaveSettings').addEventListener('click',()=>{void saveSettings();});
  $('refreshAudit').addEventListener('click',()=>{void loadAudit();});
  return {
    reset,
    load(){
      if(adminId){void loadOverview();void loadMembers();}
    }
  };
}
