# מערכת הזמנת אולפנים – החוג לתקשורת צילומית

Cloudflare Worker אחד שמגיש את האתר (`public/`) ואת ה-API (`src/`), עם מסד נתונים D1.

- הוראות הקמה מלאות: במדריך ההקמה (setup-guide.docx).
- כללים, לוח שנה אקדמי, אולפנים ומנהלים: `src/config.js`.
- סכמת מסד הנתונים: `schema.sql` (זהה ל-`migrations/0001_schema.sql`).
- `wrangler.jsonc`: יש להחליף את `PUT-YOUR-DATABASE-ID-HERE` ו-`PUT-YOUR-GOOGLE-CLIENT-ID-HERE`.

## הרצה מקומית (למפתחים)
```
npm install
npx wrangler d1 migrations apply studio-booking-db --local
npx wrangler dev
```
