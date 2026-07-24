/** Cloudflare Worker entry point for the Vite single-page application. */

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
}

const worker = {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
};

export default worker;
