import { serve } from "https://deno.land/std@0.215.0/http/server.ts";

// URL dasar situs target
const targetBaseUrl = "https://doujindesu.tv";

// Port di mana proxy Deno akan berjalan
const port = 8000; // Anda bisa mengganti port ini jika perlu

// Header yang akan dikirimkan ke server target untuk meniru browser
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  // Referer penting agar server target tahu dari mana permintaan berasal (dalam konteks Browse)
  'Referer': targetBaseUrl
  // Anda bisa menambahkan header lain jika diperlukan, tapi hati-hati
  // dengan header seperti Host, Origin, Connection, dll., biarkan fetch menanganinya.
};

// Handler untuk setiap permintaan masuk
async function handler(request: Request): Promise<Response> {
  try {
    // Parse URL permintaan masuk
    const url = new URL(request.url);

    // Buat URL target dengan menggabungkan path dan query dari permintaan masuk
    // dengan base URL target
    const targetUrl = new URL(url.pathname + url.search, targetBaseUrl);

    console.log(`[${request.method}] Proxying: ${url.pathname}${url.search} -> ${targetUrl.toString()}`);

    // Buat objek Headers baru untuk permintaan keluar ke target
    const headers = new Headers(BROWSER_HEADERS);

    // Opsional: Salin beberapa header relevan dari permintaan klien asli
    // Hati-hati dengan header sensitif seperti Cookie, Authorization, atau Host.
    // Contoh: if (request.headers.get('Cookie')) headers.set('Cookie', request.headers.get('Cookie') as string);
    // Contoh: if (request.headers.get('Accept-Encoding')) headers.set('Accept-Encoding', request.headers.get('Accept-Encoding') as string);


    // Lakukan fetch ke URL target menggunakan metode dan body dari permintaan masuk
    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: headers, // Gunakan header yang sudah kita siapkan
      body: request.body, // Teruskan body permintaan (untuk POST, PUT, dll.)
      redirect: 'manual', // Tangani redirect secara manual jika perlu (opsional)
    });

    console.log(`[${request.method}] Received response from target: ${response.status}`);

    // Kembalikan respons yang diterima dari server target langsung ke klien
    return response;

  } catch (error) {
    console.error("Error handling request:", error);
    // Kembalikan respons error jika terjadi masalah saat memproses permintaan
    return new Response("Proxy error", { status: 500 });
  }
}

console.log(`Deno reverse proxy running on http://localhost:${port}`);
console.log(`Proxying requests to: ${targetBaseUrl}`);

// Mulai server Deno
serve({ port }, handler);

// Cara menjalankan:
// Pastikan Anda sudah menginstal Deno: https://deno.land/#installation
// Simpan kode di atas dalam file (misal: proxy.ts)
// Jalankan dari terminal: deno run --allow-net proxy.ts
// Kemudian akses proxy dari browser Anda: http://localhost:8000/ (akan proxy ke https://doujindesu.tv/)
// atau http://localhost:8000/manga/contoh-manga/ (akan proxy ke https://doujindesu.tv/manga/contoh-manga/)
