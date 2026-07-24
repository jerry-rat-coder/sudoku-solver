/** Cloudflare Worker entry point for the Vite single-page application. */

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request);
    if (!response.headers.get("content-type")?.includes("text/html")) {
      return response;
    }

    const origin = new URL(request.url).origin;
    const html = (await response.text()).replaceAll("__SITE_ORIGIN__", origin);
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },
};

export default worker;
