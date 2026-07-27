// เสิร์ฟหน้าเว็บหลัก (index.html) ที่เส้นทาง /privacy
// ใช้ Function แทน _redirects เพราะ _redirects ของ Pages ไม่ยอม rewrite เป็น 200
// ให้ /index.html — มันแปลงเป็น / แล้ว 308 redirect จริง ทำให้ URL เด้งกลับหน้าแรก
//
// SPA อ่าน location.pathname เองแล้วเรนเดอร์หน้าที่ถูกต้อง

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  url.pathname = "/index.html";
  url.search = "";
  const req = new Request(url.toString(), { headers: request.headers });
  // env.ASSETS คือไฟล์นิ่งของ Pages; เผื่อไม่มีก็ยิงผ่าน fetch ปกติ
  const res = env.ASSETS ? await env.ASSETS.fetch(req) : await fetch(req);
  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
