// Admin-only browser UI. All permission checks are enforced by SQL RPCs.
export function createAccountModerator(client, {list, status, refreshButton}) {
  let adminId=null, generation=0, busy=false;
  const country={resident:'Житель Шиели',guest:'Гость Шиели'};
  const item=(tag, cls, text)=>{
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!==undefined)el.textContent=text;
    return el;
  };
  function reset(id) {
    adminId=id||null;generation++;
    list.replaceChildren();
    status.textContent=adminId?'Загружаем заявки пользователей…':'Для проверки требуется вход администратора.';
  }
  async function refresh() {
    if(!adminId || busy)return;
    const uid=adminId,version=++generation;
    refreshButton.disabled=true;
    status.textContent='Загружаем новые регистрации…';
    try {
      const {data,error}=await client.rpc('daapp_admin_list_accounts');
      if(error)throw error;
      if(uid!==adminId || version!==generation)return;
      list.replaceChildren();
      const applications=Array.isArray(data)?data:[];
      status.textContent=applications.length
        ?'Ожидают одобрения: '+applications.length
        :'Новых пользователей нет.';
      for(const person of applications) {
        const card=item('div','driver-application');
        card.append(item('strong',null,person.username||'Без логина'));
        card.append(item('span',null,'E-mail: '+(person.email||'')));
        card.append(item('span',null,'Подтверждение почты: '+
          (person.email_verified?'подтверждено':'не подтверждено')));
        card.append(item('span',null,'Телефон (пока без SMS-проверки): '+(person.phone_number||'не указан')));
        card.append(item('span',null,'Статус: '+(country[person.residency]||'не указан')));
        card.append(item('span',null,'Согласие на публичный номер: '+(person.public_phone?'да':'нет')));
        if(person.avatar_path && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/i.test(person.avatar_path)) {
          const avatar=item('img');
          const url=client.storage.from('daapp-avatars').getPublicUrl(person.avatar_path)?.data?.publicUrl;
          if(url){
            avatar.src=url;avatar.alt='Аватар заявки';
            avatar.width=64;avatar.height=64;
            avatar.style.cssText='width:64px;height:64px;object-fit:cover;border-radius:50%;margin-top:9px';
            card.append(avatar);
          }
        }
        const row=item('label');
        const checkbox=item('input');
        checkbox.type='checkbox';
        const consentText=item('span',null,'Я проверил заявку и подтверждение e-mail. Телефон не проверен SMS.');
        row.append(checkbox,consentText);
        const actions=item('div','driver-actions');
        const approve=item('button','btn','Одобрить пользователя');
        const reject=item('button','btn danger','Отклонить');
        approve.type=reject.type='button';
        approve.disabled=!person.email_verified || !person.username || !person.phone_number;
        for(const [button,decision] of [[approve,'approved'],[reject,'rejected']]) {
          button.addEventListener('click',async()=>{
            if(busy || uid!==adminId)return;
            if(decision==='approved'&&!checkbox.checked) {
              status.textContent='Отметь подтверждение проверки заявки.';
              return;
            }
            if(!window.confirm((decision==='approved'?'Одобрить':'Отклонить')+
              ' пользователя «'+(person.username||person.email)+'»?'))return;
            busy=true;approve.disabled=true;reject.disabled=true;
            status.textContent='Сохраняем решение…';
            try{
              const {error:resultError}=await client.rpc('daapp_admin_review_account',{
                p_user_id:person.user_id,p_decision:decision
              });
              if(resultError)throw resultError;
              if(uid!==adminId||version!==generation)return;
              card.remove();
              status.textContent=decision==='approved'
                ?'Пользователь одобрен. Теперь доступен вход и функции DAapp.'
                :'Заявка пользователя отклонена.';
            }catch(error){
              if(uid===adminId && version===generation)
                status.textContent='Не удалось сохранить решение ('+
                  String(error.code||'network').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,35)+').';
            }finally{busy=false;}
          });
        }
        actions.append(approve,reject);
        card.append(row,actions);
        list.append(card);
      }
    }catch(error) {
      if(uid!==adminId || version!==generation)return;
      status.textContent='Невозможно загрузить новые регистрации. Проверь SQL 009 и админ-права.';
    }finally {
      if(uid===adminId && version===generation)refreshButton.disabled=false;
    }
  }
  return {reset,refresh};
}
