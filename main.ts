import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

const targetBaseUrl = "https://doujindesu.tv";

const port = 8000;

// Header yang akan dikirimkan ke server target untuk meniru browser
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Referer': targetBaseUrl, // Referer sudah disetel ke URL target
  'Origin': targetBaseUrl // Tambahkan header Origin dan set ke URL target
};

async function handler(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const targetUrl = new URL(url.pathname + url.search, targetBaseUrl);

    console.log(`[${request.method}] Proxying: ${url.pathname}${url.search} -> ${targetUrl.toString()}`);

    // Buat objek Headers baru untuk permintaan keluar ke target
    // Objek Headers ini akan menggunakan header dari BROWSER_HEADERS
    const headers = new Headers(BROWSER_HEADERS);

    // Anda bisa menambahkan logika untuk menyalin header tertentu dari permintaan klien
    // jika Anda membutuhkannya, tapi hati-hati dengan header sensitif.


    // Lakukan fetch ke URL target menggunakan metode dan body dari permintaan masuk
    // Header 'headers' yang kita siapkan akan digunakan di sini
    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: headers, // MENGGUNAKAN HEADER YANG SUDAH TERMASUK REFERER DAN ORIGIN
      body: request.body,
      redirect: 'manual',
    });

    console.log(`[${request.method}] Received response from target: ${response.status}`);

    // ... sisa logika penanganan respons HTML vs non-HTML tetap sama ...
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
        console.log("Content-Type is HTML, processing with Cheerio...");
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
                                console.log(`Menulis ulang srcset untuk ${selector} index ${index}: ${originalUrl} -> ${rewrittenSrcset.substring(0, 50)}...`);
                            }
                        } else {
                            const rewrittenUrl = rewriteUrl(originalUrl);
                            if (rewrittenUrl !== null && rewrittenUrl !== originalUrl) {
                                $element.attr(attribute, rewrittenUrl);
                                console.log(`Menulis ulang ${attribute} untuk ${selector} index ${index}: ${originalUrl} -> ${rewrittenUrl.substring(0, 50)}...`);
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
                    console.log(`Menghapus script tag inline index ${index} karena mengandung "mydomain" (konten awal: ${scriptContent.substring(0, 50)}...)`);
                    $(element).remove();
                    removedCount++;
                }
            });
            console.log(`Penghapusan script tag selesai. Dihapus ${removedCount}.`);


            const modifiedHtml = $.html().replace('url: "/themes/ajax/ch.php"', `url: "{targetBaseUrl}/themes/ajax/ch.php"`);
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
            console.warn("Mengembalikan respons asli karena kesalahan pemrosesan HTML.");
             return new Response("Internal Server Error: HTML processing failed.", { status: 500 });
        }

    } else {
        console.log(`Content-Type bukan HTML (${contentType}), mengembalikan respons asli dengan headers disalin.`);

        const originalHeaders = new Headers(response.headers);

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
