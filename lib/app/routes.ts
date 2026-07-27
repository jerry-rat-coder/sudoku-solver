export type AppRoute = "entry" | "replay";

export function appRouteFromPath(pathname: string): AppRoute {
  return pathname === "/replay" || pathname.startsWith("/replay/")
    ? "replay"
    : "entry";
}
