import { lazy, Suspense } from "react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import Layout from "./components/Layout";
import { MainEditorProvider } from "./components/mainInput/TipTapEditor";

import { VscThemeProvider } from "./context/VscTheme";
import ParallelListeners from "./hooks/ParallelListeners";
import ErrorPage from "./pages/error";
import Chat from "./pages/gui";
import { ROUTES } from "./util/navigation";

const ConfigPage = lazy(() => import("./pages/config"));
const History = lazy(() => import("./pages/history"));
const Stats = lazy(() => import("./pages/stats"));
const ThemePage = lazy(() => import("./styles/ThemePage"));

const RouteFallback = () => (
  <div style={{ padding: "16px", fontSize: "12px", opacity: 0.7 }}>Loading...</div>
);

const initialRoute =
  typeof window !== "undefined" && (window as any).initialRoute
    ? (window as any).initialRoute
    : ROUTES.HOME;

const router = createMemoryRouter(
  [
    {
      path: ROUTES.HOME,
      element: <Layout />,
      errorElement: <ErrorPage />,
      children: [
        {
          path: "/index.html",
          element: <Chat />,
        },
        {
          path: ROUTES.HOME,
          element: <Chat />,
        },
        {
          path: "/history",
          element: (
            <Suspense fallback={<RouteFallback />}>
              <History />
            </Suspense>
          ),
        },
        {
          path: ROUTES.STATS,
          element: (
            <Suspense fallback={<RouteFallback />}>
              <Stats />
            </Suspense>
          ),
        },
        {
          path: ROUTES.CONFIG,
          element: (
            <Suspense fallback={<RouteFallback />}>
              <ConfigPage />
            </Suspense>
          ),
        },
        {
          path: ROUTES.THEME,
          element: (
            <Suspense fallback={<RouteFallback />}>
              <ThemePage />
            </Suspense>
          ),
        },
      ],
    },
  ],
  {
    initialEntries: [initialRoute],
    initialIndex: 0,
  }
);

/*
  ParallelListeners prevents entire app from rerendering on any change in the listeners,
  most of which interact with redux etc.
*/
function App() {
  return (
    <VscThemeProvider>
      <MainEditorProvider>
          <RouterProvider router={router} />
      </MainEditorProvider>
      <ParallelListeners />
    </VscThemeProvider>
  );
}

export default App;
