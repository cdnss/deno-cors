import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

const targetBaseUrl = "https://doujindesu.tv";

const port = 8000;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Referer': targetBaseUrl,
  'Origin': targetBaseUrl
};

async function handler(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const targetUrl = new URL(url.pathname + url.search, targetBaseUrl);

    console.log(`[${request.method}] Proxying: ${url.pathname}${url.search} -> ${targetUrl.toString()}`);

    const isAjaxRequest = url.pathname === '/themes/ajax/ch.php' && request.method === 'POST';
    if (isAjaxRequest) {
        console.log("--- MENDETEKSI PERMINTAAN AJAX POST ke /themes/ajax/ch.php ---");
    }

    const headers = new Headers(BROWSER_HEADERS);

    const clientCookieHeader = request.headers.get('Cookie');
    if (clientCookieHeader) {
        headers.set('Cookie', clientCookieHeader);
        console.log(`Meneruskan header cookie klien: ${clientCookieHeader.substring(0, 50)}${clientCookieHeader.length > 50 ? '...' : ''}`);
    }

    // --- Tambahkan logging header permintaan keluar (termasuk cookie yang diteruskan) ---
    if (isAjaxRequest) {
        console.log("Header Permintaan Keluar ke Target:");
        for (const [name, value] of headers.entries()) {
            console.log(`  ${name}: ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
        }
         // Logging body permintaan masuk dari klien (request.body) sulit karena stream
         // Tanpa mengonsumsinya, kita tidak bisa log body-nya di sini.
         // Jika Anda perlu debug body POST, Anda harus membaca request.body di sini,
         // menyimpannya, melognya, lalu membuat ReadableStream baru untuk fetch body.
         // Ini menambah kompleksitas. Fokus pada header dulu.
    }
     // --- Akhir logging header permintaan keluar ---


    // PERHATIAN: request.body adalah stream dan hanya bisa dibaca sekali.
    // Karena kita meneruskannya langsung ke fetch(), kita tidak bisa membacanya di sini untuk logging.
    // Jika logging body POST mutlak diperlukan, arsitektur perlu diubah.
    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: headers, // MENGGUNAKAN HEADER YANG SUDAH MENERUSKAN COOKIE KLIEN
      body: request.body, // Meneruskan body POST dari klien
      redirect: 'manual',
    });

    console.log(`[${request.method}] Received response from target: ${response.status}`);

     // --- Tambahkan logging header dan body respons masuk dari target ---
    if (isAjaxRequest) {
         console.log("Header Respons Masuk dari Target:");
         for (const [name, value) of response.headers.entries()) {
             console.log(`  ${name}: ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
         }
         console.log(`Status Respons Target untuk AJAX: ${response.status}`);

         // --- AKTIFKAN LOGGING BODY RESPONS UNTUK DEBUGGING AJAX ---
         try {
             // Gunakan response.clone() agar body respons utama tetap bisa dibaca oleh browser
             const responseBodyText = await response.clone().text();
             console.log("Body Respons Target untuk AJAX (5000 karakter pertama):");
             console.log(responseBodyText.substring(0, 5000));
             if (responseBodyText.length > 5000) {
                 console.log("...");
             }
         } catch (bodyLogErr) {
             console.error("Gagal mencatat body respons:", bodyLogErr);
         }
         // --- AKHIR LOGGING BODY RESPONS ---
    }
     // --- Akhir logging khusus AJAX ---


    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
        console.log("Content-Type adalah HTML, memproses dengan Cheerio...");
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
                                console.log(`Menulis ulang srcset untuk ${selector} index ${index}: ${originalUrl} -> ${rewrittenSrcset.substring(0, 50)}${rewrittenSrcset.length > 50 ? '...' : ''}`);
                            }
                        } else {
                            const rewrittenUrl = rewriteUrl(originalUrl);
                            if (rewrittenUrl !== null && rewrittenUrl !== originalUrl) {
                                $element.attr(attribute, rewrittenUrl);
                                console.log(`Menulis ulang ${attribute} untuk ${selector} index ${index}: ${originalUrl} -> ${rewrittenUrl.substring(0, 50)}${rewrittenUrl.length > 50 ? '...' : ''}`);
                            }
                        }
                    }
                });
            });
            console.log("Penulisan ulang URL selesai.");

            let removedCount = 0;
            $('script:not([src])').each((index, element) => {
                const scriptContent = $(element).text();

                if (scriptContent.includes('mydomain')) {
                    console.log(`Menghapus script tag inline index ${index} karena mengandung "mydomain" (konten awal: ${scriptContent.substring(0, 50)}${scriptContent.length > 50 ? '...' : ''})`);
                    $(element).remove();
                    removedCount++;
                }
            });
            console.log(`Penghapusan script tag selesai. Dihapus ${removedCount}.`);


            const modifiedHtml = $.html();
            console.log("HTML diproses. Mengembalikan HTML yang dimodifikasi.");


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
            console.warn("Mengembalikan respons error karena kesalahan pemrosesan HTML.");
             return new Response("Internal Server Error: HTML processing failed.", { status: 500 });
        }

    } else {
        console.log(`Content-Type bukan HTML (${contentType}), mengembalikan respons asli dengan headers disalin.`);

        const originalHeaders = new Headers(response.headers);

        // --- MODIFIKASI: Tambahkan header CORS ke respons proxy UNTUK URL AJAX ---
        if (isAjaxRequest) {
             console.log("Menambahkan header CORS ke respons proxy untuk AJAX URL.");
             originalHeaders.set('Access-Control-Allow-Origin', '*');
             originalHeaders.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
             originalHeaders.set('Access-Control-Allow-Headers', '*');
             originalHeaders.set('Access-Control-Allow-Credentials', 'true');
        }
        // --- AKHIR MODIFIKASI ---


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

// Cara menjalankan (tetap sama):
// deno run --allow-net --allow-read=<DENO_CACHE_DIR> proxy_debug_ajax_body.ts
// Atau (kurang aman): deno run -A proxy_debug_ajax_body.ts
