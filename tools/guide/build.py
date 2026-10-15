# בונה את מדריך הסטודנטים (public/_g/guide.pdf) מתוך התוכן שבקובץ הזה.
# הרצה:  python3 tools/guide/build.py   (דורש playwright + chromium)
import base64, html, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', '_g', 'guide.pdf')
LOGO = base64.b64encode(open(os.path.join(HERE, 'logo.jpg'), 'rb').read()).decode()
URL = 'studio-booking.photography-e89.workers.dev'
FOOT = 'מערכת הזמנת אולפנים · החוג לתקשורת צילומית'

import re
def e(s):
    s = html.escape(s, quote=False)
    return re.sub(r'\d{1,2}:\d{2}(?:[–-]\d{1,2}:\d{2})?', lambda m: '<bdi dir="ltr">' + m.group(0) + '</bdi>', s)

def card(i, h, t):
    return f'<div class="card"><div class="n">{i}</div><h3>{e(h)}</h3><p>{e(t)}</p></div>'

def note(h, t, kind=''):
    return f'<div class="note {kind}"><h4>{e(h)}</h4><p>{e(t)}</p></div>'

def page(eyebrow, title, cards, notes=(), cols=None):
    cols = cols or len(cards)
    c = ''.join(card(i + 1, *x) for i, x in enumerate(cards))
    n = ''.join(note(*x) for x in notes)
    return (f'<section class="pg"><p class="eb">{e(eyebrow)}</p><h2>{e(title)}</h2>'
            f'<div class="cards c{cols}">{c}</div>{n}<footer>{FOOT}</footer></section>')

def plain(eyebrow, title, cells, cols, notes=()):
    c = ''.join(f'<div class="card"><h3>{e(h)}</h3><p>{e(t)}</p></div>' for h, t in cells)
    n = ''.join(note(*x) for x in notes)
    return (f'<section class="pg"><p class="eb">{e(eyebrow)}</p><h2>{e(title)}</h2>'
            f'<div class="cards c{cols}">{c}</div>{n}<footer>{FOOT}</footer></section>')

def stats(eyebrow, title, items):
    c = ''.join(f'<div class="card st"><b dir="ltr"{' class="w"' if len(a)>3 else ''}>{e(a)}</b><p>{e(t)}</p></div>' for a, t in items)
    return (f'<section class="pg"><p class="eb">{e(eyebrow)}</p><h2>{e(title)}</h2>'
            f'<div class="cards c3">{c}</div><footer>{FOOT}</footer></section>')

pages = []
pages.append(f'''<section class="pg dark"><img class="logo" src="data:image/jpeg;base64,{LOGO}" alt="">
<div class="tt"><p class="eb">מדריך לסטודנטים</p><h1>מערכת הזמנת אולפנים</h1>
<p class="sub">כניסה, חתימה על כללי ההתנהגות, הזמנה, עריכה, ביטול וקיצור דרך בנייד</p>
<p class="by">ייזום, תכנון ובנייה: יורם רשף · החוג לתקשורת צילומית 2026</p></div></section>''')

pages.append(page('לפני שמתחילים', 'מה צריך כדי להזמין אולפן', [
    ('אתר המערכת', URL),
    ('מייל של המכללה', 'ההרשמה והכניסה רק עם חשבון Google של המכללה name@edu.jmc.ac.il'),
    ('אישור מנהל', 'בפעם הראשונה נרשמים. מי שהמייל שלו ברשימת החוג מאושר מיד, ואחרים ממתינים לאישור מנהל'),
    ('חתימה על כללי ההתנהגות', 'לפני ההזמנה הראשונה חותמים בתוך המערכת על כללי ההתנהגות בחללים המעשיים ובאולפנים')]))

pages.append(page('קיצור דרך בנייד · אייפון', 'מוסיפים את האתר למסך הבית', [
    ('פותחים ב-Safari', 'חשוב להשתמש בדפדפן Safari ולא בדפדפן אחר'),
    ('לוחצים על שיתוף', 'הכפתור עם החץ שיוצא מריבוע, בשורה התחתונה של המסך'),
    ('הוספה למסך הבית', 'גוללים ברשימה למטה ובוחרים באפשרות הזו'),
    ('לוחצים הוספה', 'האייקון עם לוגו החוג יופיע במסך הבית כמו כל אפליקציה')]))

pages.append(page('קיצור דרך בנייד · אנדרואיד', 'מתקינים את האתר כאפליקציה', [
    ('פותחים ב-Chrome', 'נכנסים לכתובת האתר בדפדפן Chrome'),
    ('פותחים את התפריט', 'שלוש הנקודות האנכיות בפינה העליונה של המסך'),
    ('התקנת אפליקציה', 'בוחרים בהתקנת אפליקציה, ואם אין כזו, בהוספה למסך הבית'),
    ('מאשרים', 'האייקון עם לוגו החוג יופיע במסך הבית ובמגירת האפליקציות')]))

pages.append(page('כניסה למערכת', 'נכנסים עם חשבון Google של המכללה', [
    ('פותחים את האתר', 'בדפדפן או מהאייקון שבמסך הבית של הטלפון'),
    ('לוחצים על הכפתור השחור', 'כפתור הכניסה עם Google נמצא במרכז המסך'),
    ('בוחרים את מייל המכללה', 'רק חשבון שמסתיים ב-edu.jmc.ac.il יכול להיכנס')],
    [('טיפ', 'אם נכנסתם עם מייל אישי, מתנתקים ובוחרים חשבון אחר')]))

pages.append(page('הרשמה בפעם הראשונה', 'ממלאים פרטים ומחכים לאישור', [
    ('שם מלא', 'כותבים שם ושם משפחה כפי שמופיעים במכללה'),
    ('תפקיד', 'אם המייל שלכם ברשימת החוג, התפקיד נקבע מראש. אחרת בוחרים מהרשימה. תמונה היא רשות'),
    ('התחייבות', 'מסמנים שמקפידים על הציוד, מגיעים בזמן ומבטלים הזמנה שלא מממשים'),
    ('סיום הרשמה', 'לוחצים על הכפתור וממתינים לאישור מנהל החוג')],
    [('אישור', 'מי שברשימת החוג מאושר מיד ויכול להזמין. מי שלא, רואה "ההרשמה ממתינה לאישור מנהל" ומזמין אחרי האישור')]))

pages.append(page('חדש · לפני ההזמנה הראשונה', 'חותמים על כללי ההתנהגות', [
    ('פותחים את הכללים', 'עד שחותמים, במקום ההזמנה מופיע כרטיס "כללי התנהגות". לוחצים עליו כדי לפתוח את המסמך'),
    ('קוראים עד הסוף', 'גוללים את כל הכללים עד השורה האחרונה. רק אז אפשר לסמן את האישורים'),
    ('מסמנים שני אישורים', 'קראתי והבנתי, ומאשר ומתחייב להתנהג לפי המסמך'),
    ('חותמים בשם מלא', 'שם פרטי ושם משפחה, ואז לוחצים על כפתור החתימה. אחר כך אפשר להזמין')],
    [('חשוב לדעת', 'החתימה נדרשת מכל משתמשי המערכת. כשהכללים מתעדכנים, חותמים מחדש פעם אחת על הנוסח החדש')]))

pages.append(page('לפני ההזמנה', 'מפת האולפנים מראה מי תפס עמדה', [
    ('המפה הקטנה', 'במסך ההזמנה מופיעה מפה קטנה. לחיצה עליה או על "הגדלת המפה" פותחת מפה גדולה. אפשר לסגור ולחזור להזמנה'),
    ('מה כתוב על עמדה', 'שם המזמין והשעות שבהן העמדה תפוסה'),
    ('צבע השם', 'לפי סוג המזמין: סטודנט, מרצה, מתרגל, מדריך או אורח')], cols=3))

pages.append(page('הזמנת אולפן · שלב 1 מתוך 4', 'בוחרים עמדה באולפן', [
    ('לשונית הזמנה חדשה', 'בראש הדף לוחצים על "הזמנה חדשה"'),
    ('בוחרים עמדה ברשימה', 'לוחצים על שם העמדה. בחירה חדשה ברשימה מבטלת אוטומטית את הבחירה הקודמת'),
    ('כמה עמדות יחד', 'פותחים את המפה הגדולה ומסמנים בה כמה עמדות. הן יוזמנו יחד באותן שעות')],
    [('אולפנים במערכת', 'אולפן שחור קדמי (חמש עמדות), אולפן שחור אחורי (שתי עמדות), אולפן לבן ג׳ ואולפן לבן ד׳')], cols=3))

pages.append(page('הזמנת אולפן · שלב 2 מתוך 4', 'בוחרים תאריך ושעות', [
    ('בוחרים יום', 'לוחצים על התאריך בלוח השנה. החצים מעבירים בין חודשים'),
    ('כל כפתור הוא שעה שלמה', 'הכפתור "13:00–14:00" הוא השעה בין אחת לשתיים. שעה תפוסה אפורה וכתוב בה "תפוס"'),
    ('מסמנים עד 4 שעות ברצף', 'בטלפון לוחצים על השעה הראשונה ואז על האחרונה, או גוררים אצבע. במחשב מחזיקים Shift. מתחת ללוח כתוב הטווח המדויק, ואז "המשך להזמנה"')],
    [('דוגמה', 'להזמנה מ-13:00 עד 15:00 מסמנים שני כפתורים בלבד: 13:00–14:00 ו-14:00–15:00. לא מסמנים את 15:00–16:00'),
     ('שעה בצבע אדום', 'כשכתוב באדום "תיאום עם ירדן גבאי", האולפן משמש לשיעור ויש לתאם מראש. כך גם בימי חמישי בין 14:00 ל-18:00', 'red')], cols=3))

pages.append(page('הזמנת אולפן · שלב 3 מתוך 4', 'ממלאים פרטים', [
    ('מטרת השימוש', 'בוחרים מהרשימה, למשל תרגיל קורס, פרויקט גמר או האקתון'),
    ('שנת לימוד', 'סטודנטים חייבים לבחור שנה. מתרגלים, מדריכים ומרצים לא צריכים'),
    ('לבד או עם אחרים', 'בוחרים בתפריט "אני עובד.ת לבד", או מוסיפים את שמות המשתתפים מהרשימה'),
    ('מספר משתתפים', 'המספר חייב להתאים לשמות. שם נוסף אחד הוא שני משתתפים, כולל המזמין')],
    [('בלי מילוי נכון אי אפשר להמשיך', 'כפתור "אישור הזמנה" נשאר חסום עד שמצהירים לבד או עם אחרים והמספר תואם. ברשימת השמות מופיעים רק מי שנרשם ואושר')]))

pages.append(page('הזמנת אולפן · שלב 4 מתוך 4', 'מסיימים ומאשרים', [
    ('ציוד והערות', 'שדה חופשי לצוות, למשל ציוד מיוחד שצריך להכין'),
    ('אישור הזמנה', 'לוחצים על הכפתור. מופיע המסך "ההזמנה נשמרה"'),
    ('אחרי האישור', 'אפשר להזמין שוב דרך "הזמנה נוספת", או לעבור לאזור האישי')],
    [('ההזמנה מחייבת', 'אם אי אפשר להגיע, מבטלים מראש לפחות שעתיים לפני תחילת ההזמנה')], cols=3))

pages.append(page('האזור שלי', 'רואים, עורכים, מבטלים ומעבירים הזמנות', [
    ('ההזמנות שלי', 'בלשונית "האזור שלי" מופיעות ההזמנות הקרובות, השמות שנבחרו איתכם וההיסטוריה'),
    ('עריכת הזמנה', 'לוחצים "עריכת הזמנה" ומשנים מטרת שימוש, שנת לימוד, מספר משתתפים והערות, ואז "שמירה"'),
    ('העברת מקום', 'לוחצים "העברת מקום", כותבים את מייל המכללה של חבר או חברה, והם מאשרים באזור האישי שלהם'),
    ('ביטול הזמנה', 'לוחצים "ביטול" ואז "כן, לבטל". אפשר עד שעתיים לפני תחילת ההזמנה')],
    [('שינוי מועד או עמדה', 'עריכת הזמנה לא משנה תאריך, שעות או עמדה. כדי לשנות אותם מבטלים ומזמינים מחדש. אם בהזמנה נבחרו משתתפים בשמם, מספר המשתתפים נקבע לפיהם')]))

pages.append(stats('כללי השימוש', 'מה חשוב לדעת', [
    ('8', 'עמדות לכל היותר בהזמנה אחת'), ('4', 'שעות הזמנה ביום לכל סטודנט'),
    ('08:00–18:00', 'שעות הפעילות של האולפנים'), ('6', 'משתתפים לכל היותר בעמדה'),
    ('3', 'אי-הגעות ללא ביטול וההזמנה נחסמת'), ('2', 'שעות לפני תחילת ההזמנה זה המועד האחרון לביטול')]))

pages.append(plain('בעיות נפוצות', 'אם משהו לא עובד', [
    ('כל השעות תפוסות', 'בוחרים עמדה אחרת או יום אחר, ובודקים אם יש ביטולים'),
    ('ההרשמה ממתינה לאישור', 'מי שלא ברשימת החוג ממתין לאישור מנהל. אם עבר זמן רב פונים אליו'),
    ('לא מצליחים להיכנס', 'בודקים שנכנסים עם מייל המכללה ולא עם מייל אישי'),
    ('המערכת מבקשת חתימה', 'לא ניתן להזמין לפני החתימה על כללי ההתנהגות. פותחים את כרטיס "כללי התנהגות", קוראים עד הסוף, מסמנים וחותמים'),
    ('אי אפשר ללחוץ על אישור הזמנה', 'בודקים שנבחרו מטרה, שנת לימוד לסטודנטים, לבד או שמות, ושהמספר תואם'),
    ('לא מוצאים משתתף ברשימה', 'הרשימה כוללת רק מי שנרשם ואושר. מי שלא נרשם נכנס ונרשם קודם'),
    ('המסך לא מתעדכן', 'מרעננים את הדף. אם נכתב "אין חיבור לשרת", בודקים אינטרנט ולוחצים "ניסיון חוזר"'),
    ('אי אפשר לסמן יותר משעתיים', 'בטלפון לוחצים על השעה הראשונה ואז על האחרונה (עד 4 שעות ברצף). לחיצה על שעה שכבר נבחרה מתחילה בחירה חדשה')], 4))

pages.append(f'''<section class="pg dark end"><h2>מוכנים להזמין</h2><p class="sub">נכנסים, חותמים על כללי ההתנהגות, בוחרים עמדה, תאריך ושעות, ומאשרים</p>
<p class="sub2">שאלות? פונים לצוות החוג לתקשורת צילומית</p><p class="url" dir="ltr">{URL}</p>
<footer>החוג לתקשורת צילומית · המרכז האקדמי הרב תחומי ירושלים</footer></section>''')

CSS = '''
@page{size:1920px 1080px;margin:0}
*{box-sizing:border-box;margin:0}
html{direction:rtl}
body{font-family:"Arial","Liberation Sans","Heebo",sans-serif;color:#231f20}
.pg{width:1920px;height:1080px;padding:110px 110px 90px;background:#fbf7ec;position:relative;page-break-after:always;overflow:hidden}
.eb{color:#8a6a00;font-weight:700;font-size:24px;letter-spacing:.5px}
h2{font-size:68px;font-weight:800;margin:14px 0 44px}
.cards{display:grid;gap:28px}
.c2{grid-template-columns:repeat(2,1fr)}.c3{grid-template-columns:repeat(3,1fr)}.c4{grid-template-columns:repeat(4,1fr)}
.card{background:#fff;border:1px solid #eadfc2;border-radius:22px;padding:28px 32px;min-height:230px}
.n{width:62px;height:62px;border-radius:50%;background:#ffb814;font-size:32px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-bottom:16px}
.card h3{font-size:34px;margin-bottom:12px}
.card p{font-size:27px;line-height:1.5;color:#4a4543}
.st{display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
.st b.w{font-size:68px}.st b{font-size:90px;white-space:nowrap;color:#231f20;display:block;margin-bottom:8px}
.note{margin-top:22px;background:#231f20;border-radius:22px;padding:26px 34px}
.note h4{color:#ffb814;font-size:30px;margin-bottom:8px}
.note.red h4{color:#ff7a66}
.note p{color:#fff;font-size:27px;line-height:1.5}
footer{position:absolute;bottom:46px;right:110px;color:#8f8777;font-size:23px}
.dark{background:#231f20;color:#fbf7ec}
.logo{position:absolute;top:100px;right:110px;width:720px;height:auto}
.tt{position:absolute;right:110px;bottom:110px;left:110px}
.tt .eb{color:#ffb814;font-size:30px}
h1{font-size:128px;font-weight:800;margin:18px 0 20px;color:#fbf7ec}
.sub{font-size:44px;color:#cfc7b5}.by{margin-top:36px;font-size:26px;color:#9a917f}
.end{display:flex;flex-direction:column;justify-content:center}
.end h2{font-size:110px;color:#fbf7ec;margin-bottom:24px}
.sub2{font-size:36px;color:#ffb814;margin-top:36px}
.url{font-size:34px;color:#fbf7ec;margin-top:30px;text-align:right}
.end footer{color:#9a917f}
'''
doc = f'<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>{CSS}</style></head><body>{"".join(pages)}</body></html>'
tmp = os.path.join(HERE, 'guide.html')
open(tmp, 'w', encoding='utf-8').write(doc)
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.goto('file://' + tmp)
    pg.pdf(path=OUT, width='1920px', height='1080px', print_background=True)
    b.close()
os.remove(tmp)
print('ok', OUT)
