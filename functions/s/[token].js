import { schoolAppUrl } from '../_school-links.js';

export async function onRequest({ request, params, env }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const token = String(params.token || '');
  if (!/^[A-Za-z0-9_-]{12}$/.test(token)) return new Response('ไม่พบลิงก์', { status: 404 });
  if (!env.DB) return new Response('บริการลิงก์ยังไม่พร้อมใช้งาน', { status: 503 });

  try {
    const link = await env.DB.prepare(
      'SELECT config_json FROM school_short_links WHERE token = ?'
    ).bind(token).first();
    if (!link) return new Response('ไม่พบลิงก์', { status: 404 });
    return new Response(null, {
      status: 302,
      headers: {
        Location: schoolAppUrl(link.config_json),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch {
    return new Response('เปิดลิงก์ไม่สำเร็จ กรุณาลองอีกครั้ง', { status: 503 });
  }
}
