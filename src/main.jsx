import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import posthog from 'posthog-js'

   posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY, {
     api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
   })

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);