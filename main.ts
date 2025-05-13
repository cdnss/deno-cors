import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

const targetBaseUrl = "https://doujindesu.tv";

const port = 8000;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Referer': targetBaseUrl
};

async function handler(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const targetUrl = new URL(url.pathname + url.search, targetBaseUrl);

    console.log(`[${request.method}] Proxying: ${url.pathname}${url.search} -> ${targetUrl.toString()}`);

    const headers = new Headers(BROWSER_HEADERS);

    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: 'manual',
    });

    console.log(`[${request.method}] Received response from target: ${response.status}`);

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
        console.log("Content-Type is HTML, processing with Cheerio...");
        try {
            const html = await response.text();
            const $ = cheerio.load(html);

            // Fungsi bantu untuk menulis ulang URL
            const rewriteUrl = (url: string | null | undefined): string | null => {
                if (!url) return null; // Tidak ada URL untuk diproses
                try {
                    // Buat objek URL absolut berdasarkan URL target base dan URL yang ditemukan
                    const absoluteUrl = new URL(url, targetBaseUrl);

                    // Periksa apakah hostname URL ini sama dengan hostname targetBaseUrl
                    if (absoluteUrl.hostname === new URL(targetBaseUrl).hostname) {
                        // Jika ya, kembalikan hanya path, query, dan hash. Ini akan menjadi URL relatif
                        // terhadap root proxy, yang akan diminta oleh browser dari proxy itu sendiri.
                        return absoluteUrl.pathname + absoluteUrl.search + absoluteUrl.hash;
                    }
                    // Jika hostname berbeda (URL eksternal), kembalikan URL aslinya tanpa diubah
                    return url;
                } catch (e) {
                    // Jika parsing URL gagal, log peringatan dan kembalikan URL asli
                    console.warn(`Gagal mengurai atau menulis ulang URL: ${url}`, e);
                    return url;
                }
            };

            // Daftar selector elemen dan atribut yang mungkin mengandung URL
            const elementsAndAttributes = [
                { selector: 'a[href]', attribute: 'href' }, // Link
                { selector: 'link[href]', attribute: 'href' }, // CSS, ikon, prefetch, dll.
                { selector: 'script[src]', attribute: 'src' }, // Skrip eksternal
                { selector: 'img[src]', attribute: 'src' }, // Gambar
                { selector: 'img[srcset]', attribute: 'srcset' }, // Gambar responsif (lebih kompleks)
                { selector: 'source[src]', attribute: 'src' }, // Untuk gambar, audio, video
                { selector: 'source[srcset]', attribute: 'srcset' }, // Gambar responsif source
                { selector: 'form[action]', attribute: 'action' }, // Form submission URL
                { selector: 'video[src]', attribute: 'src' }, // Video
                { selector: 'video[poster]', attribute: 'poster' }, // Poster video
                { selector: 'audio[src]', attribute: 'src' }, // Audio
                { selector: 'use[href]', attribute: 'href' }, // SVG use
                { selector: 'iframe[src]', attribute: 'src' }, // Iframe
                // Pertimbangkan elemen lain jika perlu, misal: object[data], embed[src]
            ];

            // Iterasi melalui daftar dan terapkan rewriteUrl
            elementsAndAttributes.forEach(({ selector, attribute }) => {
                $(selector).each((index, element) => {
                    const $element = $(element);
                    const originalUrl = $element.attr(attribute);

                    if (originalUrl) {
                         // Penanganan khusus untuk srcset karena bisa berisi banyak URL
                        if (attribute === 'srcset') {
                            const rewrittenSrcset = originalUrl.split(',').map(srcsetItem => {
                                const parts = srcsetItem.trim().split(/\s+/);
                                if (parts.length > 0) {
                                    const urlPart = parts[0]; // Bagian URL di srcset
                                    const rewrittenUrlPart = rewriteUrl(urlPart);
                                    if (rewrittenUrlPart !== null && rewrittenUrlPart !== urlPart) {
                                         // Gabungkan kembali URL yang ditulis ulang dengan descriptor (misal: 1x, 400w)
                                         return [rewrittenUrlPart, ...parts.slice(1)].join(' ');
                                    }
                                }
                                return srcsetItem; // Kembalikan bagian asli jika tidak ada perubahan atau error
                            }).join(', '); // Gabungkan kembali semua bagian srcset

                            if (rewrittenSrcset !== originalUrl) {
                                $element.attr(attribute, rewrittenSrcset);
                                console.log(`Menulis ulang srcset untuk ${selector} index ${index}: ${originalUrl} -> ${rewrittenSrcset.substring(0, 50)}...`);
                            }
                        } else {
                            // Penanganan untuk atribut URL tunggal
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


            // --- Logika penghapusan script tag (sebelumnya) ---
            let removedCount = 0;
            // Kita hanya perlu memeriksa script tag inline (tanpa src)
            // karena script tag dengan src sudah ditangani di rewriteUrl
            $('script:not([src])').each((index, element) => {
                const scriptContent = $(element).text();

                if (scriptContent.includes('mydomain')) {
                    console.log(`Menghapus script tag inline index ${index} karena mengandung "mydomain" (konten awal: ${scriptContent.substring(0, 50)}...)`);
                    $(element).remove();
                    removedCount++;
                }
            });
            console.log(`Penghapusan script tag selesai. Dihapus ${removedCount}.`);
            // --- Akhir logika penghapusan script tag ---


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
            console.warn("Mengembalikan respons asli karena kesalahan pemrosesan HTML.");
            return response;
        }

    } else {
        console.log(`Content-Type bukan HTML (${contentType}), mengembalikan respons asli.`);
        return response;
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
// Simpan kode ini dalam file (misal: proxy_rewrite.ts)
// Jalankan dari terminal: deno run --allow-net --allow-read=<DENO_CACHE_DIR> proxy_rewrite.ts
// Ganti <DENO_CACHE_DIR> dengan lokasi cache Deno Anda jika Anda menemui error terkait baca.
// Atau (kurang aman): deno run -A proxy_rewrite.ts
