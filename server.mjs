import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 4177);
const pubmedSearchUrl = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const pubmedSummaryUrl = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://localhost:${port}`);

  if (url.pathname === "/api/pubmed/search" || url.pathname === "/api/pubmed/summary") {
    await proxyPubMed(url, response);
    return;
  }

  const safePath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(root, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, "index.html");
  }

  response.writeHead(200, {
    "content-type": types[extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`SignalMD running at http://127.0.0.1:${port}`);
});

async function proxyPubMed(url, response) {
  const target = new URL(url.pathname.endsWith("/search") ? pubmedSearchUrl : pubmedSummaryUrl);
  url.searchParams.forEach((value, key) => target.searchParams.set(key, value));

  try {
    const upstream = await fetch(target, {
      headers: {
        "accept": "application/json",
        "user-agent": "SignalMD local source proxy",
      },
    });
    const body = await upstream.text();
    response.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }));
  }
}
