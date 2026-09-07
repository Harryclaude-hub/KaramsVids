import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="text-[13px] font-semibold text-muted-foreground">Fehler 404</p>
        <h1 className="mt-3 text-[30px] font-semibold tracking-tight text-foreground">Seite nicht gefunden</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Diese Seite gibt es nicht oder sie wurde verschoben.
        </p>
        <Link to="/" className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]">
          Zurück zur Startseite
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-[30px] font-semibold tracking-tight text-foreground">Beim Anzeigen ist etwas schiefgelaufen.</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">Versuch es noch einmal oder geh zurück zur Startseite.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button onClick={() => { router.invalidate(); reset(); }} className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-[#0077ed] dark:hover:bg-[#3ea0ff]">Erneut versuchen</button>
          <a href="/" className="inline-flex h-11 items-center rounded-[11px] bg-secondary px-5 text-[15px] font-semibold text-foreground transition-colors hover:bg-[#dcdce1] dark:hover:bg-[#3a3a3c]">Startseite</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "KaramsVids: KI-Videoschnitt für UGC & Shorts" },
      { name: "description", content: "Lade Rohvideos hoch, lass die KI Highlights finden, schneide UGC-Shorts mit Untertiteln und veröffentliche direkt auf TikTok, YouTube, Instagram & Co." },
      { property: "og:title", content: "KaramsVids: KI-Videoschnitt für UGC & Shorts" },
      { property: "og:description", content: "Lade Rohvideos hoch, lass die KI Highlights finden, schneide UGC-Shorts mit Untertiteln und veröffentliche direkt auf TikTok, YouTube, Instagram & Co." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "KaramsVids: KI-Videoschnitt für UGC & Shorts" },
      { name: "twitter:description", content: "Lade Rohvideos hoch, lass die KI Highlights finden, schneide UGC-Shorts mit Untertiteln und veröffentliche direkt auf TikTok, YouTube, Instagram & Co." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/eeb957a4-2f24-47c3-b3fa-46bbd827b429/id-preview-be665e35--110c9ea8-91da-4cb4-8c6a-4aa4858912b8.lovable.app-1784588641196.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/eeb957a4-2f24-47c3-b3fa-46bbd827b429/id-preview-be665e35--110c9ea8-91da-4cb4-8c6a-4aa4858912b8.lovable.app-1784588641196.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster theme="light" position="top-right" />
    </QueryClientProvider>
  );
}
