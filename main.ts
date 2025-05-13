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

    const isAjaxRequest = url.pathname === '/themes/ajax/ch.php' && request.method === 'POST';
    if (isAjaxRequest) {
        console.log("--- MENDETEKSI PERMINTAAN AJAX POST ke /themes/ajax/ch.php ---");
        console.log(`[${request.method}] Proxying: ${url.pathname}${url.search} -> ${targetUrl.toString()}`); // Tetap log URL proxying untuk AJAX
    }


    const headers = new Headers(BROWSER_HEADERS);

    const clientCookieHeader = request.headers.get('Cookie');
    if (clientCookieHeader) {
        headers.set('Cookie', clientCookieHeader);
        // Logging cookie klien hanya untuk AJAX
        if (isAjaxRequest) {
           console.log(`Meneruskan header cookie klien: ${clientCookieHeader.substring(0, 50)}${clientCookieHeader.length > 50 ? '...' : ''}`);
        }
    }

    // Logging header permintaan keluar (termasuk cookie yang diteruskan) hanya untuk AJAX
    if (isAjaxRequest) {
        console.log("Header Permintaan Keluar ke Target:");
        for (const [name, value] of headers.entries()) {
            console.log(`  ${name}: ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
        }
    }

    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: 'manual',
    });

    // Logging status respons umum dihapus, hanya status spesifik AJAX di bawah yang tersisa
    // console.log(`[${request.method}] Received response from target: ${response.status}`);

     // Logging header dan body respons masuk dari target hanya untuk AJAX
    if (isAjaxRequest) {
         console.log(`[${request.method}] Received response from target: ${response.status}`); // Log status di sini untuk AJAX
         console.log("Header Respons Masuk dari Target:");
         for (const [name, value) of response.headers.entries()) { // Fix: value) -> value]
             console.log(`  ${name}: ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
         }
         console.log(`Status Respons Target untuk AJAX: ${response.status}`);

         try {
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
        // console.log("Content-Type is HTML, processing with Cheerio..."); // Dihapus
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
                    console.warn(`Gagal mengurai atau menulis ulang URL: ${url}`, e); // Tetap pertahankan warning
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
                                // console.log(`Menulis ulang srcset...`); // Dihapus
                            }
                        } else {
                            const rewrittenUrl = rewriteUrl(originalUrl);
                            if (rewrittenUrl !== null && rewrittenUrl !== originalUrl) {
                                $element.attr(attribute, rewrittenUrl);
                                // console.log(`Menulis ulang ${attribute}...`); // Dihapus
                            }
                        }
                    }
                });
            });
            // console.log("Penulisan ulang URL selesai."); // Dihapus

            let removedCount = 0;
            $('script:not([src])').each((index, element) => {
                const scriptContent = $(element).text();

                if (scriptContent.includes('mydomain')) {
                    // console.log(`Menghapus script tag inline...`); // Dihapus
                    $(element).remove();
                    removedCount++;
                }
            });
            // console.log(`Penghapusan script tag selesai. Dihapus ${removedCount}.`); // Dihapus


            const modifiedHtml = $.html();
            // console.log("HTML diproses. Mengembalikan HTML yang dimodifikasi."); // Dihapus


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
            console.error("Error processing HTML with Cheerio:", htmlProcessError); // Tetap pertahankan error
             return new Response("Internal Server Error: HTML processing failed.", { status: 500 });
        }

    } else {
        // console.log(`Content-Type bukan HTML...`); // Dihapus

        const originalHeaders = new Headers(response.headers);

        if (isAjaxRequest) {
             console.log("Menambahkan header CORS ke respons proxy untuk AJAX URL."); // Tetap pertahankan
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
    console.error("Error handling request:", error); // Tetap pertahankan error utama
    return new Response("Proxy error", { status: 500 });
  }
}

console.log(`Deno reverse proxy berjalan di http://localhost:${port}`); // Tetap pertahankan
console.log(`Mem-proxy permintaan ke: ${targetBaseUrl}`); // Tetap pertahankan

Deno.serve({ port }, handler);

// Cara menjalankan:
// deno run --allow-net --allow-read=<DENO_CACHE_DIR> proxy_ajax_only_log.ts
// Atau (kurang aman): deno run -A proxy_ajax_only_log.ts
