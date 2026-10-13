
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
  var YEARS=CFG.years, PURPOSES=CFG.purposes, STUDY_YEARS=CFG.studyYears||[];

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
    S.listRole=st.me.listRole||'';if(S.listRole)S.reg.year=S.listRole;
    S.bookings=st.bookings||{};S.mine=st.mine||{};S.noshows=st.noshows||{};S.releases=st.releases||{};S.transfers=st.transfers||{};S.members=st.members||{};S.people=st.people||{};
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
    form:{purpose:'',people:1,notes:'',part:[],studyYear:''}
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
    if(!EMAIL_RE.test(em)){S.tfErr='נא להזין מייל ארגוני בסיומת \u2066@'+EMAIL_DOMAIN+'.\u2069';return renderList()}
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
      return '<div class="card item"><div><h3>'+esc(m.name||'')+' · <span class="'+(st==='pending'||st==='removed'?'tag-bl':'lbl')+'">'+tag[st]+'</span></h3><p>'+esc(m.email||'')+(m.role?' · '+roleChip(m.role):'')+'</p>'+(S.confirmRemove===m.uid?'<p class="lbl tfnote">ההסרה חוסמת הזמנות ומבטלת את כל ההזמנות העתידיות של '+esc(m.name||'המשתמש')+'.</p>':'')+'</div><div class="acts">'+acts+'</div></div>'}).join('')+'</div>';
  }

  function adminsLine(){return ADMINS.map(function(a){return esc(a.name)+' ('+esc(a.email)+')'}).join(', ')}
  /* שעה פנויה רק אם כל העמדות שנבחרו פנויות בה */
  function slotFree(d,h){return S.studios.every(function(id){return slotOK(id,d,h,1)})}
  function coordNote(d,h){for(var i=0;i<S.studios.length;i++){var b=S.bookings[key(S.studios[i],d,h)];if(b&&b.name&&b.name.indexOf('תיאום עם')===0)return b.name}return ''}
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
      var x=g[b.gid]||(g[b.gid]={gid:b.gid,studios:[],date:b.date,from:99,to:0,uid:b.uid,name:b.name,purpose:b.purpose,people:b.people,notes:b.notes,studyYear:b.studyYear||'',keys:[]});
      x.from=Math.min(x.from,b.hour); x.to=Math.max(x.to,b.hour+1); x.keys.push(k);
      if(x.studios.indexOf(b.studio)<0)x.studios.push(b.studio);
    }
    var out=Object.keys(g).map(function(i){return g[i]}).filter(function(x){var over=new Date(parse(x.date).getTime()+x.to*3600000)<=new Date();return past?over:!over});
    out.sort(function(a,b){var c=(a.date+pad(a.from)).localeCompare(b.date+pad(b.from));return past?-c:c});
    return out;
  }
  var ROLE_KEYS={'סטודנט':'s','מרצה':'l','מתרגל':'t','מדריך':'i','אורח':'g'};
  function roleChip(r){var k=ROLE_KEYS[r];return r?'<span class="role'+(k?' r-'+k:'')+'">'+esc(r)+'</span>':''}
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
    if(isAdmin()){var pc=pendingMembers().length;t.push(['all','ניהול'+(pc?' ('+pc+')':'')]);t.push(['stats','סטטיסטיקה'])}
    $('#tabs').innerHTML=t.map(function(x){return '<button class="tab" role="tab" data-act="tab" data-v="'+x[0]+'" aria-selected="'+(S.tab===x[0])+'">'+x[1]+'</button>'}).join('');
    $('#who').innerHTML=(S.profile?avatarHTML(S.profile)+'<span>'+esc(S.profile.name)+'</span>':'')+(S.uid?'<a class="btn ghost" href="/api/guide" target="_blank" rel="noopener">מדריך</a><a class="btn ghost" href="/api/guide?dl=1" download>הורדת מדריך</a><button class="btn ghost" data-act="logout">התנתקות</button>':'');
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
      STUDIOS.map(function(t){var on=S.studios.indexOf(t.id)>=0;return '<button class="studio" role="checkbox" data-act="studio" data-id="'+t.id+'" aria-checked="'+on+'"><span class="nm"><i class="bx" aria-hidden="true"></i>'+esc(t.name)+'</span></button>'}).join('')+
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
      else rows+='<button class="slot" disabled><span class="t">'+hh(h)+'</span>'+(tk?'<span'+(coordNote(S.date,h)?' style="font-size:.8em;color:#ff4d4d;font-weight:700"':'')+'>'+(coordNote(S.date,h)||'תפוס')+'</span>':'')+'</button>';
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
  /* שנת לימוד: חובה לסטודנטים בלבד */
  function needsYear(){return !!(S.profile&&S.profile.year==='סטודנט')}
  function yearMsg(){return needsYear()&&STUDY_YEARS.indexOf(S.form.studyYear)<0?'נא לבחור שנת לימוד.':''}
  function lastStudyYear(){
    var best=null,k;for(k in S.mine){var b=S.mine[k];if(b&&b.studyYear&&(!best||b.createdAt>best.createdAt))best=b}
    return best?best.studyYear:'';
  }
  function yearHTML(){
    if(!needsYear())return '';
    var f=S.form;
    return '<div class="field"><label class="lbl" for="f-year">שנת לימוד (חובה)</label><select id="f-year" data-f="studyYear"><option value="">בחירה</option>'+STUDY_YEARS.map(function(y){return '<option'+(f.studyYear===y?' selected':'')+'>'+esc(y)+'</option>'}).join('')+'</select></div>';
  }
  function partHTML(cap){
    var f=S.form,part=f.part||[];
    if(!S.dir&&!S.dirBusy){S.dirBusy=true;api('GET','/api/people').then(function(r){S.dir=r.items||[];S.dirAt=Date.now();S.dirBusy=false;if(S.step==='form')renderSide()},function(){S.dir=[];S.dirBusy=false})}
    var chosen={};part.forEach(function(x){chosen[x.uid]=1});
    var opts=(S.dir||[]).filter(function(x){return !chosen[x.uid]});
    var solo=!!f.solo&&!part.length&&parseInt(f.people,10)===1;
    var h='<div class="field"><label class="lbl" for="f-part">משתתפים איתי בעמדה (חובה)</label>';
    if(solo)h+='<div class="chips" style="display:flex;flex-wrap:wrap;gap:6px"><span class="chip" style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:4px 6px 4px 10px;background:var(--surface)">אני עובד.ת לבד<button type="button" class="btn ghost" data-act="solo-off" aria-label="ביטול" style="padding:0 8px;min-height:24px;line-height:1">×</button></span></div>';
    else if(!S.dir)h+='<p class="tfnote" style="margin:0">טוען רשימת שמות…</p>';
    else if(part.length+1>=cap)h+='<p class="tfnote" style="margin:0">הגעתם למספר המשתתפים המרבי בהזמנה.</p>';
    else h+='<select id="f-part"><option value="">הוספת שם מהרשימה…</option>'+(part.length?'':'<option value="__solo">אני עובד.ת לבד</option>')+opts.map(function(x){return '<option value="'+esc(x.uid)+'">'+esc(x.name)+(x.role&&x.role!=='סטודנט'?' ('+esc(x.role)+')':'')+'</option>'}).join('')+'</select>';
    if(part.length)h+='<div class="chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">'+part.map(function(x){return '<span class="chip" style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:4px 6px 4px 10px;background:var(--surface)">'+esc(x.name)+'<button type="button" class="btn ghost" data-act="part-rm" data-u="'+esc(x.uid)+'" aria-label="הסרת '+esc(x.name)+'" style="padding:0 8px;min-height:24px;line-height:1">×</button></span>'}).join('')+'</div>';
    var pm=partMsg();
    if(pm)h+='<p class="err" style="margin:6px 0 0" id="part-msg">'+esc(pm)+'</p>';
    return h+'</div>';
  }
  /* חובה: לציין לבד או עם אחרים, והמספר חייב להתאים לשמות שנבחרו */
  function partState(){
    var f=S.form,part=f.part||[],people=parseInt(f.people,10);
    var solo=!!f.solo&&!part.length&&people===1;
    return {solo:solo,part:part,people:people};
  }
  function partMsg(){
    var s=partState();
    if(!s.solo&&!s.part.length)return 'יש לציין אם אתם עובדים לבד: בחרו "אני עובד.ת לבד", או הוסיפו את שמות המשתתפים.';
    if(!(s.people>=1))return 'יש להזין את מספר המשתתפים.';
    if(!s.solo&&s.people!==s.part.length+1)return 'מספר המשתתפים ('+s.people+') חייב להתאים לשמות שנבחרו: '+s.part.length+' נוספים ואתם, '+(s.part.length+1)+' בסך הכול.';
    return '';
  }
  function sideForm(){
    var sel=selStudios(),cap=sel.reduce(function(a,t){return a+t.cap},0),f=S.form;
    return '<h3>פרטי ההזמנה</h3>'+
      '<div class="sum"><b>'+sel.map(function(t){return esc(t.name)}).join('<br>')+'</b><span>'+esc(fmtLong(parse(S.date)))+' · '+rng(S.start,S.start+S.dur)+'</span></div>'+
      (S.profile?'<div class="sum"><span class="lbl">מזמין/ה</span><b>'+esc(S.profile.name)+'</b></div>':'')+
      '<div class="field"><label class="lbl" for="f-purpose">מטרת השימוש</label><select id="f-purpose" data-f="purpose"><option value="">בחירה</option>'+PURPOSES.map(function(y){return '<option'+(f.purpose===y?' selected':'')+'>'+y+'</option>'}).join('')+'</select></div>'+
      yearHTML()+
      '<div class="field"><label class="lbl" for="f-people">מספר משתתפים (עד '+cap+')</label><input id="f-people" type="number" min="1" max="'+cap+'" value="'+esc(f.people)+'" data-f="people"></div>'+
      partHTML(cap)+
      '<div class="field"><label class="lbl" for="f-notes">ציוד או הערות לצוות</label><textarea id="f-notes" data-f="notes">'+esc(f.notes)+'</textarea></div>'+
      '<p class="pledge">סטודנטים יקרים, הזמנתכם מחייבת, באם אינכם יכולים להגיע, נא לבטל את הזמנת האולפן במועד המוקדם ביותר האפשרי, במידה ואי הגעה למרות ההזמנה תחזור על עצמה, המערכת לא תאפשר לכם להזמין שוב.</p>'+
      (S.err?'<p class="err" role="alert">'+esc(S.err)+'</p>':'')+
      '<button class="btn" data-act="submit"'+(S.busy||!S.db||!S.uid||partMsg()||yearMsg()?' disabled':'')+'>'+(S.busy?'שומר…':'אישור הזמנה')+'</button>'+
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
  var PLAN_STATIONS={bf1:[155,205,'1'],bf2:[367,205,'2'],bf3:[596,205,'3'],bf4:[542,833,'4'],bf5:[1221,252,'5'],bb1:[1221,671,'1'],bb2:[1221,997,'2']};
  function studioFull(id){
    if(!S.date)return false;
    for(var h=OPEN;h<closeOf(S.date);h++){ if(slotOK(id,S.date,h,1))return false }
    return true;
  }
  /* שם המזמין ליד העמדה בתאריך שנבחר (במפה הגדולה) */
  function stationLabel(id,p){
    if(!S.date)return '';
    var gs={},k,b,x;
    for(k in S.bookings){b=S.bookings[k];if(b.studio!==id||b.date!==S.date)continue;
      x=gs[b.gid]||(gs[b.gid]={sys:b.uid==='sys-classes',name:b.name||'',role:b.year||'',from:b.hour,to:b.hour+1});
      if(b.hour<x.from)x.from=b.hour;if(b.hour+1>x.to)x.to=b.hour+1}
    var all=Object.keys(gs).map(function(i){return gs[i]});
    if(!all.length)return '';
    var real=all.filter(function(g){return !g.sys}).sort(function(a,c){return a.from-c.from}),
        cls=all.filter(function(g){return g.sys}).sort(function(a,c){return a.from-c.from}),
        list=real.length?real:cls,first=list[0],nm;
    if(real.length)nm=first.name;
    else nm=first.name.indexOf('תיאום עם')===0?'תיאום עם ירדן':'שיעור';
    var lim=(window.matchMedia&&window.matchMedia('(max-width:900px)').matches)?9:13;
    if(nm.length>lim)nm=nm.slice(0,lim-1)+'…';
    var extra=list.length>1?' +'+(list.length-1):'';
    var tm=list.length>1?'':'\u2066'+hh(first.from)+'–'+hh(first.to)+'\u2069';
    if(!real.length){extra='';tm=''}
    var up=id==='bf4'||id==='bb2',y1=up?p[1]-57-40:p[1]+57+34;
    var y2=y1+32;
    return '<g class="lab" aria-hidden="true"><text class="nm'+(real.length&&ROLE_KEYS[first.role]?' rc-'+ROLE_KEYS[first.role]:'')+'" x="'+p[0]+'" y="'+y1+'">'+esc(nm)+extra+'</text>'+(tm?'<text class="tm" x="'+p[0]+'" y="'+y2+'">'+tm+'</text>':'')+'</g>';
  }
  function planSvg(mini){
    var g='';
    Object.keys(PLAN_STATIONS).forEach(function(id){
      var p=PLAN_STATIONS[id],st=studioOf(id);
      if(!st)return;
      var on=S.studios.indexOf(id)>=0,full=studioFull(id);
      g+='<g class="st'+(on?' on':'')+(full?' full':'')+'" role="button" tabindex="0" data-act="'+(mini?'plan-open':'studio')+'" data-id="'+id+'" aria-pressed="'+on+'" aria-label="'+esc(st.name)+(full?', אין שעות פנויות בתאריך שנבחר':'')+'">'+
        '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="57"/><text x="'+p[0]+'" y="'+p[1]+'">'+p[2]+'</text></g>';
      if(!mini)g+=stationLabel(id,p);
    });
    return '<svg class="pmap'+(mini?' mini':' big')+'"'+(mini?' data-act="plan-open" style="cursor:pointer"':'')+' viewBox="0 '+(mini?'0 1418 1227':'0 1418 1227')+'" role="group" aria-label="תרשים האולפנים השחורים והעמדות בהם" focusable="false">'+
      '<path class="room" d="M20 100H1398V1190H757V968H20Z"/>'+
      '<path class="wall" d="M267 114V350M463 114V350M1016 839H1333"/>'+
      '<path class="wall k" d="M757 551V1190M957 551H1398M20 968H145M351 968H757M351 815V968"/>'+
      '<text class="ttl" x="513" y="476">אולפן שחור קדמי</text>'+
      '<text class="ttl back" x="1015" y="1110">אולפן שחור אחורי</text>'+
      '<text class="ent" x="248" y="1040">כניסה</text>'+g+'</svg>';
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
      (S.date?'<p class="plan-note">מצב ההזמנות לתאריך: <b>'+esc(fmtLong(parse(S.date)))+'</b>'+(S.date!==ds(TODAY)?' (היום הראשון שאפשר להזמין בו)':'')+'</p>':'')+
      '<p class="scrollhint">אפשר לגלול הצידה כדי לראות את כל המפה</p>'+'<div class="planrow"><div class="roleidx" aria-label="אינדקס סוגי מזמינים"><b>סוג המזמין</b>'+Object.keys(ROLE_KEYS).map(function(r){return '<span><i class="rc-bg-'+ROLE_KEYS[r]+'"></i>'+r+'</span>'}).join('')+'</div><div class="plancol">'+planSvg(false)+'</div></div>'+
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
    return '<div class="card item"><div><h3>'+esc(namesOf(g.studios))+' · '+rng(g.from,g.to)+'</h3><p>'+esc(fmtLong(parse(g.date)))+(all?' · '+esc(g.name||''):'')+' · '+esc(g.purpose||'')+(g.studyYear?' · '+esc(g.studyYear):'')+(g.people?' · '+esc(g.people)+' משתתפים':'')+'</p>'+(S.people&&S.people[g.gid]?'<p>משתתפים: '+esc(S.people[g.gid].join(', '))+'</p>':'')+(g.notes?'<p>'+esc(g.notes)+'</p>':'')+''+tfx+'</div><div class="acts">'+act+'</div></div>';
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
  function allowHTML(){
    var h='<h3>רשימת אישור אוטומטי</h3><div class="card" style="display:flex;flex-direction:column;gap:12px">';
    h+='<p style="margin:0">מי שהמייל שלו ברשימה מאושר מיד כשהוא נרשם. מי שלא ברשימה ממתין לאישור ידני. '+(S.alCount==null?'':'כרגע ברשימה: <b>'+S.alCount+'</b> כתובות.')+'</p>';
    var by=S.alBy||{},bl=Object.keys(by).map(function(r){return roleChip(r)+' '+by[r]}).join(' · ');
    if(bl)h+='<p style="margin:0">'+bl+'</p>';
    h+='<div class="field"><label class="lbl" for="al-role">תפקיד לכתובות שמודבקות עכשיו (קובע גם את הצבע שלהם במפה)</label><select id="al-role" data-t="alRole">'+YEARS.map(function(y){return '<option'+((S.alRole||'סטודנט')===y?' selected':'')+'>'+y+'</option>'}).join('')+'</select></div>';
    h+='<div class="field"><label class="lbl" for="al-text">הדביקו שורה לכל אדם: שם מלא ומייל (למשל: דנה כהן dana@edu.jmc.ac.il). אפשר גם מייל בלבד</label><textarea id="al-text" data-t="alText" dir="ltr" rows="5" placeholder="שם מלא   name@edu.jmc.ac.il">'+esc(S.alText||'')+'</textarea></div>';
    if(S.alMsg)h+='<p style="margin:0" role="status"><b>'+esc(S.alMsg)+'</b></p>';
    h+='<div class="acts"><button class="btn" data-act="al-add"'+(S.alWork?' disabled':'')+'>הוספה לרשימה</button><button class="btn ghost" data-act="al-show" aria-expanded="'+(!!S.alShow)+'">'+(S.alShow?'הסתרת רשימת האנשים':'הצגת רשימת האנשים')+'</button>';
    if(S.alClear)h+='<button class="btn danger" data-act="al-clear-yes">כן, לנקות את הרשימה</button><button class="btn ghost" data-act="al-clear-no">ביטול</button>';
    else if(S.alCount)h+='<button class="btn ghost" data-act="al-clear-ask">ניקוי הרשימה</button>';
    h+='</div>';
    if(S.alShow)h+='<div class="field"><label class="lbl" for="al-q">חיפוש ברשימה</label><input id="al-q" dir="ltr" style="text-align:right" placeholder="שם או מייל" value="'+esc(S.alQ||'')+'"></div><div id="al-list">'+alListHTML()+'</div>';
    h+='<p class="tfnote" style="margin:0">הסרה מהרשימה וניקוי הרשימה לא מבטלים אישורים שכבר ניתנו. נרשמים שממתינים ומופיעים ברשימה מאושרים מיד בהוספה.</p></div>';
    return h;
  }
  function alListHTML(){
    if(!S.alItems)return '<p style="margin:0">טוען…</p>';
    var q=(S.alQ||'').trim().toLowerCase();
    var it=S.alItems.filter(function(x){return !q||x.email.indexOf(q)>=0||(x.name||'').toLowerCase().indexOf(q)>=0});
    if(!it.length)return '<div class="card empty"><p style="margin:0">'+(S.alItems.length?'אין תוצאות לחיפוש.':'הרשימה ריקה.')+'</p></div>';
    var cap=it.length>300;
    return '<p class="tfnote" style="margin:0 0 6px">מוצגים '+Math.min(it.length,300)+' מתוך '+it.length+(cap?' (צמצמו בחיפוש)':'')+'</p><div class="list" style="max-height:420px;overflow:auto">'+it.slice(0,300).map(function(x){
      var ask=S.alDel===x.email;
      return '<div class="card item"><div>'+(S.alEdit===x.email?'<input id="al-nm" maxlength="60" aria-label="שם מלא" value="'+esc(S.alEditVal||'')+'" style="margin-bottom:6px">':'<h3 class="'+(x.status==='approved'?'al-ok':'al-no')+'">'+(x.name?esc(x.name):'(בלי שם)')+'</h3>')+'<p><bdi dir="ltr">'+esc(x.email)+'</bdi> · '+(x.status?(x.status==='approved'?'רשום/ה ומאושר/ת':x.status==='pending'?'רשום/ה וממתין/ה':x.status==='rejected'?'נדחה':'הוסר/ה'):'עוד לא נרשם/ה')+'</p></div><div class="acts">'+
        '<select class="al-rolesel" data-em="'+esc(x.email)+'" aria-label="תפקיד">'+YEARS.map(function(y){return '<option'+(x.role===y?' selected':'')+'>'+y+'</option>'}).join('')+'</select>'+
        (S.alEdit===x.email?'<button class="btn" data-act="al-nm-save" data-em="'+esc(x.email)+'">שמירה</button><button class="btn ghost" data-act="al-nm-cancel">ביטול</button>':'<button class="btn ghost" data-act="al-nm-edit" data-em="'+esc(x.email)+'" data-nm="'+esc(x.name||'')+'">עריכת שם</button>')+
        (ask?'<button class="btn danger" data-act="al-del-yes" data-em="'+esc(x.email)+'">כן, להסיר</button><button class="btn ghost" data-act="al-del-no">ביטול</button>':'<button class="btn ghost" data-act="al-del" data-em="'+esc(x.email)+'">הסרה</button>')+'</div></div>'}).join('')+'</div>';
  }
  async function alLoadList(){
    try{var r=await api('GET','/api/admin/allowlist/list');S.alItems=r.items}catch(e){S.alItems=[];flash(e.message)}
    if(S.tab==='all')renderAdmin();
  }
  async function alSetRole(em,role){
    try{await api('POST','/api/admin/allowlist/role',{email:em,role:role});S.alMsg='התפקיד של '+em+' עודכן ל'+role+'.';S.alBy=null;S.alCount=null;S.alItems=null;await forceRefresh()}catch(e){S.alMsg=e.message||'שגיאה'}
    if(S.alShow)alLoadList();renderAdmin();
  }
  async function alSaveName(em){
    var nm=(S.alEditVal||'').trim();
    try{await api('POST','/api/admin/allowlist/name',{email:em,name:nm});S.alEdit=null;S.alMsg='השם עודכן.';S.alItems=null;await forceRefresh()}catch(e){S.alMsg=e.message||'שגיאה'}
    if(S.alShow)alLoadList();renderAdmin();
  }
  async function alDel(em){
    S.alDel=null;
    try{await api('POST','/api/admin/allowlist/remove',{email:em});S.alMsg='הכתובת הוסרה מהרשימה. אישור שכבר ניתן נשאר בתוקף.';S.alBy=null;S.alCount=null;S.alItems=null}catch(e){S.alMsg=e.message||'שגיאה'}
    if(S.alShow)alLoadList();renderAdmin();
  }
  async function alAdd(){
    S.alWork=true;S.alMsg='';renderAdmin();
    try{
      var r=await api('POST','/api/admin/allowlist',{text:S.alText||'',role:S.alRole||'סטודנט'});
      S.alCount=r.count;S.alText='';S.alBy=null;S.alCount=null;
      S.alMsg='נוספו '+r.added+' כתובות בתפקיד '+(S.alRole||'סטודנט')+(r.approvedNow?', ואושרו '+r.approvedNow+' נרשמים שהמתינו':'')+(r.invalid.length?'. לא תקינות והתעלמנו: '+r.invalid.join(', '):'')+'.';
      S.alItems=null;if(S.alShow)alLoadList();
      await forceRefresh();
    }catch(e){S.alMsg=e.message||'שגיאה'}
    S.alWork=false;if(S.tab==='all')renderAdmin();
  }
  async function alClear(){
    S.alClear=false;
    try{var r=await api('POST','/api/admin/allowlist/clear',{});S.alCount=0;S.alBy={};S.alMsg='הרשימה נוקתה.'}catch(e){S.alMsg=e.message||'שגיאה'}
    renderAdmin();
  }
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
      r.forEach(function(v,j){x+=(typeof v==='number'&&isFinite(v)&&i>0)?'<c r="'+colL(j)+(i+1)+'"><v>'+v+'</v></c>':'<c r="'+colL(j)+(i+1)+'" t="inlineStr"'+(i===0?' s="1"':'')+'><is><t xml:space="preserve">'+xesc(v)+'</t></is></c>'});
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
  /* ===== סטטיסטיקה ===== */
  function stInit(){if(!S.st)S.st={q:'',purpose:'',role:'',from:'',to:'',view:'people',sk:'total',sd:-1,data:null,busy:false,err:''}}
  function stQuery(detail){
    var s=S.st,p=[];
    if(s.q)p.push('q='+encodeURIComponent(s.q));
    if(s.purpose)p.push('purpose='+encodeURIComponent(s.purpose));
    if(s.role)p.push('role='+encodeURIComponent(s.role));
    if(s.year)p.push('year='+encodeURIComponent(s.year));
    if(s.from)p.push('from='+s.from);
    if(s.to)p.push('to='+s.to);
    if(detail)p.push('detail=1');
    return p.length?'?'+p.join('&'):'';
  }
  var stTimer=null,stSeq=0;
  function stLoad(){
    stInit();var my=++stSeq;S.st.busy=true;S.st.err='';stRes();
    return api('GET','/api/admin/stats'+stQuery(false)).then(function(r){if(my!==stSeq)return;S.st.data=r;S.st.busy=false;stRes()},function(e){if(my!==stSeq)return;S.st.busy=false;S.st.err=e.message||'שגיאה';stRes()});
  }
  /* תקופות: כל השנה = מתחילת סמסטר א' ועד סוף התקופה האחרונה; הנתונים נספרים רק עד היום */
  function stPeriod(k){
    var P=PERIODS,today=ds(new Date()),r=null;
    if(k==='year')r=[P[0][0],P[P.length-1][1]];
    else if(k==='sem1')r=P[0];
    else if(k==='sem2')r=P[1];
    if(!r)return null;
    return [r[0],r[1]<today?r[1]:today];
  }
  function stPeopleOpts(q){
    var list=Object.keys(S.members||{}).map(function(k){return S.members[k]}).filter(function(m){return m&&m.name&&m.status!=='removed'}).sort(function(a,b){return String(a.name).localeCompare(String(b.name),'he')});
    return list.map(function(m){return '<option value="'+esc(m.email)+'"'+(q&&q.toLowerCase()===String(m.email).toLowerCase()?' selected':'')+'>'+esc(m.name)+'</option>'}).join('');
  }
  function renderStats(){
    stInit();var s=S.st;
    var h='<div class="admin"><h3>סטטיסטיקה: כמה כל אחד היה פעיל באולפנים</h3><div class="card" style="display:flex;flex-direction:column;gap:12px;padding:16px">'+
      '<p class="tfnote" style="margin:0">הנתונים כוללים הזמנות שהתקיימו (עד התאריך שנבחר, ברירת מחדל: היום). המזמין והמשתתפים שנבחרו איתו נספרים. ניקוי סוף שנה מוחק את הנתונים, לכן יש להוריד אקסל לפני כן.</p>'+
      '<div class="row2"><div class="field"><label class="lbl" for="st-q">חיפוש לפי שם או מייל</label><input id="st-q" placeholder="חיפוש" value="'+esc(s.q)+'"></div>'+
      '<div class="field"><label class="lbl" for="st-person">בחירת אדם מהרשימה</label><select id="st-person"><option value="">כל הרשומים</option>'+stPeopleOpts(s.q)+'</select></div></div>'+
      '<div class="row2"><div class="field"><label class="lbl" for="st-purpose">סוג פעילות</label><select id="st-purpose"><option value="">הכול</option>'+PURPOSES.map(function(y){return '<option'+(s.purpose===y?' selected':'')+'>'+esc(y)+'</option>'}).join('')+'</select></div>'+
      '<div class="field"><label class="lbl" for="st-role">תפקיד</label><select id="st-role"><option value="">הכול</option>'+YEARS.map(function(y){return '<option'+(s.role===y?' selected':'')+'>'+esc(y)+'</option>'}).join('')+'</select></div></div>'+
      '<div class="row2"><div class="field"><label class="lbl" for="st-period">תקופה</label><select id="st-period"><option value=""'+(s.period?'':' selected')+'>כל התקופה / תאריכים לבחירה</option><option value="year"'+(s.period==='year'?' selected':'')+'>כל השנה</option><option value="sem1"'+(s.period==='sem1'?' selected':'')+'>סמסטר א\'</option><option value="sem2"'+(s.period==='sem2'?' selected':'')+'>סמסטר ב\'</option></select></div>'+
      '<div class="field"><label class="lbl" for="st-year">שנת לימוד</label><select id="st-year"><option value="">הכול</option>'+STUDY_YEARS.map(function(y){return '<option'+(s.year===y?' selected':'')+'>'+esc(y)+'</option>'}).join('')+'</select></div></div>'+
      '<div class="row2"><div class="field"><label class="lbl" for="st-from">מתאריך</label><input id="st-from" type="date" value="'+esc(s.from)+'" dir="ltr" style="text-align:right"></div>'+
      '<div class="field"><label class="lbl" for="st-to">עד תאריך (ריק: עד היום)</label><input id="st-to" type="date" value="'+esc(s.to)+'" dir="ltr" style="text-align:right"></div></div>'+
      '<div class="acts"><button class="btn'+(s.view==='people'?'':' ghost')+'" data-act="st-view" data-v="people" aria-pressed="'+(s.view==='people')+'">לפי אנשים</button><button class="btn'+(s.view==='purposes'?'':' ghost')+'" data-act="st-view" data-v="purposes" aria-pressed="'+(s.view==='purposes')+'">לפי סוג פעילות</button><button class="btn'+(s.view==='years'?'':' ghost')+'" data-act="st-view" data-v="years" aria-pressed="'+(s.view==='years')+'">לפי שנת לימוד</button><button class="btn ghost" data-act="st-reset">איפוס סינון</button><button class="btn ghost" data-act="st-export"'+(s.exporting?' disabled':'')+'>'+(s.exporting?'מכין קובץ…':'יצוא לאקסל')+'</button></div>'+
      '</div><div id="st-res"></div></div>';
    $('#main').innerHTML=h;
    if(!s.data&&!s.busy)stLoad();else stRes();
  }
  var ST_COLS=[['name','שם'],['role','תפקיד'],['year','שנת לימוד'],['bookings','הזמנות'],['hours','שעות כמזמין'],['pBookings','השתתפויות'],['pHours','שעות כמשתתף'],['total','סה"כ שעות'],['noshows','אי-הגעות']];
  var YR_COLS=[['ord','שנת לימוד'],['people','אנשים'],['bookings','הזמנות'],['hours','שעות כמזמין'],['pBookings','השתתפויות'],['pHours','שעות כמשתתף'],['total','סה"כ שעות'],['noshows','אי-הגעות']];
  var PU_COLS=[['purpose','סוג פעילות'],['bookings','הזמנות'],['hours','שעות'],['personHours','שעות-אדם'],['people','אנשים שונים']];
  function stSorted(rows){
    var k=S.st.sk,d=S.st.sd;
    return rows.slice().sort(function(a,b){var x=a[k],y=b[k];if(typeof x==='string'||typeof y==='string')return d*String(x||'').localeCompare(String(y||''),'he');return d*((x||0)-(y||0))});
  }
  function stRes(){
    var el=$('#st-res');if(!el)return;stInit();var s=S.st,r=s.data;
    if(s.err){el.innerHTML='<div class="card"><p class="err" role="alert" style="margin:0">'+esc(s.err)+'</p></div>';return}
    if(!r){el.innerHTML='<div class="card empty"><p style="margin:0">טוען…</p></div>';return}
    var h='<p style="margin:8px 0"><b>'+r.totals.bookings+'</b> הזמנות · <b>'+r.totals.hours+'</b> שעות · <b>'+r.totals.people+'</b> אנשים'+(s.busy?' · מעדכן…':'')+'</p>';
    var cols=s.view==='people'?ST_COLS:s.view==='years'?YR_COLS:PU_COLS,rows=s.view==='people'?r.people:s.view==='years'?r.years:r.purposes;
    if(!rows.length){el.innerHTML=h+'<div class="card empty"><p style="margin:0">אין נתונים לסינון הזה.</p></div>';return}
    h+='<div class="sttwrap"><table class="stt"><thead><tr>'+cols.map(function(c){return '<th scope="col"><button type="button" class="sth" data-act="st-sort" data-k="'+c[0]+'">'+c[1]+(s.sk===c[0]?(s.sd<0?' ▼':' ▲'):'')+'</button></th>'}).join('')+'</tr></thead><tbody>';
    stSorted(rows).forEach(function(x){
      if(s.view==='people')h+='<tr><td><b>'+esc(x.name||'(ללא שם)')+'</b><br><span class="stsub" dir="ltr">'+esc(x.email||'')+'</span>'+(x.by.length?'<br><span class="stsub">'+x.by.slice(0,3).map(function(b){return esc(b[0])+' ('+b[1]+')'}).join(' · ')+'</span>':'')+'</td><td>'+roleChip(x.role)+'</td><td>'+esc(x.year||'')+'</td><td>'+x.bookings+'</td><td>'+x.hours+'</td><td>'+x.pBookings+'</td><td>'+x.pHours+'</td><td><b>'+x.total+'</b></td><td'+(x.noshows?' class="al-no"':'')+'>'+x.noshows+'</td></tr>';
      else if(s.view==='years')h+='<tr><td><b>'+esc(x.year||'ללא שנה (צוות או לא הוזמן)')+'</b></td><td>'+x.people+'</td><td>'+x.bookings+'</td><td>'+x.hours+'</td><td>'+x.pBookings+'</td><td>'+x.pHours+'</td><td><b>'+x.total+'</b></td><td'+(x.noshows?' class="al-no"':'')+'>'+x.noshows+'</td></tr>';
      else h+='<tr><td><b>'+esc(x.purpose)+'</b></td><td>'+x.bookings+'</td><td>'+x.hours+'</td><td>'+x.personHours+'</td><td>'+x.people+'</td></tr>';
    });
    el.innerHTML=h+'</tbody></table></div><p class="tfnote">שעות כמזמין: אורך ההזמנות שהוא הזמין. שעות כמשתתף: הזמנות של אחרים שנבחר בהן כמשתתף. שעות-אדם: אורך ההזמנה כפול מספר המשתתפים שהוזן בה. בתצוגה לפי שנת לימוד, הזמנות נספרות לפי השנה שצוינה בהן, והשתתפות לפי השנה האחרונה של המשתתף.</p>';
  }
  async function stExport(){
    stInit();S.st.exporting=true;renderStats();
    try{
      var r=await api('GET','/api/admin/stats'+stQuery(true));
      var ppl=[['שם','מייל','תפקיד','שנת לימוד','הזמנות כמזמין','שעות כמזמין','השתתפויות','שעות כמשתתף','סה"כ שעות','אי-הגעות','סוגי פעילות']];
      r.people.forEach(function(x){ppl.push([x.name||'',x.email||'',x.role||'',x.year||'',x.bookings,x.hours,x.pBookings,x.pHours,x.total,x.noshows,x.by.map(function(b){return b[0]+' ('+b[1]+')'}).join(', ')])});
      var yrx=[['שנת לימוד','אנשים','הזמנות','שעות כמזמין','השתתפויות','שעות כמשתתף','סה"כ שעות','אי-הגעות']];
      (r.years||[]).forEach(function(x){yrx.push([x.year||'ללא שנה',x.people,x.bookings,x.hours,x.pBookings,x.pHours,x.total,x.noshows])});
      var pur=[['סוג פעילות','הזמנות','שעות','שעות-אדם','אנשים שונים']];
      r.purposes.forEach(function(x){pur.push([x.purpose,x.bookings,x.hours,x.personHours,x.people])});
      var det=[['תאריך','משעה','עד שעה','עמדות','שם המזמין','מייל','תפקיד','שנת לימוד','סוג פעילות','משתתפים','שמות המשתתפים','לא הגיע','הערות']];
      (r.detail||[]).forEach(function(o){det.push([dmy(o.date),hh(o.lo),hh(o.hi),namesOf(String(o.st||'').split(',')),o.name||'',o.email||'',o.role||'',o.sy||'',o.purpose||'',o.people==null?'':o.people,o.with||'',o.noshow?'כן':'',o.notes||''])});
      var info=[['פרמטר','ערך'],['תקופה',({year:'כל השנה',sem1:'סמסטר א\'',sem2:'סמסטר ב\''})[S.st.period]||'תאריכים לבחירה'],['מתאריך',r.from?dmy(r.from):'מההתחלה'],['עד תאריך',dmy(r.to)],['סינון שם/מייל',S.st.q||'הכול'],['סינון סוג פעילות',S.st.purpose||'הכול'],['סינון תפקיד',S.st.role||'הכול'],['סינון שנת לימוד',S.st.year||'הכול'],['סה"כ הזמנות',r.totals.bookings],['סה"כ שעות',r.totals.hours],['סה"כ אנשים',r.totals.people]];
      var blob=buildXlsx([{name:'לפי אנשים',rows:ppl},{name:'לפי שנת לימוד',rows:yrx},{name:'לפי סוג פעילות',rows:pur},{name:'הזמנות מפורטות',rows:det},{name:'פרטי הסינון',rows:info}]);
      var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='studio-stats-'+ds(new Date())+'.xlsx';document.body.appendChild(a);a.click();
      setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500);
    }catch(e){flash(e.message||'שגיאה')}
    S.st.exporting=false;if(S.tab==='stats')renderStats();
  }
  async function exportXlsx(){
    if(!isAdmin())return;
    var d;
    try{d=await api('GET','/api/admin/export')}catch(e){flash(e.message);return false}
    var tag={pending:'ממתין לאישור',approved:'מאושר',rejected:'לא אושר',removed:'הוסר'};
    var users=[['שם','מייל','תפקיד','סטטוס','תאריך הרשמה']];
    d.users.forEach(function(m){users.push([m.name||'',m.email||'',m.role||'',tag[m.status||'pending']||'',m.created_at?new Date(m.created_at).toLocaleDateString('he-IL'):''])});
    var bookings=[['תאריך','משעה','עד שעה','עמדות','שם','מייל','תפקיד','שנת לימוד','מטרה','משתתפים','שמות המשתתפים','הערות']];
    d.bookings.forEach(function(o){bookings.push([dmy(o.date),hh(o.lo),hh(o.hi+1),namesOf(String(o.st||'').split(',')),o.name||'',o.email||'',o.role||'',o.sy||'',o.purpose||'',o.people==null?'':o.people,o.withp||'',o.notes||''])});
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
  var AUDIT_LBL={login:'כניסה',register:'הרשמה',profile_delete:'מחיקת פרופיל',member_approved:'אישור משתמש',member_rejected:'דחיית משתמש',member_remove:'הסרת משתמש',member_purge:'מחיקת משתמש',noshow_mark:'סימון אי-הגעה',allowlist_add:'הוספה לרשימת אישור אוטומטי',allowlist_clear:'ניקוי רשימת אישור אוטומטי',allowlist_role:'שינוי תפקיד ברשימה',allowlist_name:'עריכת שם ברשימה',allowlist_remove:'הסרה מהרשימה האוטומטית',noshow_undo:'ביטול סימון אי-הגעה',release:'שחרור חסימה',export:'הורדת דוח',cleanup_year:'ניקוי סוף שנה',cancel_booking:'ביטול הזמנה של אחר',transfer_accept:'קבלת מקום'};
  async function loadAudit(){
    try{var r=await api('GET','/api/admin/audit');S.audit=r.items}catch(e){flash(e.message)}
    render();
  }
  function renderAdmin(){
    if(S.alCount==null&&!S.alBusy){S.alBusy=true;api('GET','/api/admin/allowlist').then(function(r){S.alCount=r.count;S.alBy=r.byRole||{};S.alBusy=false;if(S.tab==='all')renderAdmin()},function(){S.alBusy=false;S.alCount=0})}
    var h='<div class="admin">'+membersHTML()+allowHTML()+toolsHTML();
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
    var all=groups(),up=all.filter(function(g){return g.uid!=='sys-classes'}),cls=all.filter(function(g){return g.uid==='sys-classes'});
    h+='<h3>הזמנות קרובות</h3>';
    h+=up.length?'<div class="list">'+up.map(function(g){return itemHTML(g,true)}).join('')+'</div>':'<div class="card empty"><p style="margin:0">אין הזמנות קרובות של סטודנטים.</p></div>';
    if(cls.length){
      h+='<button type="button" class="btn ghost clsbtn" data-act="cls-toggle" aria-expanded="'+(!!S.clsOpen)+'">חסימות שיעורים ('+cls.length+') '+(S.clsOpen?'▲':'▼')+'</button>';
      if(S.clsOpen)h+='<div class="list">'+cls.map(function(g){return itemHTML(g,true)}).join('')+'</div>';
    }
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
    if(S.tab==='stats'&&isAdmin())return renderStats();
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
      '<p>'+(edit?'הפרטים נשמרים באזור האישי שלך בלבד.':'ההרשמה פתוחה לסטודנטים עם מייל ארגוני בסיומת \u2066@'+EMAIL_DOMAIN+'.\u2069'+' הפרטים נשמרים באזור האישי שלך ומשמשים למילוי אוטומטי של כל הזמנה.')+'</p></div>'+
      '<div class="photo-row">'+avatarHTML({photo:r.photo,name:r.name},'xl')+'<div class="photo-btns"><button type="button" class="btn ghost" data-act="photo-pick">'+(r.photo?'החלפת תמונה':'העלאת תמונת פרופיל')+'</button>'+(r.photo?'<button type="button" class="btn ghost" data-act="photo-remove">הסרה</button>':'')+'<input type="file" id="r-photo" accept="image/*" data-photo="1" hidden><span class="lbl" style="flex-basis:100%">אפשר גם בלי תמונה. התמונה מוצגת רק לך.</span></div></div>'+
      '<div class="field"><label class="lbl" for="r-name">שם מלא</label><input id="r-name" autocomplete="name" data-r="name" value="'+esc(r.name)+'"></div>'+
      '<div class="row2"><div class="field"><label class="lbl" for="r-year">תפקיד</label><select id="r-year" data-r="year"'+(S.listRole?' disabled':'')+'><option value="">בחירה</option>'+YEARS.map(function(y){return '<option'+(r.year===y?' selected':'')+'>'+y+'</option>'}).join('')+'</select></div>'+
      '<div class="field"><label class="lbl" for="r-email">מייל ארגוני</label><input id="r-email" type="email" autocomplete="email" dir="ltr" data-r="email" placeholder="name@'+EMAIL_DOMAIN+'" value="'+esc(S.authEmail||r.email)+'"'+(S.authEmail?' readonly':'')+' style="text-align:right"></div></div>'+
      (S.listRole?'<p class="tfnote" style="margin:0">התפקיד נקבע עבורך מראש על ידי מנהל המערכת.</p>':'')+(edit?'':'<label class="chk"><input type="checkbox" id="r-agree" data-r="agree"'+(r.agree?' checked':'')+'><span>אני מתחייב/ת לשמור על ציוד האולפן, להגיע בזמן ולבטל הזמנה שאיני מממש/ת.</span></label>')+
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
    $('#main').innerHTML='<div class="me">'+incomingHTML()+banner+'<aside class="card profile"><div class="head">'+avatarHTML(P,true)+'<div><h2>'+esc(P.name)+'</h2>'+roleChip(P.year||'')+'</div></div>'+
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
    $('#main').innerHTML='<div class="card reg"><div><h2>כניסה להזמנת אולפנים</h2><p>הכניסה למערכת היא עם חשבון Google של המכללה, בסיומת \u2066@'+EMAIL_DOMAIN+'.\u2069'+'</p></div>'+
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
    if(!S.planAuto&&S.tab==='book'&&S.db&&S.memberLoaded&&canBook()){
      S.planAuto=true;
      setTimeout(function(){var m=$('#modal');if(m&&m.hidden)openPlan(null)},60);
    }
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
    if(yearMsg()){S.err=yearMsg();return renderSide()}
    if(!(people>=1&&people<=cap)){S.err='מספר המשתתפים בהזמנה הזאת הוא בין 1 ל-'+cap+'.';return renderSide()}
    var part=(f.part||[]),pm=partMsg();
    if(pm){S.err=pm;return renderSide()}
    if(myHoursOn(S.date)+S.dur>MAX_DAY){S.err='ההזמנה חורגת ממכסה של '+MAX_DAY+' שעות ליום.';return renderSide()}
    S.err='';S.busy=true;renderSide();
    try{
      await api('POST','/api/bookings',{studios:S.studios.slice(),date:S.date,start:S.start,dur:S.dur,purpose:f.purpose,people:people,notes:(f.notes||'').slice(0,300),participants:part.map(function(x){return x.uid}),mode:partState().solo?'solo':'group',studyYear:needsYear()?f.studyYear:''});
    }catch(e){
      S.busy=false;S.step='slots';S.start=null;S.anchor=null;S.err='';
      renderSide();
      $('#side').insertAdjacentHTML('afterbegin','<p class="err" role="alert">'+esc(e.message)+'</p>');
      forceRefresh();
      return;
    }
    S.form.part=[];S.form.solo=false;
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
    if(a==='cls-toggle'){S.clsOpen=!S.clsOpen;renderList()}
    else if(a==='solo-off'){S.form.solo=false;renderSide()}
    else if(a==='st-view'){stInit();S.st.view=b.dataset.v;S.st.sk=b.dataset.v==='people'?'total':b.dataset.v==='years'?'ord':'hours';S.st.sd=b.dataset.v==='years'?1:-1;renderStats()}
    else if(a==='st-sort'){stInit();var k=b.dataset.k;if(S.st.sk===k)S.st.sd=-S.st.sd;else{S.st.sk=k;S.st.sd=(k==='name'||k==='role'||k==='purpose'||k==='year'||k==='ord')?1:-1}stRes()}
    else if(a==='st-reset'){var v=S.st&&S.st.view||'people';S.st=null;stInit();S.st.view=v;S.st.sk=v==='people'?'total':v==='years'?'ord':'hours';S.st.sd=v==='years'?1:-1;renderStats()}
    else if(a==='st-export'){stExport()}
    else if(a==='part-rm'){S.form.part=(S.form.part||[]).filter(function(x){return x.uid!==b.dataset.u});S.form.people=Math.max(1,S.form.part.length+1);renderSide()}
    else if(a==='al-add'){alAdd()}
    else if(a==='al-show'){S.alShow=!S.alShow;if(S.alShow&&!S.alItems)alLoadList();renderAdmin()}
    else if(a==='al-nm-edit'){S.alEdit=b.dataset.em;S.alEditVal=b.dataset.nm||'';S.alDel=null;var le=$('#al-list');if(le)le.innerHTML=alListHTML();var ni=$('#al-nm');if(ni)ni.focus()}
    else if(a==='al-nm-cancel'){S.alEdit=null;var lc=$('#al-list');if(lc)lc.innerHTML=alListHTML()}
    else if(a==='al-nm-save'){alSaveName(b.dataset.em)}
    else if(a==='al-del'){S.alDel=b.dataset.em;var l=$('#al-list');if(l)l.innerHTML=alListHTML()}
    else if(a==='al-del-no'){S.alDel=null;var l2=$('#al-list');if(l2)l2.innerHTML=alListHTML()}
    else if(a==='al-del-yes'){alDel(b.dataset.em)}
    else if(a==='al-clear-ask'){S.alClear=true;renderAdmin()}
    else if(a==='al-clear-no'){S.alClear=false;renderAdmin()}
    else if(a==='al-clear-yes'){alClear()}
    else if(a==='tab'){S.tab=b.dataset.v;S.confirmCancel=null;if(S.tab==='book'&&S.step==='done'){S.step='slots'}render()}
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
    else if(a==='next'){S.step='form';S.err='';if(!S.dirAt||Date.now()-S.dirAt>120000)S.dir=null;if(!S.form.studyYear)S.form.studyYear=lastStudyYear();renderSide();toSide()}
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
    if(t.id==='f-part'){if(e.type==='change'&&t.value==='__solo'){S.form.part=[];S.form.people=1;S.form.solo=true;renderSide();return}
      if(e.type==='change'&&t.value){S.form.solo=false;var o=(S.dir||[]).filter(function(x){return x.uid===t.value})[0];if(o){S.form.part=(S.form.part||[]).concat([{uid:o.uid,name:o.name}]);S.form.people=S.form.part.length+1;renderSide()}}return}
    if(t.id&&t.id.indexOf('st-')===0&&t.id!=='st-res'){stInit();var sk=t.id.slice(3);
      if(sk==='person'){if(e.type==='change'){S.st.q=t.value;var qi=$('#st-q');if(qi)qi.value=t.value;stLoad()}}
      else if(sk==='q'){S.st.q=t.value;var ps=$('#st-person');if(ps&&e.type==='input'&&ps.value&&ps.value.toLowerCase()!==String(t.value).toLowerCase())ps.value='';if(e.type==='input'){clearTimeout(stTimer);stTimer=setTimeout(stLoad,350)}}
      else if(sk==='period'){if(e.type==='change'){S.st.period=t.value;var pr=stPeriod(t.value);if(pr){S.st.from=pr[0];S.st.to=pr[1]}else{S.st.from='';S.st.to=''}renderStats();stLoad()}}
      else if(e.type==='change'){S.st[sk]=t.value;if(sk==='from'||sk==='to')S.st.period='';stLoad();if(sk==='from'||sk==='to'){var pe=$('#st-period');if(pe)pe.value=''}}
      return}
    if(t.id==='al-nm'){S.alEditVal=t.value;return}
    if(t.id==='al-q'){S.alQ=t.value;var lq=$('#al-list');if(lq)lq.innerHTML=alListHTML();return}
    if(t.classList&&t.classList.contains('al-rolesel')){if(e.type==='change')alSetRole(d.em,t.value);return}
    if(d.photo){
      if(e.type==='change'&&t.files&&t.files[0]){
        photoFrom(t.files[0]).then(function(url){S.reg.photo=url;S.regErr='';renderReg()},function(){S.regErr='אי אפשר לקרוא את הקובץ הזה. נסו תמונה אחרת (JPG או PNG).';renderReg()});
      }
      return;
    }
    if(d.f){S.form[d.f]=t.value;if((d.f==='people'||d.f==='studyYear')&&e.type==='change'&&S.step==='form')renderSide()}
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
