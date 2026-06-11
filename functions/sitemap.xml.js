// functions/sitemap.xml.js
// Dynamic sitemap — อ่านบทความจาก D1 แบบ real-time
// Cloudflare Pages Function: GET /sitemap.xml

export async function onRequest({ env }) {
  const BASE = 'https://kru-ti.com';
  const today = new Date().toISOString().split('T')[0];

  // หน้า static ที่ต้องการให้ Google index
  // หมายเหตุ: Google ไม่ index URL ที่มี # (fragment) — ใส่เฉพาะ URL จริง
  const staticPages = [
    { url: `${BASE}/`, priority: '1.0', freq: 'daily' },
  ];

  // ดึงบทความที่เผยแพร่แล้วจาก D1
  let articleUrls = [];
  try {
    const { results } = await env.DB
      .prepare(`SELECT id, slug, created_at, updated_at
                FROM articles
                WHERE published = 1
                ORDER BY created_at DESC
                LIMIT 1000`)
      .all();

    articleUrls = results.map(a => ({
      url:      `${BASE}/article/${a.id}`,
      lastmod:  (a.updated_at || a.created_at || today).split('T')[0],
      priority: '0.8',
      freq:     'monthly',
    }));
  } catch (e) {
    // DB ไม่ available ระหว่าง build — ส่ง static pages อย่างเดียว
    console.error('sitemap DB error:', e);
  }

  const urlXML = (entry) => `  <url>
    <loc>${entry.url}</loc>
    ${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : `<lastmod>${today}</lastmod>`}
    <changefreq>${entry.freq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${staticPages.map(urlXML).join('\n')}
${articleUrls.map(urlXML).join('\n')}
</urlset>`;

  return new Response(xml.trim(), {
    headers: {
      'Content-Type':  'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600', // cache 1 ชั่วโมง
    },
  });
}
