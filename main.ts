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

            let removedCount = 0;
            $('script').each((index, element) => {
                const scriptContent = $(element).text();

                if (scriptContent.includes('mydomain')) {
                    console.log(`Menghapus script tag index ${index} karena mengandung "mydomain" (konten awal: ${scriptContent.substring(0, 50)}...)`);
                    $(element).remove();
                    removedCount++;
                }
            });

            if (removedCount > 0) {
                console.log(`Total ${removedCount} script tag dihapus.`);
            } else {
                console.log("Tidak ada script tag yang mengandung 'mydomain' ditemukan.");
            }

            const modifiedHtml = $.html();
            console.log("HTML processed. Returning modified HTML.");

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
            console.warn("Returning original response due to HTML processing error.");
            return response;
        }

    } else {
        console.log(`Content-Type is not HTML (${contentType}), returning original response.`);
        return response;
    }

  } catch (error) {
    console.error("Error handling request:", error);
    return new Response("Proxy error", { status: 500 });
  }
}

console.log(`Deno reverse proxy running on http://localhost:${port}`);
console.log(`Proxying requests to: ${targetBaseUrl}`);

Deno.serve({ port }, handler);

// Cara menjalankan:
// Simpan kode ini dalam file (misal: proxy_cheerio.ts)
// Jalankan dari terminal: deno run --allow-net --allow-read=<DENO_CACHE_DIR> proxy_cheerio.ts
// Ganti <DENO_CACHE_DIR> dengan lokasi cache Deno Anda (biasanya di ~/.deno/deps)
// Atau (kurang aman): deno run -A proxy_cheerio.ts
