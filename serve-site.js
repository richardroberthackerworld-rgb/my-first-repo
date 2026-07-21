// Local preview of the VidLab / ClipCut subdomain — started by OPEN-SITE.bat.
// Serves the videotools folder AS THE SITE ROOT, exactly like video.7by.in will,
// and maps /assets/* and /pricing.html to the shared files in the parent folder.
// (The tools need a real http:// address; opening the HTML files directly fails
//  because browsers block the background worker the video engine needs.)
const repo = import.meta.dir;
const root = repo + "/videotools";
const port = 8080;

async function pick(pathname) {
  let p = decodeURIComponent(pathname);
  if (p.endsWith("/")) p += "index.html";

  // shared files that live at the repo root but ship to the subdomain root
  if (p.startsWith("/assets/") || p === "/pricing.html") {
    const shared = Bun.file(repo + p);
    if (await shared.exists()) return shared;
  }

  let f = Bun.file(root + p);
  if (await f.exists()) return f;
  // clean URLs (/compressor -> compressor.html), same as the .htaccess rule
  if (!p.includes(".")) {
    f = Bun.file(root + p + ".html");
    if (await f.exists()) return f;
  }
  return null;
}

try {
  Bun.serve({
    port,
    async fetch(req) {
      const f = await pick(new URL(req.url).pathname);
      if (!f) return new Response("Not found", { status: 404 });
      // never cache: fixes should show up on a plain reload
      return new Response(f, { headers: { "Cache-Control": "no-store" } });
    },
  });
  console.log("");
  console.log("  VidLab site is running.");
  console.log("  Open:  http://localhost:" + port + "/");
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
