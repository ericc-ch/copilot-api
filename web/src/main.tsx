import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import { I18nProvider } from "./i18n"
import "./index.css"

const root = document.querySelector("#root")
if (root) {
  createRoot(root).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>,
  )
}
