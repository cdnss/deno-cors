// ... imports and constants ...
const port = 8000
async function handler(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    
    let targetOrigin: string;
    let targetPath: string;

    const pathSegments = url.pathname.split('/').filter(segment => segment !== '');

    // --- MODIFICATION: Specific override if incoming URL ends in .webp ---
    // Periksa apakah path URL masuk berakhir dengan .webp (case-insensitive)
    if (url.pathname.toLowerCase().endsWith('.webp')) {
        targetOrigin = 'https://desu.photos'; // Force target origin to desu.photos
        targetPath = url.pathname; // Use the original path from the incoming request
        console.log(`--- MENDETEKSI PERMINTAAN .webp. Memaksa Target Origin ke ${targetOrigin} ---`);
    }
    // --- AKHIR MODIFIKASI Override .webp ---

    // --- Logika penentuan target origin default (berjalan jika BUKAN .webp override) ---
    // Periksa apakah segmen pertama dari path adalah salah satu nama host resource yang diizinkan
    else if (pathSegments.length > 0 && allowedResourceDomains.includes(pathSegments[0])) {
        targetOrigin = `https://${pathSegments[0]}`;
        targetPath = '/' + pathSegments.slice(1).join('/');
        console.log(`--- MENDETEKSI PERMINTAAN RESOURCE dari domain ${pathSegments[0]} ---`);
    } else {
        targetOrigin = targetBaseUrl;
        targetPath = url.pathname;
         console.log(`--- MENDETEKSI PERMINTAAN DOMAIN UTAMA ---`);
    }
    // --- AKHIR Logika penentuan target origin default ---


    // Buat URL target lengkap untuk fetch
    const targetUrl = new URL(targetPath + url.search, targetOrigin);

    // Periksa apakah ini permintaan AJAX spesifik kita
    const isAjaxRequest = targetUrl.pathname === '/themes/ajax/ch.php' && request.method === 'POST' && targetOrigin === targetBaseUrl;


    // --- Logging untuk SEMUA permintaan fetch ke target ---
    console.log(`[${request.method}] Proxying: ${url.pathname}${url.search} -> ${targetUrl.toString()}`);

    // Tentukan set header berdasarkan jenis permintaan dan target origin
    let headersToUse: Record<string, string>;

    if (isAjaxRequest) {
        headersToUse = AJAX_HEADERS;
    } else {
        headersToUse = BROWSER_HEADERS;

        // Jika permintaan ditujukan ke domain resource (termasuk setelah .webp override),
        // atur Referer agar terlihat datang dari domain utama.
        if (targetOrigin !== targetBaseUrl) {
             console.log(`Mengatur Referer ke ${targetBaseUrl} untuk permintaan resource dari ${targetOrigin}`);
             headersToUse = { ...BROWSER_HEADERS, 'Referer': targetBaseUrl };
        }
    }

    // Buat objek Headers dari set header yang dipilih
    const headers = new Headers(headersToUse);

    // Meneruskan header cookie klien ke target
    const clientCookieHeader = request.headers.get('Cookie');
    if (clientCookieHeader) {
        headers.set('Cookie', clientCookieHeader);
    }

    console.log("Header Permintaan Keluar ke Target:");
    for (const [name, value] of headers.entries()) {
        console.log(`  ${name}: ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
    }
    // --- Akhir logging ---


    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: 'manual',
    });

    // --- Logging respons masuk untuk SEMUA fetch ---
    console.log(`[${request.method}] Received response from target: ${response.status}`);
    console.log("Header Respons Masuk dari Target:");
    for (const [name, value] of response.headers.entries()) {
        console.log(`  ${name}: ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
    }
    console.log(`Status Respons Target: ${response.status}`);

     try {
         if (response.status >= 400) {
            console.log(`Body Respons Target (Status ${response.status}, 5000 karakter pertama):`);
            const responseBodyText = await response.clone().text();
            console.log(responseBodyText.substring(0, 5000));
            if (responseBodyText.length > 5000) {
                console.log("...");
            }
         }
     } catch (bodyLogErr) {
         console.error("Gagal mencatat body respons error:", bodyLogErr);
     }
    // --- Akhir logging ---


    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/html') && targetOrigin === targetBaseUrl) { // Hanya proses HTML dari domain utama
        console.log("Content-Type is HTML from main domain, processing with Cheerio...");
        try {
            const html = await response.text();
            const $ = cheerio.load(html);

            const rewriteUrl = (url: string | null | undefined): string | null => {
                if (!url) return null;
                try {
                    const absoluteUrl = new URL(url, targetBaseUrl);

                    if (allAllowedDomains.includes(absoluteUrl.hostname)) {
                        // Rewrite as /hostname/path/query/hash
                        // Contoh: https://desu.photos/uploads/img.webp -> /desu.photos/uploads/img.webp
                        return `/${absoluteUrl.hostname}${absoluteUrl.pathname}${absoluteUrl.search}${absoluteUrl.hash}`;
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

            const modifiedHtml = $.html();

            // --- MODIFIKASI: Menerapkan .replace() seperti yang diminta ---
            // PERHATIAN: Ini bisa merusak logika proxying resource dan menyebabkan 404.
            console.warn(`Menerapkan replace("https://desu.photos", "") pada HTML. Ini mungkin menyebabkan masalah dengan resource domain.`);
            const finalHtml = modifiedHtml.replace("https://desu.photos", "");
            // --- AKHIR MODIFIKASI ---


            const modifiedHeaders = new Headers(response.headers);
            modifiedHeaders.delete('content-length');
            modifiedHeaders.delete('content-encoding');
            modifiedHeaders.set('content-type', 'text/html; charset=utf-8');

            return new Response(finalHtml, { // Mengembalikan finalHtml setelah replace
                status: response.status,
                statusText: response.statusText,
                headers: modifiedHeaders,
            });

        } catch (htmlProcessError) {
            console.error("Error processing HTML with Cheerio:", htmlProcessError);
             return new Response("Internal Server Error: HTML processing failed.", { status: 500 });
        }

    } else { // Non-HTML resources (termasuk respons AJAX dan resource domain)
        const originalHeaders = new Headers(response.headers);

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
// deno run --allow-net --allow-read=<DENO_CACHE_DIR> proxy_replace_webp_override.ts
// Atau (kurang aman): deno run -A proxy_replace_webp_override.ts
