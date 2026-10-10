
(async function(){
  document.documentElement.dir='rtl'; document.documentElement.lang='he';
  var CFG=null;
  try{var cr=await fetch('/api/config',{credentials:'same-origin'});if(!cr.ok)throw 0;CFG=await cr.json()}catch(e){}
  if(!CFG){document.getElementById('main').innerHTML='<div class="card reg"><div><h2>אין חיבור לשרת</h2><p>לא הצלחנו להתחבר למערכת. בדקו את האינטרנט ורעננו את הדף.</p></div></div>';return}

  /* ===== Configuration: comes from the server (src/config.js) ===== */
  var STUDIOS=CFG.studios;
  var DEFAULT_STUDIO=STUDIOS[0].id;
  var OPEN=CFG.rules.OPEN, CLOSE=CFG.rules.CLOSE, MAX_DAY=CFG.rules.MAX_DAY, CANCEL_LEAD_H=CFG.rules.CANCEL_LEAD_H;
  var MAX_STATIONS=CFG.rules.MAX_STATIONS, MAX_STRIKES=CFG.rules.MAX_STRIKES, REVIEW_DAYS=CFG.rules.REVIEW_DAYS;
  var ADMINS=CFG.admins, PERIODS=CFG.periods, CLOSED_RANGES=CFG.closed, SHORT_DAYS=CFG.shortDays;
  var EMAIL_DOMAIN=CFG.domain;
  var EMAIL_RE=/^[a-z0-9._%+\-]+@edu\.jmc\.ac\.il$/;
  var YEARS=CFG.years, PURPOSES=CFG.purposes;

  /* ===== Helpers ===== */
  var $=function(s){return document.querySelector(s)};
  var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
  var pad=function(n){return String(n).padStart(2,'0')};
  var ds=function(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
  var parse=function(s){var p=s.split('-').map(Number);return new Date(p[0],p[1]-1,p[2])};
  var hh=function(h){return pad(h)+':00'};
  var rng=function(a,b){return '<span class="t">'+hh(a)+'–'+hh(b)+'</span>'};
  var DOW=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
  var fmtLong=function(d){return d.toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long'})};
  var fmtMonth=function(d){return d.toLocaleDateString('he-IL',{month:'long',year:'numeric'})};
  var studioOf=function(id){return STUDIOS.filter(function(s){return s.id===id})[0]};
  var key=function(st,d,h){return st+'_'+d+'_'+pad(h)};
  var store=function(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}};

  /* ===== Server API ===== */
  async function api(method,path,body){
    var o={method:method,credentials:'same-origin',headers:{'X-Requested-With':'yb'}};
    if(body!==undefined){o.headers['Content-Type']='application/json';o.body=JSON.stringify(body)}
    var r;
    try{r=await fetch(path,o)}catch(e){var ne=new Error('אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.');ne.code='network';throw ne}
    var j=null;try{j=await r.json()}catch(e){}
    if(!r.ok){
      var er=new Error((j&&j.message)||'הפעולה לא הצליחה. נסו שוב.');er.code=(j&&j.error)||'http';er.status=r.status;
      if(r.status===401&&S.uid&&path!=='/api/auth/logout')sessionLost();
      throw er;
    }
    return j;
  }
  function flash(msg){S.flash=msg||'';renderNotice();clearTimeout(flash.t);if(msg)flash.t=setTimeout(function(){S.flash='';renderNotice()},9000)}
  function sessionLost(){S.uid=null;S.profile=null;S.member=null;S.login=S.login||{busy:false,err:''};S.login.err='ההתחברות פגה. יש להתחבר מחדש.';clearTimeout(pollTimer);render()}
  async function refresh(){
    var st=await api('GET','/api/state'+(S.ver&&!S.forceFull&&++S.polls%30?'?v='+S.ver:''));
    S.forceFull=false;
    if(st.unchanged)return false;
    applyState(st);return true;
  }
  function forceRefresh(){S.forceFull=true;return refresh().catch(function(e){flash(e.message)})}
  function applyState(st){
    var first=!S.loaded;
    S.ver=st.v;S.uid=st.me.uid;S.canEdit=!!st.me.isAdmin;S.authEmail=st.me.email;
    if(!S.reg.email)S.reg.email=S.authEmail;
    if(st.me.suggest&&!S.reg.name)S.reg.name=st.me.suggest;
    S.bookings=st.bookings||{};S.mine=st.mine||{};S.noshows=st.noshows||{};S.releases=st.releases||{};S.transfers=st.transfers||{};S.members=st.members||{};
    S.member=st.member;S.memberLoaded=true;
    var pChanged=JSON.stringify(st.profile)!==JSON.stringify(S.profile)||!S.profileLoaded;
    S.profileLoaded=true;
    if(!S.regBusy&&!S.editing)S.profile=st.profile;
    S.db=true;S.ready=true;S.loaded=true;
    if(S.out)return;
    if(first||(pChanged&&!S.editing)){render();S.wasBlocked=isBlocked(S.uid)+'|'+canBook();return}
    renderTabs();renderNotice();
    if(needReg()||S.editing)return;
    var ae=document.activeElement;
    if(S.tab!=='book'&&ae&&/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)&&$('#main').contains(ae)){S.dirty=true;return}
    var bl=isBlocked(S.uid)+'|'+canBook();
    partial();
    if(bl!==S.wasBlocked&&$('#side'))renderSide();
    S.wasBlocked=bl;
  }
  var pollTimer=null;
  function poll(){
    clearTimeout(pollTimer);
    pollTimer=setTimeout(async function(){
      if(S.uid&&!document.hidden){try{await refresh()}catch(e){}}
      if(S.uid)poll();
    },10000);
  }
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&S.uid)refresh().catch(function(){})});
  document.addEventListener('focusout',function(){if(S.dirty){setTimeout(function(){var ae=document.activeElement;if(S.dirty&&!(ae&&/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))){S.dirty=false;if(!needReg())renderList()}},150)}});

  var NOW=new Date();
  var TODAY=new Date(NOW.getFullYear(),NOW.getMonth(),NOW.getDate());
  var MAXD=parse(PERIODS[PERIODS.length-1][1]); /* סוף שנת הלימודים: אפשר להזמין עד התאריך הזה */
  var CLOSED={};
  CLOSED_RANGES.forEach(function(r){
    for(var t=parse(r[0]),e=parse(r[1]);t<=e;t=new Date(t.getFullYear(),t.getMonth(),t.getDate()+1))CLOSED[ds(t)]=r[2];
  });
  function closeOf(d){return SHORT_DAYS[d]||CLOSE}
  /* סיבת חסימה של תאריך, או מחרוזת ריקה אם אפשר להזמין */
  function blockedReason(d){
    var dt=parse(d);
    if(dt<TODAY)return 'עבר';
    if(dt>MAXD)return 'אחרי סיום שנת הלימודים';
    if(dt.getDay()>=5)return 'סוף שבוע';
    if(CLOSED[d])return CLOSED[d];
    for(var i=0;i<PERIODS.length;i++){if(d>=PERIODS[i][0]&&d<=PERIODS[i][1])return ''}
    if(d<PERIODS[0][0])return 'לפני פתיחת שנת הלימודים';
    if(d>PERIODS[PERIODS.length-1][1])return 'אחרי סיום שנת הלימודים';
    return 'חופשת סמסטר';
  }

  /* ===== State ===== */
  var S={
    tab:'book',studios:[STUDIOS[0].id],date:null,start:null,dur:1,anchor:null,msg:'',
    month:new Date(TODAY.getFullYear(),TODAY.getMonth(),1),
    step:'slots',err:'',busy:false,done:null,confirmCancel:null,
    ver:0,polls:0,loaded:false,flash:'',bookings:{},mine:{},noshows:{},releases:{},admins:{},transfers:{},members:{},member:null,memberLoaded:false,confirmRemove:null,transferFor:null,tfEmail:'',tfErr:'',tfMsg:'',db:null,confirmRelease:null,uid:null,canEdit:false,ready:false,out:store('yb_out')==='1',
    profile:null,profileLoaded:false,editing:false,regErr:'',regBusy:false,confirmDelete:false,
    reg:{name:'',year:'',email:'',agree:false},
    form:{purpose:'',people:1,notes:''}
  };
  function needReg(){return S.ready&&S.db&&S.uid&&S.profileLoaded&&(!S.profile||S.editing)}

  /* ===== Availability ===== */
  function isTaken(st,d,h){return !!S.bookings[key(st,d,h)]}
  function isPast(d,h){return new Date(parse(d).getTime()+h*3600000)<=new Date()}
  function slotOK(st,d,h,dur){
    if(isPast(d,h))return false;
    if(blockedReason(d))return false;
    for(var i=0;i<dur;i++){ if(h+i>=closeOf(d)||isTaken(st,d,h+i))return false }
    return true;
  }
  /* שעות ביום לסטודנט נספרות פעם אחת גם אם הוזמנו כמה עמדות במקביל */
  function myHoursOn(d){
    var seen={},n=0,k;
    for(k in S.bookings){var b=S.bookings[k]; if(b.uid===S.uid&&b.date===d&&!seen[b.hour]){seen[b.hour]=1;n++}}
    return n;
  }
  function selStudios(){return S.studios.map(function(id){return studioOf(id)}).filter(Boolean)}
  function namesOf(ids){return (ids||[]).map(function(id){var t=studioOf(id);return t?t.name:id}).join(', ')}
  /* ----- שליחת פרטי ההזמנה לנייד (פתיחת אפליקציית ההודעות או וואטסאפ עם נוסח מוכן) ----- */
  /* ----- העברת מקום לסטודנט אחר ----- */
  function myEmail(){return String((S.profile&&S.profile.email)||'').toLowerCase()}
  function incoming(){
    var em=myEmail(),out=[],g;
    if(!em)return out;
    for(g in S.transfers){var t=S.transfers[g];
      if(t&&t.status==='pending'&&t.toEmail===em&&t.fromUid!==S.uid&&parse(t.date).getTime()+t.from*3600000>Date.now())out.push(t)}
    return out;
  }
  function tfSummary(t){return namesOf(t.studios)+' · '+hh(t.from)+'–'+hh(t.to)+' · '+fmtLong(parse(t.date))}
  async function sendTransfer(gid){
    var g=groups(S.mine).filter(function(x){return x.gid===gid&&x.uid===S.uid})[0];
    if(!g||!S.profile)return;
    var em=String(S.tfEmail||'').trim().toLowerCase();
    if(!EMAIL_RE.test(em)){S.tfErr='נא להזין מייל ארגוני בסיומת @'+EMAIL_DOMAIN+'.';return renderList()}
    if(em===myEmail()){S.tfErr='אי אפשר להעביר את המקום לעצמך.';return renderList()}
    try{
      await api('POST','/api/transfers',{gid:gid,toEmail:em});
      S.transferFor=null;S.tfEmail='';S.tfErr='';S.tfMsg='הבקשה נשלחה. המקום יעבור כשהסטודנט/ית יאשרו אותה.';
      await forceRefresh();
    }catch(e){S.tfErr=e.message}
    renderList();
  }
  async function dropTransfer(gid,status){
    try{
      if(status==='declined')await api('POST','/api/transfers/'+gid+'/decline');
      else if(!status)await api('DELETE','/api/transfers/'+gid);
      await forceRefresh();
    }catch(e){S.tfMsg=e.message;renderList()}
  }
  async function acceptTransfer(gid){
    var t=S.transfers[gid];
    S.tfMsg='';
    if(!t||t.status!=='pending'||t.toEmail!==myEmail())return;
    try{
      await api('POST','/api/transfers/'+gid+'/accept');
      S.tfMsg='המקום עבר אליך. ההזמנה מופיעה בהזמנות הקרובות שלך.';
    }catch(e){S.tfMsg=e.message}
    await forceRefresh();
    renderList();renderNotice();
  }
  function incomingHTML(){
    var l=incoming(),h='';
    if(S.tfMsg)h+='<div class="banner" style="grid-column:1/-1" role="status">'+esc(S.tfMsg)+'</div>';
    if(!l.length)return h;
    return h+l.map(function(t){
      return '<div class="card item tfin" style="grid-column:1/-1"><div><h3>'+esc(t.fromName||'סטודנט/ית')+' מעביר/ה אליך מקום באולפן</h3><p>'+esc(tfSummary(t))+'</p><p class="lbl">אישור יעביר את ההזמנה על שמך, והיא תחשב במכסה ובאחריות שלך.</p></div><div class="acts"><button class="btn" data-act="tf-accept" data-g="'+esc(t.gid)+'">אישור קבלת המקום</button><button class="btn ghost" data-act="tf-decline" data-g="'+esc(t.gid)+'">דחייה</button></div></div>'}).join('');
  }
  /* ----- אי הגעה, חסימה ומנהלים ----- */
  function admKey(em){return String(em||'').toLowerCase().replace(/@/g,'_at_').replace(/\./g,'_')}
  function isAdminEmail(em){em=String(em||'').toLowerCase();return ADMINS.some(function(a){return a.email===em})}
  function isAdmin(){
    if(S.canEdit)return true;
    return false;
    var em=S.profile&&S.profile.email;
    if(!em||!isAdminEmail(em))return false;
    var c=S.admins[admKey(em)];
    return !!(c&&c.uid===S.uid);
  }
  function strikes(uid){
    var r=S.releases[uid],since=r?r.at:0,n=0,g;
    for(g in S.noshows){var x=S.noshows[g];if(x&&x.uid===uid&&(x.endAt||0)>since)n++}
    return n;
  }
  function isBlocked(uid){return !!uid&&strikes(uid)>=MAX_STRIKES}
  /* ----- אישור מנהל לפני הזמנה ----- */
  function canBook(){return isAdmin()||!!(S.member&&S.member.status==='approved')}
  function pendingMembers(){return Object.keys(S.members).map(function(k){return S.members[k]}).filter(function(m){return m&&m.status==='pending'})}
  function pendingHTML(){
    var rem=S.member&&S.member.status==='removed',rej=rem||(S.member&&S.member.status==='rejected');
    return '<div class="blocked" role="status"><h3>'+(rem?'הגישה להזמנת אולפנים הוסרה':rej?'ההרשמה לא אושרה':'ההרשמה ממתינה לאישור מנהל')+'</h3><p>'+(rem?'מנהל הסיר את הגישה שלך להזמנת אולפנים. לבירור פנו למנהלי המערכת:':rej?'הבקשה שלך להזמנת אולפנים לא אושרה. לבירור פנו למנהלי המערכת:':'פרטיך התקבלו. אפשר יהיה להזמין אולפנים אחרי שמנהל יאשר את ההרשמה. אפשר לעיין בזמינות בינתיים. למנהלי המערכת:')+'</p><p>'+adminsLine()+'</p></div>';
  }
  async function decideMember(uid,status){
    if(!isAdmin())return;
    try{await api('POST','/api/admin/members/'+uid+'/status',{status:status});await forceRefresh()}catch(e){flash(e.message)}
  }
  async function removeMember(uid){
    if(!isAdmin())return;
    S.confirmRemove=null;
    try{await api('POST','/api/admin/members/'+uid+'/remove',{});await forceRefresh()}catch(e){flash(e.message)}
    renderList();
  }
  function membersHTML(){
    var l=Object.keys(S.members).map(function(k){return S.members[k]}).filter(Boolean);
    var order={pending:0,approved:1,rejected:2,removed:3};
    l.sort(function(a,b){var pa=order[a.status||'pending'],pb=order[b.status||'pending'];return pa-pb||String(a.name||'').localeCompare(String(b.name||''),'he')});
    var h='<h3>משתמשים רשומים ('+l.length+')</h3>';
    if(!l.length)return h+'<div class="card empty"><p style="margin:0">עדיין אין נרשמים. משתמש מופיע כאן אחרי הכניסה הראשונה שלו למערכת.</p></div>';
    var tag={pending:'ממתין לאישור',approved:'מאושר',rejected:'לא אושר',removed:'הוסר'};
    return h+'<div class="list">'+l.map(function(m){
      var u=esc(m.uid),st=m.status||'pending',acts='';
      if(S.confirmPurge===m.uid)acts='<button class="btn danger" data-act="mem-del-yes" data-u="'+u+'">כן, למחוק לגמרי</button><button class="btn ghost" data-act="mem-del-no">ביטול</button>';
      else if(S.confirmRemove===m.uid)acts='<button class="btn danger" data-act="mem-rm-yes" data-u="'+u+'">כן, להסיר</button><button class="btn ghost" data-act="mem-rm-no">ביטול</button>';
      else{
        if(st==='pending')acts='<button class="btn" data-act="mem-ok" data-u="'+u+'">אישור</button><button class="btn ghost" data-act="mem-no" data-u="'+u+'">דחייה</button>';
        else if(st==='approved')acts='<button class="btn ghost" data-act="mem-no" data-u="'+u+'">ביטול אישור</button>';
        else if(st==='removed')acts='<button class="btn ghost" data-act="mem-ok" data-u="'+u+'">שחזור ואישור</button>';
        else acts='<button class="btn ghost" data-act="mem-ok" data-u="'+u+'">אישור</button>';
        if((st==='removed'||st==='rejected')&&!isAdminEmail(m.email))acts+='<button class="btn ghost" data-act="mem-del" data-u="'+u+'">מחיקה</button>';
        if(st!=='removed'&&!isAdminEmail(m.email))acts+='<button class="btn ghost" data-act="mem-rm" data-u="'+u+'">הסרה</button>';
      }
      return '<div class="card item"><div><h3>'+esc(m.name||'')+' · <span class="'+(st==='pending'||st==='removed'?'tag-bl':'lbl')+'">'+tag[st]+'</span></h3><p>'+esc(m.email||'')+(m.role?' · '+esc(m.role):'')+'</p>'+(S.confirmRemove===m.uid?'<p class="lbl tfnote">ההסרה חוסמת הזמנות ומבטלת את כל ההזמנות העתידיות של '+esc(m.name||'המשתמש')+'.</p>':'')+'</div><div class="acts">'+acts+'</div></div>'}).join('')+'</div>';
  }

  function adminsLine(){return ADMINS.map(function(a){return esc(a.name)+' ('+esc(a.email)+')'}).join(', ')}
  /* שעה פנויה רק אם כל העמדות שנבחרו פנויות בה */
  function slotFree(d,h){return S.studios.every(function(id){return slotOK(id,d,h,1)})}
  function takenAny(d,h){return S.studios.some(function(id){return isTaken(id,d,h)})}
  function dayState(d){
    if(blockedReason(d))return 'off';
    for(var h=OPEN;h<closeOf(d);h++){ if(slotFree(d,h))return 'free' }
    return 'full';
  }
  function ensureDate(){
    if(S.date&&dayState(S.date)==='free')return;
    S.date=null;
    for(var t=new Date(TODAY);t<=MAXD;t=new Date(t.getTime()+86400000)){
      var d=ds(t); if(dayState(d)==='free'){S.date=d;S.month=new Date(t.getFullYear(),t.getMonth(),1);return}
    }
  }
  function maxDur(){
    var left=MAX_DAY-myHoursOn(S.date||'');
    return Math.max(0,Math.min(4,left));
  }
  function groups(src,past){
    var g={},k;src=src||S.bookings;
    for(k in src){
      var b=src[k];
      var x=g[b.gid]||(g[b.gid]={gid:b.gid,studios:[],date:b.date,from:99,to:0,uid:b.uid,name:b.name,purpose:b.purpose,people:b.people,notes:b.notes,keys:[]});
      x.from=Math.min(x.from,b.hour); x.to=Math.max(x.to,b.hour+1); x.keys.push(k);
      if(x.studios.indexOf(b.studio)<0)x.studios.push(b.studio);
    }
    var out=Object.keys(g).map(function(i){return g[i]}).filter(function(x){var over=new Date(parse(x.date).getTime()+x.to*3600000)<=new Date();return past?over:!over});
    out.sort(function(a,b){var c=(a.date+pad(a.from)).localeCompare(b.date+pad(b.from));return past?-c:c});
    return out;
  }
  function avatarHTML(p,big){
    var c='avatar'+(big==='xl'?' xl':big?' lg':'');
    if(p&&p.photo)return '<span class="'+c+'"><img src="'+esc(p.photo)+'" alt=""></span>';
    return '<span class="'+c+'" aria-hidden="true">'+initial(p&&p.name)+'</span>';
  }
  function photoFrom(file){
    return new Promise(function(res,rej){
      var u=URL.createObjectURL(file),im=new Image();
      im.onload=function(){
        var n=Math.min(im.width,im.height),c=document.createElement('canvas');
        c.width=c.height=192;
        c.getContext('2d').drawImage(im,(im.width-n)/2,(im.height-n)/2,n,n,0,0,192,192);
        URL.revokeObjectURL(u);res(c.toDataURL('image/jpeg',0.82));
      };
      im.onerror=function(){URL.revokeObjectURL(u);rej(new Error('img'))};
      im.src=u;
    });
  }
  function initial(n){return esc((n||'?').trim().charAt(0))}

  /* ===== Rendering ===== */
  var chevR='<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>';
  var chevL='<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg>';

  function adminTab(){return isAdmin()}
  function renderTabs(){
    var t=[['book','הזמנה חדשה'],['mine','האזור שלי']];
    if(isAdmin()){var pc=pendingMembers().length;t.push(['all','ניהול'+(pc?' ('+pc+')':'')])}
    $('#tabs').innerHTML=t.map(function(x){return '<button class="tab" role="tab" data-act="tab" data-v="'+x[0]+'" aria-selected="'+(S.tab===x[0])+'">'+x[1]+'</button>'}).join('');
    $('#who').innerHTML=(S.profile?avatarHTML(S.profile)+'<span>'+esc(S.profile.name)+'</span>':'')+(S.uid?'<button class="btn ghost" data-act="logout">התנתקות</button>':'');
  }
  function renderNotice(){
    renderNotice0();
    var pc=pendingMembers().length;
    if(isAdmin()&&pc&&!S.out){var n2=$('#notice');if(n2)n2.insertAdjacentHTML('beforeend','<div class="banner" role="status" style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap"><span>'+(pc===1?'יש בקשת הרשמה אחת שממתינה':'יש '+pc+' בקשות הרשמה שממתינות')+' לאישור.</span><button class="btn" data-act="tab" data-v="all">לאישור</button></div>')}
  }
  function renderNotice0(){
    var n=$('#notice');
    if(S.flash){n.innerHTML='<div class="banner warn" role="alert">'+esc(S.flash)+'</div>';return}
    if(S.ready&&S.uid&&!S.db) n.innerHTML='<div class="banner warn">ההרשמה וההזמנה לא זמינות כרגע בדפדפן הזה. אפשר לעיין בזמינות בלבד. נסו לפתוח את הקישור שוב מחשבון מחובר.</div>';
    else{
      var c=incoming().length;
      n.innerHTML=c?'<div class="banner" role="status" style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap"><span>יש לך '+(c===1?'בקשה אחת':c+' בקשות')+' לקבלת מקום באולפן מסטודנט אחר.</span><button class="btn" data-act="tab" data-v="mine">לצפייה ואישור</button></div>':'';
    }
  }
  function renderInfo(){
    var sel=selStudios(),one=sel.length===1?sel[0]:null;
    return '<div class="col"><p class="eyebrow">אולפני החוג</p>'+
      '<div class="studios" role="group" aria-label="בחירת עמדות">'+
      STUDIOS.map(function(t){var on=S.studios.indexOf(t.id)>=0;return '<button class="studio" role="checkbox" data-act="studio" data-id="'+t.id+'" aria-checked="'+on+'"><span class="nm"><i class="bx" aria-hidden="true"></i>'+esc(t.name)+'</span><small>עד '+t.cap+'</small></button>'}).join('')+
      '</div><p class="hint">אפשר לבחור כמה עמדות, גם מהמפה. הן יוזמנו יחד באותן שעות.</p>'+
      '<div class="detail"><h2>'+(one?esc(one.name):'נבחרו '+sel.length+' עמדות')+'</h2>'+
      (one&&one.desc?'<p>'+esc(one.desc)+'</p>':'')+
      (one&&one.tags&&one.tags.length?'<ul class="tags">'+one.tags.map(function(t){return '<li>'+esc(t)+'</li>'}).join('')+'</ul>':'')+
      (one?'':'<ul class="tags">'+sel.map(function(t){return '<li>'+esc(t.name)+'</li>'}).join('')+'</ul>')+'</div>'+
      '<ul class="rules"><li>פעיל ימים א׳–ה׳, <span class="t">'+hh(OPEN)+'–'+hh(CLOSE)+'</span></li>'+
      '<li>הזמנה אפשרית בתקופות הלימודים לפי לוח השנה האקדמי תשפ״ז. אין הזמנות בחגים, בחופשות ובין הסמסטרים.</li>'+
      '<li>עד '+MAX_DAY+' שעות ביום לסטודנט</li>'+
      '<li>ביטול אפשר עד '+(CANCEL_LEAD_H===2?'שעתיים':CANCEL_LEAD_H+' שעות')+' לפני תחילת ההזמנה</li></ul></div>';
  }
  function renderCal(){
    var m=S.month,first=new Date(m.getFullYear(),m.getMonth(),1),n=new Date(m.getFullYear(),m.getMonth()+1,0).getDate();
    var prevOK=first>new Date(TODAY.getFullYear(),TODAY.getMonth(),1);
    var nextOK=new Date(m.getFullYear(),m.getMonth()+1,1)<=MAXD;
    var cells=DOW.map(function(d){return '<div class="dow">'+d+'</div>'}).join('');
    for(var i=0;i<first.getDay();i++)cells+='<div></div>';
    var why=[];
    for(var d=1;d<=n;d++){
      var s=ds(new Date(m.getFullYear(),m.getMonth(),d)),st=dayState(s),rs=blockedReason(s);
      var cls='day '+st+(s===ds(TODAY)?' today':'');
      var hint=st==='full'?'מלא':((rs&&rs!=='עבר'&&rs!=='סוף שבוע'&&rs!=='אחרי סיום שנת הלימודים')?rs:'');
      if(hint&&hint!=='מלא'&&why.indexOf(hint)<0)why.push(hint);
      cells+='<button class="'+cls+'" data-act="day" data-d="'+s+'" aria-pressed="'+(s===S.date)+'"'+(st==='free'?'':' disabled')+(hint?' title="'+esc(hint)+'"':'')+' aria-label="'+esc(fmtLong(parse(s)))+(hint?', '+esc(hint):'')+'">'+d+'</button>';
    }
    return '<div class="col"><div class="calhead"><h2>'+fmtMonth(m)+'</h2><div class="nav">'+
      '<button data-act="month" data-v="-1" aria-label="החודש הקודם"'+(prevOK?'':' disabled')+'>'+chevR+'</button>'+
      '<button data-act="month" data-v="1" aria-label="החודש הבא"'+(nextOK?'':' disabled')+'>'+chevL+'</button></div></div>'+
      '<div class="grid">'+cells+'</div>'+
      (why.length?'<p class="note">אי אפשר להזמין בחודש הזה: '+why.map(esc).join(', ')+'.</p>':'')+
      '<div class="legend"><span><i style="background:var(--accent-soft);outline:1px solid var(--accent)"></i>יש שעות פנויות</span><span><i style="background:var(--taken)"></i>מלא, חג, חופשה או סוף שבוע</span></div>'+miniPlan()+'</div>';
  }
  function blockedHTML(){
    return '<div class="blocked" role="alert"><h3>ההזמנה חסומה עבורך</h3><p>נרשמו לך '+MAX_STRIKES+' אי-הגעות להזמנות אולפן, ולכן המערכת לא מאפשרת לך להזמין שוב. שחרור החסימה נעשה רק על ידי מנהלי המערכת:</p><p>'+adminsLine()+'</p></div>';
  }
  function renderSide(){
    var el=$('#side'); if(!el)return;
    if(S.step==='done'){el.innerHTML=sideDone();return}
    if(S.uid&&S.profile&&S.memberLoaded&&!canBook()){el.innerHTML=pendingHTML();return}
    if(isBlocked(S.uid)){el.innerHTML=blockedHTML();return}
    if(S.step==='form'){el.innerHTML=sideForm();return}
    el.innerHTML=sideSlots();
  }
  function rangeOK(start,dur){
    if(start==null||dur<1||dur>maxDur())return false;
    for(var i=0;i<dur;i++){ if(!slotFree(S.date,start+i))return false }
    return true;
  }
  function sideSlots(){
    if(!S.date)return '<h3>אין תאריך פנוי</h3><p class="lbl">לא נמצאו שעות פנויות באולפן הזה עד סוף שנת הלימודים.</p>';
    var md=maxDur(),html='<h3>'+esc(fmtLong(parse(S.date)))+'</h3>';
    if(md===0) return html+'<p class="err">הגעת למכסה של '+MAX_DAY+' שעות ליום הזה. אפשר לבחור תאריך אחר.</p>';
    if(S.start!=null&&!rangeOK(S.start,S.dur)){S.start=null;S.anchor=null}
    var sel=S.start!=null;
    html+='<div class="tip"><b>בחירת כמה שעות ברצף</b>'+
      '<span>במחשב: לחצו על השעה הראשונה, החזיקו <kbd>Shift</kbd> ולחצו על השעה האחרונה. כל השעות שביניהן ייבחרו. אפשר עד '+md+' שעות ביום הזה. בטלפון: גררו אצבע על השעות שרוצים, או לחצו על השעה הראשונה ואז על האחרונה. אפשר גם להוסיף שעות בכפתורי + ו־−.</span></div>';
    var rows='';
    for(var h=OPEN;h<closeOf(S.date);h++){
      var ok=slotFree(S.date,h),tk=takenAny(S.date,h);
      var inSel=sel&&h>=S.start&&h<S.start+S.dur;
      if(ok) rows+='<button class="slot" data-act="slot" data-h="'+h+'" aria-pressed="'+inSel+'">'+hh(h)+'</button>';
      else rows+='<button class="slot" disabled><span class="t">'+hh(h)+'</span>'+(tk?'<span>תפוס</span>':'')+'</button>';
    }
    html+='<div class="slots" id="slots">'+rows+'</div>';
    if(S.msg)html+='<p class="err" role="alert">'+esc(S.msg)+'</p>';
    if(sel){
      var canInc=S.dur<md&&slotFree(S.date,S.start+S.dur),canDec=S.dur>1;
      html+='<div class="sum"><span class="lbl">ההזמנה שלך</span><b>'+rng(S.start,S.start+S.dur)+'</b>'+
        '<div class="stepper" role="group" aria-label="משך ההזמנה"><button data-act="dec" aria-label="הסרת שעה"'+(canDec?'':' disabled')+'>−</button>'+
        '<span>'+S.dur+(S.dur===1?' שעה':' שעות')+'</span>'+
        '<button data-act="inc" aria-label="הוספת שעה"'+(canInc?'':' disabled')+'>+</button></div></div>'+
        '<button class="btn" data-act="next">המשך להזמנה</button>';
    }
    return html;
  }
  function sideForm(){
    var sel=selStudios(),cap=sel.reduce(function(a,t){return a+t.cap},0),f=S.form;
    return '<h3>פרטי ההזמנה</h3>'+
      '<div class="sum"><b>'+sel.map(function(t){return esc(t.name)}).join('<br>')+'</b><span>'+esc(fmtLong(parse(S.date)))+' · '+rng(S.start,S.start+S.dur)+'</span></div>'+
      (S.profile?'<div class="sum"><span class="lbl">מזמין/ה</span><b>'+esc(S.profile.name)+'</b></div>':'')+
      '<div class="field"><label class="lbl" for="f-purpose">מטרת השימוש</label><select id="f-purpose" data-f="purpose"><option value="">בחירה</option>'+PURPOSES.map(function(y){return '<option'+(f.purpose===y?' selected':'')+'>'+y+'</option>'}).join('')+'</select></div>'+
      '<div class="field"><label class="lbl" for="f-people">מספר משתתפים (עד '+cap+')</label><input id="f-people" type="number" min="1" max="'+cap+'" value="'+esc(f.people)+'" data-f="people"></div>'+
      '<div class="field"><label class="lbl" for="f-notes">ציוד או הערות לצוות</label><textarea id="f-notes" data-f="notes">'+esc(f.notes)+'</textarea></div>'+
      '<p class="pledge">סטודנטים יקרים, הזמנתכם מחייבת, באם אינכם יכולים להגיע, נא לבטל את הזמנת האולפן במועד המוקדם ביותר האפשרי, במידה ואי הגעה למרות ההזמנה תחזור על עצמה, המערכת לא תאפשר לכם להזמין שוב.</p>'+
      (S.err?'<p class="err" role="alert">'+esc(S.err)+'</p>':'')+
      '<button class="btn" data-act="submit"'+(S.busy||!S.db||!S.uid?' disabled':'')+'>'+(S.busy?'שומר…':'אישור הזמנה')+'</button>'+
      '<button class="btn ghost" data-act="back">חזרה לשעות</button>';
  }
  function sideDone(){
    var d=S.done;
    return '<div class="done"><div class="check"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 11.5l4 4 8-9"/></svg></div>'+
      '<h3>ההזמנה נשמרה</h3><div class="sum" style="width:100%"><b>'+d.studios.map(function(id){var t=studioOf(id);return esc(t?t.name:id)}).join('<br>')+'</b><span>'+esc(fmtLong(parse(d.date)))+'</span><span>'+rng(d.from,d.to)+'</span></div>'+
      '<button class="btn" data-act="more" style="width:100%">הזמנה נוספת</button>'+
      '<button class="btn ghost" data-act="tab" data-v="mine" style="width:100%">לאזור האישי</button></div>';
  }
  /* ----- מפת האולפנים: לחיצה על עמדה בוחרת אותה. גרסה קטנה בצד, גרסה גדולה בחלון קופץ ----- */
  var PLAN_STATIONS={bf1:[155,252,'1'],bf2:[367,252,'2'],bf3:[588,252,'3'],bf4:[358,640,'4'],bb1:[1188,284,'1'],bb2:[1188,609,'2']};
  function studioFull(id){
    if(!S.date)return false;
    for(var h=OPEN;h<closeOf(S.date);h++){ if(slotOK(id,S.date,h,1))return false }
    return true;
  }
  /* שם המזמין ליד העמדה בתאריך שנבחר (במפה הגדולה) */
  function stationLabel(id,p){
    if(!S.date)return '';
    var by={},order=[],k,b;
    for(k in S.bookings){b=S.bookings[k];if(b.studio!==id||b.date!==S.date)continue;
      var u=by[b.uid];if(!u){u=by[b.uid]={name:b.name||'',from:b.hour,to:b.hour+1};order.push(b.uid)}
      if(b.hour<u.from)u.from=b.hour;if(b.hour+1>u.to)u.to=b.hour+1}
    if(!order.length)return '';
    order.sort(function(a,c){return by[a].from-by[c].from});
    var first=by[order[0]],nm=first.name;
    if(nm.length>13)nm=nm.slice(0,12)+'…';
    var extra=order.length>1?' +'+(order.length-1):'';
    var tm=order.length>1?'':'\u2066'+hh(first.from)+'–'+hh(first.to)+'\u2069';
    var up=id==='bf4',y1=up?p[1]-57-40:p[1]+57+34;
    var y2=y1+32;
    return '<g class="lab" aria-hidden="true"><text class="nm" x="'+p[0]+'" y="'+y1+'">'+esc(nm)+extra+'</text>'+(tm?'<text class="tm" x="'+p[0]+'" y="'+y2+'">'+tm+'</text>':'')+'</g>';
  }
  function planSvg(mini){
    var g='';
    Object.keys(PLAN_STATIONS).forEach(function(id){
      var p=PLAN_STATIONS[id],st=studioOf(id);
      if(!st)return;
      var on=S.studios.indexOf(id)>=0,full=studioFull(id);
      g+='<g class="st'+(on?' on':'')+(full?' full':'')+'" role="button" tabindex="0" data-act="studio" data-id="'+id+'" aria-pressed="'+on+'" aria-label="'+esc(st.name)+(full?', אין שעות פנויות בתאריך שנבחר':'')+'">'+
        '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="57"/><text x="'+p[0]+'" y="'+p[1]+'">'+p[2]+'</text></g>';
      if(!mini)g+=stationLabel(id,p);
    });
    return '<svg class="pmap'+(mini?' mini':' big')+'" viewBox="0 '+(mini?'-24 1418 824':'0 1418 800')+'" role="group" aria-label="תרשים האולפנים השחורים והעמדות בהם" focusable="false">'+
      '<text class="ttl" x="386" y="52">אולפן שחור קדמי</text>'+
      '<text class="ttl" x="1103" y="52">אולפן שחור אחורי</text>'+
      '<path class="room" d="M44 116H728V551H468V745H44Z"/>'+
      '<path class="wall" d="M267 116V350M463 116V350"/>'+
      '<text class="ent" x="212" y="722">כניסה</text>'+
      '<rect class="room" x="834" y="114" width="538" height="647"/>'+
      '<path class="wall" d="M1055 451H1372"/>'+g+'</svg>';
  }
  function miniPlan(){
    return '<div class="miniplan"><h3>מפת האולפנים</h3>'+planSvg(true)+
      '<button class="btn ghost" data-act="plan-open" aria-haspopup="dialog">הגדלת המפה</button></div>';
  }
  function refreshPlan(){var pl=document.querySelector('.miniplan');if(pl)pl.outerHTML=miniPlan()}
  var planOpener=null;
  function planModalHTML(){
    var names=namesOf(S.studios);
    return '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="pm-h">'+
      '<div class="modal-head"><h2 id="pm-h">מפת האולפנים</h2><button class="btn ghost" id="pm-x" data-act="plan-close">סיום</button></div>'+
      (S.date?'<p class="plan-note">שמות המזמינים מוצגים לתאריך: <b>'+esc(fmtLong(parse(S.date)))+'</b></p>':'')+
      '<p class="scrollhint">אפשר לגלול הצידה כדי לראות את כל המפה</p>'+planSvg(false)+
      '<p class="plan-note">לחצו על עמדות כדי לבחור כמה במקביל (עד '+MAX_STATIONS+'). נבחרו: <b>'+esc(Array.isArray(names)?names.join(' · '):names)+'</b></p>'+
      '<div class="legend"><span><i style="background:var(--ink)"></i>עמדה</span><span><i style="background:var(--accent);outline:2px solid var(--ink)"></i>עמדה שנבחרה</span><span><i style="background:var(--muted);opacity:.6"></i>אין שעות פנויות בתאריך</span></div></div>';
  }
  function openPlan(opener){
    var m=$('#modal');if(!m)return;
    planOpener=opener||null;
    m.innerHTML=planModalHTML();
    m.hidden=false;
    var x=$('#pm-x');if(x)x.focus();
  }
  function refreshModal(focusId){
    var m=$('#modal');if(!m||m.hidden)return;
    var c=m.querySelector('.modal-card'),top=c?c.scrollTop:0,lf=c?c.scrollLeft:0;
    m.innerHTML=planModalHTML();
    c=m.querySelector('.modal-card');if(c){c.scrollTop=top;c.scrollLeft=lf}
    var el=focusId&&m.querySelector('.st[data-id="'+focusId+'"]');
    if(el&&el.focus)el.focus();
  }
  function closePlan(noFocus){
    var m=$('#modal');if(!m||m.hidden)return;
    m.hidden=true;m.innerHTML='';
    if(!noFocus&&planOpener&&planOpener.focus&&document.contains(planOpener))planOpener.focus();
    planOpener=null;
  }
  function renderBook(){
    ensureDate();
    $('#main').innerHTML='<div class="card booker">'+renderInfo()+renderCal()+'<div class="col side" id="side"></div></div>';
    renderSide();
  }
  function toSide(){
    if(!window.matchMedia||!window.matchMedia('(max-width:900px)').matches)return;
    var el=$('#side');if(el&&el.scrollIntoView)setTimeout(function(){el.scrollIntoView({behavior:'smooth',block:'start'})},60);
  }
  function partial(){
    if(S.out)return;
    if(S.tab!=='book'){renderList();return}
    var cal=document.querySelectorAll('.booker>.col')[1];
    if(!cal)return;
    ensureDate();
    cal.outerHTML=renderCal();
    if(S.step==='slots')renderSide();
    refreshModal();
  }
  function itemHTML(g,all){
    var mine=g.uid===S.uid;
    var soon=(new Date(parse(g.date).getTime()+g.from*3600000)-new Date())<CANCEL_LEAD_H*3600000;
    var can=(mine&&!soon)||isAdmin();
    var act='';
    if(S.confirmCancel===g.gid) act='<button class="btn danger" data-act="cancel-yes" data-g="'+g.gid+'">כן, לבטל</button><button class="btn ghost" data-act="cancel-no">השארת ההזמנה</button>';
    else if(can) act='<button class="btn ghost" data-act="cancel" data-g="'+g.gid+'">ביטול</button>';
    var tfx='';
    if(mine&&!all&&S.confirmCancel!==g.gid){
      var tr=S.transfers[g.gid];
      if(tr&&tr.status==='pending'){
        tfx='<p class="lbl tfnote">ממתין לאישור של '+esc(tr.toEmail)+'</p>';
        act+='<button class="btn ghost" data-act="tf-cancel" data-g="'+g.gid+'">ביטול העברה</button>';
      }else if(!soon){
        if(tr&&tr.status==='declined')tfx='<p class="lbl tfnote">הבקשה ל-'+esc(tr.toEmail)+' נדחתה.</p>';
        if(S.transferFor===g.gid){
          tfx+='<div class="tfform"><label class="lbl" for="tf-email">מייל ארגוני של הסטודנט/ית שיקבלו את המקום</label><input id="tf-email" type="email" dir="ltr" data-t="tfEmail" placeholder="name@'+EMAIL_DOMAIN+'" value="'+esc(S.tfEmail)+'" style="text-align:right">'+(S.tfErr?'<p class="err" role="alert">'+esc(S.tfErr)+'</p>':'')+'<p class="lbl">המקום יעבור רק אחרי שהסטודנט/ית יאשרו אותו באזור האישי שלהם. עד אז ההזמנה נשארת שלך.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="tf-send" data-g="'+g.gid+'">שליחת בקשה</button><button class="btn ghost" data-act="tf-close">סגירה</button></div></div>';
        }else act+='<button class="btn ghost" data-act="tf-open" data-g="'+g.gid+'">העברת מקום</button>';
      }
    }
    if(!act&&mine) act='<span class="lbl">אי אפשר לבטל פחות מ-'+(CANCEL_LEAD_H===2?'שעתיים':CANCEL_LEAD_H+' שעות')+' לפני</span>';
    return '<div class="card item"><div><h3>'+esc(namesOf(g.studios))+' · '+rng(g.from,g.to)+'</h3><p>'+esc(fmtLong(parse(g.date)))+(all?' · '+esc(g.name||''):'')+' · '+esc(g.purpose||'')+(g.people?' · '+esc(g.people)+' משתתפים':'')+'</p>'+(g.notes?'<p>'+esc(g.notes)+'</p>':'')+''+tfx+'</div><div class="acts">'+act+'</div></div>';
  }

  async function purgeMember(uid){
    S.confirmPurge=null;
    if(!isAdmin())return render();
    try{await api('DELETE','/api/admin/members/'+uid);await forceRefresh()}catch(e){flash(e.message)}
    render();
  }
  var PH_EMAIL='photography@edu.jmc.ac.il';
  function lsG(k){try{return localStorage.getItem(k)}catch(e){return null}}
  function lsS(k,v){try{localStorage.setItem(k,v)}catch(e){}}
  function toolsHTML(){
    if(!isAdmin())return '';
    var last=Number(lsG('yb_lastExport')||0),due=!last||Date.now()-last>30*86400000;
    var h='<h3>דוחות וניקוי</h3><div class="card" style="display:flex;flex-direction:column;gap:12px">';
    h+='<p style="margin:0">'+(last?'הדוח האחרון הורד ב־'+new Date(last).toLocaleDateString('he-IL')+'.':'עדיין לא הורד דוח במכשיר הזה.')+(due?' <b>הגיע הזמן לדוח חודשי: הורידו אותו ושלחו אל '+PH_EMAIL+'.</b>':'')+'</p>';
    h+='<div class="acts"><button class="btn" data-act="export-xlsx">הורדת דוח Excel</button><a class="btn ghost" href="mailto:'+PH_EMAIL+'?subject='+encodeURIComponent('דוח חודשי: הזמנת אולפנים')+'&body='+encodeURIComponent('מצורף הדוח החודשי. (יש לצרף את קובץ ה־Excel שהורד.)')+'">פתיחת מייל אל '+PH_EMAIL+'</a></div>';
    h+='<p class="tfnote" style="margin:0">הדוח כולל שלוש לשוניות: משתמשים, הזמנות ואי-הגעות. הקובץ מצורף למייל ידנית.</p>';
    if(S.cleanStep==='ask')h+='<div class="banner" role="alert" style="padding:12px"><p style="margin:0 0 10px"><b>ניקוי סוף שנה:</b> יימחקו כל ההזמנות שהסתיימו, האי-הגעות, השחרורים ובקשות ההעברה. המשתמשים הרשומים וההזמנות העתידיות יישארו. לפני המחיקה יורד דוח Excel אוטומטית. אי אפשר לשחזר.</p><div class="acts"><button class="btn danger" data-act="clean-yes">כן, להוריד דוח ולנקות</button><button class="btn ghost" data-act="clean-no">ביטול</button></div></div>';
    else h+='<div class="acts"><button class="btn ghost" data-act="clean-ask"'+(S.cleanStep==='busy'?' disabled':'')+'>ניקוי סוף שנה</button><button class="btn ghost" data-act="audit-load">'+(S.audit?'רענון יומן פעולות':'הצגת יומן פעולות')+'</button></div>';
    if(S.cleanMsg)h+='<p role="status" style="margin:0"><b>'+esc(S.cleanMsg)+'</b></p>';
    if(S.audit)h+='<div class="card hist" style="max-height:320px;overflow:auto">'+(S.audit.length?S.audit.map(function(x){return '<div><span>'+esc(AUDIT_LBL[x.action]||x.action)+' · '+esc(x.actor_email||'')+(x.target?' → '+esc(x.target):'')+'</span><span>'+esc(new Date(x.at).toLocaleString('he-IL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}))+'</span></div>'}).join(''):'<div><span>אין פעולות ביומן.</span></div>')+'</div>';
    return h+'</div>';
  }
  function crc32(b){var t=crc32.t,c,k,n;if(!t){t=crc32.t=[];for(n=0;n<256;n++){c=n;for(k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}}var r=-1;for(n=0;n<b.length;n++)r=t[(r^b[n])&255]^(r>>>8);return(r^-1)>>>0}
  function zipStore(files){
    var enc=new TextEncoder(),parts=[],cd=[],off=0,cdSize=0;
    files.forEach(function(f){
      var nm=enc.encode(f.name),data=enc.encode(f.text),crc=crc32(data),sz=data.length;
      var lh=new DataView(new ArrayBuffer(30));
      lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);lh.setUint16(12,0x21,true);lh.setUint32(14,crc,true);lh.setUint32(18,sz,true);lh.setUint32(22,sz,true);lh.setUint16(26,nm.length,true);
      parts.push(new Uint8Array(lh.buffer),nm,data);
      var ch=new DataView(new ArrayBuffer(46));
      ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint16(14,0x21,true);ch.setUint32(16,crc,true);ch.setUint32(20,sz,true);ch.setUint32(24,sz,true);ch.setUint16(28,nm.length,true);ch.setUint32(42,off,true);
      cd.push(new Uint8Array(ch.buffer),nm);
      off+=30+nm.length+sz;cdSize+=46+nm.length;
    });
    var e=new DataView(new ArrayBuffer(22));
    e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,cdSize,true);e.setUint32(16,off,true);
    return new Blob(parts.concat(cd,[new Uint8Array(e.buffer)]),{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  function xesc(v){return String(v==null?'':v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
  function colL(i){var s='';i++;while(i>0){var m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26)}return s}
  function sheetXml(rows){
    var w=0;rows.forEach(function(r){if(r.length>w)w=r.length});
    var x='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="'+Math.max(w,1)+'" width="22" customWidth="1"/></cols><sheetData>';
    rows.forEach(function(r,i){
      x+='<row r="'+(i+1)+'">';
      r.forEach(function(v,j){x+='<c r="'+colL(j)+(i+1)+'" t="inlineStr"'+(i===0?' s="1"':'')+'><is><t xml:space="preserve">'+xesc(v)+'</t></is></c>'});
      x+='</row>';
    });
    return x+'</sheetData></worksheet>';
  }
  function buildXlsx(sheets){
    var n=sheets.length,i,ct='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    var wb='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
    var rel='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    var files=[];
    for(i=0;i<n;i++){
      ct+='<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      wb+='<sheet name="'+xesc(sheets[i].name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>';
      rel+='<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>';
      files.push({name:'xl/worksheets/sheet'+(i+1)+'.xml',text:sheetXml(sheets[i].rows)});
    }
    rel+='<Relationship Id="rId'+(n+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    ct+='</Types>';wb+='</sheets></workbook>';
    files.unshift({name:'[Content_Types].xml',text:ct},
      {name:'_rels/.rels',text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
      {name:'xl/workbook.xml',text:wb},{name:'xl/_rels/workbook.xml.rels',text:rel},
      {name:'xl/styles.xml',text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>'});
    return zipStore(files);
  }
  function dmy(s){var p=String(s||'').split('-');return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:String(s||'')}
  async function exportXlsx(){
    if(!isAdmin())return;
    var d;
    try{d=await api('GET','/api/admin/export')}catch(e){flash(e.message);return false}
    var tag={pending:'ממתין לאישור',approved:'מאושר',rejected:'לא אושר',removed:'הוסר'};
    var users=[['שם','מייל','תפקיד','סטטוס','תאריך הרשמה']];
    d.users.forEach(function(m){users.push([m.name||'',m.email||'',m.role||'',tag[m.status||'pending']||'',m.created_at?new Date(m.created_at).toLocaleDateString('he-IL'):''])});
    var bookings=[['תאריך','משעה','עד שעה','עמדות','שם','מייל','תפקיד','מטרה','משתתפים','הערות']];
    d.bookings.forEach(function(o){bookings.push([dmy(o.date),hh(o.lo),hh(o.hi+1),namesOf(String(o.st||'').split(',')),o.name||'',o.email||'',o.role||'',o.purpose||'',o.people==null?'':o.people,o.notes||''])});
    var nos=[['שם','מייל','תאריך הזמנה']];
    d.noshows.forEach(function(x){nos.push([x.name||'',x.email||'',x.end_at?new Date(x.end_at).toLocaleDateString('he-IL'):''])});
    var blob=buildXlsx([{name:'משתמשים',rows:users},{name:'הזמנות',rows:bookings},{name:'אי-הגעות',rows:nos}]);
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='studio-report-'+ds(new Date())+'.xlsx';document.body.appendChild(a);a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500);
    lsS('yb_lastExport',String(Date.now()));
    return true;
  }
  async function cleanYear(){
    if(!isAdmin())return;
    S.cleanStep='busy';S.cleanMsg='מוריד דוח ומנקה, נא להמתין…';render();
    try{
      var ok=await exportXlsx();
      if(!ok)throw new Error('export');
      var r=await api('POST','/api/admin/cleanup',{});
      S.cleanMsg='הניקוי הושלם: נמחקו '+r.deleted+' רשומות.';
      await forceRefresh();
    }catch(e){S.cleanMsg='הניקוי הופסק. אפשר לנסות שוב.'}
    S.cleanStep=null;render();
  }
  var AUDIT_LBL={login:'כניסה',register:'הרשמה',profile_delete:'מחיקת פרופיל',member_approved:'אישור משתמש',member_rejected:'דחיית משתמש',member_remove:'הסרת משתמש',member_purge:'מחיקת משתמש',noshow_mark:'סימון אי-הגעה',noshow_undo:'ביטול סימון אי-הגעה',release:'שחרור חסימה',export:'הורדת דוח',cleanup_year:'ניקוי סוף שנה',cancel_booking:'ביטול הזמנה של אחר',transfer_accept:'קבלת מקום'};
  async function loadAudit(){
    try{var r=await api('GET','/api/admin/audit');S.audit=r.items}catch(e){flash(e.message)}
    render();
  }
  function renderAdmin(){
    var h='<div class="admin">'+membersHTML()+toolsHTML();
    /* סטודנטים עם אי-הגעות */
    var by={},g;
    for(g in S.noshows){var x=S.noshows[g];if(!x||!x.uid)continue;var u=by[x.uid]||(by[x.uid]={uid:x.uid,name:x.name,email:x.email})}
    var rows=Object.keys(by).map(function(id){return {u:by[id],n:strikes(id)}}).filter(function(r){return r.n>0||S.releases[r.u.uid]}).sort(function(a,b){return b.n-a.n});
    h+='<h3>אי-הגעות וחסימות</h3>';
    var live=rows.filter(function(r){return r.n>0});
    if(!live.length)h+='<div class="card empty"><p style="margin:0">אין סטודנטים עם אי-הגעות פעילות.</p></div>';
    else h+='<div class="list">'+live.map(function(r){
      var bl=r.n>=MAX_STRIKES,ask=S.confirmRelease===r.u.uid;
      return '<div class="card item"><div><h3>'+esc(r.u.name||'')+(bl?' · <span class="tag-bl">חסום/ה</span>':'')+'</h3><p>'+esc(r.u.email||'')+' · '+r.n+' מתוך '+MAX_STRIKES+' אי-הגעות</p></div><div class="acts">'+
        (ask?'<button class="btn danger" data-act="release-yes" data-u="'+esc(r.u.uid)+'">כן, לשחרר ולאפס</button><button class="btn ghost" data-act="release-no">ביטול</button>'
            :'<button class="btn ghost" data-act="release-ask" data-u="'+esc(r.u.uid)+'">'+(bl?'שחרור חסימה':'איפוס אי-הגעות')+'</button>')+'</div></div>'}).join('')+'</div>';
    /* הזמנות שהסתיימו */
    var past=groups(null,true);
    h+='<h3>סימון אי-הגעה (הזמנות שהסתיימו ב-'+REVIEW_DAYS+' הימים האחרונים)</h3>';
    if(!past.length)h+='<div class="card empty"><p style="margin:0">אין הזמנות שהסתיימו לסימון.</p></div>';
    else h+='<div class="list">'+past.map(function(g){
      var m=S.noshows[g.gid];
      var act=m?'<span class="tag-bl">סומן: לא הגיע</span><button class="btn ghost" data-act="noshow-undo" data-g="'+g.gid+'">ביטול סימון</button>'
               :'<button class="btn ghost" data-act="noshow-mark" data-g="'+g.gid+'">סימון: לא הגיע</button>';
      return '<div class="card item"><div><h3>'+esc(namesOf(g.studios))+' · '+rng(g.from,g.to)+'</h3><p>'+esc(fmtLong(parse(g.date)))+' · '+esc(g.name||'')+'</p></div><div class="acts">'+act+'</div></div>'}).join('')+'</div>';
    /* הזמנות קרובות */
    var up=groups();
    h+='<h3>הזמנות קרובות</h3>';
    h+=up.length?'<div class="list">'+up.map(function(g){return itemHTML(g,true)}).join('')+'</div>':'<div class="card empty"><p style="margin:0">אין הזמנות קרובות באולפנים.</p></div>';
    $('#main').innerHTML=h+'</div>';
  }
  async function markNoShow(gid,on){
    if(!isAdmin())return;
    try{await api('POST','/api/admin/noshow',{gid:gid,on:!!on});await forceRefresh()}catch(e){flash(e.message)}
  }
  async function releaseUser(uid){
    if(!isAdmin())return;
    S.confirmRelease=null;
    try{await api('POST','/api/admin/release',{uid:uid});await forceRefresh()}catch(e){flash(e.message)}
    renderList();
  }
  function renderList(){
    if(needReg())return renderReg();
    if(S.tab==='mine')return renderMe();
    if(S.tab==='all'&&isAdmin())return renderAdmin();
    var list=groups();
    var html;
    if(!list.length) html='<div class="card empty"><p style="margin:0">אין הזמנות קרובות באולפנים.</p></div>';
    else html='<div class="list">'+list.map(function(g){return itemHTML(g,true)}).join('')+'</div>';
    $('#main').innerHTML=html;
  }

  /* ----- Registration and personal area ----- */
  function regHTML(){
    var r=S.reg,edit=!!S.profile;
    return '<div class="card reg"><div>'+
      '<h2>'+(edit?'עריכת פרטים אישיים':'ברוכים הבאים, נרשמים לפני ההזמנה הראשונה')+'</h2>'+
      '<p>'+(edit?'הפרטים נשמרים באזור האישי שלך בלבד.':'ההרשמה פתוחה לסטודנטים עם מייל ארגוני בסיומת @'+EMAIL_DOMAIN+'. הפרטים נשמרים באזור האישי שלך ומשמשים למילוי אוטומטי של כל הזמנה.')+'</p></div>'+
      '<div class="photo-row">'+avatarHTML({photo:r.photo,name:r.name},'xl')+'<div class="photo-btns"><button type="button" class="btn ghost" data-act="photo-pick">'+(r.photo?'החלפת תמונה':'העלאת תמונת פרופיל')+'</button>'+(r.photo?'<button type="button" class="btn ghost" data-act="photo-remove">הסרה</button>':'')+'<input type="file" id="r-photo" accept="image/*" data-photo="1" hidden><span class="lbl" style="flex-basis:100%">אפשר גם בלי תמונה. התמונה מוצגת רק לך.</span></div></div>'+
      '<div class="field"><label class="lbl" for="r-name">שם מלא</label><input id="r-name" autocomplete="name" data-r="name" value="'+esc(r.name)+'"></div>'+
      '<div class="row2"><div class="field"><label class="lbl" for="r-year">תפקיד</label><select id="r-year" data-r="year"><option value="">בחירה</option>'+YEARS.map(function(y){return '<option'+(r.year===y?' selected':'')+'>'+y+'</option>'}).join('')+'</select></div>'+
      '<div class="field"><label class="lbl" for="r-email">מייל ארגוני</label><input id="r-email" type="email" autocomplete="email" dir="ltr" data-r="email" placeholder="name@'+EMAIL_DOMAIN+'" value="'+esc(S.authEmail||r.email)+'"'+(S.authEmail?' readonly':'')+' style="text-align:right"></div></div>'+
      (edit?'':'<label class="chk"><input type="checkbox" id="r-agree" data-r="agree"'+(r.agree?' checked':'')+'><span>אני מתחייב/ת לשמור על ציוד האולפן, להגיע בזמן ולבטל הזמנה שאיני מממש/ת.</span></label>')+
      (S.regErr?'<p class="err" role="alert">'+esc(S.regErr)+'</p>':'')+
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="reg-save"'+(S.regBusy?' disabled':'')+'>'+(S.regBusy?'שומר…':(edit?'שמירה':'סיום הרשמה'))+'</button>'+
      (edit?'<button class="btn ghost" data-act="reg-cancel">ביטול</button>':'')+'</div></div>';
  }
  function renderReg(){
    $('#main').innerHTML=regHTML();
  }
  function renderMe(){
    var P=S.profile;
    if(!P){
      $('#main').innerHTML='<div class="card empty"><p style="margin:0">האזור האישי נפתח אחרי כניסה והרשמה.</p></div>';
      return;
    }
    var st=strikes(S.uid),banner=isBlocked(S.uid)?'<div class="banner warn" style="grid-column:1/-1">'+blockedHTML().replace(/<\/?div[^>]*>/g,'')+'</div>'
      :(st?'<div class="banner warn" style="grid-column:1/-1">נרשמו לך '+st+' מתוך '+MAX_STRIKES+' אי-הגעות. אחרי '+MAX_STRIKES+' תיחסם האפשרות להזמין אולפנים. אם אינך יכול להגיע, בטל את ההזמנה מראש.</div>':'');
    var up=groups(S.mine).filter(function(g){return g.uid===S.uid}),
        hist=groups(S.mine,true).slice(0,10),
        month=ds(TODAY).slice(0,7),mh=0,th=0,k;
    var seenH={};
    for(k in S.mine){var bk=S.mine[k],hid=bk.date+'_'+bk.hour;if(!seenH[hid]){seenH[hid]=1;th++;if(bk.date.slice(0,7)===month)mh++}}
    var upItems=up.length?'<div class="list">'+up.map(function(g){return itemHTML(g,false)}).join('')+'</div>'
      :'<div class="card empty"><p style="margin:0">אין לך הזמנות קרובות.</p><button class="btn" data-act="tab" data-v="book">להזמנת אולפן</button></div>';
    var histItems=hist.length?'<div class="card hist">'+hist.map(function(g){
      return '<div><span>'+esc(namesOf(g.studios))+' · '+rng(g.from,g.to)+'</span><span>'+esc(parse(g.date).toLocaleDateString('he-IL',{day:'numeric',month:'short'}))+'</span></div>'}).join('')+'</div>'
      :'<p class="lbl" style="margin:0">עוד אין היסטוריה. כל ההזמנות שהסתיימו יופיעו כאן.</p>';
    var del=S.confirmDelete?'<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn danger" data-act="del-yes">כן, למחוק את הפרופיל</button><button class="btn ghost" data-act="del-no">ביטול</button></div>'
      :'<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" data-act="reg-edit">עריכת פרטים</button><button class="btn ghost" data-act="del-ask">מחיקת פרופיל</button></div>';
    $('#main').innerHTML='<div class="me">'+incomingHTML()+banner+'<aside class="card profile"><div class="head">'+avatarHTML(P,true)+'<div><h2>'+esc(P.name)+'</h2><span class="lbl">'+esc(P.year||'')+'</span></div></div>'+
      '<dl class="kv"><dt>דוא״ל</dt><dd class="t">'+esc(P.email)+'</dd></dl>'+
      '<div class="stats"><div><b>'+up.length+'</b><span>הזמנות קרובות</span></div><div><b>'+mh+'</b><span>שעות החודש</span></div><div><b>'+th+'</b><span>סה״כ שעות</span></div></div>'+del+
      (S.confirmDelete?'<p class="lbl" style="margin:0">מחיקת הפרופיל מוחקת רק את הפרטים האישיים. הזמנות קיימות נשארות עד לביטול.</p>':'')+'</aside>'+
      '<div class="sect"><h3>הזמנות קרובות</h3>'+upItems+'<h3>היסטוריה</h3>'+histItems+'</div></div>';
  }
  /* ----- כניסה עם Google ----- */
  function renderLogin(){
    document.body.classList.add("lg");
    $('#tabs').innerHTML='';$('#who').innerHTML='';$('#notice').innerHTML='';
    var L=S.login||(S.login={busy:false,err:''});
    $('#main').innerHTML='<div class="card reg"><div><h2>כניסה להזמנת אולפנים</h2><p>הכניסה למערכת היא עם חשבון Google של המכללה, בסיומת @'+EMAIL_DOMAIN+'.</p></div>'+
      (L.err?'<p class="err" role="alert">'+esc(L.err)+'</p>':'')+
      (L.busy?'<p class="lbl">מתחבר…</p>':'<div id="g-btn" style="min-height:44px"></div>')+'</div>';
    if(!L.busy)mountGoogle();
  }
  var gTries=0,gInit=false;
  function mountGoogle(){
    var el=$('#g-btn');if(!el)return;
    if(!(window.google&&google.accounts&&google.accounts.id)){
      if(++gTries>60){el.innerHTML='<p class="err">לא הצלחנו לטעון את כניסת Google. בדקו את החיבור ורעננו את הדף.</p>';return}
      setTimeout(mountGoogle,250);return;
    }
    if(!gInit){google.accounts.id.initialize({client_id:CFG.clientId,callback:onGoogle,auto_select:false,cancel_on_tap_outside:true});gInit=true}
    google.accounts.id.renderButton(el,{theme:'filled_black',size:'large',text:'signin_with',shape:'rectangular',locale:'he',width:260});
  }
  async function onGoogle(resp){
    var L=S.login||(S.login={busy:false,err:''});
    L.busy=true;L.err='';renderLogin();
    try{
      await api('POST','/api/auth/google',{credential:resp&&resp.credential});
      location.reload();return;
    }catch(e){L.err=e.message||'הכניסה לא הצליחה.'}
    L.busy=false;renderLogin();
  }
  function renderOut(){
    $('#tabs').innerHTML='';$('#who').innerHTML='';$('#notice').innerHTML='';
    $('#main').innerHTML='<div class="card reg"><div><h2>התנתקת מהמערכת</h2>'+
      '<p>האזור האישי וההזמנות שלך הוסתרו בדפדפן הזה.</p></div>'+
      '<p class="lbl">ההתנתקות היא מהמערכת בלבד. הכניסה לחשבון Claude שבו נפתח הדף נשארת פעילה בדפדפן, ולכן במחשב משותף כדאי להתנתק גם ממנו.</p>'+
      '<div><button class="btn" data-act="login">כניסה מחדש</button></div></div>';
  }
  function logout(){
    closePlan(true);
    clearTimeout(pollTimer);
    var done=function(){location.reload()};
    try{if(window.google&&google.accounts&&google.accounts.id)google.accounts.id.disableAutoSelect()}catch(e){}
    api('POST','/api/auth/logout',{}).then(done,done);
  }
  function login(){S.out=false;store('yb_out','');render()}
  function render(){
    document.body.classList.remove("lg");
    if(S.out){renderOut();return}
    if(S.netErr){$('#tabs').innerHTML='';$('#who').innerHTML='';$('#notice').innerHTML='';$('#main').innerHTML='<div class="card reg"><div><h2>אין חיבור לשרת</h2><p>לא הצלחנו להתחבר למערכת. בדקו את האינטרנט ורעננו את הדף.</p></div><div><button class="btn" data-act="retry">ניסיון חוזר</button></div></div>';return}
    if(S.ready&&!S.uid){renderLogin();return}
    renderTabs(); renderNotice();
    if(needReg()){renderReg();return}
    if(S.tab==='book')renderBook(); else renderList();
  }

  /* ----- Profile storage ----- */
  async function saveProfile(){
    var r=S.reg,edit=!!S.profile;
    var name=(r.name||'').trim();
    if(!name){S.regErr='נא למלא שם מלא.';return renderReg()}
    if(!r.year){S.regErr='נא לבחור תפקיד.';return renderReg()}
    if(!edit&&!r.agree){S.regErr='כדי להירשם צריך לאשר את ההתחייבות.';return renderReg()}
    S.regErr='';S.regBusy=true;renderReg();
    try{
      await api('PUT','/api/profile',{name:name,year:r.year,photo:r.photo||'',agree:!!r.agree});
      S.regBusy=false;S.editing=false;
      await forceRefresh();
      render();
    }catch(e){
      S.regBusy=false;S.regErr=e.message||'השמירה לא הצליחה. נסו שוב בעוד רגע.';renderReg();
    }
  }

  /* ===== Booking logic ===== */
  async function submit(){
    var f=S.form,P=S.profile,sel=selStudios(),cap=sel.reduce(function(a,t){return a+t.cap},0);
    var people=parseInt(f.people,10);
    if(!P){S.err='כדי להזמין צריך להשלים הרשמה.';return renderSide()}
    if(isBlocked(S.uid)||!canBook())return renderSide();
    if(blockedReason(S.date)){S.err='אי אפשר להזמין בתאריך הזה ('+blockedReason(S.date)+').';return renderSide()}
    if(!f.purpose){S.err='נא לבחור מטרת שימוש.';return renderSide()}
    if(!(people>=1&&people<=cap)){S.err='מספר המשתתפים בהזמנה הזאת הוא בין 1 ל-'+cap+'.';return renderSide()}
    if(myHoursOn(S.date)+S.dur>MAX_DAY){S.err='ההזמנה חורגת ממכסה של '+MAX_DAY+' שעות ליום.';return renderSide()}
    S.err='';S.busy=true;renderSide();
    try{
      await api('POST','/api/bookings',{studios:S.studios.slice(),date:S.date,start:S.start,dur:S.dur,purpose:f.purpose,people:people,notes:(f.notes||'').slice(0,300)});
    }catch(e){
      S.busy=false;S.step='slots';S.start=null;S.anchor=null;S.err='';
      renderSide();
      $('#side').insertAdjacentHTML('afterbegin','<p class="err" role="alert">'+esc(e.message)+'</p>');
      forceRefresh();
      return;
    }
    S.busy=false;S.done={studios:S.studios.slice(),date:S.date,from:S.start,to:S.start+S.dur};
    S.step='done';S.start=null;
    renderSide();
    toSide();
    forceRefresh();
  }
  async function cancelGroup(gid){
    S.confirmCancel=null;
    try{await api('DELETE','/api/bookings/'+gid);await forceRefresh()}catch(e){flash(e.message)}
    renderList();
  }

  /* ===== Events ===== */
  document.addEventListener('click',function(e){
    var b=e.target.closest('[data-act]'); if(!b)return;
    var a=b.dataset.act;
    if(a==='tab'){S.tab=b.dataset.v;S.confirmCancel=null;if(S.tab==='book'&&S.step==='done'){S.step='slots'}render()}
    else if(a==='home'){closePlan(true);S.tab='book';S.confirmCancel=null;S.editing=false;S.regErr='';if(S.step==='done')S.step='slots';render();window.scrollTo(0,0)}
    else if(a==='noshow-mark'){markNoShow(b.dataset.g,true)}
    else if(a==='noshow-undo'){markNoShow(b.dataset.g,false)}
    else if(a==='release-ask'){S.confirmRelease=b.dataset.u;renderList()}
    else if(a==='release-no'){S.confirmRelease=null;renderList()}
    else if(a==='release-yes'){releaseUser(b.dataset.u)}
    else if(a==='tf-open'){S.transferFor=b.dataset.g;S.tfEmail='';S.tfErr='';S.tfMsg='';renderList()}
    else if(a==='tf-close'){S.transferFor=null;S.tfErr='';renderList()}
    else if(a==='tf-send'){sendTransfer(b.dataset.g)}
    else if(a==='tf-cancel'){dropTransfer(b.dataset.g,null)}
    else if(a==='tf-accept'){acceptTransfer(b.dataset.g)}
    else if(a==='tf-decline'){S.tfMsg='';dropTransfer(b.dataset.g,'declined')}
    else if(a==='photo-pick'){var fi=$('#r-photo');if(fi)fi.click()}
    else if(a==='photo-remove'){S.reg.photo='';renderReg()}
    else if(a==='retry'){location.reload()}
    else if(a==='audit-load'){loadAudit()}
    else if(a==='export-xlsx'){exportXlsx().then(render)}
    else if(a==='clean-ask'){S.cleanStep='ask';S.cleanMsg='';render()}
    else if(a==='clean-no'){S.cleanStep=null;render()}
    else if(a==='clean-yes'){cleanYear()}
    else if(a==='mem-del'){S.confirmPurge=b.dataset.u;render()}
    else if(a==='mem-del-no'){S.confirmPurge=null;render()}
    else if(a==='mem-del-yes'){purgeMember(b.dataset.u)}
    else if(a==='mem-ok'){decideMember(b.dataset.u,'approved')}
    else if(a==='mem-no'){decideMember(b.dataset.u,'rejected')}
    else if(a==='mem-rm'){S.confirmRemove=b.dataset.u;renderList()}
    else if(a==='mem-rm-no'){S.confirmRemove=null;renderList()}
    else if(a==='mem-rm-yes'){removeMember(b.dataset.u)}
    else if(a==='logout'){logout()}
    else if(a==='login'){login()}
    else if(a==='plan-open'){openPlan(b)}
    else if(a==='plan-close'){closePlan()}
    else if(a==='studio'){
      var sid=b.dataset.id,ix=S.studios.indexOf(sid);
      if(ix>=0){if(S.studios.length>1)S.studios.splice(ix,1)}
      else if(S.studios.length<MAX_STATIONS)S.studios.push(sid);
      S.start=null;S.anchor=null;S.msg='';S.step='slots';S.done=null;
      render();refreshModal(sid);
    }
    else if(a==='month'){S.month=new Date(S.month.getFullYear(),S.month.getMonth()+Number(b.dataset.v),1);document.querySelectorAll('.booker>.col')[1].outerHTML=renderCal()}
    else if(a==='day'){S.date=b.dataset.d;S.start=null;S.anchor=null;S.msg='';S.step='slots';S.done=null;partial();toSide()}
    else if(a==='inc'){if(S.start!=null&&S.dur<maxDur()&&slotFree(S.date,S.start+S.dur)){S.dur++;S.msg=''}renderSide()}
    else if(a==='dec'){if(S.dur>1){S.dur--;S.msg=''}renderSide()}
    else if(a==='slot'){
      var h=Number(b.dataset.h);
      var touch=window.matchMedia&&window.matchMedia('(pointer:coarse)').matches;
      if((e.shiftKey||(touch&&S.start!=null&&S.dur===1&&h!==S.start))&&S.anchor!=null){
        var lo=Math.min(S.anchor,h),n=Math.abs(h-S.anchor)+1;
        if(n>maxDur()){S.msg='אפשר לבחור עד '+maxDur()+' שעות ברצף ביום הזה.'}
        else if(!rangeOK(lo,n)){S.msg='בטווח שבחרתם יש שעה תפוסה או שהמכללה סגורה בה.'}
        else{S.start=lo;S.dur=n;S.msg=''}
      } else {S.anchor=h;S.start=h;S.dur=1;S.msg=''}
      renderSide();
      var sl=document.querySelector('.slot[data-h="'+h+'"]');if(sl)sl.focus({preventScroll:true});
    }
    else if(a==='next'){S.step='form';S.err='';renderSide();toSide()}
    else if(a==='back'){S.step='slots';renderSide()}
    else if(a==='submit'){submit()}
    else if(a==='more'){S.step='slots';S.done=null;S.start=null;S.anchor=null;S.msg='';partial()}
    else if(a==='cancel'){S.confirmCancel=b.dataset.g;renderList()}
    else if(a==='cancel-no'){S.confirmCancel=null;renderList()}
    else if(a==='cancel-yes'){cancelGroup(b.dataset.g)}
    else if(a==='reg-save'){saveProfile()}
    else if(a==='reg-edit'){var p=S.profile||{};S.reg={name:p.name||'',year:p.year||'',email:p.email||'',photo:p.photo||'',agree:true};S.editing=true;S.regErr='';render()}
    else if(a==='reg-cancel'){S.editing=false;S.regErr='';render()}
    else if(a==='del-ask'){S.confirmDelete=true;renderList()}
    else if(a==='del-no'){S.confirmDelete=false;renderList()}
    else if(a==='del-yes'){deleteProfile()}
  });
  function onField(e){
    var t=e.target,d=t.dataset||{};
    if(d.photo){
      if(e.type==='change'&&t.files&&t.files[0]){
        photoFrom(t.files[0]).then(function(url){S.reg.photo=url;S.regErr='';renderReg()},function(){S.regErr='אי אפשר לקרוא את הקובץ הזה. נסו תמונה אחרת (JPG או PNG).';renderReg()});
      }
      return;
    }
    if(d.f)S.form[d.f]=t.value;
    if(d.t)S[d.t]=t.value;
    if(d.r)S.reg[d.r]=t.type==='checkbox'?t.checked:t.value;
  }
  /* גרירה באצבע לבחירת שעות ברצף (מסכי מגע) */
  (function(){
    var drag=null,swallow=0;
    function slotAt(t){var el=document.elementFromPoint(t.clientX,t.clientY);return el&&el.closest?el.closest('.slot'):null}
    document.addEventListener('touchstart',function(e){
      var sl=e.target.closest&&e.target.closest('.slot');
      if(!sl||e.touches.length!==1){drag=null;return}
      drag={h0:Number(sl.dataset.h),last:Number(sl.dataset.h),moved:false};
    },{passive:true});
    document.addEventListener('touchmove',function(e){
      if(!drag)return;
      var sl=slotAt(e.touches[0]);if(!sl)return;
      var h=Number(sl.dataset.h);if(h===drag.last)return;
      var lo=Math.min(drag.h0,h),n=Math.abs(h-drag.h0)+1;
      if(n>maxDur()||!rangeOK(lo,n))return;
      drag.last=h;drag.moved=true;S.anchor=drag.h0;S.start=lo;S.dur=n;S.msg='';renderSide();
    },{passive:true});
    document.addEventListener('touchend',function(){if(drag&&drag.moved)swallow=Date.now()+500;drag=null},{passive:true});
    document.addEventListener('click',function(e){
      if(swallow>Date.now()&&e.target.closest&&e.target.closest('.slot')){e.stopPropagation();e.preventDefault();swallow=0}
    },true);
  })();
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape')closePlan();
    if((e.key==='Enter'||e.key===' ')&&e.target.classList&&e.target.classList.contains('st')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}))}
  });
  document.addEventListener('click',function(e){var m=$('#modal');if(m&&!m.hidden&&e.target===m)closePlan()});
  document.addEventListener('mousedown',function(e){if(e.shiftKey&&e.target.closest&&e.target.closest('.slot'))e.preventDefault()});
  document.addEventListener('input',onField);
  document.addEventListener('change',onField);
  async function deleteProfile(){
    S.confirmDelete=false;
    try{await api('DELETE','/api/profile');S.profile=null;S.reg={name:'',year:'',email:S.authEmail||'',agree:false};S.tab='book';await forceRefresh()}catch(e){flash(e.message)}
    render();
  }

  /* ===== Startup ===== */
  render();
  (async function(){
    try{
      var r=await fetch('/api/state',{credentials:'same-origin'});
      if(r.status===401){S.ready=true;S.uid=null;render();return}
      if(!r.ok)throw new Error('state');
      applyState(await r.json());
      poll();
    }catch(e){S.ready=true;S.netErr=true;render()}
  })();
})();
