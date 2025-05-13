import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

const targetBaseUrl = "https://doujindesu.tv";
const targetBaseHostname = new URL(targetBaseUrl).hostname;

// Daftar domain lain yang menghosting resource (gambar, CSS, dll.)
const allowedResourceDomains = [
    'desu.photos',
    // Tambahkan domain resource lain di sini jika Anda menemuinya
];

// Gabungkan semua domain yang diizinkan untuk pengecekan penulisan ulang URL
const allAllowedDomains = [targetBaseHostname, ...allowedResourceDomains];

// Header umum untuk permintaan non-AJAX ke targetBaseUrl
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Referer': targetBaseUrl, // Referer umum ke base URL
  'Origin': targetBaseUrl
};

// Header spesifik untuk permintaan AJAX ke /themes/ajax/ch.php
const AJAX_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36', // Mobile UA
    'Accept': '*/*', // Accept spesifik untuk AJAX
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7,ko;q=0.6,ja;q=0.5', // Bahasa lebih detail
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', // **Sangat penting untuk POST**
    'Origin': targetBaseUrl, // Origin tetap sama
    'Referer': `${targetBaseUrl}/`, // Referer menunjuk ke base URL
    'Sec-Ch-Ua': '"Chromium";v="137", "Not/A)Brand";v="24"', // Client hints
    'Sec-Ch-Ua-Mobile': '?1',
    'Sec-Ch-Ua-Platform': '"Android"',
    'Sec-Fetch-Dest': 'empty', // Nilai spesifik untuk permintaan AJAX resource
    'Sec-Fetch-Mode': 'cors', // Nilai spesifik untuk permintaan cross-origin/AJAX
    'Sec-Fetch-Site': 'same-origin', // Nilai spesifik untuk AJAX jika server menganggapnya same-origin
    'X-Requested-With': 'XMLHttpRequest', // Header umum AJAX, kemungkinan diperiksa
    'Accept-Encoding': 'gzip, deflate, br', // Mengindikasikan dukungan kompresi
};


async function handler(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    let targetOrigin: string;
    let targetPath: string;

    const pathSegments = url.pathname.split('/').filter(segment => segment !== '');

    // --- MODIFIKASI: Tentukan target origin dan path berdasarkan URL proxy masuk ---
    // Periksa apakah segmen pertama dari path adalah salah satu nama host resource yang diizinkan
    if (pathSegments.length > 0 && allowedResourceDomains.includes(pathSegments[0])) {
        targetOrigin = `https://${pathSegments[0]}`; // Target adalah domain resource
        targetPath = '/' + pathSegments.slice(1).join('/'); // Path adalah sisa segmen
        // --- Tambahkan logging permintaan resource ---
        console.log(`--- MENDETEKSI PERMINTAAN RESOURCE dari domain ${pathSegments[0]} ---`);
        console.log(`[${request.method}] Proxying Resource: ${url.pathname}${url.search} -> ${targetOrigin}${targetPath}${url.search}`);
        // --- Akhir logging ---
    } else {
        // Default: target adalah domain utama
        targetOrigin = targetBaseUrl;
        targetPath = url.pathname;
    }

    // Buat URL target lengkap
    const targetUrl = new URL(targetPath + url.search, targetOrigin);
    // --- AKHIR MODIFIKASI PENENTUAN TARGET URL ---


    // Periksa apakah ini permintaan AJAX spesifik kita
    const isAjaxRequest = targetUrl.pathname === '/themes/ajax/ch.php' && request.method === 'POST' && targetOrigin === targetBaseUrl;

    // --- Logging permintaan AJAX (jika isAjaxRequest true) ---
    if (isAjaxRequest) {
        console.log("--- MENDETEKSI PERMINTAAN AJAX POST ke /themes/ajax/ch.php ---");
        console.log(`[${request.method}] Proxying AJAX: ${url.pathname}${url.search} -> ${targetUrl.toString()}`); // Sesuaikan log
    }
    // --- Akhir logging AJAX ---


    // --- Tentukan set header berdasarkan jenis permintaan dan target origin ---
    let headersToUse: Record<string, string>;

    if (isAjaxRequest) {
        console.log("Menggunakan header spesifik AJAX.");
        headersToUse = AJAX_HEADERS;
    } else {
        // Untuk permintaan non-AJAX (HTML, CSS, Gambar, dll)
        headersToUse = BROWSER_HEADERS;

        // Jika permintaan ditujukan ke domain resource (bukan domain utama),
        // atur Referer agar terlihat datang dari domain utama.
        if (targetOrigin !== targetBaseUrl) {
             console.log(`Mengatur Referer ke ${targetBaseUrl} untuk permintaan resource dari ${targetOrigin}`);
             // Clone BROWSER_HEADERS untuk diubah
             headersToUse = { ...BROWSER_HEADERS, 'Referer': targetBaseUrl };
        }
    }

    // Buat objek Headers dari set header yang dipilih
    const headers = new Headers(headersToUse);

    // --- Meneruskan header cookie klien ke target ---
    const clientCookieHeader = request.headers.get('Cookie');
    if (clientCookieHeader) {
        headers.set('Cookie', clientCookieHeader);
        if (isAjaxRequest) {
           console.log(`Meneruskan header cookie klien: ${clientCookieHeader.substring(0, 50)}${clientCookieHeader.length > 50 ? '...' : ''}`);
        }
    }
    // --- Akhir penerusan cookie ---

    // Logging header permintaan keluar (untuk AJAX ATAU Resource)
    if (isAjaxRequest || targetOrigin !== targetBaseUrl) {
        console.log("Header Permintaan Keluar ke Target:");
        for (const [name, value] of headers.entries()) {
            console.log(`  ${name}: ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
        }
    }


    // Lakukan fetch ke URL target
    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: 'manual',
    });

    // Logging respons masuk (untuk AJAX ATAU Resource)
    if (isAjaxRequest || targetOrigin !== targetBaseUrl) {
         console.log(`[${request.method}] Received response from target: ${response.status}`); // Log status respons
         console.log("Header Respons Masuk dari Target:");
         for (const [name, value] of response.headers.entries()) {
             console.log(`  ${name}: ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
         }
         console.log(`Status Respons Target: ${response.status}`); // Status yang dikembalikan target


         try {
             // Log body untuk AJAX (terlepas dari status) dan Resource dengan status error (>= 400)
             if (isAjaxRequest || (targetOrigin !== targetBaseUrl && response.status >= 400)) {
                console.log("Body Respons Target (5000 karakter pertama):");
                const responseBodyText = await response.clone().text(); // Gunakan clone untuk logging body
                console.log(responseBodyText.substring(0, 5000));
                if (responseBodyText.length > 5000) {
                    console.log("...");
                }
             }
         } catch (bodyLogErr) {
             console.error("Gagal mencatat body respons:", bodyLogErr);
         }
    }


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

                    // Check if the hostname is in the list of all allowed domains
                    if (allAllowedDomains.includes(absoluteUrl.hostname)) {
                         // Rewrite as /hostname/path/query/hash
                        return `/${absoluteUrl.hostname}${absoluteUrl.pathname}${absoluteUrl.search}${absoluteUrl.hash}`;
                    }
                    // Jika eksternal dan tidak di domain resource yang diizinkan, kembalikan tanpa diubah
                    return url;
                } catch (e) {
                    console.warn(`Gagal mengurai atau menulis ulang URL: ${url}`, e); // Pertahankan warning
                    return url;
                }
            };

            // Daftar selector elemen dan atribut yang mungkin mengandung URL
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

            // Iterasi dan terapkan rewriteUrl
            elementsAndAttributes.forEach(({ selector, attribute }) => {
                $(selector).each((index, element) => {
                    const $element = $(element);
                    const originalUrl = $element.attr(attribute);

                    if (originalUrl) {
                         if (attribute === 'srcset') {
                             const rewrittenSrcset = originalUrl.split(',').map(srcsetItem => {
                                const parts = srcsetItem.trim().split(/\s+/);
                                if (parts.length > 0) {
                                    const urlPart = parts[0]; // Bagian URL
                                    const rewrittenUrlPart = rewriteUrl(urlPart);
                                     if (rewrittenUrlPart !== null && rewrittenUrlPart !== urlPart) {
                                         return [rewrittenUrlPart, ...parts.slice(1)].join(' '); // Gabungkan kembali
                                    }
                                }
                                return srcsetItem; // Kembalikan asli jika tidak direwrite
                            }).join(', '); // Gabungkan kembali semua

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

            // Logika penghapusan script tag inline
            let removedCount = 0;
            $('script:not([src])').each((index, element) => {
                const scriptContent = $(element).text();

                if (scriptContent.includes('mydomain')) {
                    $(element).remove();
                    removedCount++;
                }
            });

            const modifiedHtml = $.html();

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
            console.error("Error processing HTML with Cheerio:", htmlProcessError); // Pertahankan error
             return new Response("Internal Server Error: HTML processing failed.", { status: 500 });
        }

    } else { // Non-HTML resources (termasuk respons AJAX dan resource domain)
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
    console.error("Error handling request:", error); // Pertahankan error utama
    return new Response("Proxy error", { status: 500 });
  }
}

console.log(`Deno reverse proxy berjalan di http://localhost:${port}`); // Pesan startup
console.log(`Mem-proxy permintaan ke: ${targetBaseUrl}`); // Pesan startup

Deno.serve({ port }, handler);

// Cara menjalankan:
// deno run --allow-net --allow-read=<DENO_CACHE_DIR> proxy_debug_resource.ts
// Atau (kurang aman): deno run -A proxy_debug_resource.ts
