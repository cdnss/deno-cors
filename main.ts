import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

var targetBaseUrl = "https://doujindesu.tv";

const port = 8000;

// Header umum untuk permintaan non-AJAX (misal: HTML, CSS, Gambar)
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Referer': targetBaseUrl, // Referer umum ke base URL
  'Origin': targetBaseUrl
};

// Header spesifik untuk permintaan AJAX ke /themes/ajax/ch.php, meniru cURL
const AJAX_HEADERS = {
    // User Agent dan Client Hints meniru perangkat Android seperti di cURL
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'Sec-Ch-Ua': '"Chromium";v="137", "Not/A)Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?1',
    'Sec-Ch-Ua-Platform': '"Android"',

    'Accept': '*/*', // Accept spesifik untuk AJAX
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7,ko;q=0.6,ja;q=0.5', // Bahasa lebih detail

    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', // **Sangat penting untuk POST**

    'Origin': targetBaseUrl, // Origin tetap sama

    // Referer meniru URL halaman spesifik dari cURL (gunakan base URL sebagai pendekatan jika URL spesifik bervariasi)
    // Menggunakan base URL karena proxy tidak tahu URL halaman spesifik di browser klien
    'Referer': `${targetBaseUrl}/`, // Contoh: https://doujindesu.tv/

    'Sec-Fetch-Dest': 'empty', // Nilai spesifik untuk permintaan AJAX resource
    'Sec-Fetch-Mode': 'cors', // Nilai spesifik untuk permintaan cross-origin/AJAX
    'Sec-Fetch-Site': 'same-origin', // Nilai spesifik untuk AJAX jika server menganggapnya same-origin

    'X-Requested-With': 'XMLHttpRequest', // Header umum AJAX, kemungkinan diperiksa

    'Accept-Encoding': 'gzip, deflate, br', // Mengindikasikan dukungan kompresi
};


async function handler(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
      if(url.endsWith("webp")){
          targetBaseUrl = "https://desu.photos"
      }
    const targetUrl = new URL(url.pathname + url.search, targetBaseUrl);

    const isAjaxRequest = url.pathname === '/themes/ajax/ch.php' && request.method === 'POST';
    if (isAjaxRequest) {
        console.log("--- MENDETEKSI PERMINTAAN AJAX POST ke /themes/ajax/ch.php ---");
        console.log(`[${request.method}] Proxying: ${url.pathname}${url.search} -> ${targetUrl.toString()}`);
    }


    // Buat objek Headers untuk permintaan keluar ke target
    let headers: Headers;
    if (isAjaxRequest) {
        // Gunakan set header spesifik untuk AJAX
        console.log("Menggunakan header spesifik AJAX.");
        headers = new Headers(AJAX_HEADERS);
    } else {
        // Gunakan set header browser default untuk permintaan lain
        headers = new Headers(BROWSER_HEADERS);
    }

    // --- Meneruskan header cookie klien ke target (menambahkan ke set header yang dipilih) ---
    const clientCookieHeader = request.headers.get('Cookie');
    if (clientCookieHeader) {
        headers.set('Cookie', clientCookieHeader);
        if (isAjaxRequest) {
           console.log(`Meneruskan header cookie klien: ${clientCookieHeader.substring(0, 50)}${clientCookieHeader.length > 50 ? '...' : ''}`);
        }
    }
    // --- Akhir penerusan cookie ---

    // Logging header permintaan keluar hanya untuk AJAX
    if (isAjaxRequest) {
        console.log("Header Permintaan Keluar ke Target:");
        for (const [name, value] of headers.entries()) {
            console.log(`  ${name}: ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
        }
        // Catatan: Logging body POST dari permintaan klien itu rumit karena stream.
        // Kode saat ini meneruskan request.body langsung ke fetch().
    }


    // Lakukan fetch ke URL target menggunakan metode dan body dari permintaan masuk
    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: headers, // Menggunakan header yang sudah termasuk cookie klien
      body: request.body, // Meneruskan body POST dari klien (seharusnya berisi id=...)
      redirect: 'manual',
    });

    // Logging respons masuk dari target hanya untuk AJAX
    if (isAjaxRequest) {
         console.log(`[${request.method}] Received response from target: ${response.status}`);
         console.log("Header Respons Masuk dari Target:");
         for (const [name, value] of response.headers.entries()) {
             console.log(`  ${name}: ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
         }
         console.log(`Status Respons Target untuk AJAX: ${response.status}`);

         try {
             // Log body respons dari target (menggunakan clone() agar body asli bisa diteruskan ke klien)
             const responseBodyText = await response.clone().text();
             console.log("Body Respons Target untuk AJAX (5000 karakter pertama):");
             console.log(responseBodyText.substring(0, 5000));
             if (responseBodyText.length > 5000) {
                 console.log("...");
             }
         } catch (bodyLogErr) {
             console.error("Gagal mencatat body respons:", bodyLogErr);
         }
    }


    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
        try {
            const html = await response.text();
            const $ = cheerio.load(html);

            const rewriteUrl = (url: string | null | undefined): string | null => {
                if (!url) return null;
                try {
                    const absoluteUrl = new URL(url, targetBaseUrl);

                    if (absoluteUrl.hostname === new URL(targetBaseUrl).hostname) {
                        return absoluteUrl.pathname + absoluteUrl.search + absoluteUrl.hash;
                    }
                    return url;
                } catch (e) {
                    console.warn(`Gagal mengurai atau menulis ulang URL: ${url}`, e);
                    return url;
                }
            };

            const elementsAndAttributes = [
                { selector: 'a[href]', attribute: 'href' },
                { selector: 'link[href]', attribute: 'href' },
                { selector: 'script[src]', attribute: 'src' },
                { selector: 'img[src]', attribute: 'src' },
                { selector: 'img[srcset]', attribute: 'srcset' },
                { selector: 'source[src]', attribute: 'src' },
                { selector: 'source[srcset]', attribute: 'srcset' },
                { selector: 'form[action]', attribute: 'action' },
                { selector: 'video[src]', attribute: 'src' },
                { selector: 'video[poster]', attribute: 'poster' },
                { selector: 'audio[src]', attribute: 'src' },
                { selector: 'use[href]', attribute: 'href' },
                { selector: 'iframe[src]', attribute: 'src' },
            ];

            elementsAndAttributes.forEach(({ selector, attribute }) => {
                $(selector).each((index, element) => {
                    const $element = $(element);
                    const originalUrl = $element.attr(attribute);

                    if (originalUrl) {
                         if (attribute === 'srcset') {
                             const rewrittenSrcset = originalUrl.split(',').map(srcsetItem => {
                                const parts = srcsetItem.trim().split(/\s+/);
                                if (parts.length > 0) {
                                    const urlPart = parts[0];
                                    const rewrittenUrlPart = rewriteUrl(urlPart);
                                     if (rewrittenUrlPart !== null && rewrittenUrlPart !== urlPart) {
                                         return [rewrittenUrlPart, ...parts.slice(1)].join(' ');
                                    }
                                }
                                return srcsetItem;
                            }).join(', ');

                            if (rewrittenSrcset !== originalUrl) {
                                $element.attr(attribute, rewrittenSrcset);
                            }
                        } else {
                            const rewrittenUrl = rewriteUrl(originalUrl);
                            if (rewrittenUrl !== null && rewrittenUrl !== originalUrl) {
                                $element.attr(attribute, rewrittenUrl);
                            }
                        }
                    }
                });
            });

            let removedCount = 0;
            $('script:not([src])').each((index, element) => {
                const scriptContent = $(element).text();

                if (scriptContent.includes('mydomain')) {
                    $(element).remove();
                    removedCount++;
                }
            });

            const modifiedHtml = $.html().replace('html(data)', 'html(data.replace("https://desu.photos",""))');

            const modifiedHeaders = new Headers(response.headers);
            modifiedHeaders.delete('content-length');
            modifiedHeaders.delete('content-encoding');
            modifiedHeaders.set('content-type', 'text/html; charset=utf-8');

            return new Response(modifiedHtml, {
                status: response.status,
                statusText: response.statusText,
                headers: modifiedHeaders,
            });

        } catch (htmlProcessError) {
            console.error("Error processing HTML with Cheerio:", htmlProcessError);
             return new Response("Internal Server Error: HTML processing failed.", { status: 500 });
        }

    } else { // Non-HTML resources, TERMASUK respons dari permintaan AJAX yang di-proxy
        const originalHeaders = new Headers(response.headers);

        // Tambahkan header CORS ke respons proxy UNTUK URL AJAX (jika ada)
        if (isAjaxRequest) {
             console.log("Menambahkan header CORS ke respons proxy untuk AJAX URL.");
             originalHeaders.set('Access-Control-Allow-Origin', '*');
             originalHeaders.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
             originalHeaders.set('Access-Control-Allow-Headers', '*');
             originalHeaders.set('Access-Control-Allow-Credentials', 'true');
        }

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: originalHeaders,
        });
    }

  } catch (error) {
    console.error("Error handling request:", error);
    return new Response("Proxy error", { status: 500 });
  }
}

console.log(`Deno reverse proxy berjalan di http://localhost:${port}`);
console.log(`Mem-proxy permintaan ke: ${targetBaseUrl}`);

Deno.serve({ port }, handler);

// Cara menjalankan:
// deno run --allow-net --allow-read=<DENO_CACHE_DIR> proxy_ajax_headers.ts
// Atau (kurang aman): deno run -A proxy_ajax_headers.ts
