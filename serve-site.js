// Tiny local web server for this site — started by OPEN-SITE.bat.
// The video tools need the pages served over http:// (not opened as files),
// because browsers block FFmpeg's background worker on file:// pages.
const root = import.meta.dir;
const port = 8080;

try {
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith("/")) p += "index.html";
      let f = Bun.file(root + p);
      if (!(await f.exists()) && !p.includes(".")) {
        // support the site's clean URLs (e.g. /videotools/compressor)
        f = Bun.file(root + p + ".html");
      }
      if (await f.exists()) {
        // never cache pages/scripts/styles — fixes must show up on plain reload
        const noCache = /\.(html?|js|mjs|css)$/i.test(p) || p.endsWith("/");
        return new Response(f, noCache ? { headers: { "Cache-Control": "no-store" } } : undefined);
      }
      return new Response("Not found: " + p, { status: 404 });
    },
  });
  console.log("");
  console.log("  VidLab site is running.");
  console.log("  Open:  http://localhost:" + port + "/videotools/");
  console.log("");
  console.log("  Keep this window open while you use the tools.");
  console.log("  Close this window to stop the site.");
} catch (e) {
  if (String(e).includes("in use")) {
    console.log("The site is already running — just use the browser tab.");
  } else {
    console.log("Could not start: " + e);
  }
}
